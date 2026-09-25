const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load() {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/objection-matcher.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({});
  vm.runInContext(`${source}\nthis.api = { matchObjection, scoreObjections, normalizeTranscript, createObjectionDetector, REBUTTAL_LABELS, OBJECTION_RULES, MATCH_THRESHOLD };`, context);
  return context.api;
}
const api = load();

// Each objection must catch natural rewordings, not just the exact phrase.
const POSITIVES = {
  "not-interested": [
    "I'm not interested",
    "Im not interested",
    "I am not interested in that",
    "we're not interested thank you",
    "not really interested",
    "no I'm not interested at all",
    "I have no interest in that",
    "I'm no longer interested",
    "I don't want it",
    "i dont want that",
    "I don't need any of that",
    "we don't need anything",
    "no thanks",
    "no thank you",
    "that's not for me",
    "I don't want to buy anything",
    "please stop calling me",
    "take me off your list",
    "I'm not intrested",
    "I'm uninterested",
    "nah not interested",
    "honestly I'm not that interested",
    "we don't want any insurance",
    "nope not interested",
    "we are not interested at this time",
    "I really don't want this",
    "I'm not interested in any of that",
    "don't want it thanks",
    "I have zero interest",
    "not interested bye",
    "I don't need insurance",
    "we're good we don't need anything"
  ],
  "mail-it": [
    "can you mail it to me",
    "could you just mail me the information",
    "send it in the mail",
    "just put it in the mail",
    "can you send me some information",
    "send me something",
    "can you email it to me",
    "email me the details",
    "can you just send me a brochure",
    "send me the info and I'll look at it",
    "can I get that in the mail",
    "can I get it in writing",
    "can you send it to my house",
    "do you have something you can send me",
    "why don't you just mail it to me",
    "can you e-mail me the information",
    "send me informaton",
    "just send me something in the mail",
    "can you mail me something",
    "mail it to my house",
    "could you email that to me",
    "I'd rather you just send me the information",
    "send the information to me",
    "can you mail that out to me"
  ],
  "forgot": [
    "I don't remember doing this",
    "I don't remember doing that",
    "I don't recall signing up for this",
    "I never did that",
    "I don't remember filling that out",
    "I didn't fill anything out",
    "I never signed up for anything",
    "I never sent that in",
    "I didn't request this",
    "I didn't ask for this",
    "I have no recollection of that",
    "I forgot about that",
    "I can't remember doing that",
    "i dont remember",
    "I don't think I did that",
    "that wasn't me",
    "we never ordered anything",
    "I don't remember sending that in",
    "I don't remeber doing this",
    "I don't recall filling out any card",
    "never did that",
    "I didn't sign up for this",
    "I don't remember ever doing this",
    "I don't remember signing anything",
    "I never requested anything",
    "I don't recall ever filling that out",
    "I don't remember that at all",
    "me? I never did that",
    "I didn't send anything in",
    "nobody here filled that out",
    "I don't remember doing any of that",
    "I have no memory of doing that"
  ],
  "zoom": [
    "do we have to do a zoom meeting",
    "do I have to do a zoom",
    "is this a zoom call",
    "can we do this without zoom",
    "I don't do zoom",
    "I don't have a computer",
    "I don't know how to use zoom",
    "can't we just do it over the phone",
    "do I have to do this",
    "why do I have to do this",
    "why do I need to do this",
    "is this required",
    "is this mandatory",
    "does it have to be on video",
    "do we need a video call",
    "a zoom meeting?",
    "I'm not good with computers",
    "I don't need a zoom meeting",
    "can we just do this on the phone",
    "can we skip the zoom",
    "why do we have to meet",
    "do I really have to do this",
    "do we have to do this",
    "do we really have to do a zoom",
    "why do we need to do a zoom meeting",
    "I don't want to do a zoom meeting",
    "can we do it over the phone instead",
    "do I have to be on camera",
    "is the zoom required",
    "I don't have a camera",
    "why can't we do this over the phone",
    "do we need to do this",
    "I'm not interested in the zoom part"
  ],
  "what-is-this": [
    "what is this all about",
    "what's this about",
    "what is this",
    "what is this regarding",
    "what is this call about",
    "what are you calling about",
    "why are you calling me",
    "who is this",
    "what company is this",
    "what company are you with",
    "what do you want",
    "what are you selling",
    "I don't know what this is",
    "I have no idea what this is",
    "what exactly is this",
    "whats this all about",
    "what is this in reference to",
    "what is it about",
    "what's going on",
    "who is calling",
    "what is this for",
    "what's this regarding",
    "what is this call for",
    "what are you calling me for",
    "who is this again",
    "what are you guys selling",
    "what is this even about",
    "what is this concerning",
    "I'm confused what is this"
  ]
};

