const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../phone-web/public',file),'utf8');
const strip=source=>source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const MIN=60000;

function transitionModule(globals={}){const context=vm.createContext({...globals});vm.runInContext(strip(read('lead-transition.js')),context);return context;}

// A tiny DOM stand-in with Web Animations: records every animate() call.
function fakeDom(){
  const make=(className='')=>{const node={className,children:[],attributes:{},animations:[],inert:false,parent:null,
    classList:{contains:name=>String(node.className).split(/\s+/).includes(name),add:name=>{if(!node.classList.contains(name))node.className=`${node.className} ${name}`.trim();},remove:name=>{node.className=String(node.className).split(/\s+/).filter(c=>c&&c!==name).join(' ');}},
    append(...items){for(const item of items){item.parent=node;node.children.push(item);}},
    remove(){if(node.parent){node.parent.children=node.parent.children.filter(c=>c!==node);node.parent=null;}},
    setAttribute(name,value){node.attributes[name]=value;},
    cloneNode(){return make(node.className);},
    querySelectorAll(){return node.children.filter(c=>c.classList.contains('leadGhost'));},
    animate(frames,options){const listeners={};const animation={frames,options,addEventListener:(name,fn)=>{listeners[name]=fn;},finish:()=>listeners.finish?.()};node.animations.push(animation);return animation;}};
    return node;};
  const doc={createElement:()=>make()};
  const card=make('leadCard');card.ownerDocument=doc;
  return {make,card};
}
const translateX=frame=>Number((/translate\((-?\d+)px,/.exec(frame.transform||'')||[])[1]||0);
const translateY=frame=>Number((/translate\(-?\d+px, (-?\d+)px\)/.exec(frame.transform||'')||[])[1]||0);

test('lead transition: only when the lead id changes, with the right direction', ()=>{
  const m=transitionModule(); const now=Date.parse('2026-09-24T20:00:00Z');
  assert.equal(m.leadTransitionKind('lead:a','lead:a',null,now),'','same lead re-rendered (status, heartbeat): no animation');
  assert.equal(m.leadTransitionKind('lead:a','lead:a',{type:'next',at:now},now),'','same lead even right after a Next tap: no animation');
  assert.equal(m.leadTransitionKind('','lead:a',null,now),'','first lead after the page opens: no animation');
  assert.equal(m.leadTransitionKind('lead:a','',null,now),'','no lead: no animation');
  assert.equal(m.leadTransitionKind('lead:a','lead:b',{type:'next',at:now-800},now),'next');
  assert.equal(m.leadTransitionKind('lead:b','lead:a',{type:'previous',at:now-800},now),'previous');
  assert.equal(m.leadTransitionKind('lead:a','lead:b',null,now),'arrive','a new lead after a result fades up');
  assert.equal(m.leadTransitionKind('lead:a','lead:b',{type:'next',at:now-m.NAV_INTENT_MS},now),'arrive','an old tap no longer explains the change');
});

test('lead transition: Next slides left, Previous slides right, a new lead fades up; about 200-280ms, ease-out', ()=>{
  const m=transitionModule();
  const total=plan=>Math.max(plan.outMs,plan.inDelay+plan.inMs);
  const next=m.leadTransitionPlan('next',false), previous=m.leadTransitionPlan('previous',false), arrive=m.leadTransitionPlan('arrive',false);
  assert.ok(translateX(next.out.at(-1))<0,'Next: old lead leaves to the left');
  assert.ok(translateX(next.in[0])>0,'Next: new lead comes in from the right');
  assert.ok(translateX(previous.out.at(-1))>0,'Previous: old lead leaves to the right');
  assert.ok(translateX(previous.in[0])<0,'Previous: new lead comes in from the left');
  assert.equal(translateX(arrive.in[0]),0); assert.ok(translateY(arrive.in[0])>0,'new lead after a result rises gently into place');
  for(const plan of [next,previous,arrive]){
    assert.ok(total(plan)>=200&&total(plan)<=280,`total ${total(plan)}ms`);
    assert.equal(plan.out[0].opacity,1); assert.equal(plan.out.at(-1).opacity,0); assert.equal(plan.in[0].opacity,0); assert.equal(plan.in.at(-1).opacity,1);
    assert.ok(Math.abs(translateX(plan.in[0]))<=16,'moves only a little');
    assert.match(plan.easing,/cubic-bezier\(\.2, \.7|ease-out/);
  }
  assert.equal(m.leadTransitionPlan('',false),null);
});

test('lead transition: reduced motion means no slide, just a quick fade', ()=>{
  const m=transitionModule();
  for(const kind of ['next','previous','arrive']){
    const plan=m.leadTransitionPlan(kind,true);
    assert.equal(plan.out,null,'no outgoing copy');
    assert.ok(plan.in.every(frame=>!('transform' in frame)),'no movement');
    assert.ok(plan.inMs<=150);
  }
  assert.equal(transitionModule({matchMedia:q=>({matches:q==='(prefers-reduced-motion: reduce)'})}).prefersReducedMotion(),true);
  assert.equal(transitionModule({matchMedia:()=>({matches:false})}).prefersReducedMotion(),false);
  assert.equal(transitionModule({}).prefersReducedMotion(),false);
  const {make,card}=fakeDom(); card.append(make('requestBadge'),make('phoneList'));
  const played=m.playLeadTransition(card,'next',[make('oldName')],{reducedMotion:true});
  assert.equal(played.out,null);
  assert.equal(card.children.some(c=>c.className==='leadGhost'),false,'no sliding copy with reduced motion');
  assert.ok(card.children.every(c=>c.animations.length===1&&c.animations[0].frames.every(f=>!('transform' in f))));
});

test('lead transition: the old lead is a see-through copy that never takes taps; the new lead is live at once', ()=>{
  const m=transitionModule();
  const {make,card}=fakeDom();
  const oldName=make('oldName'); card.append(oldName);
  const outgoing=m.snapshotLeadCard(card);
  assert.equal(outgoing.length,1); assert.notEqual(outgoing[0],oldName,'copies, not the live nodes');
  card.children=[]; const name=make('h2'), phones=make('phoneList'); card.append(name,phones); // app.js renders the new lead first
  const plan=m.playLeadTransition(card,'previous',outgoing,{reducedMotion:false});
  const ghost=card.children.find(c=>c.className==='leadGhost');
  assert.ok(ghost,'outgoing copy laid over the card');
  assert.equal(ghost.attributes['aria-hidden'],'true'); assert.equal(ghost.inert,true);
  assert.deepEqual(ghost.animations[0].frames,plan.out);
  for(const child of [name,phones]){
    assert.deepEqual(child.animations[0].frames,plan.in);
    assert.equal(child.animations[0].options.fill,'backwards','the new lead ends in its normal state');
  }
  assert.equal(card.classList.contains('leadMoving'),true,'nothing pokes out sideways while it moves');
  ghost.animations[0].finish();
  assert.equal(card.children.includes(ghost),false,'the copy is removed when it has faded');
  phones.animations[0].finish();
  assert.equal(card.className,'leadCard','back to normal once the new lead has settled');
  assert.deepEqual(card.children,[name,phones]);
  // Nothing to copy from the waiting message; no animation support: nothing happens.
  const waiting=make('leadCard empty'); waiting.append(make('x'));
  assert.equal(m.snapshotLeadCard(waiting),null);
  assert.equal(m.playLeadTransition({children:[]},'next',null),null);
  const css=read('styles.css');
  assert.match(css,/\.workspace \.leadGhost \{[^}]*position: absolute;[^}]*pointer-events: none;/,'the copy never swallows a tap');
  assert.match(css,/\.workspace \.leadCard \{ position: relative; \}/);
  assert.match(css,/\.workspace \.leadCard\.leadMoving \{ overflow-x: clip; \}/,'no sideways scroll during the slide');
});

// ---- The Workspace itself: which transition each render asks for ----
async function settle(){for(let i=0;i<5;i++)await new Promise(setImmediate);}
const leadA={available:true,leadId:'test-a',leadName:'Fictional A',phones:[{label:'Mobile',number:'555-0100',dialHref:'#sample-call'}]};
const leadB={...leadA,leadId:'test-b',leadName:'Fictional B'};
async function loadWorkspace(){
  const clock={now:Date.parse('2026-09-24T20:00:00Z')};
  class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));} static now(){return clock.now;}}
  const elements=new Map(), played=[], sent=[];
  const make=()=>({children:[],listeners:{},value:'',hidden:false,open:true,disabled:false,textContent:'',className:'',
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;}});
  const el=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  const server={state:null};
  const setLead=lead=>{const t=new Date(clock.now).toISOString();server.state={lead,desktop_seen:t,lead_updated_at:t,device_id:'test-computer'};};
  setLead(leadA);
  let authChanged;
  const session={user:{id:'user-1'}};
  const context=vm.createContext({
    client:{auth:{onAuthStateChange:fn=>{authChanged=fn;},getSession:async()=>({data:{session},error:null}),refreshSession:async()=>({data:{session},error:null})}},
    saveLeadSchedule:async()=>false, saveAppointmentChoice:async()=>false, encourageLead:()=>{}, encourageResult:()=>{}, cloudEnabled:async()=>true,
    cloudState:async()=>structuredClone(server.state), cloudTouchPhone:async()=>{},
    cloudSend:async(state,command)=>{if(server.fail)throw new TypeError('Load failed');sent.push({...command});},
    watchCloud:async()=>()=>{}, isOnline:()=>true, visibleLead:s=>s?.lead,
    document:{hidden:false,querySelector:selector=>selector.startsWith('meta')?null:el(selector),createElement:make,addEventListener(){}},
    localStorage:{data:new Map(),getItem(k){return this.data.get(k)??null;},setItem(k,v){this.data.set(k,String(v));},removeItem(k){this.data.delete(k);}},
    location:{search:'',origin:'https://example.test',replace(){}}, addEventListener(){},
    URLSearchParams, Date:FakeDate, JSON, crypto:require('node:crypto'), structuredClone,
    setInterval(){}, setTimeout(){return 0;}, clearTimeout(){}, console
  });
  for(const file of ['time-zone.js','pending-call.js','phone-actions.js','lead-highlights.js','lead-rules.js','settings-store.js','lead-transition.js']) vm.runInContext(strip(read(file)),context);
  // Record what app.js asks for, and what the card shows at that moment.
  context.playLeadTransition=(card,kind)=>{played.push({kind,name:card.children.find(c=>c.textContent&&/Fictional/.test(c.textContent))?.textContent});};
  const app=await vm.runInContext(`(async()=>{${strip(read('app.js'))}\nreturn {refreshCloud};})()`,context);
  authChanged('SIGNED_IN',session); await settle();
  const callLink=()=>el('#leadCard').children.find(child=>child.className==='phoneList').children[0];
  const tick=async(ms=1000)=>{clock.now+=ms;await settle();};
  return {el,app,clock,played,sent,setLead,callLink,tick,server};
}

