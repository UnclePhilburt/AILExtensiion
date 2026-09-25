const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load() {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/script-fields.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({});
  vm.runInContext(`${source}\nthis.api = { splitPersonName, parseAddress, formatDob, scriptFieldsFromLead, titleCaseWord, agentFirstName, speakableGroup };`, context);
  return context.api;
}
const api = load();
const plain = (value) => JSON.parse(JSON.stringify(value));

test('first names come out title-cased from IMPACT "LAST, FIRST" and other name shapes', () => {
  const cases = {
    'CARTER, JAMES': ['James', 'James Carter'],
    'JAMES CARTER': ['James', 'James Carter'],
    'carter, james': ['James', 'James Carter'],
    'CARTER, JAMES R': ['James', 'James Carter'],
    'CARTER, JAMES R.': ['James', 'James Carter'],
    'CARTER JR, JAMES': ['James', 'James Carter Jr.'],
    'Smith, John A. Jr.': ['John', 'John Smith Jr.'],
    'CARTER, J ROBERT': ['Robert', 'Robert Carter'],
    "O'NEIL, MARY-ANN": ['Mary-Ann', "Mary-Ann O'Neil"],
    'MCDONALD, RONALD': ['Ronald', 'Ronald McDonald'],
    'DE LA CRUZ, MARIA': ['Maria', 'Maria De La Cruz'],
    'WASHINGTON III, GEORGE': ['George', 'George Washington III'],
    'JAMES': ['James', 'James']
  };
  for (const [raw, [first, full]] of Object.entries(cases)) {
    const name = api.splitPersonName(raw);
    assert.equal(name.firstName, first, raw);
    assert.equal(name.fullName, full, raw);
  }
  assert.equal(api.splitPersonName('').firstName, '');
});

test('addresses are read back naturally and split into street, city, state and zip', () => {
  assert.deepEqual(plain(api.parseAddress('123 N MAIN ST APT 4B SPRINGFIELD, IL 62704')), { street: '123 N Main St Apt 4B', city: 'Springfield', state: 'IL', zip: '62704', full: '123 N Main St Apt 4B, Springfield, IL 62704' });
  assert.equal(api.parseAddress('123 MAIN ST, SPRINGFIELD, IL 62704').full, '123 Main St, Springfield, IL 62704');
  assert.equal(api.parseAddress('4500 W 12TH AVE KANSAS CITY MO 64111').city, 'Kansas City');
  assert.equal(api.parseAddress('PO BOX 12 SMALLTOWN, TX 75001-1234').full, 'PO Box 12, Smalltown, TX 75001');
  // No street word to split on: the whole line stays together, nothing guessed.
  assert.deepEqual(plain(api.parseAddress('9 PINEHURST SPRINGFIELD IL 62704')), { street: '9 Pinehurst Springfield', city: '', state: 'IL', zip: '62704', full: '9 Pinehurst Springfield, IL 62704' });
  assert.equal(api.parseAddress('').full, '');
});

test('dates of birth read as "March 4, 1985" and anything else is left out', () => {
  assert.equal(api.formatDob('03/04/1985'), 'March 4, 1985');
  assert.equal(api.formatDob('1985-03-04'), 'March 4, 1985');
  assert.equal(api.formatDob('3-4-85'), 'March 4, 1985');
  assert.equal(api.formatDob('Mar 4, 1985'), 'March 4, 1985');
  assert.equal(api.formatDob('13/40/1999'), '');
  assert.equal(api.formatDob('unknown'), '');
});

test('script fields use only what the IMPACT lead has; missing values stay empty', () => {
  const lead = { available: true, leadName: 'CARTER, JAMES', address: '123 MAIN ST SPRINGFIELD, IL 62704', email: 'JC@EXAMPLE.COM', requestType: 'Union Member Request',
    phones: [{ label: 'Home', number: '(555) 010-0101' }, { label: 'Mobile', number: '(555) 010-0100' }] };
  const fields = plain(api.scriptFieldsFromLead(lead));
  assert.equal(fields.firstName, 'James');
  assert.equal(fields.fullName, 'James Carter');
  assert.equal(fields.address, '123 Main St, Springfield, IL 62704');
  assert.equal(fields.phone, '(555) 010-0100');
  assert.equal(fields.email, 'jc@example.com');
  for (const key of ['dob', 'group', 'beneficiary', 'spouse', 'kits', 'agent']) assert.equal(fields[key], '', key);
  const more = plain(api.scriptFieldsFromLead(lead, { dob: '03/04/1985', group: 'IBEW Local 58', beneficiary: 'CARTER, MARY', kits: '3' }, { user_metadata: { full_name: 'cody smith' } }));
  assert.equal(more.dob, 'March 4, 1985');
  assert.equal(more.group, 'IBEW Local 58');
  assert.equal(more.beneficiary, 'Mary Carter');
  assert.equal(more.kits, '3');
  assert.equal(more.agent, 'Cody');
  assert.equal(api.scriptFieldsFromLead(lead, { kits: 'several' }).kits, '');
  assert.equal(api.scriptFieldsFromLead({ available: false }), null);
});