// Close-but-different sentences that must NOT map to that objection.
const NEGATIVES = {
  "not-interested": [
    "I'm interested",
    "I'm very interested",
    "I would be interested",
    "are you interested in saving money",
    "if you're not interested that's fine",
    "I don't want to be rude but",
    "I'm not sure if I'm interested",
    "interested but I don't have much time",
    "you're not interested in anything are you",
    "I don't want to miss this",
    "no",
    "I'm good",
    "that's interesting",
    "there is no obligation",
    "it's not a sales call",
    "I'm not sure",
    "I'm interesting"
  ],
  "mail-it": [
    "I'll mail it to you",
    "I got it in the mail",
    "I sent it in the mail last week",
    "what is your email address",
    "can you remember your mailing address",
    "my email is john at gmail dot com",
    "did you get the mail",
    "we will send you a zoom link",
    "I'll send you a text",
    "the mailman came",
    "I'm calling about the card you sent in",
    "I just need to send this over to my manager"
  ],
  "forgot": [
    "can you remember your zip code",
    "do you remember filling out the card",
    "if you don't remember that's okay",
    "I don't remember my zip code",
    "a lot of people don't remember filling it out",
    "do you recall sending that in",
    "remember to have your spouse there",
    "I remember doing that",
    "I don't remember your name",
    "I didn't catch that",
    "can't we just do it over the phone",
    "you filled out a card requesting information",
    "you didn't do anything wrong"
  ],
  "zoom": [
    "we'll set up a quick zoom meeting tomorrow",
    "all you have to do is join the zoom",
    "do you have zoom on your phone",
    "you will need a computer or phone",
    "can you get on a zoom call tomorrow",
    "I will send you the zoom link",
    "the meeting is about twenty minutes",
    "we have to do a zoom meeting with your spouse",
    "I have a computer",
    "is this a good time",
    "the zoom meeting will be with a licensed agent",
    "do you have a computer or a smartphone"
  ],
  "what-is-this": [
    "what was that",
    "let me tell you what this is all about",
    "what is your zip code",
    "what is the best number to reach you",
    "what time works for you",
    "what did you say",
    "what is it that you do for work",
    "this is about the card you sent in",
    "what is it like where you live",
    "what is this weekend looking like for you",
    "so what we do is"
  ]
};

// Ordinary rep talk and everyday replies: nothing may fire.
const NEUTRAL = [
  "hi this is Cody with American Income Life",
  "you filled out a card requesting information about the free child safe kit",
  "is this a good time",
  "I'm just calling to get that information over to you",
  "there's no obligation",
  "we'll set up a quick zoom meeting tomorrow",
  "do you have a computer or a smartphone",
  "what time works best for you",
  "can you remember your zip code",
  "if you're not interested that's fine",
  "I'm interested",
  "thank you so much have a great day",
  "the zoom meeting will be with a licensed agent",
  "I just need to send this over to my manager",
  "do you remember filling out the card",
  "what is this weekend looking like for you",
  "okay",
  "yes that's right",
  "sounds good",
  "tell me more",
  "I remember that card",
  "yeah I filled that out",
  "can you repeat that",
  "hold on let me get a pen",
  "my wife handles the mail",
  "what's the weather like",
  "why not",
  "I have to go pick up my kids",
  "I don't have time right now",
  "call me back later",
  "I'm busy",
  "I need to check with my husband",
  "that's fine",
  "I'll do it",
  "I don't know"
];

for (const [id, phrases] of Object.entries(POSITIVES)) {
  test(`fuzzy objection matching catches ${phrases.length} natural variants of "${id}"`, () => {
    const misses = phrases.filter((phrase) => api.matchObjection(phrase)?.id !== id);
    assert.deepEqual(misses, [], `missed: ${misses.map((phrase) => `${phrase} => ${api.matchObjection(phrase)?.id || 'nothing'}`).join('; ')}`);
  });
}

for (const [id, phrases] of Object.entries(NEGATIVES)) {
  test(`"${id}" ignores ${phrases.length} look-alike sentences`, () => {
    const wrong = phrases.filter((phrase) => api.matchObjection(phrase)?.id === id);
    assert.deepEqual(wrong, []);
  });
}

