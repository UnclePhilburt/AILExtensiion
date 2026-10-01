const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/022_text_tracking.sql'),'utf8');
test('text tracking is private, retry-safe, and prompts at most once daily across phones',async()=>{
 const db=new PGlite(); const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
 create table public.companion_members(user_id uuid primary key,enabled boolean default true);
 grant select on companion_members to authenticated;
 insert into auth.users values('${a}'),('${b}'); insert into companion_members(user_id) values('${a}'),('${b}');`);
 await db.exec(sql);
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`);
 const insert=`insert into text_messages(id,lead_id,lead_name,phone,body,variant,experiment,slot,sent_at,local_hour,time_zone) values('${id}','lead','Test Lead','3145550100','Test message','A','test','2',now()-interval '2 days',14,'America/Chicago') on conflict(user_id,id) do nothing`;
 await db.exec(insert); await db.exec(insert);
 assert.equal((await db.query('select * from text_messages')).rows.length,1);
 assert.equal((await db.query('select * from companion_text_checkin()')).rows.length,1);
 assert.equal((await db.query('select * from companion_text_checkin()')).rows.length,0);
 assert.equal((await db.query('select replied from text_messages')).rows[0].replied,null);
 await assert.rejects(db.exec("update text_messages set body='changed'"),/permission/);
 await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
 assert.equal((await db.query('select * from text_messages')).rows.length,0);
 await db.exec("update text_messages set replied=true");
 await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
 assert.equal((await db.query('select replied from text_messages')).rows[0].replied,null);
 await db.exec('update text_messages set replied=false, reviewed_at=now()');
 assert.equal((await db.query('select replied from text_messages')).rows[0].replied,false);
 await db.exec(`reset role; update companion_members set enabled=false where user_id='${a}'; set role authenticated;`);
 assert.equal((await db.query('select * from text_messages')).rows.length,0);
 } finally {await db.close();}
});
test('wording and timing learning exclude unknown results and wait for enough checked samples',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../phone-web/public/text-learning.js'),'utf8').replace(/^export /gm,''),context);
 const base={experiment:'e',timeZone:'America/Chicago',localHour:9};
 const unknown=Array.from({length:100},()=>({...base,variant:'B',replied:null}));
 assert.equal(context.chooseTextVariant(unknown,'e','A',()=>.9),'A');
 const a=Array.from({length:20},(_,i)=>({...base,variant:'A',replied:i<12}));
 const b=Array.from({length:20},(_,i)=>({...base,localHour:15,variant:'B',replied:i<2}));
 assert.equal(context.chooseTextVariant([...a,...b,...unknown],'e','B',()=>.9),'A');
 assert.equal(context.chooseTextVariant([...a,...b],'e','B',()=>.1),'B');
 assert.match(context.textingTimeHint(a,'e','America/Chicago'),/Still learning/);
 assert.match(context.textingTimeHint([...a,...b],'e','America/Chicago'),/09:00.*12:00/);
 assert.match(context.textingTimeHint([...a,...b],'e','Europe/London'),/Still learning/);
});
