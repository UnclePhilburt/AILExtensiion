const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {PGlite}=require('@electric-sql/pglite');
test('workspace calls link results once, delay the next attempt and stop refused leads',async()=>{
 const db=new PGlite();const user='11111111-1111-4111-8111-111111111111';
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;create table companion_members(user_id uuid primary key,enabled boolean default true);grant select on companion_members to authenticated;insert into auth.users values('${user}');insert into companion_members values('${user}',true);`);
 await db.exec("create function public.plan_test_now() returns timestamptz language sql as $$select coalesce(nullif(current_setting('plan.test_time',true),''),'2026-10-04T23:00:00Z')::timestamptz$$;");
 await db.exec(`create table companion_sync(user_id uuid,device_id uuid);insert into companion_sync values('${user}','cccccccc-cccc-4ccc-8ccc-cccccccccccc');create table test_commands(id uuid,command jsonb);create function companion_send(p_id uuid,p_device uuid,p_command jsonb) returns void language sql as $$insert into public.test_commands values(p_id,p_command)$$;grant select on test_commands to authenticated;`);
 for(const file of ['009_scheduled_events.sql','022_text_tracking.sql','023_dynamic_text_experiments.sql','024_followup_plan.sql','025_plan_text_no_answer.sql'])await db.exec(/^02[45]/.test(file)?fs.readFileSync('supabase/migrations/'+file,'utf8').replace(/now\(\)/g,'public.plan_test_now()'):fs.readFileSync('supabase/migrations/'+file,'utf8'));

 await db.exec('alter table followup_leads add column archived_at timestamptz');
 await db.exec(fs.readFileSync('supabase/migrations/027_monday_fallback.sql','utf8').replace(/now\(\)/g,'public.plan_test_now()'));
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);select plan_enable(true);`);

 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/029_workspace_plan_calls.sql','utf8').replace(/now\(\)/g,'public.plan_test_now()'));
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);select set_config('plan.test_time','2026-10-05T19:00:00Z',false);`);
 const lead={leadId:'123',leadName:'TEST, JANE',requestType:'Child Safe Kit Offer',phone:'3145550100',slot:'2',phones:[{label:'Mobile',number:'3145550100'}]};await db.query('select plan_import($1::jsonb)',[JSON.stringify([lead])]);
 const call='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const record=(id,result=null)=>db.query('select plan_workspace_call($1,$2::jsonb,$3,$4,$5)',[id,JSON.stringify(lead),'2026-10-05T19:00:00Z',result,result?'2026-10-05T19:00:00Z':null]);
 await record(call);assert.equal((await db.query('select count(*)::int as n from followup_workspace_calls')).rows[0].n,1);assert.equal((await db.query("select count(*)::int as n from followup_actions where status='done'")).rows[0].n,0);
 await record(call,'no-answer');await record(call,'no-answer');await record(call);
 assert.equal((await db.query("select count(*)::int as n from followup_actions where status='done'")).rows[0].n,1);
 assert.equal((await db.query('select slot,result from followup_workspace_calls')).rows[0].slot,'2');
 assert.equal((await db.query("select count(*)::int as n from followup_actions where kind='call' and status='pending' and due_at<'2026-10-05T21:00:00Z'")).rows[0].n,0);
 await record('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','refused-appointment');
 assert.equal((await db.query('select status from followup_leads')).rows[0].status,'stopped');assert.equal((await db.query("select count(*)::int as n from followup_actions where status in ('pending','claimed')")).rows[0].n,0);

 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/030_workspace_call_guard.sql','utf8').replace(/now\(\)/g,'public.plan_test_now()'));await db.exec('set role authenticated');
 await assert.rejects(db.query('select plan_begin_workspace_call($1,$2::jsonb)',['cccccccc-cccc-4ccc-8ccc-cccccccccccc',JSON.stringify(lead)]),/called recently/);
 const fresh={...lead,leadId:'456'},freshId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';await db.query('select plan_begin_workspace_call($1,$2::jsonb)',[freshId,JSON.stringify(fresh)]);await db.query('select plan_begin_workspace_call($1,$2::jsonb)',[freshId,JSON.stringify(fresh)]);assert.equal((await db.query("select count(*)::int as n from followup_workspace_calls where lead_id='456'")).rows[0].n,1);

 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/031_shared_call_pass.sql','utf8').replace(/now\(\)/g,'public.plan_test_now()'));await db.exec('set role authenticated');
 await db.query('select workspace_pass_list($1::jsonb)',['["123","456","789","123"]']);
 const progress=async(reset=null)=>(await db.query('select workspace_pass_progress($1) as p',[reset])).rows[0].p;
 let shared=await progress();assert.equal(shared.total,3);assert.equal(shared.called,2);assert.equal(shared.remaining,1);
 await db.query("select set_config('plan.test_time',$1,false)",['2026-10-05T19:01:00Z']);shared=await progress(1);assert.equal(shared.pass,2);assert.equal(shared.called,0);assert.equal((await progress(1)).pass,2,'a duplicate reset from the other phone must not reset twice');assert.equal((await db.query('select count(*)::int as n from followup_workspace_calls')).rows[0].n,3,'reset preserves all calls');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['22222222-2222-4222-8222-222222222222']);assert.equal((await db.query('select count(*)::int as n from followup_workspace_calls')).rows[0].n,0);
 }finally{await db.close();}
});

const vm=require('vm');
test('workspace outbox keeps a result queued while its call start is uploading and retries failures',async()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('phone-web/public/workspace-plan-sync.js','utf8').replace(/^export /gm,''),ctx);
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};let release,fail=false;const uploads=[];
 const client={rpc:async(name,args)=>{uploads.push(args);if(uploads.length===1)await new Promise(r=>release=r);return {error:fail?{message:'Offline'}:null};}};
 const sync=ctx.createWorkspacePlanSync({client,storage,getUser:()=> 'user',notify:()=>{}}),call={healthCallId:'call',leadId:'123',leadName:'Test',startedAt:Date.now()};
 sync.record(call,{phone:'3145550100',slot:'2'});sync.record(call,{phone:'3145550100',slot:'2'},'no-answer');release();await new Promise(r=>setImmediate(r));
 assert.equal(JSON.parse([...data.values()][0])[0].p_result,'no-answer');fail=true;await sync.flush();assert.equal(JSON.parse([...data.values()][0]).length,1);fail=false;await sync.flush();assert.equal(JSON.parse([...data.values()][0]).length,0);
});

test('lead history merges calls and texts without duplicating linked follow-up calls',async()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('phone-web/public/lead-call-memory.js','utf8').replace(/^export /gm,''),ctx);
 const at=new Date().toISOString();const rows={followup_workspace_calls:[{id:'w',action_id:'a',started_at:at,phone:'3145550100',result:'no-answer'}],followup_actions:[{id:'a',kind:'call',started_at:at},{id:'b',kind:'text',started_at:at}],text_messages:[{sent_at:at,phone:'3145550100',replied:true}]};
 const client={from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:rows[table],error:null})};return q;}};const result=await ctx.loadLeadMemory(client,'user','123');assert.equal(result.events.length,2);assert.ok(result.until>Date.now());assert.equal(ctx.recentCallUntil([], [{kind:'text',started_at:at}]),0);
});