test(`ordinary rep talk and everyday replies trigger nothing (${NEUTRAL.length} sentences)`, () => {
  const fired = NEUTRAL.filter((phrase) => api.matchObjection(phrase)).map((phrase) => `${phrase} => ${api.matchObjection(phrase).id}`);
  assert.deepEqual(fired, []);
  assert.equal(api.matchObjection(''), null);
  assert.equal(api.matchObjection(null), null);
});

test('negation flips meaning: interested vs not interested, remember vs do not remember', () => {
  assert.equal(api.matchObjection("I'm interested"), null);
  assert.equal(api.matchObjection("I'm not interested").id, 'not-interested');
  assert.equal(api.matchObjection("I'm uninterested").id, 'not-interested');
  assert.equal(api.matchObjection('I remember doing that'), null);
  assert.equal(api.matchObjection("I don't remember doing that").id, 'forgot');
  assert.equal(api.matchObjection('I want it'), null);
  assert.equal(api.matchObjection("I don't want it").id, 'not-interested');
});

test('transcripts are normalised: contractions, missing apostrophes, slang and small misspellings', () => {
  assert.equal(api.normalizeTranscript("I DON'T remember, doing THAT!!"), 'i do not remember doing that');
  assert.equal(api.normalizeTranscript('i dont remember'), 'i do not remember');
  assert.equal(api.normalizeTranscript('Im not gonna do that'), 'i am not going to do that');
  assert.equal(api.normalizeTranscript('what\u2019s this about'), 'what is this about');
  assert.equal(api.normalizeTranscript("can't we"), 'can not we');
  assert.equal(api.normalizeTranscript('I dont remeber'), 'i do not remember');
  assert.equal(api.normalizeTranscript('not intrested'), 'not interested');
  assert.equal(api.normalizeTranscript('send me informaton'), 'send me information');
  // Misspelling tolerance stays small: a different word is not "corrected".
  assert.equal(api.normalizeTranscript("that's interesting"), 'that is interesting');
});

test('every built-in saved phrase still matches on its own', () => {
  for (const rule of api.OBJECTION_RULES) {
    for (const phrase of rule.phrases) {
      assert.equal(api.matchObjection(phrase)?.id, rule.id, phrase);
      assert.equal(api.matchObjection(phrase).via, 'saved-phrase', phrase);
    }
  }
});

test('custom phrases can be added per objection and still respect rep-talk vetoes', () => {
  const customPhrases = { forgot: ['that was my late husband'], 'mail-it': ['put it on paper for me'] };
  assert.equal(api.matchObjection('yesterday I told my neighbor that was my late husband', { customPhrases }), null, 'inside a longer sentence a custom phrase needs an anchor');
  assert.equal(api.matchObjection('that was my late husband', { customPhrases })?.id, 'forgot');
  assert.equal(api.matchObjection('oh that was my late husband', { customPhrases })?.id, 'forgot', 'a filler word is fine');
  assert.equal(api.matchObjection('put it on paper for me', { customPhrases })?.id, 'mail-it');
  assert.equal(api.matchObjection('put it on paper for me'), null);
  assert.equal(api.matchObjection('do you remember that was my late husband', { customPhrases }), null);
});

test('fuzzy matches still map to the exact Salebase rebuttal panel titles', () => {
  const salebaseTitles = ["I'm not interested.", 'Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?', 'What is this all about?'];
  const compact = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  assert.equal(api.REBUTTAL_LABELS.length, salebaseTitles.length);
  for (const [id, phrases] of Object.entries(POSITIVES)) {
    const match = api.matchObjection(phrases[phrases.length - 1]);
    assert.equal(match.id, id);
    assert.ok(salebaseTitles.some((title) => compact(title).includes(compact(match.label))), `${match.label} has a Salebase panel`);
    assert.deepEqual([...match.phrases], [...api.OBJECTION_RULES.find((rule) => rule.id === id).phrases], 'panel lookup phrases are the saved ones');
  }
  assert.equal(api.matchObjection("I don't recall signing up for this").label, "I don't remember doing this!");
  assert.equal(api.matchObjection('why do I have to do this').label, 'Do we have to do a Zoom meeting?');
});

test('the more specific objection wins when two apply', () => {
  assert.equal(api.matchObjection("I don't want to do a zoom meeting").id, 'zoom');
  assert.equal(api.matchObjection("I don't want it").id, 'not-interested');
});

