const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PGlite} = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const sql = (file) => fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8');

test('009 calendar: owner-only rows, no duplicates, replaced schedules removed, bad input rejected', async () => {
  const db = new PGlite();
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222', c = '33333333-3333-4333-8333-333333333333';
  const lead = { leadKey: 'lead:123', leadId: '123', leadName: 'Fictional Lead', phone: '555-0100', address: '1 Sample St', requestType: 'Union Member Request' };
  const future = (days, hour = 15) => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour + 5, 0, 0, 0); return d.toISOString(); };
  const appt = (startsAt, extra = {}) => ({ kind: 'virtual-appointment', startsAt, allDay: false, source: 'history', sourceLine: `Schedule Virtual Appointment on ${startsAt} by Me`, ...extra });
  const save = (events, replace = false, l = lead) => db.query('select companion_save_schedule($1,$2,$3) as saved', [l, JSON.stringify(events), replace]);
  const rows = async () => (await db.query('select lead_key, kind, starts_at, all_day, source, lead_name from scheduled_events order by starts_at')).rows;
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public, auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${a}'),('${b}'),('${c}');`);
    await db.exec(sql('001_cloud_sync.sql'));
    await db.exec(sql('009_scheduled_events.sql'));
    await db.exec(`insert into companion_members(user_id) values ('${a}'),('${b}'); set role authenticated;`);
    const asUser = (id) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);

    await asUser(a);
    const first = future(3), callback = future(5, 0);
    assert.equal((await save([appt(first), { kind: 'callback', startsAt: callback, allDay: true, source: 'history', sourceLine: 'Schedule Call Back appointment - No Time Preference by Me' }], true)).rows[0].saved, 2);
    await save([appt(first)], true); // the same lead seen again
    assert.equal((await rows()).length, 2, 'no duplicates');
    await save([appt(first)], true, { ...lead, leadName: 'Renamed Lead' });
    assert.equal((await rows()).find((r) => r.kind === 'virtual-appointment').lead_name, 'Renamed Lead', 'details updated');

    // A phone-recorded time becomes the history row when IMPACT lists the same time.
    const phoneTime = future(7);
    await save([appt(phoneTime, { source: 'phone', sourceLine: 'Set from the phone' })]);
    assert.equal((await rows()).find((r) => r.starts_at.toISOString() === phoneTime).source, 'phone');

    // Rescheduled in IMPACT: the old upcoming history appointment goes, the callback and phone row stay.
    const rescheduled = future(4);
    await save([appt(rescheduled)], true);
    const after = await rows();
    assert.deepEqual(after.map((r) => [r.kind, r.starts_at.toISOString(), r.source]), [
      ['virtual-appointment', rescheduled, 'history'], ['callback', callback, 'history'], ['virtual-appointment', phoneTime, 'phone']
    ]);
    await save([appt(phoneTime)], true);
    assert.equal((await rows()).find((r) => r.starts_at.toISOString() === phoneTime).source, 'history');
    assert.equal((await rows()).some((r) => r.starts_at.toISOString() === rescheduled), false, 'replaced again');

    // Past entries are kept (shown dimmed) even when history moves on.
    await db.exec('reset role');
    await db.query("insert into scheduled_events(user_id, lead_key, kind, starts_at) values ($1, 'lead:123', 'appointment', now() - interval '2 days')", [a]);
    await db.exec('set role authenticated');
    await save([appt(future(9))], true);
    assert.ok((await rows()).some((r) => r.kind === 'appointment'), 'past entry kept');

    await assert.rejects(save([{ kind: 'meeting', startsAt: future(1) }]), /check constraint/);
    await assert.rejects(save(Array.from({ length: 11 }, (_, i) => appt(future(i + 1)))), /Invalid calendar events/);
    await assert.rejects(save([appt(future(1))], false, { ...lead, leadKey: '' }), /Missing lead/);

    await asUser(b);
    assert.equal((await rows()).length, 0, 'other accounts see nothing');
    assert.equal((await db.query('delete from scheduled_events returning id')).rows.length, 0);
    await save([appt(first)], true);
    assert.equal((await rows()).length, 1, 'same lead key, separate account');
    await asUser(c);
    await assert.rejects(save([appt(first)]), /row-level security/, 'no Companion membership');
    await asUser(a);
    assert.deepEqual((await rows()).map((r) => r.kind), ['appointment', 'callback', 'virtual-appointment'], 'past appointment, callback, latest appointment');

    await db.exec('reset role');
    await db.query('update companion_members set enabled=false where user_id=$1', [a]);
    await db.exec('set role authenticated');
    assert.equal((await rows()).length, 0, 'disabled account sees nothing');
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from scheduled_events'), /permission denied/);
    await assert.rejects(save([appt(first)]), /permission denied/);
  } finally { await db.close(); }
});
