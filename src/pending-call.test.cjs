const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const phoneActionsSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/phone-actions.js'),'utf8').replace(/^export /gm,'');
const leadHighlightsSource=(require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/time-zone.js'),'utf8')+'\n'+require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/lead-highlights.js'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const leadRulesSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/lead-rules.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const settingsStoreSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/settings-store.js'),'utf8').replace(/^export /gm,'');
const leadTransitionSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/lead-transition.js'),'utf8').replace(/^export /gm,'');
const pendingCallSource=fs.readFileSync(path.join(__dirname,'../phone-web/public/pending-call.js'),'utf8').replace(/^export /gm,'');
const appSource=fs.readFileSync(path.join(__dirname,'../phone-web/public/app.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
const HOUR=60*60*1000;

function memoryStorage(){
  const data=new Map();
  return {data,getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>{data.set(k,String(v));},removeItem:k=>{data.delete(k);}};
}
const savedCalls=storage=>[...storage.data.keys()].filter(key=>key.startsWith('impact.pendingCall.')).length;
function helpers(){const context=vm.createContext({JSON,Number,String});vm.runInContext(pendingCallSource,context); vm.runInContext(phoneActionsSource,context); vm.runInContext(leadHighlightsSource,context); vm.runInContext(leadRulesSource,context); vm.runInContext(settingsStoreSource,context); vm.runInContext(leadTransitionSource,context);return context;}

// Loads app.js the way the phone page does. Each call is one "page load";
// sharing `storage` between calls simulates the phone reloading the tab.
async function loadPage({storage,shared,userId='user-1'}){
  const elements=new Map();
  const make=()=>({children:[],listeners:{},value:'',hidden:false,open:true,disabled:false,textContent:'',
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;}});
  const el=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  let authChanged;
  const context=vm.createContext({
    client:{auth:{onAuthStateChange:fn=>{authChanged=fn;}}}, saveLeadSchedule:async()=>false, saveAppointmentChoice:async()=>false, encourageLead:()=>{}, encourageResult:()=>{}, cloudEnabled:async()=>true,
    cloudState:async()=>shared.state,cloudTouchPhone:async()=>{}, cloudSend:async(_s,c)=>{shared.sent.push(c);},
    watchCloud:async()=>()=>{},visibleLead:s=>s?.lead,isOnline:()=>true,
    document:{querySelector:selector=>selector.startsWith('meta')?null:el(selector),createElement:make,addEventListener(){}},
    localStorage:storage,location:{search:'',origin:'https://example.test',replace(){}},
    URLSearchParams, Date, crypto:require('node:crypto'), JSON, setInterval(){},setTimeout(){}, console
  });
  vm.runInContext(pendingCallSource,context); vm.runInContext(phoneActionsSource,context); vm.runInContext(leadHighlightsSource,context); vm.runInContext(leadRulesSource,context); vm.runInContext(settingsStoreSource,context); vm.runInContext(leadTransitionSource,context);
  const app=await vm.runInContext(`(async()=>{${appSource}\nreturn {refreshCloud};})()`,context);
  authChanged('SIGNED_IN',{user:{id:userId}});
  await new Promise(setImmediate);
  const callLink=()=>el('#leadCard').children.find(child=>child.className==='phoneList').children[0];
  return {el,app,callLink,authChanged};
}
const leadA={available:true,leadId:'test-a',leadName:'Fictional A',callHistory:['Older call'],phones:[{label:'Mobile',number:'555-0100',dialHref:'#sample-call'}]};
const leadB={...leadA,leadId:'test-b',leadName:'Fictional B'};
const stateFor=lead=>({lead,desktop_seen:new Date().toISOString(),lead_updated_at:new Date().toISOString(),device_id:'test-computer'});

test('pending call helpers store per user, expire after 12 hours and decide what to show', ()=>{
  const h=helpers(); const storage=memoryStorage(); const now=Date.parse('2026-09-24T15:00:00Z');
  const call=h.createPendingCall({leadKey:'lead:1',leadId:'1',leadName:'Fictional',phoneLabel:'Mobile',now});
  h.writePendingCall(storage,'user-1',call);
  assert.equal(savedCalls(storage),1);
  assert.deepEqual({...h.readPendingCall(storage,'user-1',now+HOUR)},{...call});
  assert.equal(h.readPendingCall(storage,'user-2',now),null,'another account on the same phone does not see it');
  assert.equal(h.readPendingCall(storage,'user-1',now+13*HOUR),null);
  assert.equal(savedCalls(storage),0,'expired entries are removed');
  storage.setItem(h.pendingCallStorageKey('user-1'),'{not json');
  assert.equal(h.readPendingCall(storage,'user-1',now),null);
  const broken={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
  assert.equal(h.readPendingCall(broken,'user-1',now),null);
  h.writePendingCall(broken,'user-1',call);

  assert.deepEqual({...h.pendingCallDecision(call,'lead:1',now)},{calledLeadKey:'lead:1',reminder:null,clear:false});
  assert.deepEqual({...h.pendingCallDecision(call,'',now)},{calledLeadKey:'',reminder:null,clear:false},'waits while no lead is visible');
  assert.equal(h.pendingCallDecision(call,'lead:2',now).reminder,call,'reminds when IMPACT moved on without a result');
  const done=h.markPendingCallResult(call,now+1000);
  assert.deepEqual({...h.pendingCallDecision(done,'lead:1',now)},{calledLeadKey:'lead:1',reminder:null,clear:false},'result can be retried on the same lead');
  assert.deepEqual({...h.pendingCallDecision(done,'lead:2',now)},{calledLeadKey:'',reminder:null,clear:true});
  assert.equal(h.pendingCallDecision(call,'lead:1',now+13*HOUR).clear,true);
  assert.equal(h.isCallResultCommand('no-answer'),true);
  assert.equal(h.isCallResultCommand('virtual-appointment'),false);
});

test('call result controls come back after the phone page reloads', async()=>{
  const storage=memoryStorage(); const shared={state:stateFor(leadA),sent:[]};
  const first=await loadPage({storage,shared});
  assert.equal(first.el('#callResults').hidden,true);
  first.callLink().listeners.click(); await new Promise(setImmediate);
  assert.equal(first.el('#callResults').hidden,false);
  assert.equal(savedCalls(storage),1);

  // The phone browser reloads the tab while the rep is in the dialer.
  const page=await loadPage({storage,shared});
  assert.equal(page.el('#callResults').hidden,false,'result buttons are shown again');
  assert.equal(page.el('#noAnswer').disabled,false);
  assert.equal(page.el('#callHistory').open,false,'history stays collapsed during the call');
  assert.equal(page.el('#pendingCallNotice').hidden,true);
  assert.equal(page.el('#previousLead').disabled,false,'navigation is not locked by the restored call');

  await page.el('#noAnswer').listeners.click();
  assert.deepEqual([shared.sent.at(-1).type,shared.sent.at(-1).leadId],['no-answer','test-a']);
  assert.equal(page.el('#callResults').hidden,false,'still available on the same lead in case IMPACT reports a problem');

  // IMPACT logs the result and advances; the saved call is forgotten quietly.
  shared.state=stateFor(leadB);
  await page.app.refreshCloud();
  assert.equal(page.el('#callResults').hidden,true);
  assert.equal(page.el('#pendingCallNotice').hidden,true);
  assert.equal(savedCalls(storage),0);
  const later=await loadPage({storage,shared});
  assert.equal(later.el('#callResults').hidden,true);
});

test('a reload keeps the call through a brief disconnect and is scoped to the signed-in user', async()=>{
  const storage=memoryStorage(); const shared={state:stateFor(leadA),sent:[]};
  const first=await loadPage({storage,shared});
  first.callLink().listeners.click(); await new Promise(setImmediate);

  const other=await loadPage({storage,shared,userId:'user-2'});
  assert.equal(other.el('#callResults').hidden,true,'a different account on this phone does not inherit the call');

  const page=await loadPage({storage,shared});
  shared.state={...shared.state,lead:null};
  await page.app.refreshCloud();
  assert.equal(page.el('#callResults').hidden,true);
  shared.state=stateFor(leadA);
  await page.app.refreshCloud();
  assert.equal(page.el('#callResults').hidden,false,'call controls return with the same lead');

  // Previous/Next locking still works while a call is pending.
  await page.el('#nextLead').listeners.click();
  assert.deepEqual([shared.sent.at(-1).type,shared.sent.at(-1).leadId],['next','test-a']);
  assert.equal(page.el('#nextLead').disabled,true);
});

test('if IMPACT moved to another lead without a result, the phone reminds the rep until dismissed', async()=>{
  const storage=memoryStorage(); const shared={state:stateFor(leadA),sent:[]};
  const first=await loadPage({storage,shared});
  first.callLink().listeners.click(); await new Promise(setImmediate);
  const sentBefore=shared.sent.length;

  shared.state=stateFor(leadB);
  const page=await loadPage({storage,shared});
  assert.equal(page.el('#callResults').hidden,true,'no result buttons for a lead that was not called');
  assert.equal(page.el('#pendingCallNotice').hidden,false);
  assert.match(page.el('#pendingCallText').textContent,/Fictional A/);
  await page.el('#noAnswer').listeners.click();
  assert.equal(shared.sent.length,sentBefore,'a result is never sent against the wrong lead');

  // Going back to the called lead in IMPACT brings the controls back.
  shared.state=stateFor(leadA);
  await page.app.refreshCloud();
  assert.equal(page.el('#callResults').hidden,false);
  assert.equal(page.el('#pendingCallNotice').hidden,true);

  shared.state=stateFor(leadB);
  await page.app.refreshCloud();
  assert.equal(page.el('#pendingCallNotice').hidden,false);
  page.el('#dismissPendingCall').listeners.click();
  assert.equal(page.el('#pendingCallNotice').hidden,true);
  assert.equal(savedCalls(storage),0);
  const later=await loadPage({storage,shared:{state:stateFor(leadA),sent:[]}});
  assert.equal(later.el('#callResults').hidden,true,'dismissed calls stay dismissed after a reload');
});

test('saved calls older than 12 hours are not restored', async()=>{
  const storage=memoryStorage(); const h=helpers();
  h.writePendingCall(storage,'user-1',h.createPendingCall({leadKey:'lead:test-a',leadId:'test-a',leadName:'Fictional A',now:Date.now()-13*HOUR}));
  const page=await loadPage({storage,shared:{state:stateFor(leadA),sent:[]}});
  assert.equal(page.el('#callResults').hidden,true);
  assert.equal(savedCalls(storage),0);
});
