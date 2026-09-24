const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('cloud mode preserves local installs and refuses offline phone commands', async () => {
  let settings = {}, sent;
  const context = vm.createContext({
    chrome:{runtime:{id:'test'},storage:{local:{get:async()=>settings}}},
    client:{rpc:async(name,args)=>{ sent={name,args}; return {}; }},
    crypto:{randomUUID:()=> 'sample-id'}, Date, URLSearchParams,
  });
  const source=fs.readFileSync(path.join(__dirname,'cloud-sync.js'),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'');
  vm.runInContext(source,context);
  assert.equal(await context.cloudEnabled(),true);
  settings={'impact.bridgeToken':'local-token'};
  assert.equal(await context.cloudEnabled(),false);
  settings['impact.connectionMode']='cloud';
  assert.equal(await context.cloudEnabled(),true);
  await assert.rejects(context.cloudSend(null,{type:'next'}),/offline/);
  assert.equal(sent,undefined);
  const now=new Date().toISOString();
  const state={device_id:'computer-a',desktop_seen:now,lead_updated_at:now,lead:{leadId:'123'}};
  assert.equal(context.visibleLead(state).leadId,'123');
  assert.equal(context.visibleLead({...state,desktop_seen:'2000-01-01T00:00:00Z'}),null);
  assert.equal(context.visibleLead({...state,lead_updated_at:'2000-01-01T00:00:00Z'}),null);
  await context.cloudSend(state,{type:'next',leadId:'123'},'one-action');
  assert.equal(sent.name,'companion_send');
  assert.equal(sent.args.p_device,'computer-a');
  assert.equal(sent.args.p_id,'one-action');
  assert.equal(sent.args.p_command.leadId,'123');
});
