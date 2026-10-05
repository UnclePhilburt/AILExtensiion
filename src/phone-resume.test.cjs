const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../phone-web/public',file),'utf8');
const phoneActionsSource=read('phone-actions.js').replace(/^export /gm,'');
const leadHighlightsSource=(require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/time-zone.js'),'utf8')+'\n'+require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/lead-highlights.js'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const leadRulesSource=read('lead-rules.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const settingsStoreSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/settings-store.js'),'utf8').replace(/^export /gm,'');
const leadTransitionSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/lead-transition.js'),'utf8').replace(/^export /gm,'');
const leadSwipeSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../phone-web/public/lead-swipe.js'),'utf8').replace(/^export /gm,'');
const pendingCallSource=read('pending-call.js').replace(/^export /gm,'');
const appSource=read('app.js').replace(/^import .*;\r?\n/gm,'');
const MIN=60000;

function actions(){const context=vm.createContext({setTimeout,clearTimeout});vm.runInContext(phoneActionsSource,context);context.NETWORK_MESSAGE=vm.runInContext('NETWORK_MESSAGE',context);return context;}
function slotView(state, slot='1') {
  if (!state) return state;
  const key = slot === '2' ? '2' : '1';
  const slotted = state.slot_leads?.[key];
  const seen = state.slot_seen?.[key];
  if (key === '2') return { ...state, lead: slotted || null, lead_updated_at: seen || null };
  return { ...state, lead: slotted || state.lead, lead_updated_at: seen || state.lead_updated_at };
}
function visibleLead(state, slot='1', now=Date.now()) {
  const view = slotView(state, slot);
  return view?.desktop_seen && now - Date.parse(view.desktop_seen) < 45000 && now - Date.parse(view.lead_updated_at) < 30 * MIN ? view.lead : null;
}

