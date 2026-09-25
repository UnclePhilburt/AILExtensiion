const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
// app.js imports these helpers; the tests strip imports, so load them into each context.
const phoneActionsSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/phone-actions.js'),'utf8').replace(/^export /gm,'');
const leadHighlightsSource=(require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/time-zone.js'),'utf8')+'\n'+require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/lead-highlights.js'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const leadRulesSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/lead-rules.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const pendingCallSource=fs.readFileSync(path.join(__dirname,'../phone-web/public/pending-call.js'),'utf8').replace(/^export /gm,'');
test('phone cloud flow shows live leads, collapses history for a call and clears on logout', async()=>{
  const elements=new Map();
  const make=()=>({children:[],listeners:{},value:'',hidden:false,open:true,
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;}});
  const el=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  let authChanged, sent, redirected;
  const lead={available:true,leadId:'test-a',leadName:'Fictional A',callHistory:['No Answer yesterday'],phones:[{label:'Mobile',number:'555-0100',dialHref:'#sample-call'}]};
  let state={lead,desktop_seen:new Date().toISOString(),lead_updated_at:new Date().toISOString(),device_id:'test-computer'};
  const context=vm.createContext({
    client:{auth:{onAuthStateChange:fn=>{authChanged=fn;}}}, cloudEnabled:async()=>true,
    cloudState:async()=>state,cloudTouchPhone:async()=>{}, cloudSend:async(s,c)=>{sent={s,c};},
    watchCloud:async()=>()=>{},visibleLead:s=>s?.lead,isOnline:()=>true,
    document:{querySelector:selector=>selector.startsWith('meta')?null:el(selector),createElement:make,addEventListener(){}},
    localStorage:{getItem:()=>null,setItem(){}},location:{search:'',origin:'https://example.test',replace:url=>{redirected=url;}},
    URLSearchParams, Date, crypto:require('node:crypto'), setInterval(){},setTimeout(){}, console
  });
  vm.runInContext(pendingCallSource,context); vm.runInContext(phoneActionsSource,context); vm.runInContext(leadHighlightsSource,context); vm.runInContext(leadRulesSource,context);
  const source=fs.readFileSync(path.join(__dirname,'../phone-web/public/app.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
  const app=await vm.runInContext(`(async()=>{${source}\nreturn {refreshCloud,receiveBridgeLead};})()`,context);
  authChanged('SIGNED_IN',{user:{id:'test-user'}});
  await new Promise(setImmediate);
  assert.equal(el('#bridgeSetup').hidden,true);
  assert.equal(el('#callResults').hidden,true);
  assert.equal(el('#historyEntries').children[0].textContent,'No Answer yesterday');
  const call=el('#leadCard').children.find(child=>child.className==='phoneList').children[0];
  call.listeners.click(); await new Promise(setImmediate);
  assert.equal(el('#callResults').hidden,false);
  assert.equal(el('#callHistory').open,false);
  assert.equal(sent.c.type,'call');assert.equal(sent.c.leadId,'test-a');
  state={...state,lead:{...lead,leadId:'test-b',leadName:'Fictional B'}};
  await app.refreshCloud();
  assert.equal(el('#callResults').hidden,true);
  assert.equal(el('#callHistory').open,true);
  authChanged('SIGNED_OUT',null);
  assert.equal(el('#callHistory').hidden,true);
  assert.equal(el('#callResults').hidden,true);
  assert.equal(redirected,'account.html?next=workspace.html');
});

test('phone locks Previous/Next until the moved-to lead arrives, so stale taps are not sent', async()=>{
  const elements=new Map();
  const make=()=>({children:[],listeners:{},value:'',hidden:false,open:true,disabled:false,
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;}});
  const el=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  let authChanged; const sent=[];
  const lead={available:true,leadId:'test-a',leadName:'Fictional A',phones:[]};
  let state={lead,desktop_seen:new Date().toISOString(),lead_updated_at:new Date().toISOString(),device_id:'test-computer'};
  const context=vm.createContext({
    client:{auth:{onAuthStateChange:fn=>{authChanged=fn;}}}, cloudEnabled:async()=>true,
    cloudState:async()=>state,cloudTouchPhone:async()=>{}, cloudSend:async(s,c)=>{sent.push(c);},
    watchCloud:async()=>()=>{},visibleLead:s=>s?.lead,isOnline:()=>true,
    document:{querySelector:selector=>selector.startsWith('meta')?null:el(selector),createElement:make,addEventListener(){}},
    localStorage:{getItem:()=>null,setItem(){}},location:{search:'',origin:'https://example.test',replace(){}},
    URLSearchParams, Date, crypto:require('node:crypto'), setInterval(){},setTimeout(){}, console
  });
  vm.runInContext(pendingCallSource,context); vm.runInContext(phoneActionsSource,context); vm.runInContext(leadHighlightsSource,context); vm.runInContext(leadRulesSource,context);
  const source=fs.readFileSync(path.join(__dirname,'../phone-web/public/app.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
  const app=await vm.runInContext(`(async()=>{${source}\nreturn {refreshCloud};})()`,context);
  authChanged('SIGNED_IN',{user:{id:'test-user'}});
  await new Promise(setImmediate);
  assert.equal(el('#previousLead').disabled,false);
  await el('#nextLead').listeners.click();
  assert.deepEqual(sent.map(c=>[c.type,c.leadId]),[['next','test-a']]);
  assert.equal(el('#previousLead').disabled,true);
  await el('#previousLead').listeners.click();
  assert.equal(sent.length,1,'a Previous tap while the phone still shows the old lead is not sent');
  state={...state,lead:{...lead,leadId:'test-b',leadName:'Fictional B'}};
  await app.refreshCloud();
  assert.equal(el('#previousLead').disabled,false);
  await el('#previousLead').listeners.click();
  assert.deepEqual([sent.at(-1).type,sent.at(-1).leadId],['previous','test-b']);
  state={...state,result:{message:'Navigation skipped because the lead changed.',at:new Date().toISOString()}};
  await app.refreshCloud();
  assert.equal(el('#previousLead').disabled,false,'a result from the computer unlocks the buttons');
});
