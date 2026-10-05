const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('phone-web/public/call-registration-retry.js','utf8').replace(/^export /gm,'');
test('retry registration keeps the same call ID, backs off and stops on matching confirmation',async()=>{
 const c=vm.createContext({});vm.runInContext(source,c);let now=10000,slot='1',lead={leadId:'123',callRetrySupported:true};let call={retryRegistration:true,slot:'1',leadId:'123',healthCallId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',phoneLabel:'Home',phoneNumber:'3145550100',startedAt:now};const sent=[];
 const deps={getCall:()=>call,getUser:()=> 'owner',getSlot:()=>slot,getLead:()=>lead,isHidden:()=>false,save:c=>call=c,send:async(t,d)=>sent.push({t,d}),now:()=>now};let retry=c.createCallRegistrationRetry(deps);
 now+=5000;await retry.tick();assert.equal(sent.length,1);assert.equal(sent[0].d.healthCallId,call.healthCallId);assert.equal(sent[0].d.registrationRetry,true);
 retry=c.createCallRegistrationRetry(deps);now+=5000;await retry.tick();assert.equal(sent.length,1,'reload keeps retry backoff');now+=5000;await retry.tick();assert.equal(sent.length,2);
 assert.equal(retry.confirm('Call confirmed. [call:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb]'),false);assert.equal(retry.confirm('Call confirmed. [call:'+call.healthCallId+']'),true);
 now+=60000;await retry.tick();assert.equal(sent.length,2);
 call={...call,confirmedAt:0,resultSentAt:now};await retry.tick();assert.equal(sent.length,2);
 call={...call,resultSentAt:0};slot='2';await retry.tick();assert.equal(sent.length,2);slot='1';lead={...lead,leadId:'456'};await retry.tick();assert.equal(sent.length,2);
});
const {PGlite}=require('@electric-sql/pglite');
test('Supabase retries requeue registration without counting another call and reject another owner',async()=>{
 const db=new PGlite(),user='11111111-1111-4111-8111-111111111111',device='dddddddd-dddd-4ddd-8ddd-dddddddddddd',call='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table companion_sync(user_id uuid,device_id uuid,desktop_seen timestamptz,slot_leads jsonb,slot_seen jsonb,lead jsonb,lead_updated_at timestamptz,recent_commands jsonb default '[]',commands jsonb default '[]',phone_seen timestamptz);
 create table companion_events(user_id uuid,event_type text);create table companion_call_outcomes(user_id uuid,outcome text,request_type text,local_hour smallint);
 create table calling_number_calls(id uuid,user_id uuid);create table followup_workspace_calls(user_id uuid,id uuid,lead_id text,result text,started_at timestamptz);
 create function calling_number_record(p_call uuid,p_type text,p_number uuid) returns void language sql as $$insert into public.calling_number_calls select p_call,auth.uid() where not exists(select 1 from public.calling_number_calls where id=p_call and user_id=auth.uid())$$;
 select set_config('request.jwt.claim.sub','${user}',false);
 insert into companion_sync(user_id,device_id,desktop_seen,slot_leads,slot_seen) values('${user}','${device}',now(),'{"1":{"leadId":"123"}}',jsonb_build_object('1',now()));
 insert into followup_workspace_calls values('${user}','${call}','123',null,now());`);
 await db.exec(fs.readFileSync('supabase/migrations/032_call_registration_retry.sql','utf8'));
 const command={type:'call',leadId:'123',slot:'1',healthCallId:call};
 await db.query('select companion_send($1,$2,$3::jsonb)',['cccccccc-cccc-4ccc-8ccc-cccccccccccc',device,JSON.stringify(command)]);
 await db.query('select companion_retry_call($1,$2,$3::jsonb)',['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',device,JSON.stringify(command)]);
 assert.equal((await db.query('select count(*)::int n from companion_events')).rows[0].n,1);
 assert.equal((await db.query('select jsonb_array_length(commands) n from companion_sync')).rows[0].n,2);
 await db.exec("select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)");
 await assert.rejects(db.query('select companion_retry_call($1,$2,$3::jsonb)',['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',device,JSON.stringify(command)]),/no longer waiting/);
 }finally{await db.close();}
});