// Loads app.js with a controllable clock, captured timers and page events, so a
// phone going to the background (timers frozen) and coming back can be replayed.
async function loadPage(server,globals={}){
  const clock={now:Date.parse('2026-09-24T20:00:00Z')};
  class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));} static now(){return clock.now;}}
  const elements=new Map(), timers=[], docEvents={}, winEvents={};
  const make=()=>({dataset:{},style:{},classList:{toggle(){},add(){}},querySelector(){return null;},insertBefore(item){this.children.push(item);},children:[],listeners:{},value:'',hidden:false,open:true,disabled:false,textContent:'',className:'',
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;}});
  const el=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  const auth={session:{user:{id:'user-1'}},refreshOk:true,refreshCalls:0,getSessionCalls:0};
  let authChanged;
  const document={hidden:false,querySelector:selector=>selector.startsWith('meta')?null:el(selector),createElement:make,
    addEventListener(name,fn){docEvents[name]=fn;}};
  const context=vm.createContext({
    createCallRegistrationRetry:()=>({tick:async()=>{},confirm:()=>false}),findUncalledLead:async()=>({leadId:leadB.leadId}),createCallPassProgress:()=>({refresh:async()=>{}}),installLeadSwipe(){}, buildLeadProfile(){}, createScriptOverlay:()=>({open(){},hide(){},sync(){}}),
    loadLeadMemory:async()=>({until:0,events:[]}),client:{rpc:async()=>({data:new Date(clock.now).toISOString(),error:null}),auth:{onAuthStateChange:fn=>{authChanged=fn;},
      getSession:async()=>{auth.getSessionCalls++;return {data:{session:auth.session},error:null};},
      refreshSession:async()=>{auth.refreshCalls++;return auth.refreshOk?{data:{session:auth.session},error:null}:{data:{session:null},error:new Error('refresh failed')};}}},
    saveLeadSchedule:async()=>false, saveAppointmentChoice:async()=>false, encourageLead:()=>{}, encourageResult:()=>{}, cloudEnabled:async()=>true,
    cloudState:async()=>{server.reads++;return server.nextRead?server.nextRead():structuredClone(server.state);},
    cloudTouchPhone:async()=>{},
    cloudSend:async(state,command,id)=>{server.attempts.push({state,command,id});if(server.failNext){const e=server.failNext;server.failNext=null;throw e;}server.sent.push(command);},
    watchCloud:async()=>()=>{},
    isOnline:t=>Boolean(t&&clock.now-Date.parse(t)<45000),
    slotView,
    visibleLead:(s,slot)=>visibleLead(s,slot,clock.now),
    document,localStorage:{data:new Map(),getItem(k){return this.data.get(k)??null;},setItem(k,v){this.data.set(k,String(v));},removeItem(k){this.data.delete(k);}},
    location:{search:'',origin:'https://example.test',replace(){}},
    addEventListener:(name,fn)=>{winEvents[name]=fn;},
    URLSearchParams, Date:FakeDate, JSON, crypto:require('node:crypto'), structuredClone,
    setInterval(){}, setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;}, clearTimeout(){}, console, ...globals
  });
  vm.runInContext(read("workspace-plan-sync.js").replace(/^export /gm,""),context); vm.runInContext(pendingCallSource,context); vm.runInContext(phoneActionsSource,context); vm.runInContext(leadHighlightsSource,context); vm.runInContext(leadRulesSource,context); vm.runInContext(settingsStoreSource,context); vm.runInContext(leadTransitionSource,context); vm.runInContext(leadSwipeSource,context);
  const app=await vm.runInContext(`(async()=>{${appSource}\nreturn {refreshCloud};})()`,context);
  authChanged('SIGNED_IN',auth.session);
  await settle();
  const page={el,app,clock,timers,auth,document,storage:context.localStorage,
    callLink:()=>el('#leadCard').children.find(child=>child.className==='phoneList').children[0],
    async hide(){document.hidden=true;docEvents.visibilitychange();},
    async show({fireEvent=true}={}){document.hidden=false;if(fireEvent)docEvents.visibilitychange();await settle();},
    fireWindow:async name=>{winEvents[name]();await settle();},
    feedback:()=>el('#actionFeedback').hidden?'':el('#actionFeedback').textContent,
    runTimers:async ms=>{for(const t of timers.splice(0).filter(t=>t.ms===ms))t.fn();await settle();}};
  return page;
}
async function settle(){for(let i=0;i<5;i++)await new Promise(setImmediate);}
const leadA={available:true,leadId:'test-a',leadName:'Fictional A',phones:[{label:'Mobile',number:'555-0100',dialHref:'#sample-call'}]};
const leadB={...leadA,leadId:'test-b',leadName:'Fictional B'};
function makeServer(){return {reads:0,sent:[],attempts:[],failNext:null,nextRead:null,state:null};}
function freshState(server,page,lead=leadA){const now=new Date(page?page.clock.now:Date.parse('2026-09-24T20:00:00Z')).toISOString();server.state={lead,desktop_seen:now,lead_updated_at:now,device_id:'test-computer'};}
function freshTwoSlotState(server,page,lead1=leadA,lead2=leadB){
  const now=new Date(page?page.clock.now:Date.parse('2026-09-24T20:00:00Z')).toISOString();
  server.state={lead:lead1,desktop_seen:now,lead_updated_at:now,device_id:'test-computer',slot_leads:{'1':lead1,'2':lead2},slot_seen:{'1':now,'2':now}};
}

async function calledPage(globals){
  const server=makeServer(); freshState(server,null);
  const page=await loadPage(server,globals);
  page.callLink().listeners.click(); await settle();
  assert.deepEqual(server.sent.map(c=>c.type),['call']);
  assert.equal(page.el('#callResults').hidden,false);
  return {server,page};
}