test('a short cooldown stops one objection from firing repeatedly', () => {
  const detector = api.createObjectionDetector({ cooldownMs: 20000, anyCooldownMs: 4000 });
  assert.equal(detector.detect("I don't remember doing this", 0).match.id, 'forgot');
  const repeat = detector.detect('I never did that', 5000);
  assert.equal(repeat.match, null);
  assert.equal(repeat.reason, 'cooldown');
  assert.equal(repeat.suppressed.id, 'forgot');
  assert.equal(detector.detect('what is this all about', 2000).match, null, 'any-objection cooldown');
  assert.equal(detector.detect('what is this all about', 6000).match.id, 'what-is-this', 'a different objection after the short gap');
  assert.equal(detector.detect("I don't recall signing up", 21000).match.id, 'forgot', 'same objection again after the cooldown');
  assert.equal(detector.detect("I'm interested", 60000).reason, 'no-match');
});

test('the service worker uses the cooldown detector and optional stored custom phrases', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
  assert.match(worker, /const objectionDetector = createObjectionDetector\(\);/);
  assert.match(worker, /objectionDetector\.detect\(transcript, Date\.now\(\), \{ customPhrases: stored\['impact\.objectionPhrases'\] \}\)/);
  assert.doesNotMatch(worker.slice(worker.indexOf('async function handleObjectionTranscript'), worker.indexOf('async function revealSalebaseRebuttal')), /transcript[,}]\s*\}\s*\)|lastTranscript/);
});

test('long utterances: rep script paragraphs stay silent, a customer objection at the end still fires', () => {
  const repScript = [
    'hi this is Cody with American Income Life I am calling about the card you sent in requesting information about the free will kit',
    'a lot of people do not remember filling it out and that is completely okay it was a while ago so what we do is set up a short zoom meeting',
    'if you are not interested in the coverage that is totally fine but you still get the free child safe kit either way',
    'all you have to do is join the zoom from your phone or computer and the agent will go over everything with you',
    'I just need to verify your mailing address can you tell me your zip code and the best email to send the confirmation to',
    'what is this weekend looking like for you and your spouse would saturday morning or sunday afternoon work better',
    'you do not have to decide anything today there is no obligation we just want to make sure you get the information you asked for',
    'I will mail it to you after the meeting and the agent will email you the zoom link about thirty minutes before'
  ];
  assert.deepEqual(repScript.filter((line) => api.matchObjection(line)), []);
  assert.equal(api.matchObjection('so basically you filled out a card requesting information about the free child safe kit and my job is just to get that over to you okay does that sound good to you I do not remember doing this').id, 'forgot');
  assert.equal(api.matchObjection('the agent just goes over the benefits and answers questions it takes about twenty minutes honestly I am not interested thanks').id, 'not-interested');
  assert.equal(api.matchObjection('okay so we set that up for saturday and you will get a text reminder wait do we have to do a zoom meeting for this').id, 'zoom');
});

// 0.4.13 regression: real speech-to-text gives lowercase, unpunctuated text,
// and a short final result often merges the rep's question with the
// customer's answer. 0.4.12 applied rep-talk vetoes to the whole result, so
// "do you remember ... no i dont remember doing this" fired nothing.
test('speech-to-text style results fire: lowercase, no punctuation, rep question merged with the answer', () => {
  const cases = {
    "i'm not interested": 'not-interested',
    'im not interested thanks': 'not-interested',
    'im not interested': 'not-interested',
    'no im not interested': 'not-interested',
    'i dont remember doing this': 'forgot',
    'i dont remember doing that': 'forgot',
    'can you just mail it to me': 'mail-it',
    'what is this all about': 'what-is-this',
    'do we have to do a zoom meeting': 'zoom',
    'are you interested in saving money no im not interested': 'not-interested',
    'okay if you have a second im not interested': 'not-interested',
    'do you remember filling that out no i dont remember doing this': 'forgot',
    'we will send you the information can you just mail it to me': 'mail-it'
  };
  const misses = Object.entries(cases).filter(([text, id]) => api.matchObjection(text)?.id !== id)
    .map(([text, id]) => `${text} => ${api.matchObjection(text)?.id || 'nothing'} (want ${id})`);
  assert.deepEqual(misses, []);
});

test('rep talk alone still fires nothing, even when a window of it looks like an objection', () => {
  const repOnly = [
    'let me tell you what this is all about',
    'you filled out a card do you remember filling that out',
    'if you are not interested thats fine but you still get the kit',
    "we'll set up a quick zoom meeting tomorrow",
    'so we just set up a quick zoom meeting tomorrow at five and the agent will go over everything'
  ];
  assert.deepEqual(repOnly.filter((line) => api.matchObjection(line)).map((line) => `${line} => ${api.matchObjection(line).id}`), []);
});
