const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {PGlite}=require('@electric-sql/pglite');
test('plan imports are idempotent, private and stopped leads never restart on import',async()=>{
 const db=new PGlite();const user='11111111-1111-4111-8111-111111111111';
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;create table companion_members(user_id uuid primary key,enabled boolean default true);grant select on companion_members to authenticated;insert into auth.users values('${user}');insert into companion_members values('${user}',true);`);
 await db.exec("create function public.plan_test_now() returns timestamptz language sql as $$select coalesce(nullif(current_setting('plan.test_time',true),''),'2026-10-04T23:00:00Z')::timestamptz$$;");
 await db.exec(`create table companion_sync(user_id uuid,device_id uuid);insert into companion_sync values('${user}','cccccccc-cccc-4ccc-8ccc-cccccccccccc');create table test_commands(id uuid,command jsonb);create function companion_send(p_id uuid,p_device uuid,p_command jsonb) returns void language sql as $$insert into public.test_commands values(p_id,p_command)$$;grant select on test_commands to authenticated;`);
 for(const file of ['009_scheduled_events.sql','022_text_tracking.sql','023_dynamic_text_experiments.sql','024_followup_plan.sql'])await db.exec(file.startsWith('024')?fs.readFileSync('supabase/migrations/'+file,'utf8').replace(/now\(\)/g,'public.plan_test_now()'):fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);select plan_enable(true);`);
 const batch=JSON.stringify([{leadId:'123',leadName:'DOE, JANE',requestType:'Child Safe',phones:[{label:'Mobile',number:'3145550100'}]}]);
 const imp=()=>db.query('select plan_import($1::jsonb) as n',[batch]);assert.equal((await imp()).rows[0].n,1);assert.equal((await imp()).rows[0].n,0);
 assert.equal((await db.query('select * from followup_actions')).rows.length,21);
 assert.equal((await db.query("select * from followup_actions where kind='text'")).rows.length,4);

 const phone1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',phone2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const claim=async phone=>(await db.query('select plan_claim($1) as a',[phone])).rows[0].a;
 const first=await claim(phone1);assert.equal(first.action.step,'intro');assert.equal(await claim(phone2),null);
 const action=(op,payload={})=>db.query('select plan_action($1,$2,$3,$4::jsonb) as a',[first.action.id,phone1,op,JSON.stringify(payload)]);
 await assert.rejects(action('complete'),/before recording/);
 await action('prepare',{variant:'C',body:'Hi Jane',number:'3145550100',experiment:'plan-intro'});await action('start');
 await db.exec("select set_config('plan.test_time','2026-10-04T23:30:00Z',false)");assert.equal(await claim(phone2),null,'a text awaiting confirmation must not move to the other phone');
 await action('complete');await action('complete');
 await db.query("select plan_impact($1,'1','call')",[first.action.id]);await db.query("select plan_impact($1,'1','call')",[first.action.id]);
 assert.equal((await db.query('select * from test_commands')).rows.length,1);
 assert.equal((await db.query('select * from text_messages')).rows.length,1);
 assert.equal(await claim(phone1),null);
 await db.exec("select set_config('plan.test_time','2026-10-05T19:00:00Z',false)");
 const monday=await claim(phone1);assert.equal(monday.action.kind,'call');assert.equal(monday.action.attempt,1);
 await db.query("select plan_action($1,$2,'start')",[monday.action.id,phone1]);
 await db.query("select plan_impact($1,'2','call')",[monday.action.id]);
 await db.query("select plan_action($1,$2,'complete','{\"result\":\"no-answer\"}')",[monday.action.id,phone1]);
 await db.query("select plan_impact($1,'2','no-answer')",[monday.action.id]);await db.query("select plan_impact($1,'2','no-answer')",[monday.action.id]);
 assert.equal((await db.query('select * from test_commands')).rows.length,3);
 assert.equal(await claim(phone2),null);
 await db.exec("select set_config('plan.test_time','2026-10-05T22:00:00Z',false)");assert.equal((await claim(phone2)).action.attempt,2);
 await db.exec('update text_messages set replied=true');assert.equal((await db.query("select status from followup_leads")).rows[0].status,'replied');assert.equal(await claim(phone1),null);
 await db.exec("select plan_set_status('123','replied')");await imp();assert.equal((await db.query("select * from followup_actions where status in ('pending','claimed')")).rows.length,0);
 await db.exec("select plan_set_status('123','appointment','2026-10-06T19:00:00Z')");assert.equal((await db.query('select * from scheduled_events')).rows.length,1);assert.equal((await db.query('select appointment from text_messages')).rows[0].appointment,true);
 await assert.rejects(db.exec("update followup_leads set status='active'"),/permission/);
 await db.exec("select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)");assert.equal((await db.query('select * from followup_leads')).rows.length,0);await assert.rejects(imp(),/enabled account/);
 }finally{await db.close();}
});
