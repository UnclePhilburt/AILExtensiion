const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('local objection rules match common speakerphone phrases without storing audio', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/objection-matcher.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({}); vm.runInContext(source, context);
  assert.equal(context.matchObjection("I am not interested in this").label, "I'm not interested.");
  assert.equal(context.matchObjection('Could you mail it to me?').label, 'Can you mail it to me?');
  assert.equal(context.matchObjection("I don't remember doing that").label, "I don't remember doing this!");
  assert.equal(context.matchObjection('Do I have to do a Zoom meeting?').label, 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?');
  assert.equal(context.matchObjection('Thanks, have a nice day.'), null);
});

test('listener is opt-in, asks for local processing, and does not send or save audio', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/offscreen/listener.js'), 'utf8');
  assert.match(source, /processLocally = true/);
  assert.match(source, /processLocally: true/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /MediaRecorder/);
  assert.match(source, /changes\['impact\.objectionListening'\]\?\.newValue === false/);
});

test('the extension offers a direct local English-pack install and detected browser language settings', () => {
  const popup = fs.readFileSync(path.join(__dirname, '../extension/src/popup/popup.js'), 'utf8');
  assert.match(popup, /const install = Recognition\.install\(\{ langs: \['en-US'\], processLocally: true \}\)/);
  assert.match(popup, /brave:\/\/settings\/languages/);
  assert.match(popup, /edge:\/\/settings\/languages/);
  assert.match(popup, /chrome:\/\/settings\/languages/);
  assert.match(popup, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(popup, /chrome:\/\/settings\/content\/microphone/);
  const permissionPage = fs.readFileSync(path.join(__dirname, '../extension/src/offscreen/microphone-permission.js'), 'utf8');
  assert.match(permissionPage, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
});

test('Salebase rebuttal lookup uses the saved label and phrase variants in the existing script tab', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
  assert.match(worker, /revealSalebaseRebuttal\(match\)/);
  assert.match(worker, /revealRebuttalInScriptTab\(chrome, match, \{ otherLabels: REBUTTAL_LABELS\.filter/);
  const reveal = worker.slice(worker.indexOf('async function revealSalebaseRebuttal'), worker.indexOf('async function getPhoneCommand'));
  assert.doesNotMatch(reveal, /tabs\.create|windows\.create|window\.open/);
  const module = fs.readFileSync(path.join(__dirname, '../extension/src/background/salebase-rebuttal.js'), 'utf8');
  assert.match(module, /label: match\?\.label \|\| '', phrases: match\?\.phrases \|\| \[\]/);
  assert.doesNotMatch(module, /tabs\.create|windows\.create/);
});
