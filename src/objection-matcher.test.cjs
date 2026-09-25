const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('local objection rules match common speakerphone phrases without storing audio', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/objection-matcher.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({}); vm.runInContext(source, context);
  assert.equal(context.matchObjection("I am not interested in this").label, "I'm not interested");
  assert.equal(context.matchObjection('Could you mail it to me?').label, 'Can you mail it to me?');
  assert.equal(context.matchObjection("I don't remember doing that").label, "I don't remember doing this!");
  assert.equal(context.matchObjection('Do I have to do a Zoom meeting?').label, 'Do we have to do a Zoom meeting?');
  assert.equal(context.matchObjection('Thanks, have a nice day.'), null);
});

test('listener is opt-in, asks for local processing, and does not send or save audio', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/offscreen/listener.js'), 'utf8');
  assert.match(source, /processLocally = true/);
  assert.match(source, /processLocally: true/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /MediaRecorder/);
});
