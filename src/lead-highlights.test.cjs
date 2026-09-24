const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const strip=source=>source.replace(/^export /gm,'');
function highlights(){const context=vm.createContext({});vm.runInContext(strip(read('phone-web/public/lead-highlights.js')),context);return context;}
const plain=value=>JSON.parse(JSON.stringify(value));
// Local times, so the tests hold in any time zone (IMPACT times are read as the phone's local time).
const at=(day,hour=10,minute=0)=>new Date(2026,8,day,hour,minute).getTime();
const now=at(24);
// Real IMPACT Status lines for one lead, newest first as IMPACT lists them.
const realLead=[
  'No Answer on Sep 23 2026 09:38 PM by Me',
  'No Answer on Sep 23 2026 03:09 PM by Me',
  'Schedule Call Back appointment on Sep 24 2026 - No Time Preference by Me',
  'Checkin on Sep 22 2026 04:41 PM by Me',
  'No Answer on Sep 22 2026 04:01 PM by Me',
  'No Answer on Sep 22 2026 04:00 PM by Me',
  'No Answer on Sep 22 2026 02:56 PM by Me',
  'Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me',
  'SetVirtualAppt by Me'
];
const impactHistory=['No Answer on Sep 23 2026 04:48 PM by Me.','No Answer on Sep 23 2026 02:42 PM by Me.','Reschedule appointment on Sep 22 2026 06:30 PM by Me.'];
const summary=chips=>chips.map(c=>`${c.label} | ${c.title} | ${c.detail}`);

test('real IMPACT Status lines parse into action, scheduled time, preference and kind', ()=>{
  const h=highlights();
  const callback=plain(h.parseHistoryEntry(realLead[2]));
  assert.equal(callback.kind,'callback');
  assert.equal(callback.scheduled,true);
  assert.equal(callback.action,'Schedule Call Back appointment');
  assert.equal(callback.preference,'No time preference');
  assert.deepEqual([callback.dates[0].at,callback.dates[0].hasTime],[new Date(2026,8,24).getTime(),false]);
  const appointment=plain(h.parseHistoryEntry(realLead[7]));
  assert.deepEqual([appointment.kind,appointment.scheduled,appointment.type,appointment.preference],['appointment',true,'Virtual','']);
  assert.equal(appointment.dates[0].at,at(22,15));
  const reschedule=plain(h.parseHistoryEntry(impactHistory[2]));
  assert.deepEqual([reschedule.kind,reschedule.reschedule,reschedule.dates[0].at],['appointment',true,at(22,18,30)]);
  assert.deepEqual([h.classifyEntry(realLead[3]),h.parseHistoryEntry(realLead[3]).scheduled],['checkin',false]);
  const marker=plain(h.parseHistoryEntry('SetVirtualAppt by Me'));
  assert.deepEqual([marker.kind,marker.dates.length,marker.scheduled,marker.action],['other',0,false,'SetVirtualAppt']);
  assert.equal(h.parseHistoryEntry('No Answer on Sep 23 2026 12:05 AM by Me').dates[0].at,at(23,0,5));
  assert.equal(h.parseHistoryEntry('Schedule Call Back appointment on Sep 25 2026 - 02:30 PM by Me').dates[0].at,at(25,14,30));
  assert.equal(h.parseHistoryEntry('Schedule Call Back appointment on Sep 25 2026 - Morning by Me').preference,'Morning');
  assert.equal(h.parseHistoryEntry('Callback on 09/25/2026 10:15 AM by Me.').dates[0].at,at(25,10,15));
  assert.equal(h.findDates('On Feb 30 2026 by Me').length,0,'impossible dates are ignored');
  for (const line of realLead) assert.ok(!['bad-number','refused','appointment-missed'].includes(h.classifyEntry(line)),`no false warning: ${line}`);
  assert.equal(h.classifyEntry('Refused Appointment on Sep 23 2026 04:48 PM by Me.'),'refused');
  assert.equal(h.classifyEntry('Bad Number on Sep 23 2026 04:48 PM by Me.'),'bad-number');
  assert.equal(h.classifyEntry('Appointment cancelled on Sep 23 2026 04:48 PM by Me.'),'appointment-missed');
});

