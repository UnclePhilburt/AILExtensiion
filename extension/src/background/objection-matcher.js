// Local, rule-based objection matching (no AI model, nothing leaves the
// computer). Only the short recognised text of one utterance is examined; no
// audio or transcript is saved.
//
// How a transcript is matched:
// 1. normalise: lowercase, strip punctuation, expand contractions and
//    speech-to-text spellings (dont, im, gonna...), fix small misspellings of
//    key words (edit distance 1, or 2 for long words).
// 2. every objection has an "anchor" check (e.g. a first-person negation next
//    to remember/recall/sign up/fill out) and "veto" checks for ordinary rep
//    talk ("do you remember...", "if you're not interested...", "your zip code").
// 3. words are mapped to shared concepts (this/that/it, remember/recall,
//    do/did/sign up/fill out, mail/send/email...) and the utterance is scored
//    against natural variants by weighted, in-order token overlap.
// 4. the best objection above the threshold wins. His saved phrases still
//    match directly (subject to the same vetoes).

export const MATCH_THRESHOLD = 0.75;
export const OBJECTION_COOLDOWN_MS = 20000; // same objection
export const ANY_OBJECTION_COOLDOWN_MS = 4000; // any objection

const RULES = [
  {
    id: 'not-interested',
    priority: 0, // generic: loses ties to a more specific objection
    label: "I'm not interested",
    phrases: ['not interested', 'no interest', "don't want it", 'do not want it'],
    variants: [
      "I'm not interested", 'not interested', 'we are not interested', 'I am not really interested', 'no interest',
      'I have no interest in that', "I'm not interested in that", "I'm not interested in anything", 'no thank you not interested',
      "I don't want it", "I don't want that", "I don't want any", "I don't need it", "I don't need that", "we don't need anything",
      "I don't want to do this", "I don't want to buy anything", 'no thanks', 'no thank you', 'not for me', 'not for us',
      "I'm not looking for anything", 'I am no longer interested', 'stop calling me', 'take me off your list', 'remove me from your list',
      "I'm not interested in insurance", "we don't want any insurance"
    ],
    anchors: [
      /\b(not|no|never|nothing|zero)\b(?: \w+){0,2} (interested|interest)\b/,
      /\b(not|never)\b(?: \w+){0,2} (want|need)\b(?: (it|this|that|them|any|anything|one|insurance|coverage|policy|nothing|none|more))?(?:$| (it|this|that|any|anything|one|insurance|coverage|policy|nothing))/,
      /\b(not|never) (want|need) to (buy|do|sign|hear|talk|get|pay|continue|go|deal|meet|set)\b/,
      /\bno (thank you|thanks)\b/, /\bnot for (me|us)\b/, /\bnot looking (for|to)\b/,
      /\bstop calling\b/, /\b(take|remove) (me|us) (off|from)\b/
    ],
    vetoes: [
      /\b(if|when|unless|maybe|in case) you\b/, /\byou (are|were|would be) not\b/, /\bare you (not )?interested\b/,
      /\b(not|never) want to (be rude|bother|interrupt|keep|waste|take up|miss|lose|hurt|forget)\b/,
      /\bnot only\b/, /\bnot interested in (the |a |doing )?(zoom|video|meeting|computer)/, /\bdo not need to\b(?! (buy|do|sign|hear|talk|get|pay|continue|go|meet|set))/
    ]
  },
  {
    id: 'mail-it',
    priority: 1,
    label: 'Can you mail it to me?',
    phrases: ['mail it to me', 'send it in the mail', 'send me information', 'mail me information'],
    variants: [
      'send the information to me', 'can you mail it to me', 'just mail it to me', 'mail me the information', 'mail me something', 'send it in the mail',
      'put it in the mail', 'send me some information', 'can you send me something', 'can you just send me the information',
      'send me the info and I will look at it', 'email it to me', 'can you email me the details', 'email me the information',
      'send me a brochure', 'send it to my house', 'can I get that in the mail', 'can I get it in writing',
      'do you have something you can send me', 'can you send me something in the mail', 'send it to me', 'mail it'
    ],
    anchors: [
      /\b(mail|send|email|post|ship|text)\b.*\b(me|us|myself)\b/, /\b(me|us)\b.*\b(mail|send|email)\b/,
      /\bin the mail\b/, /\bin writing\b/, /\b(mail|send|email) (it|this|that|them)( to (me|us|my \w+))?$/
    ],
    vetoes: [
      /\b(mail|send|email|text|ship|post)\w*\b(?: \w+){0,3} (to )?you\b(?!.*\b(me|us)\b)/,
      /\b(sent|mailed|got|received|already|emailed)\b(?: \w+){0,4} (mail|email)\b/, /\bmy (email|mailing address|address|e mail)( address)? is\b/,
      /\b(your|the) (email|mailing|address)\b/, /\bdid you (get|receive)\b/, /\b(send|mail|email) (it|this|that)? ?over\b/, /\bto (my|the|our) (manager|supervisor|office|team|agent|boss)\b/, /\b(we|i) (will|are going to|can) (mail|send|email)\b/
    ]
  },
  {
    id: 'forgot',
    priority: 1,
    label: "I don't remember doing this!",
    phrases: ["don't remember", 'do not remember', 'never did this', "didn't do this"],
    variants: [
      "I don't remember doing this", "I don't remember doing that", "I don't remember that", "I don't remember",
      "I don't recall signing up for this", "I don't recall doing that", "I don't recall", 'I never did that', 'I never did this',
      "I didn't do this", "I don't remember filling that out", "I didn't fill anything out", 'I never filled out a card',
      'I never signed up for anything', 'I never sent that in', "I didn't request this", "I didn't ask for this", 'I never asked for this',
      'I have no recollection of this', 'I have no memory of that', 'I forgot about that', 'I forgot', "I can't remember doing that",
      "I don't think I did that", "I don't think I signed up for that", "that wasn't me", 'we never ordered anything', 'nobody here filled that out',
      "I don't remember sending that in", "I don't remember requesting anything"
    ],
    anchors: [
      /\b(not|never|no)\b(?: \w+){0,3} (remember|recall|recollect|recollection|memory)\b/,
      /\b(i|we)\b(?: \w+){0,3} (forgot|forget|forgotten)\b/,
      /\b(not|never)\b(?: \w+){0,3} (do|did|done|doing|sign|signed|signing|fill|filled|filling|request|requested|ask|asked|send|sent|mail|mailed|order|ordered|register|registered|enroll|enrolled|apply|applied|submit|submitted|return|returned|agree|agreed)\b/,
      /\b(that|it|this) (was|is) not (me|us)\b/,
      /\b(nobody|no one|none of us)\b(?: \w+){0,3} (do|did|filled|signed|sent|requested|ordered|asked|mailed)\b/
    ],
    vetoes: [
      /\byou (do |did |may |might |probably |just )?(not|never)\b/, /\b(do|did|can|could) you (remember|recall)\b/, /\bif you\b/,
      /\b(remember|recall|forgot|forget)\b(?: \w+){0,3} (zip|code|address|number|name|birthday|birth|date|password|email|social|pin|street|age|phone)\b/,
      /\b(people|folks|most|many|they|customers|everyone|some|lot)\b(?: \w+){0,2} (not|never) (remember|recall)\b/,
      /\bnot (do|did) (it|this|that) yet\b/, /\bnot remember (you|your)\b/, /\bnot (mean|want|need) to\b/,
      /\b(can|could|do|did|will|would|should) not (we|i)\b/
    ]
  },
  {
    id: 'zoom',
    priority: 2,
    label: 'Do we have to do a Zoom meeting?',
    phrases: ['zoom meeting', 'do i have to do this', 'why do i have to do this', 'have to do this'],
    variants: [
      'do we have to do a zoom meeting', 'do I have to do a zoom meeting', 'do we have to do a zoom', 'is this a zoom call',
      'is this on zoom', 'can we do this without zoom', "I don't do zoom", "I don't have zoom", "I don't have a computer",
      "I don't know how to use zoom", "can't we just do it over the phone", 'can we just do this on the phone', 'do I have to do this',
      'why do I have to do this', 'do I need to do this', 'why do I need to do this', 'is this required', 'is this mandatory', 'is the zoom required', "I don't want to do a zoom meeting",
      'do I have to', 'do we need a video call', 'does it have to be on video', 'does it have to be a zoom meeting',
      "I'm not good with computers", 'do we really have to meet', 'why do we have to meet', 'why do I have to meet with someone',
      'can we skip the zoom', 'a zoom meeting', 'zoom meeting'
    ],
    anchors: [
      /\b(do|does|why|must|will|would|should)\b (i|we)\b(?: \w+){0,2} (have to|has to|need to|got to|supposed to)\b/,
      /\bwhy (do|would|should|must) (i|we) (need|have|do|meet)\b/,
      /\b(is|does) (this|it|that|the zoom|the meeting|the video|zoom)\b(?: \w+){0,2} (required|mandatory|necessary|have to be|need to be)\b/,
      /\b(i|we)\b(?: \w+){0,3} not\b(?: \w+){0,4} (zoom|video|computer|computers|laptop|camera|webcam|facetime|skype)\b/,
      /\b(without|instead of|other than|skip) (the |a )?(zoom|video|computer|meeting)\b/,
      /^(?:(?:so|but|and|wait|well|okay|oh|um|uh) )*(do|does|is|are|can|could|will|would|why|must) (i|we|this|it|that)\b.*\b(zoom|video|facetime|skype|computer|webcam|camera)\b/,
      /\b(just|rather|instead|only)\b.*\b(over|on) the phone\b/, /\b(can|could) (we|i|not we)\b.*\b(over|on) the phone\b/
    ],
    vetoes: [
      /\ball (you|we) (have|need) to do\b/, /^(?:(?:so|but|and|okay|well) )*(do|does|can|could|will|would|are|is) you\b/,
      /\byou (have|need|will need|would need|will have) to\b/, /\b(we will|i will|let us|we can|we are going to)\b(?: \w+){0,4} (zoom|meeting)\b/
    ]
  },
  {
    id: 'what-is-this',
    priority: 1,
    label: 'What is this all about?',
    phrases: ['what is this all about', 'what is this about', 'what is this'],
    variants: [
      'what is this all about', 'what is this about', 'what is this', 'what is this regarding', 'what is this call about',
      'what is this for', 'what is this in reference to', 'what are you calling about', 'what are you calling for', 'what are you calling me for', 'why are you calling me',
      'who is this', 'who is calling', 'what company is this', 'what company are you with', 'what do you want', 'what are you selling',
      "I don't know what this is", 'I have no idea what this is', 'what exactly is this', 'what is going on', 'what is it about',
      'what is this concerning', 'what is the call about', 'what is this even about', "what's this all about"
    ],
    anchors: [
      /\bwhat(?: \w+)? is (this|it|that)\b/, /\bwhat (are|were) you calling (me |us )?(about|for)\b/, /\bwhy are you calling\b/,
      /\bwhat is (the|this) call (about|regarding|for)\b/, /\bwho is (this|calling|that)\b/, /\bwhat company\b/,
      /\bwhat (are|were) you selling\b/, /\bwhat do you want\b/, /\b(not|no)\b(?: \w+){0,2} (know|idea|clue) what (this|it|that) is\b/,
      /\bwhat (is|are) you (talking|calling) about\b/, /\bwhat is going on\b/, /\bwhat was (this|it|that) (about|for|regarding)\b/
    ],
    vetoes: [
      /\bwhat was (that|it)\b(?! (about|for|regarding))/, /\b(let me|i will|i am going to|i want to|i can|i would like to|i will just) (tell|explain|show|go over|share)\b/,
      /\bwhat (it|this|that) is( all)? about is\b/, /\bwhat is (it|that|this) (that )?you\b/, /\bwhat is (it|that|this) like\b/,
      /\bwhat did you say\b/,
      /\bwhat is (this|that) (weekend|week|morning|afternoon|evening|month|year|time|number|date|address|day)\b/, /\blooking like\b/
    ]
  }
];

