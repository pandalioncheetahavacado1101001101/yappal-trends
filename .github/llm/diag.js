#!/usr/bin/env node
'use strict';
/* Asks the local model the same small question three ways (plain, reasoning_effort none, think false) and writes what came back
 * (the answer's first characters, how much was reasoning, tokens, seconds) to diag.md: which switch stops a model thinking aloud. */
const fs = require('node:fs');

const model = process.argv[2];
const base = 'http://127.0.0.1:11434/v1/chat/completions';
const messages = [
  { role: 'system', content: 'You write one plain sentence saying who did or is accused of what, from the sources only. Answer with JSON only: {"line": "..."}' },
  { role: 'user', content: 'Title: Jack Doherty contract\nSources:\n1. Jack Doherty says a sponsorship contract he signed without reading bars him from posting for six months.\n2. Shuffle chief replies "money well spent" after Jack Doherty complains about posting ban.' },
];
const ways = [['plain', {}], ['reasoning_effort none', { reasoning_effort: 'none' }], ['think false', { think: false }], ['no response_format', { __noFormat: true }]];

(async () => {
  const out = [`### ${model}`, ''];
  for (const [name, extra] of ways) {
    const body = { model, messages, temperature: 0.2, max_tokens: 400, response_format: { type: 'json_object' }, ...extra };
    if (extra.__noFormat) { delete body.response_format; delete body.__noFormat; }
    const t0 = Date.now();
    let line;
    try {
      const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(170000) });
      const text = await res.text();
      let j = null; try { j = JSON.parse(text); } catch { j = null; }
      const m = j && j.choices && j.choices[0] ? j.choices[0].message || {} : {};
      const content = typeof m.content === 'string' ? m.content : '';
      const reasoning = typeof m.reasoning === 'string' ? m.reasoning : typeof m.reasoning_content === 'string' ? m.reasoning_content : '';
      const u = (j && j.usage) || {};
      line = `- ${name}: HTTP ${res.status}, ${((Date.now() - t0) / 1000).toFixed(1)}s, prompt ${u.prompt_tokens ?? '?'} + answer ${u.completion_tokens ?? '?'} tokens, reasoning ${reasoning.length} chars, content: ${JSON.stringify(content.slice(0, 260))}${res.status !== 200 ? ' body: ' + JSON.stringify(text.slice(0, 200)) : ''}`;
    } catch (e) {
      line = `- ${name}: failed after ${((Date.now() - t0) / 1000).toFixed(1)}s (${e && e.name})`;
    }
    out.push(line);
  }
  out.push('');
  fs.appendFileSync('diag.md', out.join('\n') + '\n');
})();
