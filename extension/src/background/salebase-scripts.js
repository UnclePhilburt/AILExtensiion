export const SALEBASE_SCRIPTS_URL = 'https://salebase.ai/phone_scripts/phone_scripts.php';

// Salebase's visible dropdown labels, most specific first.
export const SALEBASE_SCRIPT_LABELS = ['Response Card', 'Will Kit', 'MediaPlex', 'Child Safe Referral', 'Child Safe', 'POS Beneficiary',
  'POS Lapsed', 'Globe Lapse', 'Globe', 'AILPlus (Non-Customer)', 'AILPlus', 'Final Expense'];

const GROUP_CODE_TYPE = /(?:^|[\s,;:|-])(?:[A-Z][A-Z&.'\/-]*[A-Z&.]|Local|Lodge|District|Council|Chapter)\s+#?\d{1,5}[A-Z]?\s*\((?=[^()]*[A-Za-z])[A-Za-z0-9&\/.' -]{1,20}\)/;

// IMPACT request type text -> { label, rule }. Request types are free text, so
// the rules stay readable and tolerate small wording differences.
// Union / Association member requests are the leads who "sent back a reply
// card": Salebase's Response Card script. IMPACT does not call them that.
// details.group: the lead's group from the IMPACT page (browser-only), used
// only when the request type alone does not decide.
export function scriptChoiceForLead(requestType, details = {}) {
  const type = String(requestType || '').toLowerCase().replace(/[\u00a0\s]+/g, ' ');
  const rules = [
    ['response card', /response\s*cards?|reply\s*cards?|\brc\b/, 'Response Card'],
    ['will kit', /will\s*kit/, 'Will Kit'],
    ['mediaplex', /media\s*plex/, 'MediaPlex'],
    ['child safe referral', /child\s*safe.*referral/, 'Child Safe Referral'],
    ['child safe', /child\s*safe/, 'Child Safe'],
    ['pos beneficiary', /pos.*beneficiar|beneficiar.*pos/, 'POS Beneficiary'],
    ['pos lapsed', /pos.*laps|laps.*pos/, 'POS Lapsed'],
    ['globe lapse', /globe.*laps|laps.*globe/, 'Globe Lapse'],
    ['globe', /\bglobe\b/, 'Globe'],
    ['ailplus non-customer', /ail\s*plus.*non.?customer|non.?customer.*ail\s*plus/, 'AILPlus (Non-Customer)'],
    ['ailplus', /ail\s*plus/, 'AILPlus'],
    ['final expense', /final\s*expense/, 'Final Expense'],
    ['union/association member', /\b(?:union|association)\b/, 'Response Card']
  ];
  for (const [rule, pattern, label] of rules) if (pattern.test(type)) return { label, rule };
  // Response Card leads show their group where the request type is read, e.g.
  // "IBT 610 (SGCOY) (AD&D)": a name and number followed by bracketed codes.
  if (GROUP_CODE_TYPE.test(String(requestType || ''))) return { label: 'Response Card', rule: 'group code in request type' };
  if (String(details?.group || '').trim()) return { label: 'Response Card', rule: 'has group' };
  return { label: '', rule: type ? 'no rule for this request type' : 'no request type' };
}

export function salebaseOptionForRequestType(requestType, details = {}) {
  return scriptChoiceForLead(requestType, details).label;
}

// "  Response&nbsp;Cards – Union " -> "response card union"
export function normalizeScriptLabel(text) {
  return String(text || '').normalize('NFKC').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean).map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)).join(' ');
}

const PLACEHOLDER_OPTION = /^(?:select|choose|pick)\b|^-+$|^$/;

