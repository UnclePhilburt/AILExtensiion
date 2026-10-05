const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {PGlite}=require('@electric-sql/pglite');
test('Monday fallback moves missed intros to morning and keeps normal calling hours without repeating Sunday sends',async()=>{
 const db=new PGlite();const user='11111111-1111-4111-8111-111111111111';
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;create table companion_members(user_id uuid primary key,enabled boolean default true);grant select on companion_members to authenticated;insert into auth.users values('${user}');insert into companion_members values('${user}',true);`);
 await db.exec("create function public.plan_test_now() returns timestamptz language sql as $$select coalesce(nullif(current_setting('plan.test_time',true),''),'2026-10-04T23:00:00Z')::timestamptz$$;");
 await db.exec(`create table companion_sync(user_id uuid,device_id uuid);insert into companion_sync values('${user}','cccccccc-cccc-4ccc-8ccc-cccccccccccc');create table test_commands(id uuid,command jsonb);create function companion_send(p_id uuid,p_device uuid,p_command jsonb) returns void language sql as $$insert into public.test_commands values(p_id,p_command)$$;grant select on test_commands to authenticated;`);
 for(const file of ['009_scheduled_events.sql','022_text_tracking.sql','023_dynamic_text_experiments.sql','024_followup_plan.sql','025_plan_text_no_answer.sql'])await db.exec(/^02[45]/.test(file)?fs.readFileSync('supabase/migrations/'+file,'utf8').replace(/now\(\)/g,'public.plan_test_now()'):fs.readFileSync('supabase/migrations/'+file,'utf8'));

 await db.exec('alter table followup_leads add column archived_at timestamptz');
 await db.exec(fs.readFileSync('supabase/migrations/027_monday_fallback.sql','utf8').replace(/now\(\)/g,'public.plan_test_now()'));
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);select plan_enable(true);`);
 const batch=JSON.stringify([{leadId:'123',leadName:'DOE, JANE',requestType:'Child Safe',phones:[{label:'Mobile',number:'3145550100'}]}]);
 await db.query('select plan_import($1::jsonb)',[batch]);
 const device='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const time=t=>db.query("select set_config('plan.test_time',$1,false)",[t]);
 const claim=async()=>(await db.query('select plan_claim($1) as a',[device])).rows[0].a;
 await time('2026-10-05T14:59:00Z');assert.equal(await claim(),null);
 await time('2026-10-05T15:00:00Z');const intro=await claim();assert.equal(intro.action.step,'intro');assert.equal(intro.lead.monday_fallback,true);
 await db.query("select plan_action($1,$2,'prepare',$3::jsonb)",[intro.action.id,device,JSON.stringify({variant:'A',body:'Hi Jane',number:'3145550100',experiment:'test'})]);
 await db.query("select plan_action($1,$2,'start')",[intro.action.id,device]);await db.query("select plan_action($1,$2,'complete')",[intro.action.id,device]);
 await time('2026-10-05T18:00:00Z');assert.equal(await claim(),null);
 await time('2026-10-05T19:00:00Z');const first=await claim();assert.equal(first.action.attempt,1);assert.equal(first.action.kind,'call');
 await db.query("select plan_action($1,$2,'start')",[first.action.id,device]);await db.query("select plan_action($1,$2,'complete','{\"result\":\"no-answer\"}')",[first.action.id,device]);
 await time('2026-10-05T21:59:00Z');assert.equal(await claim(),null);await time('2026-10-05T22:00:00Z');assert.equal((await claim()).action.attempt,2);
 const third=(await db.query("select status from followup_actions where step='day-1' and attempt=3")).rows[0];assert.equal(third.status,'pending');
 await db.exec('reset role');
 // A sent Sunday introduction keeps normal Monday calling hours.
 await db.exec(`insert into followup_leads(user_id,lead_id,name,week_start,status) values('${user}','456','Sunday sent','2026-10-04','active');insert into followup_actions(user_id,lead_id,step,kind,due_at,status,started_at,completed_at) values('${user}','456','intro','text','2026-10-04T23:00:00Z','done','2026-10-04T23:00:00Z','2026-10-04T23:00:00Z');insert into followup_actions(user_id,lead_id,step,kind,due_at) values('${user}','456','day-1','call','2026-10-05T19:00:00Z');`);
 await time('2026-10-05T19:00:00Z');await db.exec(`select plan_prepare_monday('${user}')`);assert.equal((await db.query("select monday_fallback from followup_leads where lead_id='456'")).rows[0].monday_fallback,false);
 await time('2026-11-02T16:00:00Z');assert.equal((await db.query("select plan_hours_open('text','intro',true) as yes")).rows[0].yes,true);
 await time('2026-11-02T19:00:00Z');assert.equal((await db.query("select plan_hours_open('text','intro',true) as yes")).rows[0].yes,false);
 }finally{await db.close();}
});
