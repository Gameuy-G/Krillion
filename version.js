// version.js - bump VERSION every batch (batch N = v0.N.0) and add a CHANGELOG entry at the TOP.
var VERSION = "0.1.0";
var CHANGELOG = [
  { version: "0.1.0", batch: 1, date: "2026-11-23", notes: "GitHub Pages placeholder, 20 starter prompts (40 answers each), matching + scoring engine, node tests." }
];
if (typeof module !== "undefined") module.exports = { VERSION: VERSION, CHANGELOG: CHANGELOG };