// Picks the dropdown option for a wanted label. Never guesses between two
// equally good options, and never picks an option that is itself another
// known script (a "Child Safe" lead never gets "Child Safe Referral").
// hints: extra text (the request type) used only to break a tie.
export function matchScriptOption(wanted, optionTexts, hints = '') {
  const options = (optionTexts || []).map((text, index) => ({ index, text: String(text ?? ''), norm: normalizeScriptLabel(text) }))
    .filter((option) => !PLACEHOLDER_OPTION.test(option.norm));
  const want = normalizeScriptLabel(wanted);
  if (!want) return { index: -1, how: 'none', reason: 'no script for this lead' };
  const exact = options.find((option) => option.text.trim().toLowerCase() === String(wanted).trim().toLowerCase());
  if (exact) return { index: exact.index, text: exact.text, how: 'exact' };
  const same = options.filter((option) => option.norm === want);
  if (same.length) return { index: same[0].index, text: same[0].text, how: 'normalized' };
  const otherScripts = new Set(SALEBASE_SCRIPT_LABELS.map(normalizeScriptLabel).filter((label) => label !== want));
  const eligible = options.filter((option) => !otherScripts.has(option.norm) && ![...otherScripts].some((other) => other.length > want.length && other.includes(want) && (` ${option.norm} `).includes(` ${other} `)));
  const wantTokens = want.split(' ');
  const tiers = [
    ['startsWith', (option) => (`${option.norm} `).startsWith(`${want} `)],
    ['contains', (option) => (` ${option.norm} `).includes(` ${want} `)],
    ['tokens', (option) => wantTokens.every((token) => option.norm.split(' ').includes(token))]
  ];
  const hintTokens = new Set(normalizeScriptLabel(hints).split(' ').filter((token) => token.length > 2 && !wantTokens.includes(token)));
  for (const [how, test] of tiers) {
    const found = eligible.filter(test);
    if (found.length === 1) return { index: found[0].index, text: found[0].text, how };
    if (found.length > 1) {
      const scored = found.map((option) => ({ option, score: option.norm.split(' ').filter((token) => hintTokens.has(token)).length }));
      const best = Math.max(...scored.map((item) => item.score));
      const top = scored.filter((item) => item.score === best);
      if (best > 0 && top.length === 1) return { index: top[0].option.index, text: top[0].option.text, how: `${how}+hint` };
      return { index: -1, how: 'ambiguous', reason: `several options fit: ${found.map((option) => option.text.trim()).join(' | ')}` };
    }
  }
  return { index: -1, how: 'none', reason: 'no option fits' };
}

// ---- Run inside the Salebase page (chrome.scripting.executeScript) ----
// Both must stay self-contained: they are serialized into the page.

// Waits briefly for the script dropdown and its options (Salebase may fill
// them after the page reports "complete").
export async function readScriptDropdown(waitMs = 6000) {
  const started = Date.now();
  for (;;) {
    const dropdown = document.querySelector('#myDropdown');
    if (dropdown && dropdown.tagName === 'SELECT' && dropdown.options.length) {
      return { found: true, options: Array.from(dropdown.options, (option) => option.text), selectedIndex: dropdown.selectedIndex };
    }
    if (Date.now() - started >= waitMs) return { found: false, options: [], selectedIndex: -1 };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

// Selects option #index (only if it still has the expected text) the way a
// person would, then confirms Salebase kept it.
export async function applyScriptOption(index, expectedText) {
  const dropdown = document.querySelector('#myDropdown');
  if (!dropdown || dropdown.tagName !== 'SELECT') return { ok: false, reason: 'dropdown disappeared' };
  const option = dropdown.options[index];
  if (!option || option.text !== expectedText) return { ok: false, reason: 'dropdown options changed' };
  dropdown.selectedIndex = index;
  option.selected = true;
  dropdown.dispatchEvent(new Event('input', { bubbles: true }));
  dropdown.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  return dropdown.selectedIndex === index ? { ok: true } : { ok: false, reason: 'Salebase switched the dropdown back' };
}

// The popup's one-line summary of the last script selection.
export function scriptStatusText(entry) {
  if (!entry?.status) return '';
  const type = entry.requestType ? `“${entry.requestType}”` : 'this lead (no request type)';
  switch (entry.status) {
    case 'selected':
    case 'already-selected': return `Script: ${entry.chosen || entry.label} (matched)`;
    case 'no-mapping': return `Script: no match for ${type}`;
    case 'no-match': return `Script: no “${entry.label}” option in Salebase for ${type}`;
    case 'ambiguous': return `Script: ${entry.label} not chosen: ${entry.reason}`;
    case 'no-script-window': return `Script: opening Salebase for ${entry.label}`;
    case 'no-dropdown':
    case 'tab-not-ready': return `Script: Salebase script page not ready (${entry.label})`;
    case 'select-failed': return `Script: could not select ${entry.chosen || entry.label} (${entry.reason})`;
    default: return `Script: ${entry.status}`;
  }
}
