const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('extension/src/content/impact-diagnostic.js','utf8');
const fn=source.slice(source.indexOf('  async function requestPlanMessage'),source.indexOf('  function installPlanImport'));
function request(sendMessage){const ctx=vm.createContext({chrome:{runtime:{sendMessage}},setTimeout:cb=>cb()});vm.runInContext(fn,ctx);return ctx.requestPlanMessage;}
test('import reconnects after an empty response and preserves the exact payload',async()=>{
 const message={type:'impact/planImport',expectedUser:'owner',leads:[{leadId:'123'}]};let calls=0;
 const result=await request(async m=>{assert.equal(m,message);return ++calls===1?undefined:{ok:true,added:1};})(message);
 assert.equal(calls,2);assert.equal(result.added,1);
});
test('import recovers a closed worker connection',async()=>{
 let calls=0;await request(async()=>{if(++calls===1)throw Error('Could not establish connection. Receiving end does not exist.');return {ok:true};})({type:'impact/planStatus'});assert.equal(calls,2);
});
test('outdated page asks for refresh without retrying a dead context',async()=>{
 let calls=0;await assert.rejects(request(async()=>{calls++;throw Error('Extension context invalidated.');})({}),/Refresh this IMPACT inbox/);assert.equal(calls,1);
});
test('database and sign-in errors are preserved without automatic retries',async()=>{
 let calls=0;await assert.rejects(request(async()=>{calls++;return {ok:false,error:'Sign in to your account first.'};})({}),/Sign in/);assert.equal(calls,1);
});
test('missing worker responses stop after three attempts with actionable instructions',async()=>{
 let calls=0;await assert.rejects(request(async()=>{calls++;})({}),/chrome:\/\/extensions/);assert.equal(calls,3);
});
test('blank failure response is explained without replaying it',async()=>{
 let calls=0;await assert.rejects(request(async()=>{calls++;return {ok:false};})({}),/check that you are signed in/);assert.equal(calls,1);
});
