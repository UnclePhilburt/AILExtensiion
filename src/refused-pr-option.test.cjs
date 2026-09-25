const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
const prCode = source.slice(source.indexOf('  async function clickRefusedAppointment('), source.indexOf('  function clickNoAnswer('));
const QUICK = { appearMs: 300, readyMs: 150, closeMs: 200, stepMs: 10 };
const PR_ERROR = /IMPACT's PR question couldn't be answered automatically\. Pick No and Submit on your computer\./;

// Minimal fake elements: only what the content script reads.
function element({ tag = 'DIV', text = '', attrs = {}, classes = [], visible = true, ...props } = {}) {
  const el = {
    tagName: tag, textContent: text, innerText: text, attrs: { ...attrs }, clicks: 0, events: [], visible,
    classList: { list: new Set(classes), contains(name) { return this.list.has(name); } },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    getClientRects() { return this.visible ? [{}] : []; },
    dispatchEvent(event) { this.events.push(event.type); return true; },
    closest() { return null; },
    click() { this.clicks++; this.onclick?.(); },
    ...props
  };
  return el;
}
function radio({ name = 'pr', label, checked = false, type = 'radio', group }) {
  const input = element({ tag: 'INPUT', type, checked, id: `${name}-${label}` });
  input.click = function () {
    this.clicks++;
    if (this.type === 'checkbox') { this.checked = !this.checked; return; }
    for (const other of group) other.checked = other === this;
  };
  return input;
}
function body({ labels = [], toggles = [], selects = [], clickables = [] }) {
  return element({ classes: ['modal-body'], querySelectorAll(selector) {
    if (selector === 'label') return labels;
    if (selector === 'input[type="radio"], input[type="checkbox"]') return toggles;
    if (selector === 'input[type="checkbox"]') return toggles.filter((input) => input.type === 'checkbox');
    if (selector === 'select') return selects;
    if (selector.startsWith('button, a,')) return clickables;
    throw new Error(`unexpected selector ${selector}`);
  } });
}
function prDialog(modalBody, { visible = true } = {}) {
  const dialog = element({ attrs: { id: 'prOptionDialog', role: 'dialog' }, classes: ['modal', 'fade', 'in'], visible });
  const submit = element({ tag: 'A', text: 'Submit', attrs: { onclick: 'onPROption(123)' }, classes: ['btn', 'btn-primary'] });
  const cancel = element({ tag: 'A', text: 'Cancel', attrs: { 'data-dismiss': 'modal' } });
  submit.onclick = () => { dialog.visible = false; }; // IMPACT closes the box on Submit.
  dialog.querySelector = (selector) => (selector === '.modal-body' ? modalBody : null);
  dialog.querySelectorAll = (selector) => { if (selector === '.modal-footer a') return [submit, cancel]; throw new Error(selector); };
  return { dialog, submit, cancel };
}
function load({ dialog = null, extra = {} } = {}) {
  const logs = []; const storage = new Map([['impact.pendingResultAdvance', JSON.stringify({ leadId: 'L1', requestedAt: 1, awaitingOK: true })]]);
  const context = vm.createContext({
    Date, JSON, Event: class { constructor(type) { this.type = type; } },
    window: { setTimeout }, logs,
    document: { querySelector: (selector) => (selector === '#prOptionDialog' ? context.currentDialog : null), querySelectorAll: () => [] },
    currentDialog: dialog,
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    sanitizeText: (value) => String(value || '').replace(/\s+/g, ' ').trim(),
    log: async (...entry) => { logs.push(entry); },
    ...extra
  });
  vm.runInContext(`${prCode}\nthis.answerPrOptionDialog = answerPrOptionDialog; this.clickRefusedAppointment = clickRefusedAppointment;`, context);
  return { context, storage, logs };
}
const threeRadios = (preselected) => {
  const group = [];
  for (const label of ['No', 'Great Experience', 'Poor Experience']) group.push(radio({ label, checked: label === preselected, group }));
  return group;
};

test('radio buttons with label[for]: No is clicked and checked, then Submit', async () => {
  const group = threeRadios();
  const labels = group.map((input) => element({ tag: 'LABEL', text: input.id.slice(3), attrs: { for: input.id } }));
  const { dialog, submit, cancel } = prDialog(body({ labels, toggles: group }));
  const { context, storage, logs } = load({ dialog });
  assert.equal(await context.answerPrOptionDialog(QUICK), 'answered');
  assert.deepEqual(group.map((input) => [input.clicks, input.checked]), [[1, true], [0, false], [0, false]]);
  assert.equal(submit.clicks, 1);
  assert.equal(cancel.clicks, 0);
  assert.ok(JSON.parse(storage.get('impact.pendingResultAdvance')).requestedAt > 1, 'result-advance clock restarted');
  assert.equal(logs.at(-1)[1], 'refused.prOptionAnswered');
});

