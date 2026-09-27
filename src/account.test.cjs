const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('account UI signs in, clears the password, signs out, and validates password confirmation', async () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', hidden: false, textContent: '', listeners: {}, classList: { toggle() {} },
      addEventListener(event, listener) { this.listeners[event] = listener; }, reportValidity: () => true
    });
    return elements.get(selector);
  };
  let credentials;
  let passwordUpdates = 0;
  const auth = {
    onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }),
    signInWithPassword: async input => { credentials = input; return { data: { session: { user: { email: input.email } } } }; },
    signOut: async () => ({}), updateUser: async () => { passwordUpdates++; return {}; }
  };
  const saved = {};
  const context = vm.createContext({
    createClient: () => ({ auth, rpc: async () => ({ error: null }) }), URLSearchParams,
    localStorage: { getItem: (key) => saved[key] ?? null, setItem: (key, value) => { saved[key] = String(value); } },
    location: { hash: '', search: '?next=workspace.html', assign: value => { context.destination = value; } },
    callingHoursOpen: () => true,
    CLOSED_MESSAGE: 'Companion is closed. You can sign in from 9:00 AM to 9:00 PM in your time zone.',
    setInterval: () => 0,
    document: { querySelector: element, querySelectorAll: () => [] }
  });
  const source = fs.readFileSync('src/account.js', 'utf8').replace(/^import .*$/gm, '');
  const store = fs.readFileSync('phone-web/public/settings-store.js', 'utf8').replace(/^export /gm, '');
  vm.runInContext(`${store}\n${source}`, context);
  await new Promise(setImmediate);
  assert.equal(element('#account').hidden, true);
  element('#email').value = ' tester@example.test ';
  element('#password').value = 'test-only-password';
  element('#signInForm').listeners.submit({ preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(credentials.email, 'tester@example.test');
  assert.equal(context.destination, './');
  assert.equal(element('#password').value, '');
  assert.equal(element('#signInForm').hidden, true);
  assert.equal(element('#account').hidden, false);
  element('#newPassword').value = 'new-test-password';
  element('#confirmPassword').value = 'different';
  element('#passwordForm').listeners.submit({ preventDefault() {} });
  assert.equal(passwordUpdates, 0);
  assert.match(element('#message').textContent, /do not match/);
  element('#accountFirstName').value = 'Cody';
  element('#newPassword').value = element('#confirmPassword').value = 'long-enough-password';
  element('#passwordForm').listeners.submit({ preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(passwordUpdates, 1);
  assert.match(saved['impact.phoneSettings'] || '', /"firstName":"Cody"/);
  element('#signOut').listeners.click();
  await new Promise(setImmediate);
  assert.equal(element('#account').hidden, true);
  assert.equal(element('#signInForm').hidden, false);
});