test('real lead on Sep 24 10:00 AM: callback due today, past appointment, 5 no answers, check-in', ()=>{
  const chips=plain(highlights().buildHeadsUp(realLead,now));
  assert.deepEqual(summary(chips),[
    'Callback due today | Today · No time preference | Call back any time today',
    'Had appointment | Tue, Sep 22, 3:00 PM | Virtual appointment · 2 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 9:38 PM · yesterday',
    'Recent activity | Checkin | Tue, Sep 22, 4:41 PM · 2 days ago'
  ]);
  assert.deepEqual(chips.map(c=>c.tone),['callback','neutral','neutral','neutral']);
  assert.equal(chips[0].soon,true);
  assert.ok(!chips.some(c=>c.tone==='danger'),'no false warnings');
  // A date-only callback stays due all day.
  assert.equal(highlights().buildHeadsUp(realLead,at(24,23,59))[0].label,'Callback due today');
});

test('real lead on Sep 25: the callback date has passed and the appointment is past', ()=>{
  const chips=plain(highlights().buildHeadsUp(realLead,at(25)));
  assert.deepEqual(summary(chips),[
    'Callback date passed | Thu, Sep 24 · No time preference | yesterday',
    'Had appointment | Tue, Sep 22, 3:00 PM | Virtual appointment · 3 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 9:38 PM · 2 days ago',
    'Recent activity | Checkin | Tue, Sep 22, 4:41 PM · 3 days ago'
  ]);
});

test('real lead on Sep 21: the virtual appointment is upcoming and soon, the callback is set', ()=>{
  const chips=plain(highlights().buildHeadsUp(realLead,at(21)));
  assert.deepEqual(summary(chips),[
    'Upcoming appointment | Tue, Sep 22, 3:00 PM | Virtual appointment · tomorrow',
    'Callback set | Thu, Sep 24 · No time preference | in 3 days'
  ]);
  assert.deepEqual(chips.map(c=>[c.tone,c.soon]),[['appointment',true],['callback',false]]);
});

test('no answers logged today are counted', ()=>{
  const chips=plain(highlights().buildHeadsUp(realLead,at(23,22)));
  assert.equal(chips.find(c=>c.label==='Previous tries').detail,'Last Sep 23, 9:38 PM · 22 min ago · 2 today');
  assert.equal(chips[0].label,'Callback set');
  assert.equal(chips[0].detail,'tomorrow');
});

test('the newest scheduled line wins, and appointments today show their time', ()=>{
  const h=highlights();
  const chips=plain(h.buildHeadsUp([
    'Reschedule appointment on Sep 24 2026 06:30 PM by Me',
    'Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me',
    'Schedule Call Back appointment on Sep 26 2026 - Afternoon by Me',
    'Schedule Call Back appointment on Sep 25 2026 - No Time Preference by Me'
  ],now));
  assert.deepEqual(summary(chips),[
    'Appointment today | Today, 6:30 PM | Appointment (rescheduled) · in 9 hrs',
    'Callback set | Sat, Sep 26 · Afternoon | in 2 days'
  ]);
  assert.equal(chips[0].soon,true);
  assert.equal(plain(h.buildHeadsUp(impactHistory,now))[0].label,'Had appointment');
  assert.equal(h.buildHeadsUp(['Schedule Virtual Appointment on Aug 01 2026 03:00 PM by Me'],now).length,0,'old appointments are not shown');
});

test('warnings, lines without dates and run-together lines are handled', ()=>{
  const h=highlights();
  const chips=plain(h.buildHeadsUp(['No Answer on Sep 23 2026 04:48 PM by Me.','Bad Number on Sep 20 2026 09:00 AM by Me.'],now));
  assert.deepEqual(chips.map(c=>[c.tone,c.label]),[['danger','Check the number'],['neutral','Previous tries']]);
  assert.equal(h.buildHeadsUp(['Refused Appointment on Sep 10 2026 11:00 AM by Me.'],now)[0].label,'Refused before');
  assert.deepEqual(plain(h.buildHeadsUp(['SetVirtualAppt by Me'],now)),[]);
  assert.deepEqual(plain(h.buildHeadsUp([],now)),[]);
  assert.deepEqual(plain(h.buildHeadsUp(undefined,now)),[]);
  assert.equal(h.buildHeadsUp(['No Answer yesterday'],now)[0].title,'1 no answer');
  // If IMPACT's text arrives as one run-together string, the lines are split back apart.
  assert.equal(h.splitHistory([realLead.join(' ')]).length,9);
  assert.equal(h.splitHistory([realLead.join('')]).length,9);
  assert.deepEqual(plain(h.splitHistory(['No Answer on Sep 23 2026 04:48 PM by Me. Comment · 9/24/2026 7:56:31 PM IMV'])),['No Answer on Sep 23 2026 04:48 PM by Me.','Comment · 9/24/2026 7:56:31 PM IMV']);
  assert.deepEqual(summary(plain(h.buildHeadsUp([realLead.join(' ')],now))),summary(plain(h.buildHeadsUp(realLead,now))));
  assert.equal(h.relativeTime(now+30*60000,now),'in 30 min');
  assert.equal(h.relativeTime(new Date(2026,8,24).getTime(),now,false),'today');
});

