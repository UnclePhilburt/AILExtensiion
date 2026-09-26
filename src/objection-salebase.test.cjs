// Every Salebase rebuttal (all scripts in the saved page fixture) has a
// listener entry, realistic spoken variants reach it, and nothing the rep reads
// from the scripts (or the rebuttal answers) triggers an objection.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const corpus = require('./fixtures/salebase-script-corpus.cjs');

function load(file, names) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
  const context = vm.createContext({ console });
  vm.runInContext(`${source}\nglobalThis.__api = { ${names.join(', ')} };`, context);
  return context.__api;
}
const api = load('extension/src/background/objection-matcher.js',
  ['matchObjection', 'createObjectionDetector', 'OBJECTION_RULES', 'REBUTTAL_LABELS', 'titleAlternatives']);
const { pickRebuttalTitle } = load('extension/src/background/salebase-rebuttal.js', ['pickRebuttalTitle']);

const FIXTURE_TITLES = [...new Set(corpus.rebuttals.map((item) => item.title))];
const RULES = [...api.OBJECTION_RULES];
const ruleTitles = new Set(RULES.flatMap((rule) => [...rule.titles]));
const splitAnswer = (answer) => [answer, ...answer.split(/(?<=[.!?…])\s+/)];

// Two or three things a customer actually says for each objection.
const SPOKEN = {
  'not-interested': ["no thanks I'm really not interested", "honestly we're not interested in any of that", "I don't want it thank you"],
  'mail-it': ['can you just mail it to me instead', 'just send it in the mail please', "why don't you mail me the stuff"],
  forgot: ["I don't remember filling out anything like that", 'I never sent in any card', "I don't recall doing that at all"],
  zoom: ['do we really have to do a zoom meeting', 'why do I have to do this', 'why do we have to meet with somebody'],
  'what-is-this': ['what is this all about', "what's this about exactly", 'what is this regarding'],
  confused: ["I'm confused", "I'm not sure what you're talking about", "I don't understand what this is"],
  'how-long': ['how long is this gonna take', 'how much time is this going to take', 'is this going to take long'],
  cost: ['how much is this going to cost me', 'is there a cost to this', 'do I have to pay anything'],
  'too-expensive': ["it's way too expensive", 'we already got quotes and it was too expensive', "we can't afford that"],
  free: ['how is it free', "why is it free what's the catch", "what's in it for you"],
  'busy-now': ["I can't talk right now", "I'm at work right now", "I'm driving"],
  'call-back': ['can you call me back later', 'call me back tomorrow', 'could you give me a call back'],
  'right-now': ['do I have to do this right now', 'does it have to be right now', 'can we do this some other time'],
  'not-today': ["I can't do it today", "today's not good for me", 'not today'],
  'bad-time': ["that time won't work", "that time doesn't work for me", "I can't make that time"],
  'not-buying': ["we're not buying anything", "I'm not buying anything", "we don't buy anything over the phone"],
  selling: ['are you trying to sell me something', 'are you gonna try to sell me insurance', 'is someone going to come out and sell me something'],
  spouse: ['why does my wife need to be there', 'why does my husband have to be there', 'does my spouse have to be on it'],
  single: ["I'm single", "I'm not married", "it's just me I don't have a spouse"],
  union: ["I'm not in the union anymore", 'I left the union years ago', "I'm not a union member anymore"],
  'need-help': ["I don't need help filling it out", 'I can fill it out myself', "I don't need any help with that"],
  'already-have': ['I already have one set up', 'we already have a will', 'I already have Globe Life'],
  'ordered-long-ago': ['I ordered these a while ago', 'that was a long time ago', 'I requested that ages ago'],
  'two-part': ["what's the two part program", 'what are the two parts', 'what do you mean two parts'],
  'spoke-already': ['I already spoke with someone', 'I already talked to somebody', 'somebody already called me about this'],
  'every-year': ['you guys do this every year', 'you call every year', "didn't we do this last year"],
  trust: ["how do I know this isn't a scam", 'is this a scam', "I don't trust this"],
  'dollar-policy': ['I thought it was the one dollar policy', 'I thought this was the dollar insurance', 'I already sent in my application'],
  shopping: ['I was just shopping around', "I'm just looking around", 'we were just comparing prices']
};