test('Workspace: animates only when the lead changes; Next = next, Previous = previous, after a result = arrive', async()=>{
  const w=await loadWorkspace();
  assert.deepEqual(w.played,[],'the first lead on page open is not animated');
  await w.tick(); w.setLead({...leadA,email:'new@example.test'}); await w.app.refreshCloud();
  await w.tick(); w.setLead(leadA); await w.app.refreshCloud();
  assert.deepEqual(w.played,[],'status/heartbeat/contact refreshes of the same lead are not animated');

  await w.el('#nextLead').listeners.click(); await settle();
  assert.equal(w.sent.at(-1).type,'next');
  await w.tick(); w.setLead(leadB); await w.app.refreshCloud();
  assert.deepEqual(w.played,[{kind:'next',name:'Fictional B'}],'Next slides, and the new lead is already rendered when it plays');
  await w.tick(); await w.app.refreshCloud();
  assert.equal(w.played.length,1,'a re-render of the new lead does not animate again');

  await w.el('#previousLead').listeners.click(); await settle();
  assert.equal(w.sent.at(-1).type,'previous');
  assert.equal(w.sent.at(-1).leadId,'test-b','Previous is sent for the lead on screen');
  await w.tick(); w.setLead(leadA); await w.app.refreshCloud();
  assert.deepEqual(w.played.at(-1),{kind:'previous',name:'Fictional A'});
  // No deferred state: the lead that just slid in is the one a tap acts on, immediately.
  w.callLink().listeners.click(); await settle();
  assert.deepEqual([w.sent.at(-1).type,w.sent.at(-1).leadId],['call','test-a'],'no stale lead id right after Previous');
  assert.equal(w.el('#nextLead').disabled,false,'buttons are usable straight away');

  await w.el('#noAnswer').listeners.click(); await settle();
  assert.deepEqual([w.sent.at(-1).type,w.sent.at(-1).leadId],['no-answer','test-a']);
  await w.tick(); w.setLead(leadB); await w.app.refreshCloud();
  assert.deepEqual(w.played.at(-1),{kind:'arrive',name:'Fictional B'},'IMPACT moving on after a result: soft fade-up');
  assert.equal(w.played.length,3);
});

test('Workspace: a lead briefly missing and coming back unchanged is not animated; a Next that failed to send does not set a direction', async()=>{
  const w=await loadWorkspace();
  await w.tick(); w.setLead(null); await w.app.refreshCloud();
  await w.tick(); w.setLead(leadA); await w.app.refreshCloud();
  assert.deepEqual(w.played,[]);
  await w.tick(); w.setLead(leadB); await w.app.refreshCloud();
  assert.deepEqual(w.played.map(p=>p.kind),['arrive'],'a lead changed on the computer fades up');
  w.server.fail=true;
  await w.el('#nextLead').listeners.click(); await settle();
  w.server.fail=false;
  assert.equal(w.el('#nextLead').disabled,false,'the failed Next unlocks the buttons');
  await w.tick(); w.setLead(leadA); await w.app.refreshCloud();
  assert.deepEqual(w.played.map(p=>p.kind),['arrive','arrive'],'no slide for a Next that never reached the computer');
});