test('a preselected answer is switched to No; wrapping labels and plain text beside the radio work', async () => {
  const group = threeRadios('Great Experience');
  const wrapping = element({ tag: 'LABEL', text: ' No ' });
  group[0].closest = (selector) => (selector === 'label' ? wrapping : null);
  group[1].nextSibling = { nodeType: 3, textContent: ' Great Experience' };
  group[2].nextSibling = { nodeType: 3, textContent: ' ' };
  group[2].nextElementSibling = element({ tag: 'SPAN', text: 'Poor Experience' });
  const { dialog, submit } = prDialog(body({ toggles: group }));
  const { context } = load({ dialog });
  assert.equal(await context.answerPrOptionDialog(QUICK), 'answered');
  assert.deepEqual(group.map((input) => input.checked), [true, false, false]);
  assert.equal(submit.clicks, 1);

  const already = threeRadios('No');
  already.forEach((input, i) => { input.nextSibling = { nodeType: 3, textContent: ['No', 'Great Experience', 'Poor Experience'][i] }; });
  const second = prDialog(body({ toggles: already }));
  assert.equal(await load({ dialog: second.dialog }).context.answerPrOptionDialog(QUICK), 'answered');
  assert.equal(already[0].checked, true);
});

test('a <select> gets its No option chosen with input and change events', async () => {
  const options = ['', 'No', 'Great Experience', 'Poor Experience'].map((text, i) => element({ tag: 'OPTION', text: text || 'Select', value: String(i), selected: i === 0 }));
  const select = element({ tag: 'SELECT', value: '0', options });
  const { dialog, submit } = prDialog(body({ selects: [select] }));
  const { context } = load({ dialog });
  assert.equal(await context.answerPrOptionDialog(QUICK), 'answered');
  assert.equal(select.value, '1');
  assert.equal(options[1].selected, true);
  assert.deepEqual(select.events, ['input', 'change']);
  assert.equal(submit.clicks, 1);
});

test('button-style choices: only the exact "No" button is clicked', async () => {
  const buttons = ['No', 'Great Experience', 'Poor Experience'].map((text) => element({ tag: 'BUTTON', text }));
  const { dialog, submit } = prDialog(body({ clickables: buttons }));
  const { context } = load({ dialog });
  assert.equal(await context.answerPrOptionDialog(QUICK), 'answered');
  assert.deepEqual(buttons.map((button) => button.clicks), [1, 0, 0]);
  assert.equal(submit.clicks, 1);
});

test('checkboxes: No is ticked once, never unticked, and other ticks block Submit', async () => {
  const boxes = ['No', 'Great Experience'].map((label) => radio({ label, type: 'checkbox', group: [] }));
  boxes.forEach((box, i) => { box.nextSibling = { nodeType: 3, textContent: ['No', 'Great Experience'][i] }; });
  const first = prDialog(body({ toggles: boxes }));
  assert.equal(await load({ dialog: first.dialog }).context.answerPrOptionDialog(QUICK), 'answered');
  assert.equal(boxes[0].checked, true);
  boxes[1].checked = true;
  const second = prDialog(body({ toggles: boxes }));
  await assert.rejects(load({ dialog: second.dialog }).context.answerPrOptionDialog(QUICK), PR_ERROR);
  assert.equal(boxes[0].checked, true, 'an already-ticked No is not clicked off');
  assert.equal(second.submit.clicks, 0);
});

test('no exact "No" choice: clear error, Submit not clicked, automatic advance stopped', async () => {
  const buttons = ['Nope', 'Great Experience', 'Poor Experience', 'Not now'].map((text) => element({ tag: 'BUTTON', text }));
  const { dialog, submit } = prDialog(body({ clickables: buttons }));
  const { context, storage, logs } = load({ dialog });
  await assert.rejects(context.answerPrOptionDialog(QUICK), PR_ERROR);
  assert.equal(submit.clicks, 0);
  assert.equal(buttons.reduce((sum, button) => sum + button.clicks, 0), 0);
  assert.equal(storage.has('impact.pendingResultAdvance'), false);
  assert.equal(logs.at(-1)[1], 'refused.prOptionFailed');
});

test('two "No" controls are ambiguous: nothing is clicked', async () => {
  const buttons = [element({ tag: 'BUTTON', text: 'No' }), element({ tag: 'A', text: 'no' })];
  const { dialog, submit } = prDialog(body({ clickables: buttons }));
  await assert.rejects(load({ dialog }).context.answerPrOptionDialog(QUICK), PR_ERROR);
  assert.deepEqual([submit.clicks, buttons[0].clicks, buttons[1].clicks], [0, 0, 0]);
});

