// These are deliberately plain-language rules, not an AI model. We keep only
// the short recognised text needed to identify a rebuttal; no audio is saved.
const RULES = [
  { id: 'not-interested', label: "I'm not interested", phrases: ["not interested", "no interest", "don't want it", "do not want it"] },
  { id: 'mail-it', label: 'Can you mail it to me?', phrases: ['mail it to me', 'send it in the mail', 'send me information', 'mail me information'] },
  { id: 'forgot', label: "I don't remember doing this!", phrases: ["don't remember", 'do not remember', "never did this", "didn't do this"] },
  { id: 'zoom', label: 'Do we have to do a Zoom meeting?', phrases: ['zoom meeting', 'do i have to do this', 'why do i have to do this', 'have to do this'] },
  { id: 'what-is-this', label: 'What is this all about?', phrases: ['what is this all about', 'what is this about', 'what is this'] }
];

export function matchObjection(transcript) {
  const text = String(transcript || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return RULES.find((rule) => rule.phrases.some((phrase) => text.includes(phrase))) || null;
}

// Every rebuttal title, so the Salebase page script can tell where one
// rebuttal panel ends and the next begins.
export const REBUTTAL_LABELS = RULES.map((rule) => rule.label);
