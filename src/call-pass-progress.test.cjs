const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('completed passes restart automatically once across both phones, while empty and incomplete lists stay put',async()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('phone-web/public/call-pass-progress.js','utf8').replace(/^export /gm,''),ctx);
 let pass=1,resets=0;const client={rpc:async(name,args)=>{if(args.p_restart===pass){pass++;resets++;}return {data:{pass,total:3,called:pass===1?3:0}};}};
 const results=await Promise.all([ctx.currentCallPass(client),ctx.currentCallPass(client)]);assert.equal(resets,1);assert.ok(results.every(r=>r.data.pass===2));
 for(const data of [{pass:1,total:0,called:0},{pass:1,total:3,called:2},{needs_list:true,total:0,called:0}]){let calls=0;await ctx.currentCallPass({rpc:async()=>{calls++;return {data};}});assert.equal(calls,1);}
});
test('incomplete passes reset once on a new Central day, including both phones and midnight in daylight saving time',async()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(fs.readFileSync('phone-web/public/call-pass-progress.js','utf8').replace(/^export /gm,''),ctx);
 let pass=1,resets=0,started_at='2026-10-05T19:00:00Z',now=Date.parse('2026-10-06T04:59:59Z');
 const client={rpc:async(name,args)=>{if(args.p_restart===pass){pass++;resets++;started_at=new Date(now).toISOString();}return {data:{pass,started_at,total:216,called:pass===1?201:0}};}};
 assert.equal((await ctx.currentCallPass(client,now)).data.called,201);assert.equal(resets,0,'still Monday Central');
 now=Date.parse('2026-10-06T05:00:00Z');const results=await Promise.all([ctx.currentCallPass(client,now),ctx.currentCallPass(client,now)]);
 assert.equal(resets,1);assert.ok(results.every(r=>r.data.called===0));assert.equal((await ctx.currentCallPass(client,now)).data.pass,2);
 assert.equal(ctx.centralPassDay('2026-11-02T05:59:59Z'),'2026-11-01');assert.equal(ctx.centralPassDay('2026-11-02T06:00:00Z'),'2026-11-02');
});
