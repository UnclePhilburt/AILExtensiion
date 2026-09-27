const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname,'../phone-web/public',name),'utf8');
const strip = source => source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const model = vm.createContext({Date,Intl,Map});
vm.runInContext(strip(read('time-zone.js')) + '\n' + strip(read('morning-briefing-model.js')),model);
const at = (day,hour=9) => new Date(2026,8,day,hour);
test('briefing is due from local 9 AM, once per date and account',()=>{
  assert.equal(model.briefingDue('a','',at(27,8)),false);
  assert.equal(model.briefingDue('a','',at(27)),true);
  assert.equal(model.briefingDue('a','2026-09-27',at(27,22)),false);
  assert.equal(model.briefingDue('a','2026-09-27',at(28)),true);
  assert.equal(model.briefingDue(null,'',at(28)),false);
  assert.notEqual(model.briefingKey('a'),model.briefingKey('b'));
});
test('comparisons exclude today and navigation; require three previous active days',()=>{
  const event=(day,type='call')=>({event_type:type,created_at:at(day,14).toISOString()});
  const recap=model.callingRecap([event(26),event(26),event(25),event(24),event(23),event(27),event(26,'next')],at(27));
  assert.equal(recap.yesterdayCalls,2);
  assert.match(recap.insight,/1 above.*average of 1.*3 active/);
  assert.match(model.callingRecap([event(25)],at(27)).insight,/more calling days/);
});
test('schedule uses local times and preserves IMPACT all-day calendar dates',()=>{
  const rows=[{id:1,starts_at:at(27,15).toISOString()}, {id:2,starts_at:at(28,10).toISOString()},
    {id:3,starts_at:'2026-09-27T05:00:00Z',all_day:true},{id:4,starts_at:'invalid'}];
  assert.equal(model.scheduleToday(rows,at(27)).map(r=>r.id).join(','),'3,1');
});
test('message is stable for the account/day and schedule-aware',()=>{
  const message=model.morningMessage('a',at(27),10,2);
  assert.equal(message,model.morningMessage('a',at(27,18),10,2));
  assert.match(message,/calendar today/);
});

async function harness(hour=9) {
  let now=at(27,hour), authCallback, active=false;
  const nodes=[],docEvents={},winEvents={},saved=new Map();
  const make=tag=>({tag,children:[],dataset:{},listeners:{},hidden:false,
    append(...items){this.children.push(...items);},setAttribute(){},
    addEventListener(k,v){this.listeners[k]=v;},focus(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}});
  const home=make('home'),body=make('body'),head=make('head');
  const doc={head,body,hidden:false,createElement:t=>{const n=make(t);nodes.push(n);return n;},
    addEventListener:(k,fn)=>docEvents[k]=fn,querySelector:selector=>selector==='.homeMain'?home:selector==='main'?home:selector==='dialog[open]'?nodes.find(n=>n.tag==='dialog'&&n.open):null};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return +now;}}
  const query={select(){return this;},eq(){return this;},gte(){return this;},lt(){return this;},order(){return this;},range(){return this;},abortSignal(){return Promise.resolve({data:[],error:null});}};
  const context=vm.createContext({Date:Clock,Intl,Map,URL,AbortSignal,Promise,console,
    location:{pathname:'/index.html'},document:doc,navigator:{},
    window:{addEventListener:(k,fn)=>winEvents[k]=fn},setTimeout:fn=>{Promise.resolve().then(fn);},
    localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
    client:{auth:{onAuthStateChange:fn=>authCallback=fn,getSession:async()=>({data:{session:{user:{id:'a'}}}})},from:()=>query},
    readPendingCall:()=>active?{resultSentAt:0}:null});
  vm.runInContext(strip(read('time-zone.js'))+'\n'+strip(read('morning-briefing-model.js'))+'\n'+strip(read('appointment-outcomes.js')),context);
  vm.runInContext(strip(read('morning-briefing.js')).replace('import.meta.url',"'https://example.test/morning-briefing.js'"),context);
  const settle=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};await settle();
  return {nodes,saved,settle,docEvents,winEvents,body,
    setHour:h=>{now=at(27,h);},setActive:v=>active=v,
    auth:id=>authCallback(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null),
    dialogs:()=>nodes.filter(n=>n.tag==='dialog'&&n.open)};
}
test('returning after 9 opens once; dismiss and focus do not reopen; account switch clears',async()=>{
  const h=await harness(8);assert.equal(h.dialogs().length,0);
  h.setHour(9);h.winEvents.focus();await h.settle();assert.equal(h.dialogs().length,1);
  h.dialogs()[0].children.find(n=>n.className==='morningStart').listeners.click();
  h.winEvents.focus();await h.settle();assert.equal(h.dialogs().length,0);
  h.auth('b');await h.settle();assert.equal(h.dialogs().length,1);
  h.auth(null);await h.settle();assert.equal(h.dialogs().length,0);
});
test('an unfinished call delays the automatic briefing',async()=>{
  const h=await harness(8);h.setActive(true);h.setHour(9);h.winEvents.focus();await h.settle();
  assert.equal(h.dialogs().length,0);h.setActive(false);h.winEvents.focus();await h.settle();assert.equal(h.dialogs().length,1);
});