test('IMPACT lead panel: optional "Label: value" details are read only when IMPACT shows them', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
  const grab = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const code = [
    grab('  const SCRIPT_DETAIL_LABELS', '  function extractSimpleLabel'),
    grab('  function sanitizeText', '  function redactCustomerText'),
    grab('  function escapeRegExp', '\n  }\n') + '\n  }\n'
  ].join('\n');
  const context = vm.createContext({});
  vm.runInContext(`${code}\nthis.collect = (text) => collectScriptDetails({ innerText: text });`, context);
  const read = (text) => { const out = JSON.parse(JSON.stringify(context.collect(text))); delete out.groupSource; delete out.groupTableHeaders; return out; };
  assert.deepEqual(read('CARTER, JAMES edit Language: English Mobile: (555) 010-0100 x@y.com 1 MAIN ST SPRINGFIELD, IL 62704 Map It'), {});
  assert.deepEqual(read('CARTER, JAMES Date of Birth: 03/04/1985 Group Name: IBEW Local 58 Beneficiary: CARTER, MARY Number of Kits: 2 Language: English'),
    { dob: '03/04/1985', group: 'IBEW Local 58', beneficiary: 'CARTER, MARY', kits: '2' });
  assert.deepEqual(read('DOB: 1985-03-04 Spouse: Mary Carter'), { dob: '1985-03-04', spouse: 'Mary Carter' });
  assert.deepEqual(read('Request Type Union Member Request Subgroup: none'), {}, 'no label, no value; "Subgroup" is not "Group"');
});

