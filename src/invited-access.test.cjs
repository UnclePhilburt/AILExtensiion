const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PGlite} = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
test('admin invitations gain access automatically; public signups and revoked members do not', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, invited_at timestamptz);
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      insert into auth.users values ('11111111-1111-4111-8111-111111111111',now());`);
    for (const file of ['001_cloud_sync.sql','003_invited_access.sql']) {
      await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
    }
    assert.equal((await db.query('select count(*)::int as n from companion_members')).rows[0].n,1);
    await db.exec(`insert into auth.users values ('22222222-2222-4222-8222-222222222222',null);
      insert into auth.users values ('33333333-3333-4333-8333-333333333333',now());`);
    assert.equal((await db.query('select count(*)::int as n from companion_members')).rows[0].n,2);
    await db.exec(`update auth.users set invited_at=now() where id='22222222-2222-4222-8222-222222222222'`);
    assert.equal((await db.query('select count(*)::int as n from companion_members')).rows[0].n,3);
    await db.exec(`update companion_members set enabled=false where user_id='33333333-3333-4333-8333-333333333333';
      update auth.users set invited_at=now() where id='33333333-3333-4333-8333-333333333333';`);
    assert.equal((await db.query("select enabled from companion_members where user_id='33333333-3333-4333-8333-333333333333'")).rows[0].enabled,false);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select companion_approve_invitation()'),/permission denied/);
  } finally { await db.close(); }
});
