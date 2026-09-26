// Reads the sanitized Salebase page (salebase-phone-scripts.html) into plain
// text for the objection tests: every script body line the rep reads, every
// rebuttal title per script, and every rebuttal answer.
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, 'salebase-phone-scripts.html'), 'utf8');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (text) => text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, code) => {
  if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
  return ENTITIES[code.toLowerCase()] ?? all;
});
const BLOCK = /<\/?(?:div|p|br|li|ul|ol|h\d|button|tr|td|table)\b[^>]*>/gi;
const toText = (html) => decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(BLOCK, '\n').replace(/<[^>]+>/g, ''));
const clean = (text) => text.replace(/[ \t\u00a0]+/g, ' ').trim();

// <span class="script-type VALUE">…</span> blocks, balanced.
function blocks(region) {
  const out = [];
  const open = /<span class="script-type ([^"]+)"[^>]*>/g;
  let match;
  while ((match = open.exec(region))) {
    let depth = 1; const tag = /<span\b|<\/span>/g; tag.lastIndex = open.lastIndex; let end;
    while (depth && (end = tag.exec(region))) depth += end[0] === '</span>' ? -1 : 1;
    out.push({ script: match[1].split(/\s+/)[0], html: region.slice(open.lastIndex, end ? end.index : region.length) });
    open.lastIndex = end ? end.index : region.length;
  }
  return out;
}

const left = HTML.slice(HTML.indexOf('class="left-column"'), HTML.indexOf('id="rebuttalsColumn"'));
const right = HTML.slice(HTML.indexOf('id="rebuttalsColumn"'), HTML.indexOf('id="leadGlossaryOverlay"'));

// Each script's text split into the lines/sentences the rep says.
const scripts = blocks(left).map(({ script, html }) => {
  const text = toText(html);
  const lines = text.split('\n').map(clean).filter(Boolean);
  const sentences = lines.flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z(“"])/)).map(clean).filter((line) => /[a-z]/i.test(line));
  return { script, lines, sentences, text: clean(text.replace(/\n+/g, ' ')) };
});

const rebuttals = blocks(right).flatMap(({ script, html }) => {
  const items = [];
  const re = /<span class="ConditionalChar">([\s\S]*?)<\/span>\s*<div class="rebuttal-answer">([\s\S]*?)<\/div>\s*<\/p>/g;
  let match;
  while ((match = re.exec(html))) items.push({ script, title: clean(toText(match[1])), answer: clean(toText(match[2]).replace(/\(back to script\)/gi, ' ').replace(/\n+/g, ' ')) });
  return items;
});

const OPTION_LABELS = Object.fromEntries([...HTML.matchAll(/<option value="([A-Z-]+)">\s*([^<]+?)\s*<\/option>/g)].map((m) => [m[1], decode(m[2])]));

module.exports = { scripts, rebuttals, OPTION_LABELS };
