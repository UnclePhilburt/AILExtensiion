const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const strip = (source) => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function load(file) {
  const context = vm.createContext({});
  vm.runInContext(strip(read(file)), context);
  return context;
}

const phone = load('phone-web/public/appointment-reminders.js');
const extension = load('extension/src/shared/appointment-reminders.js');
const at = (hour, minute = 0) => new Date(2026, 8, 26, hour, minute, 0);
const morning = at(10, 0);

test('reminder windows: morning, within the hour, then the last few minutes', () => {
  assert.equal(phone.reminderKind(at(16, 0), morning), 'morning');
  assert.equal(phone.reminderKind(at(11, 0), morning), 'hour');
  assert.equal(phone.reminderKind(at(10, 6), morning), 'starting');
  assert.equal(phone.reminderKind(at(9, 58), morning), 'starting');
  assert.equal(phone.reminderKind(at(16, 0), at(8, 30)), '');
  assert.equal(phone.reminderKind(at(16, 0), at(11, 30)), '');
  assert.equal(phone.reminderKind(at(16, 0), new Date(2026, 8, 27, 10, 0, 0)), '');
});

test('an all-day appointment reminds on that morning, and a callback does not', () => {
  const allDay = new Date(Date.UTC(2026, 8, 26, 5, 0, 0)).toISOString();
  assert.equal(phone.reminderKind(allDay, morning, true), 'morning');
  assert.equal(phone.reminderKind(allDay, at(12, 0), true), '');
  const due = phone.dueReminders([
    { impact_lead_id: '20', lead_name: 'Later', starts_at: at(16, 0).toISOString(), kind: 'appointment' },
    { impact_lead_id: '21', lead_name: 'Soon', starts_at: at(10, 5).toISOString(), kind: 'virtual-appointment' },
    { impact_lead_id: '22', lead_name: 'Call back', starts_at: at(10, 30).toISOString(), kind: 'callback' }
  ], morning);
  assert.deepEqual(due.map((item) => item.impact_lead_id), ['21', '20']);
  assert.equal(phone.reminderText('hour', 'Jordan'), 'Jordan has an appointment coming up within the hour. Text a reminder.');
  assert.match(read('phone-web/public/appointment-reminders.js'), /Appointment already scheduled\. Don't call unless you need to\./);
});

test('the computer uses the same windows and skips callbacks', () => {
  const due = extension.dueReminders([
    { impact_lead_id: '30', lead_name: 'Noon', starts_at: at(11, 0).toISOString(), kind: 'appointment' },
    { impact_lead_id: '31', lead_name: 'Callback', starts_at: at(10, 20).toISOString(), kind: 'callback' }
  ], morning);
  assert.equal(JSON.stringify(due), JSON.stringify([{ leadId: '30', name: 'Noon', startsAt: at(11, 0).toISOString(), kind: 'hour' }]));
});

test('Next and Best next bring a due appointment forward once; Previous does not', () => {
  const source = read('extension/src/content/impact-diagnostic.js');
  assert.match(source, /if \(direction === "next" && await openDueReminder\(\)\) return;/);
  assert.match(source, /async function openBestNextLead\(command\) \{\s*if \(await openDueReminder\(\)\) return;/);
  assert.match(source, /if \(command\.type === "open-lead"\)/);
  assert.doesNotMatch(source, /command\.type === "open-lead" && command\.leadId/);
  assert.match(read('supabase/migrations/017_open_lead.sql'), /'open-lead'/);
  assert.match(read('phone-web/public/app.js'), /Appointment already scheduled/);
  assert.match(read('phone-web/public/workspace.html'), /id="showReminderLead"/);
});
