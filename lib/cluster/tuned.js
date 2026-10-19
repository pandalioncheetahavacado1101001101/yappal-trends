'use strict';
/*
 * The clustering thresholds a model is run with (lib/cluster/cluster.js THRESHOLDS for what each means). Tuned on the frozen day
 * 2026-10-12 ONLY (node lib/cluster/bench.js --day 2026-10-12 --tune) and reported on 2026-10-12b; a model with no tuned row runs
 * the proposal's numbers, marked untuned, and must be tuned the same way before it ships (ios/IDEAS-SUPER.md P8 gate).
 */
const { THRESHOLDS } = require('./cluster');

const TUNED = {
  // The deterministic stand-in (lib/cluster/stub.js, a lexical TF-IDF vector): tuned 2026-10-20 on rows+vectors, 2026-10-12 only.
  // Its cosines are a word-overlap scale (one story's pairs: median 0.27), so these numbers say nothing about a real model's.
  'stub-hash': { seeded: 0.05, named: 0.4, nameOnly: 0.85, rare: 0.6, free: 0.88, cross: 0.575, slack: 0.25 },
};

/** The thresholds for a model: its tuned row over the proposal's numbers; `tuned` says which. */
function thresholdsFor(model) {
  const row = TUNED[String(model || '').replace(/:latest$/, '')];
  return { ...THRESHOLDS, ...(row || {}), tuned: !!row };
}

module.exports = { thresholdsFor, TUNED };