test('phone action helpers explain every refusal in plain English', async()=>{
  const h=actions(); const now=Date.parse('2026-09-24T20:00:00Z'); const iso=ms=>new Date(ms).toISOString();
  assert.equal(h.formatAgo(20000),'20 seconds'); assert.equal(h.formatAgo(5*MIN),'5 minutes'); assert.equal(h.formatAgo(3*60*MIN),'3 hours');
  const state={lead:{leadId:'a',leadName:'Fictional A'},desktop_seen:iso(now-5000),lead_updated_at:iso(now-40*MIN+1)};
  assert.equal(h.checkBeforeSend({...state,lead_updated_at:iso(now-MIN)},{leadId:'a'},now),'');
  assert.match(h.checkBeforeSend({...state,desktop_seen:iso(now-7*MIN)},{leadId:'a'},now),/hasn't checked in for 7 minutes.*IMPACT is open/);
  assert.match(h.checkBeforeSend(null,{leadId:'a'},now),/isn't connected/);
  assert.match(h.checkBeforeSend(state,{leadId:'a'},now),/hasn't sent this lead recently/);
  assert.match(h.checkBeforeSend({...state,lead_updated_at:iso(now)},{leadId:'b'},now),/different lead now \(Fictional A\)/);
  assert.equal(h.isStateFresh(now-2000,0,now),true);
  assert.equal(h.isStateFresh(now-2000,now-1000,now),false,'state fetched before the page was hidden is not trusted');
  assert.equal(h.isStateFresh(now-9000,0,now),false);
  assert.equal(h.isAuthFailure('JWT expired'),true); assert.equal(h.isAuthFailure('The lead changed.'),false);
  assert.equal(h.friendlySendError('TypeError: Failed to fetch','no-answer'),h.NETWORK_MESSAGE);
  assert.match(h.friendlySendError('The lead changed. Wait for the latest lead.','no-answer'),/different lead/);
  assert.match(h.friendlySendError('The lead changed. Wait for the latest lead.','next'),/catching up/);
  await assert.rejects(h.withTimeout(new Promise(()=>{}),5,'slow'),/slow/);
  assert.equal(await h.withTimeout(Promise.resolve(7),1000),7);
});

test('a tap right after coming back re-checks the computer first, then sends No Answer', async()=>{
  const {server,page}=await calledPage();
  await page.hide();
  page.clock.now+=20*MIN; freshState(server,page);           // computer kept checking in meanwhile
  await page.show({fireEvent:false});                          // tap before the resume refresh lands
  const readsBefore=server.reads;
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.equal(server.reads,readsBefore+1,'fresh state fetched before sending');
  assert.deepEqual([server.sent.at(-1).type,server.sent.at(-1).leadId],['no-answer','test-a']);
  assert.equal(server.attempts.at(-1).state.desktop_seen,server.state.desktop_seen,'sent with the fresh state, not the stale one');
  assert.match(page.feedback(),/Sending No Answer/);
});

test('if the computer stopped checking in, the tap says so instead of doing nothing', async()=>{
  const {server,page}=await calledPage();
  await page.hide();
  const seen=page.clock.now; page.clock.now+=6*MIN;
  server.state={...server.state,desktop_seen:new Date(seen+MIN).toISOString()};
  await page.show({fireEvent:false});
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.equal(server.sent.length,1,'nothing but the original call was sent');
  assert.match(page.feedback(),/computer hasn't checked in for 5 minutes/);
  assert.equal(page.el('#actionFeedback').className,'actionFeedback error');
  assert.match(page.el('#leadCard').textContent,/call to Fictional A is saved/);
  freshState(server,page);
  await page.app.refreshCloud();
  assert.equal(page.el('#callResults').hidden,false,'result buttons return with the computer');
});

test('if IMPACT moved to another lead while away, No Answer is not sent to the wrong lead', async()=>{
  const {server,page}=await calledPage();
  await page.hide(); page.clock.now+=10*MIN; freshState(server,page,leadB);
  await page.show({fireEvent:false});
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.equal(server.sent.length,1);
  assert.match(page.feedback(),/different lead now \(Fictional B\)/);
  assert.equal(page.el('#pendingCallNotice').hidden,false,'the unlogged-call reminder shows');
});

test('Phone 2 validates No Answer against its own slot on the first fresh read', async()=>{
  const server=makeServer();
  freshTwoSlotState(server,null,leadA,leadB);
  const page=await loadPage(server);
  page.storage.setItem('impact.phoneSettings',JSON.stringify({phoneSlot:'2'}));
  await page.app.refreshCloud(); await settle();
  page.callLink().listeners.click(); await settle();
  assert.deepEqual([server.sent.at(-1).type,server.sent.at(-1).leadId,server.sent.at(-1).slot],['call','test-b','2']);
  await page.hide();
  page.clock.now+=20*MIN;
  freshTwoSlotState(server,page,leadA,leadB);
  await page.show({fireEvent:false});
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.deepEqual([server.sent.at(-1).type,server.sent.at(-1).leadId,server.sent.at(-1).slot],['no-answer','test-b','2']);
  assert.equal(server.attempts.at(-1).state.lead.leadId,'test-b','fresh send state is the Phone 2 slot, not Phone 1');
  assert.match(page.feedback(),/Sending No Answer/);
});

test('an expired sign-in is refreshed and the send retried once with the same id', async()=>{
  const {server,page}=await calledPage();
  server.failNext=new Error('JWT expired');
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.equal(page.auth.refreshCalls,1);
  assert.equal(server.attempts.at(-1).id,server.attempts.at(-2).id);
  assert.equal(server.sent.at(-1).type,'no-answer');

  server.failNext=new Error('JWT expired'); page.auth.refreshOk=false;
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.match(page.feedback(),/Reconnecting to your account didn't work/);

  server.failNext=new TypeError('Failed to fetch');
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.match(page.feedback(),/Check your phone's signal/);
});

test('coming back refreshes right away and releases a Previous/Next lock whose timer was frozen', async()=>{
  const server=makeServer(); freshState(server,null);
  const page=await loadPage(server);
  await page.el('#nextLead').listeners.click(); await settle();
  assert.equal(page.el('#nextLead').disabled,true);
  await page.hide(); page.clock.now+=15*MIN; freshState(server,page);
  const readsBefore=server.reads;
  await page.show();
  assert.ok(server.reads>readsBefore,'state refreshed on return');
  assert.equal(page.el('#nextLead').disabled,false,'lock released');
  assert.equal(page.el('#previousLead').disabled,false);
  const reads=server.reads;
  await page.fireWindow('focus');
  assert.equal(server.reads,reads,'focus right after visibilitychange does not refresh twice');
  page.clock.now+=5000; await page.fireWindow('online');
  assert.ok(server.reads>reads,'regaining signal refreshes');
  page.clock.now+=5000; await page.fireWindow('pageshow');
  assert.ok(page.auth.getSessionCalls>0,'session checked on resume');
});

test('the phone says so when the computer never confirms, and shows late confirmations', async()=>{
  const {server,page}=await calledPage();
  await page.el('#noAnswer').listeners.click(); await settle();
  await page.runTimers(16000);
  assert.match(page.feedback(),/hasn't confirmed that yet/);

  await page.el('#refusedAppointment').listeners.click(); await settle();
  // The computer's clock is 10 minutes behind, so its timestamp looks old.
  page.clock.now+=3000; freshState(server,page);
  server.state.result={message:'Refused Appointment submitted. Waiting for IMPACT, then moving to the next lead...',at:new Date(page.clock.now-10*MIN).toISOString()};
  await page.app.refreshCloud();
  assert.match(page.feedback(),/Refused Appointment submitted/);
  await page.runTimers(16000);
  assert.match(page.feedback(),/Refused Appointment submitted/,'no false warning after a confirmation');
});

test('a read left hanging by the phone sleeping does not block later refreshes', async()=>{
  const server=makeServer(); freshState(server,null);
  const page=await loadPage(server);
  server.nextRead=()=>new Promise(()=>{});
  page.clock.now+=1000; void page.app.refreshCloud();
  server.nextRead=null;
  const reads=server.reads;
  await page.app.refreshCloud();
  assert.equal(server.reads,reads,'a recent read in flight is not duplicated');
  page.clock.now+=16000; freshState(server,page,leadB);
  await page.app.refreshCloud();
  assert.equal(server.reads,reads+1);
  assert.match(page.el('#leadCard').children.find(c=>c.textContent==='Fictional B')?.textContent||'',/Fictional B/);
});

test('a brief network error after waking keeps the lead on screen', async()=>{
  const {server,page}=await calledPage();
  page.clock.now+=2000;
  server.nextRead=()=>Promise.reject(new TypeError('Load failed'));
  await page.app.refreshCloud();
  assert.equal(page.el('#callResults').hidden,false);
  assert.equal(page.el('#status').textContent,'Reconnecting…');
});

test('Settings: Refused Appointment asks first (default on) and a sent tap vibrates (default on)', async()=>{
  const asked=[], buzz=[]; let answer=false;
  const {server,page}=await calledPage({confirm:message=>{asked.push(message);return answer;},navigator:{vibrate:ms=>{buzz.push(ms);return true;}}});
  await page.el('#refusedAppointment').listeners.click(); await settle();
  assert.deepEqual(server.sent.map(c=>c.type),['call'],'declined: nothing sent');
  assert.match(asked[0],/Send Refused Appointment to IMPACT for Fictional A\?/);
  assert.deepEqual(buzz,[],'no buzz for a declined tap');
  answer=true;
  await page.el('#refusedAppointment').listeners.click(); await settle();
  assert.deepEqual(server.sent.map(c=>c.type),['call','refused-appointment']);
  assert.deepEqual(buzz,[40],'one short buzz once the tap is sent');
});

test('Settings: with confirm and vibrate turned off, Refused Appointment sends straight away without a buzz', async()=>{
  const asked=[], buzz=[];
  const {server,page}=await calledPage({confirm:()=>{asked.push(1);return false;},navigator:{vibrate:ms=>{buzz.push(ms);}}});
  page.storage.setItem('impact.phoneSettings',JSON.stringify({confirmResults:false,vibrate:false}));
  await page.el('#refusedAppointment').listeners.click(); await settle();
  assert.deepEqual(server.sent.map(c=>c.type),['call','refused-appointment']);
  assert.equal(asked.length,0); assert.deepEqual(buzz,[]);
});

test('Settings: No Answer never asks, and a failed send does not vibrate', async()=>{
  const asked=[], buzz=[];
  const {server,page}=await calledPage({confirm:()=>{asked.push(1);return true;},navigator:{vibrate:ms=>{buzz.push(ms);}}});
  server.failNext=new Error('Failed to fetch');
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.deepEqual(buzz,[],'not sent, no buzz');
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.deepEqual(server.sent.map(c=>c.type),['call','no-answer']);
  assert.equal(asked.length,0); assert.deepEqual(buzz,[40]);
});

test('Calendar: each lead the Workspace receives is handed to the calendar, and a failure there changes nothing', async()=>{
  const seen=[];
  const server=makeServer(); freshState(server,null);
  const page=await loadPage(server,{saveLeadSchedule:async lead=>{seen.push(lead.leadId);throw new Error('scheduled_events missing');}});
  assert.ok(seen.includes('test-a'));
  assert.ok(page.el('#leadCard').children.some(c=>c.textContent==='Fictional A'),'lead still shown');
  page.callLink().listeners.click(); await settle();
  assert.deepEqual(server.sent.map(c=>c.type),['call'],'workspace keeps working');
});

test('Encouragement: the header line follows the lead, and only a sent result gets the gentle message', async()=>{
  const calls=[];
  const {server,page}=await calledPage({encourageLead:key=>calls.push(['lead',key]),encourageResult:type=>calls.push(['result',type])});
  assert.ok(calls.some(c=>c[0]==='lead'&&c[1]),'a lead key was handed over when the lead arrived');
  server.failNext=new Error('Failed to fetch');
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.equal(calls.filter(c=>c[0]==='result').length,0,'a failed send gets no message');
  await page.el('#noAnswer').listeners.click(); await settle();
  assert.deepEqual(calls.filter(c=>c[0]==='result'),[['result','no-answer']]);
});

test('quiet-hours auto-skip sends Next once for an active Response Card lead', async()=>{
  const server=makeServer();
  const page=await loadPage(server);
  page.clock.now=Date.parse('2026-09-25T01:05:00Z'); // 8:05 PM Central
  page.storage.setItem('impact.phoneSettings',JSON.stringify({autoSkipQuietHours:true}));
  freshState(server,page,{...leadA,requestType:'Response Card - IBT 610 (SGCOY) (AD&D)'});
  await page.app.refreshCloud(); await settle(); await page.runTimers(0);
  assert.deepEqual(server.sent.map(c=>c.type),['next']);
  await page.app.refreshCloud(); await settle(); await page.runTimers(0);
  assert.deepEqual(server.sent.map(c=>c.type),['next'],'does not repeat Next while IMPACT is still on the same lead');
});

test('saved history stays separate from lead details and does not open over the active call',async()=>{
 const {server,page}=await calledPage({loadLeadMemory:async()=>({until:Date.parse('2026-09-24T22:00:00Z'),events:[]})});
 page.clock.now+=5000;freshState(server,page);await page.app.refreshCloud();await settle();
 const history=page.el('#leadCard').children.filter(c=>c.className==='savedLeadHistory').at(-1);
 assert.ok(history,'saved call history has its own class instead of profileBio');
 assert.notEqual(history.open,true,'active call history must not automatically expand');
 assert.equal(page.el('#callResults').hidden,false);
});
test('recent calls skip on arrival but not on the initial page or repeated refresh',async()=>{
 const server=makeServer();freshState(server,null);
 const page=await loadPage(server,{loadLeadMemory:async()=>({until:Date.parse('2026-09-24T22:00:00Z'),events:[]})});await settle();
 assert.equal(server.sent.length,0);
 freshState(server,page,leadB);await page.app.refreshCloud();await settle();assert.deepEqual(server.sent.map(c=>c.type),['open-lead']);
 await page.app.refreshCloud();await settle();assert.equal(server.sent.length,1);
});
test('a settled lead with no number skips once without recording a call',async()=>{
 const server=makeServer();freshState(server,null);const page=await loadPage(server);
 freshState(server,page,{...leadB,phones:[]});await page.app.refreshCloud();
 await page.runTimers(2000);assert.deepEqual(server.sent.map(c=>c.type),['open-lead']);
 freshState(server,page,{...leadB,phones:[]});await page.app.refreshCloud();await page.runTimers(2000);
 assert.equal(server.sent.length,1);
});
test('a numberless lead skips when the page first opens, including empty phone entries',async()=>{
 for(const phones of [[],[{label:'Home',number:'',dialHref:'tel:'}]]){
  const server=makeServer();freshState(server,null,{...leadA,phones});const page=await loadPage(server);
  await page.runTimers(2000);assert.deepEqual(server.sent.map(c=>c.type),['open-lead']);
 }
});
test('a number arriving during the settling pause prevents a missing-number skip',async()=>{
 const server=makeServer();freshState(server,null,{...leadA,phones:[]});const page=await loadPage(server);
 freshState(server,page,leadA);await page.app.refreshCloud();await page.runTimers(2000);
 assert.equal(server.sent.length,0);
});
test('a future callback opened by IMPACT is redirected to an uncalled lead',async()=>{
 const server=makeServer();freshState(server,null,{...leadA,callHistory:['Schedule Call Back appointment on Sep 25 2026 - 02:30 PM by Me']});
 const page=await loadPage(server);await page.runTimers(2000);
 assert.deepEqual(server.sent.map(c=>c.type),['open-lead']);assert.equal(server.sent[0].targetLeadId,leadB.leadId);
});
test('a due callback stays visible instead of being skipped for its schedule',async()=>{
 const server=makeServer();freshState(server,null,{...leadA,callHistory:['Schedule Call Back appointment on Sep 24 2026 - 02:30 PM by Me']});
 const page=await loadPage(server);await page.runTimers(2000);assert.equal(server.sent.length,0);
});
test('Dont show again sends No Answer for the call and disables the finished-call button',async()=>{
 const {server,page}=await calledPage();await page.el('#dontShowAgain').listeners.click();await settle();
 assert.deepEqual(server.sent.map(c=>c.type),['call','no-answer']);assert.equal(server.sent[1].leadId,leadA.leadId);
 assert.equal(page.el('#dontShowAgain').disabled,true);assert.match(page.feedback(),/excluded from calls and texts/);
});
test('a scheduled appointment opened by IMPACT is skipped without a call',async()=>{
 const server=makeServer();freshState(server,null,{...leadA,callHistory:['Schedule Virtual Appointment on Sep 25 2026 - 02:30 PM by Me']});
 const page=await loadPage(server);await page.runTimers(2000);assert.deepEqual(server.sent.map(c=>c.type),['open-lead']);
});
