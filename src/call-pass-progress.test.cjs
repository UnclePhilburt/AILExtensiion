const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('saved daily calls include legacy history, paginate and deduplicate both phones and linked plan calls',async()=>{
 const ctx=vm.createContext({Intl,Date,Set});vm.runInContext(fs.readFileSync('phone-web/public/call-pass-progress.js','utf8').replace(/^export /gm,''),ctx);
 const rows={calling_number_calls:Array.from({length:501},(_,i)=>({id:String(i),created_at:'2026-10-05T19:00:00Z'})),followup_workspace_calls:[{id:'0',started_at:'2026-10-05T19:00:00Z',action_id:'linked'}],followup_actions:[{id:'linked',kind:'call',started_at:'2026-10-05T19:00:00Z'},{id:'extra',kind:'call',started_at:'2026-10-05T20:00:00Z'},{id:'text',kind:'text',started_at:'2026-10-05T20:00:00Z'}]};
 rows.calling_number_calls.push({id:'yesterday',created_at:'2026-10-05T04:59:00Z'});
 const client={from:t=>{const q={select:()=>q,eq:(k,v)=>{assert.equal(v,'owner');return q;},gte:()=>q,order:()=>q,range:async(a,b)=>({data:rows[t].slice(a,b+1)})};return q;}};
 assert.equal(await ctx.savedCallsToday(client,'owner',new Date('2026-10-05T21:00:00Z')),502);
});
