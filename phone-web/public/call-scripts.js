import { CALL_SCRIPTS } from './call-scripts.data.js';

export { CALL_SCRIPTS };

const RULES = [
  [/response\s*cards?|reply\s*cards?|\brc\b/i, 'RESPONSE'],
  [/will\s*kit/i, 'WILLKIT'],
  [/media\s*plex/i, 'MPCHILDSAFE'],
  [/child\s*safe.*referral/i, 'REFERRAL'],
  [/child\s*safe/i, 'CHILDSAFE'],
  [/pos.*beneficiar|beneficiar.*pos/i, 'BENEFICIARY'],
  [/pos.*laps|laps.*pos/i, 'LAPSED-POS'],
  [/globe.*laps|laps.*globe/i, 'GLOBELAPSE'],
  [/\bglobe\b/i, 'GLOBE'],
  [/ail\s*plus.*non.?customer|non.?customer.*ail\s*plus/i, 'AILPLUS-NONCUST'],
  [/ail\s*plus/i, 'APLUS'],
  [/final\s*expense/i, 'FE'],
  [/\bpos\b/i, 'POS'],
  [/\b(?:union|association)\b/i, 'RESPONSE']
];

const GROUP_CODE = /(?:^|[\s,;:|-])(?:[A-Z][A-Z&.'/-]*[A-Z&.]|Local|Lodge|District|Council|Chapter)\s+#?\d{1,5}[A-Z]?\s*\(/;

export function scriptForRequestType(requestType) {
  const type = String(requestType || '');
  for (const [pattern, id] of RULES) if (pattern.test(type)) return CALL_SCRIPTS.find((script) => script.id === id) || null;
  if (GROUP_CODE.test(type)) return CALL_SCRIPTS.find((script) => script.id === 'RESPONSE') || null;
  return null;
}

export function firstNameFrom(leadName) {
  const text = String(leadName || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const given = text.includes(',') ? text.split(',').slice(1).join(' ') : text;
  const word = given.trim().split(' ')[0] || '';
  if (!word) return '';
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function fillScriptText(text, lead, agentName = '') {
  const agent = String(agentName || '').trim();
  const values = {
    firstName: firstNameFrom(lead?.leadName) || '(Name)',
    address: String(lead?.address || '').trim() || '(Address)',
    agent: agent || '(You)',
    group: '(Group)',
    beneficiary: '(Beneficiary)',
    spouse: '(Spouse)'
  };
  return String(text || '').replace(/\{(firstName|address|agent|group|beneficiary|spouse)\}/g, (_, key) => values[key]);
}
