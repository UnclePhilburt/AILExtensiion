const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const {PGlite}=require('@electric-sql/pglite');
test('reset preserves history and protections, isolates accounts, and observes Central noon and DST',async()=>{
 const db=new PGlite();const c='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema cron;
 create function cron.schedule(text,text,text) returns int language sql as $$select 1$$;
 create table auth.users(id uuid,email text);insert into auth.users values('${c}','cody2931@gmail.com'),('${other}','other@example.com');
 create function public.test_now() returns timestamptz language sql as $$select current_setting('test.now')::timestamptz$$;
 select set_config('test.now','2026-10-04T16:00:00Z',false);
 create function public.plan_require_user() returns uuid language sql as $$select current_setting('test.user')::uuid$$;
 create table followup_settings(user_id uuid primary key,enabled boolean,imported_count int,import_note text);
 create table followup_leads(user_id uuid,lead_id text,week_start date,status text,primary key(user_id,lead_id));
 create table followup_actions(user_id uuid,lead_id text,foreign key(user_id,lead_id) references followup_leads(user_id,lead_id));
 create table scheduled_events(user_id uuid,impact_lead_id text,kind text,starts_at timestamptz);
 create table text_messages(user_id uuid,body text);insert into text_messages values('${c}','Saved text');
 insert into scheduled_events values('${c}','meeting','virtual-appointment','2026-11-10T20:00:00Z');
 insert into followup_leads values('${c}','old','2026-09-27','active'),('${c}','stopped','2026-09-27','stopped'),('${c}','reply','2026-09-27','replied'),('${c}','meeting','2026-09-27','active'),('${other}','untouched','2026-09-27','active');
 insert into followup_actions select user_id,lead_id from followup_leads;`);
 const sql=fs.readFileSync('supabase/migrations/026_plan_weekly_reset.sql','utf8').replace(/create extension if not exists pg_cron with schema pg_catalog;/,'').replace(/now\(\)/g,'public.test_now()');
 await db.exec(sql);
 assert.equal((await db.query(`select * from followup_leads where user_id='${c}' and archived_at is null`)).rows.length,0);
 assert.equal((await db.query(`select * from followup_leads where user_id='${other}'`)).rows.length,1);
 assert.equal((await db.query('select * from scheduled_events')).rows.length,1);assert.equal((await db.query('select * from text_messages')).rows.length,1);
 assert.equal((await db.query(`select * from followup_leads where user_id='${c}'`)).rows.length,3);
 await db.exec(`insert into followup_leads(user_id,lead_id,week_start,status) values('${c}','morning','2026-10-04','active'),('${c}','late-old','2026-09-27','active');select plan_weekly_reset();`);
 assert.equal((await db.query("select * from followup_leads where lead_id='late-old'")).rows.length,1);
 await db.exec("select set_config('test.now','2026-10-04T17:00:00Z',false);select plan_weekly_reset();");
 assert.equal((await db.query("select * from followup_leads where lead_id='late-old'")).rows.length,0);
 assert.equal((await db.query("select * from followup_leads where lead_id='morning'")).rows.length,1);
 await db.exec(sql);assert.equal((await db.query("select * from followup_leads where lead_id='morning'")).rows.length,1);
 await db.exec("select set_config('test.now','2026-11-01T17:00:00Z',false);select plan_weekly_reset();");
 assert.equal((await db.query(`select last_reset_week::text as w from followup_settings where user_id='${c}'`)).rows[0].w,'2026-10-25');
 await db.exec("select set_config('test.now','2026-11-01T18:00:00Z',false);select plan_weekly_reset();");
 assert.equal((await db.query(`select last_reset_week::text as w from followup_settings where user_id='${c}'`)).rows[0].w,'2026-11-01');
 await db.exec(`set role authenticated;select set_config('test.user','${other}',false);select plan_clear();`);
 await assert.rejects(db.exec(`select plan_clear_for_user('${c}',null)`),/permission/);
 await db.exec('reset role');assert.equal((await db.query(`select * from followup_leads where user_id='${c}'`)).rows.length,3);
 }finally{await db.close();}
});