test('the Submit must be the onPROption link; otherwise nothing is submitted', async () => {
  const group = threeRadios();
  group.forEach((input, i) => { input.nextSibling = { nodeType: 3, textContent: ['No', 'Great Experience', 'Poor Experience'][i] }; });
  const { dialog, submit } = prDialog(body({ toggles: group }));
  submit.attrs.onclick = 'somethingElse()';
  await assert.rejects(load({ dialog }).context.answerPrOptionDialog(QUICK), PR_ERROR);
  assert.equal(submit.clicks, 0);
});

test('the dialog never appears (or stays hidden/faded): existing flow continues and it is logged', async () => {
  const none = load();
  assert.equal(await none.context.answerPrOptionDialog(QUICK), 'not-shown');
  assert.equal(none.logs[0][1], 'refused.prOptionDialogNotShown');
  assert.ok(none.storage.has('impact.pendingResultAdvance'), 'OK/Next handling still runs');
  const hidden = prDialog(body({ clickables: [element({ tag: 'BUTTON', text: 'No' })] }), { visible: false });
  assert.equal(await load({ dialog: hidden.dialog }).context.answerPrOptionDialog(QUICK), 'not-shown');
  assert.equal(hidden.submit.clicks, 0);
  const fading = prDialog(body({ clickables: [element({ tag: 'BUTTON', text: 'No' })] }));
  fading.dialog.classList.list.delete('in');
  assert.equal(await load({ dialog: fading.dialog }).context.answerPrOptionDialog(QUICK), 'not-shown');
});

test('a dialog that opens late and fills in late is still answered', async () => {
  const buttons = [];
  const { dialog, submit } = prDialog(body({ clickables: buttons }));
  const { context } = load();
  setTimeout(() => { context.currentDialog = dialog; }, 40);
  setTimeout(() => { buttons.push(element({ tag: 'BUTTON', text: 'No' })); }, 90);
  assert.equal(await context.answerPrOptionDialog(QUICK), 'answered');
  assert.equal(buttons[0].clicks, 1);
  assert.equal(submit.clicks, 1);
});

test('the box still open after Submit is reported', async () => {
  const { dialog, submit } = prDialog(body({ clickables: [element({ tag: 'BUTTON', text: 'No' })] }));
  submit.onclick = () => {};
  const { context, storage } = load({ dialog });
  await assert.rejects(context.answerPrOptionDialog(QUICK), /PR box is still open after Submit/);
  assert.equal(storage.has('impact.pendingResultAdvance'), false);
});

test('Refused Appointment: panel Submit first, then the PR question is answered No', async () => {
  const order = [];
  const choice = element({ tag: 'A', text: 'Refused Appointment :', attrs: { href: '#panelRefused' } });
  choice.onclick = () => order.push('refused-option');
  const panelSubmit = element({ tag: 'INPUT', type: 'button', value: 'Submit', attrs: { onclick: 'MarkResolveRefused(1, 2, 8) ; return false;' } });
  const panel = element({ querySelectorAll: (selector) => (selector === 'input, select, textarea' ? [] : [panelSubmit]) });
  const noButton = element({ tag: 'BUTTON', text: 'No' });
  noButton.onclick = () => order.push('pr-no');
  const pr = prDialog(body({ clickables: [noButton] }));
  const originalSubmit = pr.submit.onclick;
  pr.submit.onclick = () => { order.push('pr-submit'); originalSubmit(); };
  let context;
  ({ context } = load({ extra: {
    validateCallResult() {},
    submitCallResult(_command, target) { order.push('panel-submit'); assert.equal(target, panelSubmit); setTimeout(() => { context.currentDialog = pr.dialog; }, 30); }
  } }));
  context.document.querySelectorAll = (selector) => (selector.includes('panelRefused') ? [choice] : []);
  const baseQuery = context.document.querySelector;
  context.document.querySelector = (selector) => (selector === '#statuscontainer #panelRefused' ? panel : baseQuery(selector));
  assert.equal(await context.clickRefusedAppointment({ type: 'refused-appointment', leadId: 'L1' }, QUICK), 'answered');
  assert.deepEqual(order, ['refused-option', 'panel-submit', 'pr-no', 'pr-submit']);
});

test('the quiet-hours watcher ignores the PR dialog, and the phone message mentions the PR answer', () => {
  const quietHours = /do\s+not\s+(?:knock|visit).{0,100}\b8\s*(?::\s*00)?\s*(?:p\.?m\.?|pm)\b/i;
  assert.ok(source.includes(quietHours.source), 'watcher pattern unchanged');
  assert.equal(quietHours.test('× PR Option Flag for PR? No Great Experience Poor Experience Comment: Submit Cancel'), false);
  assert.match(source, /Refused Appointment submitted \(PR flag: No\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'), /"version": "0\.3\.7"/);
});