test('IMPACT group: found by label, request table, request type or pattern; never a phone number, ZIP or apartment', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
  const grab = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const code = [
    grab('  const SCRIPT_DETAIL_LABELS', '  function extractSimpleLabel'),
    grab('  function sanitizeText', '  function redactCustomerText'),
    grab('  function escapeRegExp', '\n  }\n') + '\n  }\n'
  ].join('\n');
  const context = vm.createContext({});
  vm.runInContext(`${code}\nthis.findGroupCode = findGroupCode; this.collect = (panel, type, name) => collectScriptDetails(panel, type, name);`, context);
  const find = context.findGroupCode;
  assert.equal(find('IBT 610 (SGCOY) (AD&D)'), 'IBT 610 (SGCOY) (AD&D)', "Cody's capture");
  assert.equal(find('IUOE 148 (SGK2Q) (AD&D)'), 'IUOE 148 (SGK2Q) (AD&D)');
  assert.equal(find('Local 150 (ABC12)'), 'Local 150 (ABC12)');
  assert.equal(find('IBEW LOCAL 58 (X1)'), 'IBEW LOCAL 58 (X1)');
  assert.equal(find('Request Type RESPONSE CARD IUOE 148 (SGK2Q) (AD&D) Language: English'), 'IUOE 148 (SGK2Q) (AD&D)', 'heading words are not part of the group');
  for (const text of ['Mobile: (555) 010-0100 Home: (555) 010-0101', 'MOBILE 555 (555) 010-0100', '123 MAIN ST SPRINGFIELD, IL 62704 (H)', '12 OAK AVE APT 4 (REAR)',
    'HWY 61 (NORTH)', 'CARTER, JAMES', 'Union Member Request', 'Call 3 (No Answer)', 'IUOE 148', 'Account 1234 (5678)']) {
    assert.equal(find(text), '', text);
  }
  const panel = (text, table) => ({ innerText: text, querySelector: (selector) => (table && selector.includes('table.table-bordered') ? table : null) });
  const table = (rows) => ({ querySelectorAll: () => rows.map((cells) => ({ querySelectorAll: () => cells.map((cell) => ({ innerText: cell })) })) });
  const read = (...args) => JSON.parse(JSON.stringify(context.collect(...args)));
  // Cody's capture: the 2nd-row cell of the bordered request table (the cell
  // the request type is read from) holds "IBT 610 (SGCOY) (AD&D)".
  const ibt = table([['Request Type'], ['IBT 610 (SGCOY) (AD&D)']]);
  assert.deepEqual(read(panel('CARTER, JAMES Request Type IBT 610 (SGCOY) (AD&D) Mobile: (555) 010-0100', ibt), 'IBT 610 (SGCOY) (AD&D)', 'CARTER, JAMES'),
    { group: 'IBT 610 (SGCOY) (AD&D)', groupSource: 'request type', groupTableHeaders: ['Request Type'] });
  // Matched by its heading when IMPACT labels it.
  assert.equal(read(panel('x', table([['Group'], ['IBT 610 (SGCOY) (AD&D)']])), '').groupSource, 'table:Group');
  assert.equal(read(panel('x', table([['Account'], ['IBT 610 (SGCOY) (AD&D)']])), '').groupSource, 'table:Account');
  assert.equal(read(panel('x', table([['Account'], ['Web']])), 'Will Kit').group, undefined, 'a weak heading needs a group-looking value');
  assert.equal(read(panel('x', table([['Union'], ['Teamsters']])), 'Will Kit').group, 'Teamsters', 'a group heading is taken as written');
  // In the request type text.
  assert.deepEqual(read(panel('CARTER, JAMES Language: English'), 'Response Card - IUOE 148 (SGK2Q) (AD&D)', 'CARTER, JAMES'), { group: 'IUOE 148 (SGK2Q) (AD&D)', groupSource: 'request type', groupTableHeaders: [] });
  // Its own column in the request table.
  assert.deepEqual(read(panel('x', table([['Request Type', 'Group'], ['Union Member Request', 'IUOE 148 (SGK2Q) (AD&D)']])), 'Union Member Request'),
    { group: 'IUOE 148 (SGK2Q) (AD&D)', groupSource: 'table:Group', groupTableHeaders: ['Request Type', 'Group'] });
  // Another cell of that table, without a heading we know.
  assert.equal(read(panel('x', table([['Request Type', 'Sub'], ['Union Member Request', 'Local 150 (ABC12)']])), 'Union Member Request').groupSource, 'request table');
  // Only under a label that usually means something else.
  assert.deepEqual(read(panel('CARTER, JAMES Source: IUOE 148 (SGK2Q) (AD&D) Language: English'), 'Union Member Request'), { group: 'IUOE 148 (SGK2Q) (AD&D)', groupSource: 'label:Source', groupTableHeaders: [] });
  assert.deepEqual(read(panel('CARTER, JAMES Source: Web Language: English'), 'Will Kit'), { groupSource: 'none', groupTableHeaders: [] });
  // Anywhere else on the panel.
  assert.equal(read(panel('CARTER, JAMES IUOE 148 (SGK2Q) Mobile: (555) 010-0100 1 MAIN ST SPRINGFIELD, IL 62704'), 'Union Member Request', 'CARTER, JAMES').group, 'IUOE 148 (SGK2Q)');
  // A labelled group wins and is kept as written.
  assert.equal(read(panel('Group: IBEW Local 58 Source: IUOE 148 (SGK2Q)'), '').group, 'IBEW Local 58');
});

test('group placeholder: say the name and number, keep the codes for the tooltip', () => {
  assert.equal(api.speakableGroup('IBT 610 (SGCOY) (AD&D)'), 'IBT 610', "Cody's capture");
  assert.equal(api.speakableGroup('IUOE 148 (SGK2Q) (AD&D)'), 'IUOE 148');
  assert.equal(api.speakableGroup('Local 150 (ABC12)'), 'Local 150');
  assert.equal(api.speakableGroup('IBEW Local 58'), 'IBEW Local 58');
  assert.equal(api.speakableGroup('(SGK2Q)'), '(SGK2Q)', 'nothing left to say: keep it');
  const fields = plain(api.scriptFieldsFromLead({ available: true, leadName: 'CARTER, JAMES', requestType: 'IBT 610 (SGCOY) (AD&D)' }, { group: 'IBT 610 (SGCOY) (AD&D)' }));
  assert.equal(fields.group, 'IBT 610');
  assert.equal(fields.groupRaw, 'IBT 610 (SGCOY) (AD&D)');
});
