// The phone (phone-web/public/lead-rules.js) and the extension
// (extension/src/content/impact-diagnostic.js) each have findGroupCode: the
// extension's content script cannot import modules. Same pattern, same word
// lists, same answers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const phoneSource = read('phone-web/public/lead-rules.js');
const extensionSource = read('extension/src/content/impact-diagnostic.js');

const line = (source, name) => {
  const match = source.match(new RegExp(`^\\s*const ${name} = (.+);$`, 'm'));
  assert.ok(match, name);
  return match[1];
};

function phoneFind() {
  const context = vm.createContext({});
  vm.runInContext(`${read('phone-web/public/time-zone.js')}\n${phoneSource}`.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nthis.find = findGroupCode;', context);
  return context.find;
}
function extensionFind() {
  const grab = (start, end) => extensionSource.slice(extensionSource.indexOf(start), extensionSource.indexOf(end, extensionSource.indexOf(start)));
  const code = [grab('  const GROUP_CODE = ', '  // The request table'), grab('  function sanitizeText', '  function redactCustomerText')].join('\n');
  const context = vm.createContext({});
  vm.runInContext(`${code}\nthis.find = findGroupCode;`, context);
  return context.find;
}

test('phone and extension use the identical group pattern and word lists', () => {
  for (const name of ['GROUP_CODE', 'NOT_GROUP_WORDS', 'GROUP_LEAD_IN']) assert.equal(line(phoneSource, name), line(extensionSource, name), name);
});

test('phone and extension find the same groups (and the same non-groups)', () => {
  const phone = phoneFind();
  const extension = extensionFind();
  const cases = {
    'IBT 610 (SGCOY) (AD&D)': 'IBT 610 (SGCOY) (AD&D)',
    'IUOE 148 (SGK2Q) (AD&D)': 'IUOE 148 (SGK2Q) (AD&D)',
    'Local 150 (ABC12)': 'Local 150 (ABC12)',
    'Response Card - IBT 610 (SGCOY) (AD&D)': 'IBT 610 (SGCOY) (AD&D)',
    '(555) 010-0100': '', 'Mobile: (555) 010-0100': '', '123 MAIN ST SPRINGFIELD, IL 62704 (H)': '', '12 OAK AVE APT 4 (REAR)': '',
    'Union Member Request': '', 'Child Safe Kit': '', 'Call 3 (No Answer)': '', 'IBT 610': ''
  };
  for (const [text, expected] of Object.entries(cases)) {
    assert.equal(phone(text), expected, `phone: ${text}`);
    assert.equal(extension(text), expected, `extension: ${text}`);
  }
});