test('history captured by the extension flows straight into the heads-up', ()=>{
  const source=read('extension/src/content/impact-diagnostic.js');
  const fn=source.slice(source.indexOf('  function collectCallHistory('),source.indexOf('  async function prefetchNextLead('));
  const extension=vm.createContext({sanitizeText:value=>value.replace(/\s+/g,' ').trim()});
  vm.runInContext(fn,extension);
  const history=extension.collectCallHistory({querySelectorAll:()=>[{textContent:'Show Less... Status '+realLead.join('\n')}]});
  const chips=plain(highlights().buildHeadsUp(history,now));
  assert.deepEqual(chips.map(c=>c.label),['Callback due today','Had appointment','Previous tries','Recent activity']);
});

test('the phone lead card shows heads-up chips above the details and hides them when empty', async()=>{
  const elements=new Map();
  const make=()=>({children:[],listeners:{},value:'',hidden:false,open:true,disabled:false,textContent:'',className:'',attributes:{},
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,fn){this.listeners[name]=fn;}});
  const el=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  let authChanged;
  const lead={available:true,leadId:'test-a',leadName:'Fictional A',requestType:'Sample request',language:'English',email:'fictional@example.test',callHistory:realLead,phones:[{label:'Mobile',number:'555-0100',dialHref:'#sample-call'}]};
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
  for(const file of ['pending-call.js','phone-actions.js','lead-highlights.js','lead-rules.js']) vm.runInContext(strip(read(`phone-web/public/${file}`)),context);
  const app=await vm.runInContext(`(async()=>{${read('phone-web/public/app.js').replace(/^import .*;\r?\n/gm,'')}\nreturn {refreshCloud};})()`,context);
  authChanged('SIGNED_IN',{user:{id:'test-user'}});
  await new Promise(setImmediate);
  const card=el('#leadCard').children;
  const names=card.map(c=>c.className||c.textContent);
  assert.equal(card.some(c=>c.children?.[0]?.textContent==='Language'),false,'English is omitted to keep the lead card compact');
  const headsUp=card.find(c=>String(c.className).includes('headsUp'));
  assert.ok(headsUp,'heads-up section rendered');
  assert.ok(names.findIndex(name=>String(name).includes('headsUp'))<names.indexOf('detail'),'shown before the contact details');
  assert.ok(names.findIndex(name=>String(name).includes('headsUp'))<names.indexOf('phoneList'),'shown before the Call buttons');
  assert.equal(headsUp.children[0].textContent,'SCHEDULED CALLBACK');
  const chips=headsUp.children.filter(c=>String(c.className).includes('headsUpChip'));
  assert.deepEqual(chips.map(c=>c.className),['headsUpChip callback soon','headsUpChip neutral muted','headsUpChip neutral','headsUpChip neutral muted']);
  assert.deepEqual(chips[0].children.map(c=>c.textContent),['Callback due today','Today · No time preference','Call back any time today']);
  state={...state,lead:{...lead,leadId:'test-c',callHistory:[realLead.join(' ')]}};
  await app.refreshCloud();
  assert.equal(el('#historyEntries').children.length,9,'Previous activity lists run-together lines separately');
  assert.equal(el('#historyEntries').children[2].textContent,realLead[2]);
  state={...state,lead:{...lead,leadId:'test-b',callHistory:[]}};
  await app.refreshCloud();
  assert.equal(el('#leadCard').children.some(c=>String(c.className).includes('headsUp')),false);
  state={...state,lead:{...lead,leadId:'test-d',language:'Spanish',callHistory:[]}};
  await app.refreshCloud();
  assert.equal(el('#leadCard').children.some(c=>c.children?.[0]?.textContent==='Language'),true,'a non-English language remains visible');
});
