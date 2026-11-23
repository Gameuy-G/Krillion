// game.js - Dive App engine: normalize, alias + fuzzy match, tiers, points. No DOM here.
var DiveGame = (function () {
  "use strict";

  var ROUND_SIZE = 7;
  var SECONDS_PER_PROMPT = 25;
  var METERS_PER_POINT = 10; // assumption: sink depth = points * 10 m

  var TIERS = {
    nothing:   { key: "nothing",   label: "NOTHING LANDED",   points: 0,   flavour: "never made it onto the reef" },
    plankton:  { key: "plankton",  label: "PLANKTON",         points: 10,  flavour: "the answer everyone blurts out" },
    tooclever: { key: "tooclever", label: "TOO CLEVER",       points: 15,  flavour: "technically true... barely" },
    schooler:  { key: "schooler",  label: "SCHOOLER",         points: 30,  flavour: "swimming with the school" },
    rare:      { key: "rare",      label: "RARE",             points: 60,  flavour: "now that is a rare catch" },
    deepcut:   { key: "deepcut",   label: "DEEP CUT",         points: 80,  flavour: "seriously deep pull" },
    krillion:  { key: "krillion",  label: "ONE IN A KRILLION", points: 100, flavour: "trench dweller. absurd." }
  };
  // share of the prompt's total weight -> tier (checked in this order)
  var SHARE_CUTS = [["plankton", 0.10], ["schooler", 0.03], ["rare", 0.01], ["deepcut", 0.003]];

  function tierFor(share, answer) {
    if (!answer || !(answer.weight > 0)) return "nothing";
    if (answer.clever) return "tooclever";
    for (var i = 0; i < SHARE_CUTS.length; i++) {
      if (share >= SHARE_CUTS[i][1]) return SHARE_CUTS[i][0];
    }
    return "krillion";
  }

  // lowercase, strip accents/punctuation, collapse spaces, drop leading the/a/an
  function normalize(s) {
    s = String(s == null ? "" : s).toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/&/g, " and ").replace(/[^a-z0-9#+ ]+/g, " ");
    s = s.replace(/\s+/g, " ").replace(/^ | $/g, "");
    return s.replace(/^(the|a|an) (?=.)/, "");
  }

  // optimal string alignment distance (insert/delete/replace/swap = 1), stops early above max
  function distance(a, b, max) {
    var la = a.length, lb = b.length, i, j, cost, v, row, prev = null, cur = null, prev2 = null;
    if (Math.abs(la - lb) > max) return max + 1;
    prev = []; for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = [i]; row = i;
      for (j = 1; j <= lb; j++) {
        cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
      }
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }

  var cache = typeof WeakMap !== "undefined" ? new WeakMap() : null;

  function getIndex(p) {
    if (cache && cache.has(p)) return cache.get(p);
    var total = 0, i, j;
    for (i = 0; i < p.answers.length; i++) total += Math.max(0, p.answers[i].weight);
    var idx = { total: total, keys: {}, kinds: {}, recs: [], collisions: [] };
    for (i = 0; i < p.answers.length; i++) {
      var a = p.answers[i];
      var share = total > 0 ? Math.max(0, a.weight) / total : 0;
      var rec = { answer: a, canonical: a.canonical, weight: a.weight, share: share, tier: tierFor(share, a) };
      idx.recs.push(rec);
      var names = [a.canonical].concat(a.aliases || []);
      for (j = 0; j < names.length; j++) {
        var k = normalize(names[j]);
        if (!k) continue;
        if (idx.keys[k] && idx.keys[k] !== rec) { idx.collisions.push(k); continue; }
        idx.keys[k] = rec;
        if (!idx.kinds[k]) idx.kinds[k] = j === 0 ? "exact" : "alias";
      }
    }
    idx.keyList = Object.keys(idx.keys);
    if (cache) cache.set(p, idx);
    return idx;
  }

  // -> {status: "exact"|"alias"|"fuzzy"|"none", rec}
  function lookup(p, raw) {
    var idx = getIndex(p), n = normalize(raw), i;
    if (!n) return { status: "none" };
    var variants = [n];
    if (n.length > 3 && /s$/.test(n)) variants.push(n.slice(0, -1));
    if (n.length > 4 && /es$/.test(n)) variants.push(n.slice(0, -2));
    for (i = 0; i < variants.length; i++) {
      var v = variants[i];
      if (idx.keys[v]) return { status: idx.kinds[v] === "alias" ? "alias" : "exact", rec: idx.keys[v] };
    }
    var limit = n.length <= 3 ? 0 : (n.length <= 7 ? 1 : 2);
    if (limit) {
      var best = null, bestD = limit + 1, tie = false;
      for (i = 0; i < idx.keyList.length; i++) {
        var d = distance(n, idx.keyList[i], limit);
        if (d > limit) continue;
        var r = idx.keys[idx.keyList[i]];
        if (d < bestD) { bestD = d; best = r; tie = false; }
        else if (d === bestD && r !== best) tie = true;
      }
      if (best && !tie) return { status: "fuzzy", rec: best };
    }
    return { status: "none" };
  }

  function shorten(s) { s = String(s == null ? "" : s).replace(/\s+/g, " ").replace(/^ | $/g, ""); return s.length > 24 ? s.slice(0, 24) + "..." : s; }

  // One submit. UI: if status is "confirm", ask again; when the same text is submitted a 2nd time call with confirmed=true.
  // -> {status: "empty"|"noecho"|"confirm"|"scored", ...}
  function evaluate(p, raw, confirmed) {
    var shown = shorten(raw);
    if (!normalize(raw)) return { status: "empty", message: "type an answer first" };
    var m = lookup(p, raw);
    if (m.status === "none") return { status: "noecho", input: shown, message: '"' + shown + '": no echo. try again' };
    var rec = m.rec;
    if ((m.status === "alias" || m.status === "fuzzy") && !confirmed) {
      return { status: "confirm", input: shown, target: rec.canonical, via: m.status,
        message: '"' + shown + '" -> "' + rec.canonical + '"', hint: "submit again to confirm - or edit" };
    }
    var t = TIERS[rec.tier];
    return { status: "scored", canonical: rec.canonical, tier: t.key, label: t.label, flavour: t.flavour,
      points: t.points, meters: t.points * METERS_PER_POINT, share: rec.share, weight: rec.weight, via: m.status };
  }

  // n random distinct prompts (rng returns [0,1) - pass a seeded one for tests)
  function pickRound(prompts, n, rng) {
    rng = rng || Math.random; n = Math.min(n || ROUND_SIZE, prompts.length);
    var pool = prompts.slice(), out = [], i, j, tmp;
    for (i = 0; i < n; i++) {
      j = i + Math.floor(rng() * (pool.length - i));
      tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; out.push(pool[i]);
    }
    return out;
  }

  return { ROUND_SIZE: ROUND_SIZE, SECONDS_PER_PROMPT: SECONDS_PER_PROMPT, METERS_PER_POINT: METERS_PER_POINT,
    TIERS: TIERS, SHARE_CUTS: SHARE_CUTS, tierFor: tierFor, normalize: normalize, distance: distance,
    getIndex: getIndex, lookup: lookup, evaluate: evaluate, pickRound: pickRound };
})();
if (typeof module !== "undefined") module.exports = DiveGame;