test('the fixture has every script and its rebuttals', () => {
  assert.equal(corpus.scripts.length, 13);
  assert.deepEqual(Object.values(corpus.OPTION_LABELS), ['Response Card', 'Will Kit', 'Child Safe', 'MediaPlex Child Safe', 'Referral', 'POS', 'Lapsed POS',
    'Beneficiary', 'Globe', 'Globe Lapse', 'AILPlus', 'AILPlus (Non-Customer)', 'Final Expense']);
  assert.equal(corpus.rebuttals.length, 92);
  assert.equal(FIXTURE_TITLES.length, 48);
  for (const script of Object.keys(corpus.OPTION_LABELS)) assert.ok(corpus.rebuttals.some((item) => item.script === script), `${script} has rebuttals`);
});

test('every Salebase rebuttal title has a matcher entry, with the exact title', () => {
  for (const title of FIXTURE_TITLES) assert.ok(ruleTitles.has(title), `no matcher entry for "${title}"`);
  for (const title of ruleTitles) assert.ok(FIXTURE_TITLES.includes(title), `"${title}" is not an exact Salebase title`);
  for (const rule of RULES) assert.ok(FIXTURE_TITLES.includes(rule.label), `${rule.id} label "${rule.label}" is an exact title`);
  assert.deepEqual([...api.REBUTTAL_LABELS].sort(), [...FIXTURE_TITLES].sort());
});

test('every objection has realistic spoken variants that reach it (and its Salebase titles)', () => {
  assert.deepEqual(Object.keys(SPOKEN).sort(), RULES.map((rule) => rule.id).sort(), 'one spoken-variant list per objection');
  for (const [id, utterances] of Object.entries(SPOKEN)) {
    for (const utterance of utterances) {
      const match = api.matchObjection(utterance);
      assert.equal(match?.id, id, `"${utterance}" should be ${id}, got ${match?.id}`);
      assert.ok(match.titles.length && match.titles.every((title) => FIXTURE_TITLES.includes(title)));
      assert.ok(match.titles.includes(match.label));
    }
  }
});

test('each objection carries 15 to 45 loose phrasings', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/objection-matcher.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({}); vm.runInContext(`${source}\nglobalThis.__rules = RULES;`, context);
  for (const rule of context.__rules) assert.ok(rule.variants.length >= 15 && rule.variants.length <= 45, `${rule.id}: ${rule.variants.length} variants`);
});

