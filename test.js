// test.js - run with: node test.js
var fs = require("fs");
var G = require("./game.js"), PROMPTS = require("./prompts.js"), V = require("./version.js");
var fails = 0, n = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log("FAIL: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

// version
ok(/^0\.\d+\.0$/.test(V.VERSION), "VERSION format");
eq(V.CHANGELOG[0].version, V.VERSION, "changelog top = VERSION");

// data
eq(PROMPTS.length, 20, "20 prompts");
var ids = {};
PROMPTS.forEach(function (p) {
  ok(!ids[p.id], "unique id " + p.id); ids[p.id] = 1;
  eq(p.answers.length, 40, p.id + " has 40 answers");
  var idx = G.getIndex(p), counts = {}, canon = {};
  eq(idx.collisions.length, 0, p.id + " key collisions " + idx.collisions.join(","));
  p.answers.forEach(function (a) {
    ok(a.weight > 0, p.id + " weight " + a.canonical);
    ok(!canon[a.canonical], p.id + " dup " + a.canonical); canon[a.canonical] = 1;
  });
  idx.recs.forEach(function (r) { counts[r.tier] = (counts[r.tier] || 0) + 1; });
  ok(counts.plankton >= 3 && counts.schooler >= 7 && counts.rare >= 12 && counts.deepcut >= 10 && counts.krillion >= 7, p.id + " tier spread " + JSON.stringify(counts));
  ok((counts.tooclever || 0) <= 1, p.id + " too many clever");
});
ok(!/[^\x00-\x7F]/.test(fs.readFileSync("./prompts.js", "utf8")), "prompts.js pure ASCII");
ok(!/[^\x00-\x7F]/.test(fs.readFileSync("./game.js", "utf8")), "game.js pure ASCII");

// normalize
eq(G.normalize("  The  SHARK! "), "shark", "normalize the/case/punct");
eq(G.normalize("Caf\u00e9"), "cafe", "normalize accent");
eq(G.normalize("T-Rex"), "t rex", "normalize hyphen");
eq(G.normalize("C++"), "c++", "keep ++");
eq(G.normalize("a"), "a", "single article kept");

// tier boundaries
eq(G.tierFor(0.10, { weight: 1 }), "plankton", "cut plankton");
eq(G.tierFor(0.0999, { weight: 1 }), "schooler", "just under plankton");
eq(G.tierFor(0.03, { weight: 1 }), "schooler", "cut schooler");
eq(G.tierFor(0.01, { weight: 1 }), "rare", "cut rare");
eq(G.tierFor(0.003, { weight: 1 }), "deepcut", "cut deepcut");
eq(G.tierFor(0.0029, { weight: 1 }), "krillion", "krillion");
eq(G.tierFor(0.5, { weight: 1, clever: true }), "tooclever", "clever");
eq(G.tierFor(0.5, { weight: 0 }), "nothing", "zero weight");

// evaluate on p01 (fish eaters)
var p1 = PROMPTS[0], r;
r = G.evaluate(p1, "shark"); eq(r.status, "scored", "shark scored"); eq(r.tier, "plankton", "shark plankton"); eq(r.points, 10, "shark 10"); eq(r.meters, 100, "shark meters");
r = G.evaluate(p1, "Sharks"); eq(r.status, "scored", "plural exact"); eq(r.canonical, "Shark", "plural -> Shark");
r = G.evaluate(p1, "great white shark"); eq(r.status, "confirm", "alias asks confirm"); eq(r.message, '"great white shark" -> "Shark"', "alias msg"); eq(r.hint, "submit again to confirm - or edit", "alias hint");
r = G.evaluate(p1, "great white shark", true); eq(r.status, "scored", "alias confirmed"); eq(r.canonical, "Shark", "alias target");
r = G.evaluate(p1, "Pengiun"); eq(r.status, "confirm", "swap typo fuzzy"); eq(r.target, "Penguin", "fuzzy target"); eq(r.via, "fuzzy", "via fuzzy");
r = G.evaluate(p1, "idk"); eq(r.status, "noecho", "idk noecho"); eq(r.message, '"idk": no echo. try again', "noecho msg");
r = G.evaluate(p1, "cot"); eq(r.status, "noecho", "3-letter no fuzzy");
r = G.evaluate(p1, "   "); eq(r.status, "empty", "empty");
r = G.evaluate(p1, "human"); eq(r.tier, "tooclever", "human clever"); eq(r.points, 15, "clever 15");
r = G.evaluate(p1, "puffin"); eq(r.tier, "deepcut", "puffin deepcut"); eq(r.points, 80, "deepcut 80");
r = G.evaluate(p1, "Cod"); eq(r.tier, "krillion", "cod krillion"); eq(r.points, 100, "krillion 100");
r = G.evaluate(p1, "dolphin"); eq(r.tier, "schooler", "dolphin schooler"); eq(r.points, 30, "schooler 30");
r = G.evaluate(p1, "tern"); eq(r.tier, "deepcut", "tern deepcut");
r = G.evaluate(p1, "egret"); eq(r.tier, "deepcut", "egret deepcut");
r = G.evaluate(p1, "sea lion"); eq(r.tier, "rare", "sea lion rare"); eq(r.points, 60, "rare 60");
r = G.evaluate(PROMPTS[10], "olso"); eq(r.status, "confirm", "Olso -> Oslo"); eq(r.target, "Oslo", "Oslo target");
r = G.evaluate(PROMPTS[4], "c#"); eq(r.canonical, "C#", "c# exact");
r = G.evaluate(PROMPTS[18], "kunafa"); eq(r.status, "scored", "kunafa canonical");

// ambiguity + nothing landed (synthetic prompts)
var amb = { id: "t1", text: "t", answers: [{ canonical: "Bark", weight: 5, aliases: [] }, { canonical: "Bank", weight: 5, aliases: [] }] };
eq(G.evaluate(amb, "baik").status, "noecho", "ambiguous fuzzy -> noecho");
var nl = { id: "t2", text: "t", answers: [{ canonical: "Alpha", weight: 10, aliases: [] }, { canonical: "Beta", weight: 0, aliases: [] }] };
r = G.evaluate(nl, "beta"); eq(r.status, "scored", "zero weight scored"); eq(r.tier, "nothing", "nothing tier"); eq(r.points, 0, "nothing 0"); eq(r.label, "NOTHING LANDED", "nothing label");
eq(G.evaluate(nl, "alpha").tier, "plankton", "sole answer plankton");

// pickRound
var seed = 7, rng = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
var round = G.pickRound(PROMPTS, 7, rng), seen = {};
eq(round.length, 7, "round of 7");
round.forEach(function (p) { ok(!seen[p.id], "round dup " + p.id); seen[p.id] = 1; });
eq(G.pickRound(PROMPTS.slice(0, 3), 7).length, 3, "round capped by pool");
eq(G.pickRound(PROMPTS).length, 7, "default 7");

console.log(n + " checks, " + fails + " failed");
process.exit(fails ? 1 : 0);
