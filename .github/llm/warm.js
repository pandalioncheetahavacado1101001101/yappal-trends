#!/usr/bin/env node
'use strict';
/*
 * Reads the editor's unchanging prompt (its system text and worked examples: lib/editor/prompt.js) to the local model once, so the
 * runner's prompt cache holds it before the cycle's first card is asked for: every card's request starts with the same text, and
 * only the story after it is new.   node .github/llm/warm.js <model> [seconds it may take]
 * Best effort: any failure is silence and exit 0 (the first card then reads the prompt itself, and is a little slower).
 */
const path = require('node:path');

const model = process.argv[2];
const seconds = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 120;
(async () => {
  try {
    const P = require(path.join(__dirname, '..', '..', 'lib', 'editor', 'prompt'));
    const story = { title: 'Warm up', subject: 'Warm up', facts: {}, shown: [{ text: 'A sentence that warms the model up and tells nothing.', type: 'page', outlet: null, t: 0 }] };
    const body = { ...P.bodyFor(story, { model, maxTokens: 1, reasoning: 'none' }) };
    const started = Date.now();
    const res = await fetch('http://127.0.0.1:11434/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(seconds * 1000) });
    await res.text();
    process.stdout.write(`model: the editor's prompt was read in ${Math.round((Date.now() - started) / 1000)} s (HTTP ${res.status})\n`);
  } catch (e) {
    process.stdout.write(`model: the editor's prompt was not read ahead (${e && e.name}); the first card reads it\n`);
  }
})();