test('nothing in any script body or rebuttal answer triggers an objection', () => {
  const hits = [];
  for (const script of corpus.scripts) {
    for (const line of new Set([...script.sentences, ...script.lines])) {
      const match = api.matchObjection(line);
      if (match) hits.push(`${script.script}: "${line.slice(0, 90)}" => ${match.id}`);
    }
  }
  for (const rebuttal of corpus.rebuttals) {
    for (const piece of splitAnswer(rebuttal.answer)) {
      const match = api.matchObjection(piece);
      if (match) hits.push(`${rebuttal.script} answer "${rebuttal.title.slice(0, 30)}": "${piece.slice(0, 90)}" => ${match.id}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.ok(corpus.scripts.reduce((sum, script) => sum + script.sentences.length, 0) > 150, 'the corpus is the real script text');
});

test('negations and ordinary replies do not fire the new objections', () => {
  for (const utterance of ["I'm not confused", 'I do remember the card', "I'm interested", 'I am not busy right now', 'sure that time works', 'yes I am still in the union',
    'we are married', 'that is not too expensive', 'I have not spoken with anyone', 'no I do not have a will yet', 'okay that sounds good', 'my wife will be there']) {
    assert.equal(api.matchObjection(utterance), null, utterance);
  }
});

test('titles added on Salebase later still match loosely from their words, without firing on script text', () => {
  const later = [...FIXTURE_TITLES, 'I just lost my job.', 'My doctor said no more insurance.'];
  assert.equal(api.matchObjection('I just lost my job', { extraTitles: later })?.label, 'I just lost my job.');
  assert.equal(api.matchObjection('I lost my job last month', { extraTitles: later })?.via, 'title');
  assert.equal(api.matchObjection('my doctor said no more insurance', { extraTitles: later })?.label, 'My doctor said no more insurance.');
  for (const utterance of ['I did not lose my job', 'you just lost your job', 'if you lost your job', 'I just lost my job']) {
    if (utterance === 'I just lost my job') assert.equal(api.matchObjection(utterance), null, 'no fallback without page titles');
    else assert.equal(api.matchObjection(utterance, { extraTitles: later }), null, utterance);
  }
  // Curated objections still win over the title fallback.
  assert.equal(api.matchObjection('how long is this going to take', { extraTitles: later }).id, 'how-long');

  // Pretend every Salebase title were new: the fallback alone still stays silent on all the rep's text.
  const generic = { extraTitles: FIXTURE_TITLES, onlyTitles: true };
  const hits = [];
  for (const script of corpus.scripts) for (const line of new Set([...script.sentences, ...script.lines])) if (api.matchObjection(line, generic)) hits.push(line.slice(0, 90));
  for (const rebuttal of corpus.rebuttals) for (const piece of splitAnswer(rebuttal.answer)) if (api.matchObjection(piece, generic)) hits.push(piece.slice(0, 90));
  assert.deepEqual(hits, []);
  // Near-duplicate titles ("How long is this going to take?" / "...") may resolve to their twin, which is the same objection.
  const sameObjection = (title, label) => RULES.some((rule) => rule.titles.includes(title) && rule.titles.includes(label));
  const missed = FIXTURE_TITLES.filter((title) => ![title, ...api.titleAlternatives(title)].some((variant) => {
    const label = api.matchObjection(variant, generic)?.label;
    return label && sameObjection(title, label);
  }));
  // Only rep notes ("If they are single...") and two-word titles are skipped by the fallback.
  assert.deepEqual(missed.filter((title) => !/^(if|after)\b/i.test(title) && title.split(/\s+/).length > 3), []);
  assert.ok(FIXTURE_TITLES.length - missed.length >= 40, `fallback reaches ${FIXTURE_TITLES.length - missed.length} of ${FIXTURE_TITLES.length} titles`);
});

test('custom phrases in impact.objectionPhrases still work, including for the new objections', () => {
  const customPhrases = { 'how-long': ['give me a ring next week'], shopping: ['we are kicking tires'] };
  assert.equal(api.matchObjection('give me a ring next week', { customPhrases })?.id, 'how-long');
  assert.equal(api.matchObjection('we are kicking tires', { customPhrases })?.label, 'I was just shopping around.');
  assert.equal(api.matchObjection('give me a ring next week'), null);
});

test('the cooldown applies to the new objections too', () => {
  const detector = api.createObjectionDetector({ cooldownMs: 20000, anyCooldownMs: 4000 });
  assert.equal(detector.detect('how much will this cost', 0).match.id, 'cost');
  assert.equal(detector.detect('what does it cost', 5000).reason, 'cooldown');
  assert.equal(detector.detect("I'm single", 2000).match, null, 'any-objection cooldown');
  assert.equal(detector.detect("I'm single", 6000).match.id, 'single');
  assert.equal(detector.detect('what does it cost', 21000).match.id, 'cost');
});

// The listener's titles resolve against each script's own rebuttal list.
const listingFor = (active) => ({ ok: true, isScriptPage: true, activeScript: active,
  rebuttals: corpus.rebuttals.map((item) => ({ title: item.title, script: item.script, shown: item.script === active })) });
const heardIn = (utterance, script) => {
  const match = api.matchObjection(utterance);
  assert.ok(match, utterance);
  return pickRebuttalTitle(match.titles, listingFor(script), { crossScript: match.crossScript !== false });
};

test('the rebuttal for the active script opens when several scripts share an objection', () => {
  const cases = [
    ["I don't want it", 'WILLKIT', "I don't want it."],
    ["I don't want it", 'RESPONSE', "I'm not interested."],
    ["I'm not interested", 'LAPSED-POS', 'Not interested...'],
    ["I'm not interested", 'GLOBE', "I'm not interested."],
    ['how long is this going to take', 'APLUS', 'How long is this going to take?'],
    ['how long is this going to take', 'LAPSED-POS', 'How long is this going to take...'],
    ['how long is this going to take', 'POS', 'How long will this take?'],
    ['are you trying to sell me insurance', 'RESPONSE', 'Are you trying to sell me insurance?'],
    ['are you trying to sell me insurance', 'LAPSED-POS', 'Is someone going to try and sell me something/someone always wants to come out and sell me more insurance...'],
    ['are you trying to sell me something', 'FE', "You're not going to try and sell me anything are you?"],
    ['why do we have to meet', 'FE', 'Why do we have to meet a benefits coordinator?'],
    ['why do we have to meet', 'CHILDSAFE', 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?'],
    ["I don't remember filling that out", 'WILLKIT', "I don't remember filling this out."],
    ["I don't remember any card", 'RESPONSE', "I don't remember any card."],
    ['I already have one', 'CHILDSAFE', 'I already have a Child Safe Kit.'],
    ['just mail it to me', 'APLUS', 'Just mail it...'],
    ["I can't talk right now", 'MPCHILDSAFE', "I'm driving, at work, or busy!"],
    ['can you call me back', 'MPCHILDSAFE', "I'm driving, at work, or busy!"],
    ['why is it free', 'WILLKIT', 'What is in it for you? Or how is it free? Or are you going to try to sell me something?']
  ];
  for (const [utterance, script, title] of cases) {
    const picked = heardIn(utterance, script);
    assert.equal(picked?.title, title, `${utterance} @ ${script}`);
    assert.equal(picked.shown, true);
    assert.equal(picked.script, script);
  }
});

test('when the active script lacks the rebuttal it is borrowed from another script, or reported missing for script-specific ones', () => {
  // "Call me back" has no panel on Response Card, but its busy panel covers it.
  assert.equal(heardIn('can you call me back later', 'RESPONSE').title, "I can't talk right now. / I'm at work.");
  const borrowed = heardIn('I already spoke with someone', 'RESPONSE');
  assert.equal(borrowed.otherScript, true);
  assert.equal(borrowed.title, 'I already spoke with someone.');
  assert.equal(borrowed.script, 'POS');
  const callBack = heardIn('can you call me back later', 'POS');
  assert.equal(callBack.otherScript, true);
  assert.equal(callBack.script, 'CHILDSAFE');
  assert.equal(heardIn('I was just shopping around', 'WILLKIT').otherScript, true);
  assert.equal(heardIn("I'm single", 'RESPONSE').notInScript, true);
  assert.equal(heardIn("what's the two part program", 'WILLKIT').notInScript, true);
  assert.equal(heardIn("I'm single", 'LAPSED-POS').title, 'If they are single...');
  assert.equal(pickRebuttalTitle(['Can you call me back?'], { ok: true, rebuttals: [] }), null, 'no listing: the old label path is used');
});

test('matching stays fast enough for live speech', () => {
  const lines = corpus.scripts.flatMap((script) => script.sentences).slice(0, 300);
  const started = process.hrtime.bigint();
  for (const line of lines) api.matchObjection(line, { extraTitles: FIXTURE_TITLES });
  const perLineMs = Number(process.hrtime.bigint() - started) / 1e6 / lines.length;
  assert.ok(perLineMs < 25, `${perLineMs.toFixed(2)} ms per utterance`);
});

test('the listener passes page titles, and the worker reports other-script and not-in-script outcomes', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
  assert.match(worker, /extraTitles: pageRebuttalTitles\.titles/);
  assert.match(worker, /fromScript: result\.fromScript/);
  const reveal = fs.readFileSync(path.join(__dirname, '../extension/src/background/salebase-rebuttal.js'), 'utf8');
  assert.match(reveal, /'other-script'/);
  assert.match(reveal, /'not-in-script'/);
  assert.match(reveal, /type: 'impact\/listRebuttals'/);
  const content = fs.readFileSync(path.join(__dirname, '../extension/src/content/salebase-rebuttal.js'), 'utf8');
  assert.match(content, /message\?\.type === 'impact\/listRebuttals'/);
});
