const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const strip=source=>source.replace(/^export /gm,'');
function highlights(){const context=vm.createContext({});vm.runInContext(strip(read('phone-web/public/lead-highlights.js')),context);return context;}
const plain=value=>JSON.parse(JSON.stringify(value));
// Local times, so the tests hold in any time zone.
const now=new Date(2026,8,24,15,0).getTime();
// Status entries in the format IMPACT uses (see src/history.test.cjs).
const impactHistory=['No Answer on Sep 23 2026 04:48 PM by Me.','No Answer on Sep 23 2026 02:42 PM by Me.','Reschedule appointment on Sep 22 2026 06:30 PM by Me.'];

test('IMPACT Status entries are parsed into action, date and kind', ()=>{
  const h=highlights();
  const entry=plain(h.parseHistoryEntry('Reschedule appointment on Sep 22 2026 06:30 PM by Me.'));
  assert.equal(entry.action,'Reschedule appointment');
  assert.equal(entry.by,'Me');
  assert.equal(entry.kind,'appointment');
  assert.equal(entry.dates[0].at,new Date(2026,8,22,18,30).getTime());
  assert.equal(h.parseHistoryEntry('No Answer on Sep 23 2026 12:05 AM by Me.').dates[0].at,new Date(2026,8,23,0,5).getTime());
  assert.equal(h.parseHistoryEntry('Callback on 09/25/2026 10:15 AM by Me.').dates[0].at,new Date(2026,8,25,10,15).getTime());
  assert.equal(h.parseHistoryEntry('Callback on Sept. 25, 2026 at 9:00 pm by Me.').dates[0].at,new Date(2026,8,25,21,0).getTime());
  assert.equal(h.findDates('On Feb 30 2026 by Me').length,0,'impossible dates are ignored');
  assert.equal(h.parseHistoryEntry('No Answer yesterday').dates.length,0);
  assert.equal(h.classifyEntry('No Answer on Sep 23 2026 04:48 PM by Me.'),'attempt');
  assert.equal(h.classifyEntry('Refused Appointment on Sep 23 2026 04:48 PM by Me.'),'refused');
  assert.equal(h.classifyEntry('Bad Number on Sep 23 2026 04:48 PM by Me.'),'bad-number');
  assert.equal(h.classifyEntry('Appointment cancelled on Sep 23 2026 04:48 PM by Me.'),'appointment-missed');
  assert.equal(h.classifyEntry('Call Back on Sep 23 2026 04:48 PM by Me.'),'callback');
  assert.equal(h.classifyEntry('Lead assigned on Sep 23 2026 04:48 PM by Admin.'),'other');
});

test('the real IMPACT history shows recent appointment activity and earlier tries', ()=>{
  const h=highlights();
  const chips=plain(h.buildHeadsUp(impactHistory,now));
  assert.deepEqual(chips.map(c=>[c.tone,c.label,c.title]),[
    ['appointment','Recent appointment activity','Reschedule appointment'],
    ['neutral','Previous tries','2 no answers']
  ]);
  assert.match(chips[0].detail,/Sep 22, 6:30 PM · 2 days ago/);
  assert.match(chips[1].detail,/^Last: No Answer yesterday/);
  const today=plain(h.buildHeadsUp(['No Answer on Sep 24 2026 01:30 PM by Me.',...impactHistory],now));
  assert.match(today.at(-1).detail,/Last: No Answer 2 hrs ago · 1 logged today/);
  assert.deepEqual(plain(h.buildHeadsUp([],now)),[]);
  assert.deepEqual(plain(h.buildHeadsUp(undefined,now)),[]);
  assert.deepEqual(plain(h.buildHeadsUp(['Lead assigned on Sep 20 2026 09:00 AM by Admin.'],now)),[],'nothing to flag, nothing shown');
});

test('future dates are treated as scheduled: appointments first, soon ones flagged', ()=>{
  const h=highlights();
  const chips=plain(h.buildHeadsUp([
    'Callback on Sep 24 2026 05:00 PM by Me.',
    'Set Virtual Appointment on Sep 29 2026 10:00 AM by Me.',
    'Set Virtual Appointment on Sep 25 2026 10:00 AM by Me.',
    ...impactHistory
  ],now));
  assert.deepEqual(chips.map(c=>c.label),['Upcoming appointment','Upcoming appointment','Callback set','Previous tries']);
  assert.equal(chips[0].detail,'Fri, Sep 25, 10:00 AM · tomorrow');
  assert.equal(chips[0].soon,true);
  assert.equal(chips[1].soon,false);
  assert.equal(chips[1].detail,'Tue, Sep 29, 10:00 AM · in 5 days');
  assert.equal(chips[2].detail,'Thu, Sep 24, 5:00 PM · in 2 hrs');
  assert.ok(!chips.some(c=>c.label==='Recent appointment activity'),'no duplicate appointment chip when one is upcoming');
  assert.equal(chips.length,4,'at most four chips');
});

