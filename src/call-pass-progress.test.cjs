const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('saved daily calls include legacy history, paginate and deduplicate both phones and linked plan calls',async()=>{
 const ctx=vm.createContext({Intl,Date,Set});vm.runInContext(fs.readFileSync('phone-web/public/call-pass-progress.js','utf8').replace(/^export /gm,''),ctx);
 const rows={calling_number_calls:Array.from({length:501},(_,i)=>({id:String(i),created_at:'2026-10-05T19:00:00Z'})),followup_workspace_calls:[{id:'0',started_at:'2026-10-05T19:00:00Z',action_id:'linked'}],followup_actions:[{id:'linked',kind:'call',started_at:'2026-10-05T19:00:00Z'},{id:'extra',kind:'call',started_at:'2026-10-05T20:00:00Z'},{id:'text',kind:'text',started_at:'2026-10-05T20:00:00Z'}]};
 rows.calling_number_calls.push({id:'yesterday',created_at:'2026-10-05T04:59:00Z'});
 const client={from:t=>{const q={select:()=>q,eq:(k,v)=>{assert.equal(v,'owner');return q;},gte:()=>q,order:()=>q,range:async(a,b)=>({data:rows[t].slice(a,b+1)})};return q;}};
 assert.equal(await ctx.savedCallsToday(client,'owner',new Date('2026-10-05T21:00:00Z')),502);
});
test('completed passes restart automatically once across both phones, while empty and incomplete lists stay put',async()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('phone-web/public/call-pass-progress.js','utf8').replace(/^export /gm,''),ctx);
 let pass=1,resets=0;const client={rpc:async(name,args)=>{if(args.p_restart===pass){pass++;resets++;}return {data:{pass,total:3,called:pass===1?3:0}};}};
 const results=await Promise.all([ctx.currentCallPass(client),ctx.currentCallPass(client)]);assert.equal(resets,1);assert.ok(results.every(r=>r.data.pass===2));
 for(const data of [{pass:1,total:0,called:0},{pass:1,total:3,called:2},{needs_list:true,total:0,called:0}]){let calls=0;await ctx.currentCallPass({rpc:async()=>{calls++;return {data};}});assert.equal(calls,1);}
});
