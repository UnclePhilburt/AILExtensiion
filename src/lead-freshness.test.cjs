const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PGlite} = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const migration = name => fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');

test('migration 005 keeps the lead fresh while the computer checks in from the call page', async () => {
  const db = new PGlite();
  const a='11111111-1111-4111-8111-111111111111', device='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const id = n => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12,'0')}`;
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public, auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${a}');`);
    await db.exec(migration('001_cloud_sync.sql'));
    await db.exec(migration('005_keep_lead_fresh_during_calls.sql'));
    await db.exec(`insert into companion_members(user_id) values ('${a}'); set role authenticated;`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);
    await db.query('select companion_desktop($1,$2)',[device,{available:true,leadId:'123',leadName:'Fictional lead'}]);

    // IMPACT has been on "Call - What Happened?" for 40 minutes: only heartbeats arrive.
    await db.exec("reset role; update companion_sync set lead_updated_at = now() - interval '40 minutes'; set role authenticated");
    await assert.rejects(db.query('select companion_send($1,$2,$3)',[id(1),device,{type:'no-answer',leadId:'123'}]), /has not sent this lead recently/);
    await db.query('select companion_desktop($1)',[device]);
    const row = (await db.query("select lead->>'leadId' as lead, lead_updated_at > now() - interval '1 minute' as fresh from companion_sync")).rows[0];
    assert.deepEqual({...row},{lead:'123',fresh:true});
    await db.query('select companion_send($1,$2,$3)',[id(2),device,{type:'no-answer',leadId:'123'}]);
    assert.equal((await db.query('select companion_take($1) as command',[device])).rows[0].command.type,'no-answer');
    await assert.rejects(db.query('select companion_send($1,$2,$3)',[id(3),device,{type:'no-answer',leadId:'999'}]), /lead changed/);

    // A heartbeat never revives a lead that was already erased, or another computer's lead.
    await db.exec("reset role; update companion_sync set lead = null, lead_updated_at = now() - interval '40 minutes'; set role authenticated");
    await db.query('select companion_desktop($1)',[device]);
    assert.equal((await db.query("select lead_updated_at > now() - interval '1 minute' as fresh from companion_sync")).rows[0].fresh,false);
    await db.query('select companion_desktop($1,$2)',[device,{available:true,leadId:'123'}]);
    await db.exec("reset role; update companion_sync set desktop_seen = now() - interval '1 minute'; set role authenticated");
    await db.query('select companion_desktop($1)',[other]);
    const taken = (await db.query('select lead, lead_updated_at from companion_sync')).rows[0];
    assert.equal(taken.lead,null); assert.equal(taken.lead_updated_at,null);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select companion_desktop($1)',[device]), /permission denied/);
  } finally { await db.close(); }
});