test('warnings and recent callbacks are surfaced', ()=>{
  const h=highlights();
  const chips=plain(h.buildHeadsUp([
    'No Answer on Sep 23 2026 04:48 PM by Me.',
    'Call Back on Sep 21 2026 11:00 AM by Me.',
    'Bad Number on Sep 20 2026 09:00 AM by Me.'
  ],now));
  assert.deepEqual(chips.map(c=>[c.tone,c.label]),[['danger','Check the number'],['callback','Recent callback'],['neutral','Previous tries']]);
  assert.equal(plain(h.buildHeadsUp(['Call Back on Aug 01 2026 11:00 AM by Me.'],now)).length,0,'old callbacks are not flagged');
  assert.equal(h.buildHeadsUp(['Refused Appointment on Sep 10 2026 11:00 AM by Me.'],now)[0].label,'Refused before');
  assert.equal(h.relativeTime(now+30*60000,now),'in 30 min');
  assert.equal(h.relativeTime(now-3*24*3600000,now),'3 days ago');
  assert.equal(h.relativeTime(new Date(2026,8,24).getTime(),now,false),'today');
});

test('history captured by the extension flows straight into the heads-up', ()=>{
  const source=read('extension/src/content/impact-diagnostic.js');
  const fn=source.slice(source.indexOf('  function collectCallHistory('),source.indexOf('  async function prefetchNextLead('));
  const extension=vm.createContext({sanitizeText:value=>value.replace(/\s+/g,' ').trim()});
  vm.runInContext(fn,extension);
  const history=extension.collectCallHistory({querySelectorAll:()=>[{textContent:'Show Less... Status Set Virtual Appointment on Sep 25 2026 10:00 AM by Me. No Answer on Sep 23 2026 04:48 PM by Me.'}]});
  const chips=plain(highlights().buildHeadsUp(history,now));
  assert.deepEqual(chips.map(c=>c.label),['Upcoming appointment','Previous tries']);
});

test('the phone lead card shows heads-up chips above the details and hides them when empty', async()=>{
  const elements=new Map();
  const make=()=>({children:[],listeners:{},value:'',hidden:false,open:true,disabled:false,textContent:'',className:'',attributes:{},
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,fn){this.listeners[name]=fn;}});
  const el=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  let authChanged;
  const lead={available:true,leadId:'test-a',leadName:'Fictional A',requestType:'Sample request',language:'English',callHistory:['Set Virtual Appointment on Sep 25 2026 10:00 AM by Me.',...impactHistory],phones:[{label:'Mobile',number:'555-0100',dialHref:'#sample-call'}]};
  let state={lead,desktop_seen:new Date().toISOString(),lead_updated_at:new Date().toISOString(),device_id:'test-computer'};
  class FakeDate extends Date{constructor(...a){super(...(a.length?a:[now]));} static now(){return now;}}
  const context=vm.createContext({
    client:{auth:{onAuthStateChange:fn=>{authChanged=fn;}}}, cloudEnabled:async()=>true,
    cloudState:async()=>state,cloudTouchPhone:async()=>{}, cloudSend:async()=>{},
    watchCloud:async()=>()=>{},visibleLead:s=>s?.lead,isOnline:()=>true,
    document:{querySelector:selector=>selector.startsWith('meta')?null:el(selector),createElement:make,addEventListener(){}},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{search:'',origin:'https://example.test',replace(){}},
    URLSearchParams, Date:FakeDate, crypto:require('node:crypto'), setInterval(){},setTimeout(){}, console
  });
  for(const file of ['pending-call.js','phone-actions.js','lead-highlights.js']) vm.runInContext(strip(read(`phone-web/public/${file}`)),context);
  const app=await vm.runInContext(`(async()=>{${read('phone-web/public/app.js').replace(/^import .*;\r?\n/gm,'')}\nreturn {refreshCloud};})()`,context);
  authChanged('SIGNED_IN',{user:{id:'test-user'}});
  await new Promise(setImmediate);
  const card=el('#leadCard').children;
  const names=card.map(c=>c.className||c.textContent);
  const headsUp=card.find(c=>c.className==='headsUp');
  assert.ok(headsUp,'heads-up section rendered');
  assert.ok(names.indexOf('headsUp')<names.indexOf('detail'),'shown before the contact details');
  assert.ok(names.indexOf('headsUp')<names.indexOf('phoneList'),'shown before the Call buttons');
  assert.deepEqual(headsUp.children.map(c=>c.className),['headsUpChip appointment soon','headsUpChip neutral']);
  assert.equal(headsUp.children[0].children[0].textContent,'Upcoming appointment · soon');
  assert.equal(headsUp.children[0].children[1].textContent,'Set Virtual Appointment');
  assert.equal(headsUp.children[0].children[2].textContent,'Fri, Sep 25, 10:00 AM · tomorrow');
  state={...state,lead:{...lead,leadId:'test-b',callHistory:[]}};
  await app.refreshCloud();
  assert.equal(el('#leadCard').children.some(c=>c.className==='headsUp'),false);
});