const CONTRACTIONS = [
  [/\b(can ?not|can'?t)\b/g, 'can not'], [/\bwon'?t\b/g, 'will not'], [/\bain'?t\b/g, 'am not'],
  [/\b(do|does|did|is|are|was|were|have|has|had|would|could|should|must|need)n'?t\b/g, '$1 not'],
  [/\bi'?m\b/g, 'i am'], [/\bi'?ve\b/g, 'i have'], [/\bi'd\b/g, 'i would'], [/\bi'll\b/g, 'i will'],
  [/\b(you|we|they)'re\b/g, '$1 are'], [/\byoure\b/g, 'you are'], [/\btheyre\b/g, 'they are'],
  [/\b(you|we|they)'ll\b/g, '$1 will'], [/\b(you|we|they)'ve\b/g, '$1 have'], [/\b(you|we|they)'d\b/g, '$1 would'],
  [/\b(what|that|it|who|there|where|how|here)'?s\b/g, '$1 is'], [/\blet'?s\b/g, 'let us'],
  [/\bgonna\b/g, 'going to'], [/\bwanna\b/g, 'want to'], [/\bgotta\b/g, 'got to'], [/\bhafta\b/g, 'have to'],
  [/\bkinda\b/g, 'kind of'], [/\bsorta\b/g, 'sort of'], [/\blemme\b/g, 'let me'], [/\bgimme\b/g, 'give me'],
  [/\bdunno\b/g, 'do not know'], [/\b(nope|nah|naw)\b/g, 'no'], [/\b(u|ya)\b/g, 'you'], [/\byou (guys|folks|people)\b/g, 'you'], [/\by'?all\b/g, 'you all'],
  [/\b(un|dis)interested\b/g, 'not interested'], [/\bsign ?up\b/g, 'sign up'], [/\bsignup\b/g, 'sign up'],
  [/\bface ?time\b/g, 'facetime'], [/\bvideo ?call\b/g, 'video call'], [/\binfo\b/g, 'information']
];

// Key words that small speech-to-text misspellings are corrected to.
const VOCABULARY = ['remember', 'remembered', 'remembering', 'recall', 'recollect', 'recollection', 'interested', 'interest',
  'information', 'brochure', 'meeting', 'computer', 'required', 'mandatory', 'necessary', 'requested', 'request', 'signed',
  'filled', 'calling', 'regarding', 'concerning', 'reference', 'facetime', 'forgot', 'forget', 'email', 'mailed', 'anything',
  'something', 'supposed', 'insurance', 'company', 'selling', 'recall', 'ordered', 'registered', 'mandatory'];
const VOCAB_SET = new Set(VOCABULARY);

const CONCEPTS = [
  // multi-word first
  [['sign', 'up'], '~do'], [['signed', 'up'], '~do'], [['signing', 'up'], '~do'], [['fill', 'out'], '~do'], [['filled', 'out'], '~do'],
  [['filling', 'out'], '~do'], [['fill', 'in'], '~do'], [['filled', 'in'], '~do'], [['send', 'in'], '~do'], [['sent', 'in'], '~do'],
  [['mail', 'in'], '~do'], [['mailed', 'in'], '~do'], [['send', 'back'], '~do'], [['sent', 'back'], '~do'], [['mailed', 'back'], '~do'],
  [['ask', 'for'], '~do'], [['asked', 'for'], '~do'], [['have', 'to'], '~haveto'], [['has', 'to'], '~haveto'], [['need', 'to'], '~haveto'],
  [['needs', 'to'], '~haveto'], [['got', 'to'], '~haveto'], [['supposed', 'to'], '~haveto'], [['how', 'come'], '~why'],
  [['video', 'call'], '~zoom'], [['in', 'reference', 'to'], '~about'], [['in', 'regards', 'to'], '~about'], [['no', 'longer'], '~not'],
  [['my', 'house'], '~me'], [['my', 'home'], '~me'], [['my', 'address'], '~me'], [['in', 'writing'], '~mail'],
  // single words
  [['this'], '~this'], [['that'], '~this'], [['it'], '~this'], [['these'], '~this'], [['those'], '~this'], [['them'], '~this'],
  ...['remember', 'remembered', 'remembering', 'recall', 'recalled', 'recalling', 'recollect', 'recollection', 'memory'].map((w) => [[w], '~remember']),
  ...['forgot', 'forget', 'forgotten'].map((w) => [[w], '~forgot']),
  ...['do', 'does', 'did', 'done', 'doing', 'sign', 'signed', 'signing', 'fill', 'filled', 'filling', 'request', 'requested', 'requesting',
    'order', 'ordered', 'register', 'registered', 'enroll', 'enrolled', 'apply', 'applied', 'submit', 'submitted', 'return', 'returned',
    'ask', 'asked', 'agree', 'agreed'].map((w) => [[w], '~do']),
  ...['mail', 'mailed', 'mailing', 'send', 'sending', 'sent', 'email', 'emailed', 'emailing', 'post', 'ship', 'text'].map((w) => [[w], '~mail']),
  ...['information', 'details', 'brochure', 'pamphlet', 'paperwork', 'packet', 'literature', 'material', 'materials', 'something',
    'anything', 'stuff', 'letter'].map((w) => [[w], '~info']),
  ...['interested', 'interest'].map((w) => [[w], '~interest']),
  ...['want', 'need', 'needs'].map((w) => [[w], '~want']),
  ...['not', 'never', 'no', 'nothing', 'none', 'zero', 'nobody'].map((w) => [[w], '~not']),
  ...['zoom', 'video', 'facetime', 'skype', 'teams', 'webcam', 'camera', 'computer', 'computers', 'laptop', 'online', 'virtual'].map((w) => [[w], '~zoom']),
  ...['meeting', 'meet', 'appointment', 'session', 'conference'].map((w) => [[w], '~meeting']),
  ...['must', 'required', 'require', 'mandatory', 'necessary', 'obligated'].map((w) => [[w], '~haveto']),
  ...['why'].map((w) => [[w], '~why']),
  ...['about', 'regarding', 'concerning'].map((w) => [[w], '~about']),
  ...['calling', 'call', 'called', 'phoning'].map((w) => [[w], '~call']),
  ...['me', 'us', 'myself'].map((w) => [[w], '~me']),
  ...['i', 'we'].map((w) => [[w], '~i'])
];

const STOPWORDS = new Set(['a', 'an', 'the', 'um', 'uh', 'uhm', 'umm', 'er', 'ah', 'oh', 'well', 'like', 'just', 'really', 'actually',
  'honestly', 'so', 'okay', 'ok', 'yeah', 'yes', 'sir', 'maam', 'mam', 'please', 'all', 'ever', 'even', 'exactly', 'again', 'for', 'of',
  'at', 'with', 'is', 'am', 'are', 'be', 'been', 'being', 'can', 'could', 'would', 'will', 'should', 'shall', 'may', 'might', 'any',
  'some', 'any', 'out', 'up', 'hey', 'hi', 'hello', 'look', 'listen', 'honey', 'dear', 'buddy', 'man', 'now', 'right', 'then', 'very',
  'kind', 'sort', 'think', 'guess', 'mean', 'know', 'you know']);

const KEY_WEIGHT = 2;

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, current[j]);
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

function correctWord(word) {
  if (word.length < 5 || VOCAB_SET.has(word)) return word;
  const max = word.length >= 8 ? 2 : 1;
  let best = word; let bestDistance = max + 1;
  for (const candidate of VOCABULARY) {
    if (candidate[0] !== word[0]) continue;
    const distance = editDistance(word, candidate, max);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return best;
}

// Lowercase, strip punctuation, expand contractions/STT spellings, fix typos.
export function normalizeTranscript(transcript) {
  let text = String(transcript || '').toLowerCase().replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'").replace(/e-mail/g, 'email');
  text = text.replace(/[^a-z0-9'\s]/g, ' ');
  for (const [pattern, replacement] of CONTRACTIONS) text = text.replace(pattern, replacement);
  return text.replace(/'/g, '').split(/\s+/).filter(Boolean).map(correctWord).join(' ');
}

function toConcepts(normalized) {
  const words = normalized.split(' ').filter(Boolean);
  const out = [];
  for (let index = 0; index < words.length;) {
    let matched = null;
    for (const [pattern, concept] of CONCEPTS) {
      if (pattern.every((word, offset) => words[index + offset] === word)) { matched = [pattern.length, concept]; break; }
    }
    if (matched) { out.push(matched[1]); index += matched[0]; continue; }
    if (!STOPWORDS.has(words[index])) out.push(words[index]);
    index += 1;
  }
  return out;
}

const weightOf = (token) => (token.startsWith('~') || ['what', 'who', 'zoom', 'phone', 'company', 'selling'].includes(token) ? KEY_WEIGHT : 1);

// Weighted in-order overlap of a variant inside a window of the utterance.
function variantScore(variant, tokens) {
  const total = variant.reduce((sum, token) => sum + weightOf(token), 0);
  if (!total || !tokens.length) return 0;
  const windowSize = variant.length + 2;
  let best = 0;
  for (let start = 0; start < Math.max(1, tokens.length - windowSize + 1); start += 1) {
    const window = tokens.slice(start, start + windowSize);
    const table = Array.from({ length: variant.length + 1 }, () => new Array(window.length + 1).fill(0));
    for (let i = 1; i <= variant.length; i += 1) {
      for (let j = 1; j <= window.length; j += 1) {
        table[i][j] = variant[i - 1] === window[j - 1]
          ? table[i - 1][j - 1] + weightOf(variant[i - 1])
          : Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
    best = Math.max(best, table[variant.length][window.length] / total);
    if (best === 1) break;
  }
  return best;
}

const PREPARED = RULES.map((rule) => ({
  rule,
  savedPhrases: rule.phrases.map(normalizeTranscript),
  variantTokens: [...rule.phrases, ...rule.variants].map((variant) => toConcepts(normalizeTranscript(variant))).filter((tokens) => tokens.length)
}));

function prepareCustom(customPhrases) {
  if (!customPhrases || typeof customPhrases !== 'object') return {};
  const out = {};
  for (const [id, list] of Object.entries(customPhrases)) {
    const phrases = (Array.isArray(list) ? list : [list]).map((value) => String(value || '').trim()).filter(Boolean).slice(0, 50);
    out[id] = { saved: phrases.map(normalizeTranscript), tokens: phrases.map((phrase) => toConcepts(normalizeTranscript(phrase))).filter((t) => t.length) };
  }
  return out;
}

// Scores every objection for one utterance. Exposed for tests and debugging.
export function scoreObjections(transcript, options = {}) {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return [];
  const tokens = toConcepts(normalized);
  const custom = prepareCustom(options.customPhrases);
  const padded = ` ${normalized} `;
  return PREPARED.map(({ rule, savedPhrases, variantTokens }) => {
    const extra = custom[rule.id] || { saved: [], tokens: [] };
    const saved = [...savedPhrases, ...extra.saved].find((phrase) => phrase && padded.includes(` ${phrase} `)) || '';
    const vetoText = options.vetoContext || normalized;
    const vetoed = rule.vetoes.some((veto) => veto.test(vetoText));
    const anchored = rule.anchors.some((anchor) => anchor.test(normalized));
    // A saved phrase said on its own (e.g. "a zoom meeting?") counts even
    // without an anchor; inside a longer sentence it needs one.
    const savedAlone = Boolean(saved) && normalized.split(' ').length <= saved.split(' ').length + 2;
    let score = 0;
    for (const variant of [...variantTokens, ...extra.tokens]) {
      score = Math.max(score, variantScore(variant, tokens));
      if (score === 1) break;
    }
    if (saved) score = 1;
    const matched = !vetoed && (anchored || savedAlone) && score >= MATCH_THRESHOLD;
    return { id: rule.id, label: rule.label, score: Math.round(score * 100) / 100, anchored, vetoed, saved: Boolean(saved), matched, priority: rule.priority };
  }).sort((a, b) => Number(b.matched) - Number(a.matched) || b.score - a.score || b.priority - a.priority);
}

// Long final results can merge rep talk and the customer's reply, so a long
// utterance is also checked in short overlapping windows.
const WINDOW_WORDS = 10;
const LONG_UTTERANCE_WORDS = 14;

export function matchObjection(transcript, options = {}) {
  let [best] = scoreObjections(transcript, options);
  const words = normalizeTranscript(transcript).split(' ').filter(Boolean);
  if (!best?.matched && words.length > LONG_UTTERANCE_WORDS) {
    for (let start = 0; start + WINDOW_WORDS - 3 < words.length; start += 3) {
      // Vetoes also see a few words before the window ("if you | are not interested").
      const vetoContext = words.slice(Math.max(0, start - 4), start + WINDOW_WORDS).join(' ');
      const [candidate] = scoreObjections(words.slice(start, start + WINDOW_WORDS).join(' '), { ...options, vetoContext });
      if (candidate?.matched && (!best?.matched || candidate.score > best.score || (candidate.score === best.score && candidate.priority > best.priority))) best = candidate;
    }
  }
  if (!best?.matched) return null;
  const rule = RULES.find((item) => item.id === best.id);
  // label/phrases are what the Salebase panel lookup uses.
  return { id: rule.id, label: rule.label, phrases: rule.phrases, score: best.score, via: best.saved ? 'saved-phrase' : 'fuzzy' };
}

// Wraps matchObjection with a short cooldown so one objection said (or
// transcribed) several times in a row only opens its rebuttal once.
export function createObjectionDetector({ cooldownMs = OBJECTION_COOLDOWN_MS, anyCooldownMs = ANY_OBJECTION_COOLDOWN_MS } = {}) {
  const lastById = new Map();
  let lastAny = -Infinity;
  return {
    detect(transcript, now = Date.now(), options = {}) {
      const match = matchObjection(transcript, options);
      if (!match) return { match: null, reason: 'no-match' };
      if (now - (lastById.get(match.id) ?? -Infinity) < cooldownMs) return { match: null, reason: 'cooldown', suppressed: match };
      if (now - lastAny < anyCooldownMs) return { match: null, reason: 'cooldown', suppressed: match };
      lastById.set(match.id, now);
      lastAny = now;
      return { match, reason: 'matched' };
    },
    reset() { lastById.clear(); lastAny = -Infinity; }
  };
}

// Every rebuttal title, so the Salebase page script can tell where one
// rebuttal panel ends and the next begins.
export const REBUTTAL_LABELS = RULES.map((rule) => rule.label);
export const OBJECTION_RULES = RULES.map(({ id, label, phrases }) => ({ id, label, phrases }));
