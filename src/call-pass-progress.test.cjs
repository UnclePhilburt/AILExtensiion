const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('completed passes restart automatically once across both phones, while empty and incomplete lists stay put',async()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('phone-web/public/call-pass-progress.js','utf8').replace(/^export /gm,''),ctx);
 let pass=1,resets=0;const client={rpc:async(name,args)=>{if(args.p_restart===pass){pass++;resets++;}return {data:{pass,total:3,called:pass===1?3:0}};}};
 const results=await Promise.all([ctx.currentCallPass(client),ctx.currentCallPass(client)]);assert.equal(resets,1);assert.ok(results.every(r=>r.data.pass===2));
 for(const data of [{pass:1,total:0,called:0},{pass:1,total:3,called:2},{needs_list:true,total:0,called:0}]){let calls=0;await ctx.currentCallPass({rpc:async()=>{calls++;return {data};}});assert.equal(calls,1);}
});
