const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const strip=source=>source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function highlights(){const context=vm.createContext({});vm.runInContext(strip(`${read('phone-web/public/time-zone.js')}\n${read('phone-web/public/lead-highlights.js')}`),context);return context;}
const plain=value=>JSON.parse(JSON.stringify(value));
// Fixed instants so the tests hold in any process time zone. Sep 2026:
// Central (IMPACT) = UTC-5, Eastern = UTC-4, Pacific = UTC-7.
const ct=(day,hour=10,minute=0)=>Date.UTC(2026,8,day,hour+5,minute);
const now=ct(24); // Sep 24 2026 10:00 AM Central
const central={phoneTimeZone:'America/Chicago'};
const heads=(history,at,options=central)=>plain(highlights().buildHeadsUp(history,at,options));
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

test('real IMPACT Status lines parse as Central wall-clock times', ()=>{
  const h=highlights();
  const callback=plain(h.parseHistoryEntry(realLead[2]));
  assert.equal(callback.kind,'callback');
  assert.equal(callback.scheduled,true);
  assert.equal(callback.action,'Schedule Call Back appointment');
  assert.equal(callback.preference,'No time preference');
  assert.deepEqual([callback.dates[0].at,callback.dates[0].hasTime],[ct(24,0),false],'date-only = midnight Central');
  const appointment=plain(h.parseHistoryEntry(realLead[7]));
  assert.deepEqual([appointment.kind,appointment.scheduled,appointment.type,appointment.preference],['appointment',true,'Virtual','']);
  assert.equal(appointment.dates[0].at,ct(22,15));
  const reschedule=plain(h.parseHistoryEntry(impactHistory[2]));
  assert.deepEqual([reschedule.kind,reschedule.reschedule,reschedule.dates[0].at],['appointment',true,ct(22,18,30)]);
  assert.deepEqual([h.classifyEntry(realLead[3]),h.parseHistoryEntry(realLead[3]).scheduled],['checkin',false]);
  const marker=plain(h.parseHistoryEntry('SetVirtualAppt by Me'));
  assert.deepEqual([marker.kind,marker.dates.length,marker.scheduled,marker.action],['other',0,false,'SetVirtualAppt']);
  assert.equal(h.parseHistoryEntry('No Answer on Sep 23 2026 12:05 AM by Me').dates[0].at,ct(23,0,5));
  assert.equal(h.parseHistoryEntry('Schedule Call Back appointment on Sep 25 2026 - 02:30 PM by Me').dates[0].at,ct(25,14,30));
  assert.equal(h.parseHistoryEntry('Schedule Call Back appointment on Sep 25 2026 - Morning by Me').preference,'Morning');
  assert.equal(h.parseHistoryEntry('Callback on 09/25/2026 10:15 AM by Me.').dates[0].at,ct(25,10,15));
  assert.equal(h.parseHistoryEntry('Comment · 9/24/2026 7:56:31 PM IMV').dates[0].at,ct(24,19,56));
  assert.equal(h.findDates('On Feb 30 2026 by Me').length,0,'impossible dates are ignored');
  for (const line of realLead) assert.ok(!['bad-number','refused','appointment-missed'].includes(h.classifyEntry(line)),`no false warning: ${line}`);
  assert.equal(h.classifyEntry('Refused Appointment on Sep 23 2026 04:48 PM by Me.'),'refused');
  assert.equal(h.classifyEntry('Bad Number on Sep 20 2026 09:00 AM by Me.'),'bad-number');
  assert.equal(h.classifyEntry('Appointment cancelled on Sep 23 2026 04:48 PM by Me.'),'appointment-missed');
});

test('IMPACT times respect Central daylight saving time', ()=>{
  const h=highlights();
  const at=line=>h.findDates(line)[0].at;
  assert.equal(at('Jan 15 2026 03:00 PM'),Date.UTC(2026,0,15,21),'CST = UTC-6');
  assert.equal(at('Mar 7 2026 03:00 PM'),Date.UTC(2026,2,7,21),'day before DST starts');
  assert.equal(at('Mar 9 2026 03:00 PM'),Date.UTC(2026,2,9,20),'day after DST starts');
  assert.equal(at('Mar 8 2026 03:30 AM'),Date.UTC(2026,2,8,8,30),'just after the spring-forward change');
  assert.equal(at('Nov 2 2026 09:00 AM'),Date.UTC(2026,10,2,15),'after DST ends');
  // Arizona has no DST: 3 PM CDT = 1 PM in Phoenix in September.
  assert.equal(h.formatWhen(ct(22,15),true,{zones:h.resolveZones({phoneTimeZone:'America/Phoenix'})}),'Tue, Sep 22, 1:00 PM');
});

test('real lead, Central phone, Sep 24 10:00 AM CT: times exactly as IMPACT lists them', ()=>{
  const chips=heads(realLead,now);
  assert.deepEqual(summary(chips),[
    'Callback due today | Today · No time preference | Call back any time today',
    'Had appointment | Tue, Sep 22, 3:00 PM | Virtual appointment · 2 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 9:38 PM · yesterday',
    'Recent activity | Checkin | Tue, Sep 22, 4:41 PM · 2 days ago'
  ]);
  assert.deepEqual(chips.map(c=>c.tone),['callback','neutral','neutral','neutral']);
  assert.equal(chips[0].soon,true);
  assert.ok(!chips.some(c=>c.tone==='danger'),'no false warnings');
  // A date-only callback is due for the whole Central day.
  assert.equal(heads(realLead,ct(24,23,59))[0].label,'Callback due today');
  assert.equal(heads(realLead,ct(25,0,5))[0].label,'Callback date passed');
});

test('the lead\'s impactTimeZone (e.g. Eastern from the extension) is ignored', ()=>{
  const h=highlights();
  for (const impactTimeZone of ['America/New_York','America/Los_Angeles']) {
    assert.deepEqual(summary(heads(realLead,now,{...central,impactTimeZone})),summary(heads(realLead,now)));
    assert.equal(h.localTimeNote(realLead[0],{...central,impactTimeZone}),'');
  }
});

test('the same lead on an Eastern or Pacific phone shows phone time with the IMPACT (Central) clock', ()=>{
  assert.deepEqual(summary(heads(realLead,now,{phoneTimeZone:'America/New_York'})).slice(1,3),[
    'Had appointment | Tue, Sep 22, 4:00 PM (3:00 PM CT) | Virtual appointment · 2 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 10:38 PM · yesterday'
  ]);
  assert.deepEqual(summary(heads(realLead,now,{phoneTimeZone:'America/Los_Angeles'})).slice(1,3),[
    'Had appointment | Tue, Sep 22, 1:00 PM (3:00 PM CT) | Virtual appointment · 2 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 7:38 PM · yesterday'
  ]);
});

test('real lead on Sep 25: the callback date has passed and the appointment is past', ()=>{
  assert.deepEqual(summary(heads(realLead,ct(25))),[
    'Callback date passed | Thu, Sep 24 · No time preference | yesterday',
    'Had appointment | Tue, Sep 22, 3:00 PM | Virtual appointment · 3 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 9:38 PM · 2 days ago',
    'Recent activity | Checkin | Tue, Sep 22, 4:41 PM · 3 days ago'
  ]);
});

test('real lead on Sep 21: the virtual appointment is upcoming and soon, the callback is set', ()=>{
  const chips=heads(realLead,ct(21));
  assert.deepEqual(summary(chips),[
    'Upcoming appointment | Tue, Sep 22, 3:00 PM | Virtual appointment · tomorrow',
    'Callback set | Thu, Sep 24 · No time preference | in 3 days'
  ]);
  assert.deepEqual(chips.map(c=>[c.tone,c.soon]),[['appointment',true],['callback',false]]);
});

test('relative labels use the real time: "min ago", "2 today", and Central days for date-only callbacks', ()=>{
  const chips=heads(realLead,ct(23,22));
  assert.equal(chips.find(c=>c.label==='Previous tries').detail,'Last Sep 23, 9:38 PM · 22 min ago · 2 today');
  assert.equal(chips[0].label,'Callback set');
  assert.equal(chips[0].detail,'tomorrow');
  assert.equal(heads(realLead,ct(23,23,30))[0].label,'Callback set','11:30 PM Central is still Sep 23');
  const h=highlights();
  const zones=h.resolveZones(central);
  assert.equal(h.relativeTime(now+30*60000,now,true,zones),'in 30 min');
  assert.equal(h.relativeTime(ct(24,13),now,true,zones),'in 3 hrs');
  assert.equal(h.relativeTime(ct(24,0),now,false,zones),'today');
  assert.equal(h.relativeTime(ct(23,0),now,false,zones),'yesterday');
});

test('the newest scheduled line wins, and appointments today show their time', ()=>{
  const chips=heads([
    'Reschedule appointment on Sep 24 2026 06:30 PM by Me',
    'Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me',
    'Schedule Call Back appointment on Sep 26 2026 - Afternoon by Me',
    'Schedule Call Back appointment on Sep 25 2026 - No Time Preference by Me'
  ],now);
  assert.deepEqual(summary(chips),[
    'Appointment today | Today, 6:30 PM | Appointment (rescheduled) · in 9 hrs',
    'Callback set | Sat, Sep 26 · Afternoon | in 2 days'
  ]);
  assert.equal(chips[0].soon,true);
  assert.equal(heads(impactHistory,now)[0].label,'Had appointment');
  assert.equal(heads(['Schedule Virtual Appointment on Aug 01 2026 03:00 PM by Me'],now).length,0,'old appointments are not shown');
  assert.equal(heads(['Schedule Virtual Appointment on Sep 24 2026 10:30 AM by Me'],ct(24,10,40))[0].label,'Had appointment');
});

test('warnings, lines without dates and run-together lines are handled', ()=>{
  const h=highlights();
  const chips=heads(['No Answer on Sep 23 2026 04:48 PM by Me.','Bad Number on Sep 20 2026 09:00 AM by Me.'],now);
  assert.deepEqual(chips.map(c=>[c.tone,c.label]),[['danger','Check the number'],['neutral','Previous tries']]);
  assert.equal(chips[0].detail,'Sun, Sep 20, 9:00 AM · 4 days ago');
  assert.equal(heads(['Refused Appointment on Sep 10 2026 11:00 AM by Me.'],now)[0].label,'Refused before');
  assert.deepEqual(heads(['SetVirtualAppt by Me'],now),[]);
  assert.deepEqual(heads([],now),[]);
  assert.deepEqual(heads(undefined,now),[]);
  assert.equal(heads(['No Answer yesterday'],now)[0].title,'1 no answer');
  assert.equal(h.splitHistory([realLead.join(' ')]).length,9);
  assert.equal(h.splitHistory([realLead.join('')]).length,9);
  assert.deepEqual(plain(h.splitHistory(['No Answer on Sep 23 2026 04:48 PM by Me. Comment · 9/24/2026 7:56:31 PM IMV'])),['No Answer on Sep 23 2026 04:48 PM by Me.','Comment · 9/24/2026 7:56:31 PM IMV']);
  assert.deepEqual(summary(heads([realLead.join(' ')],now)),summary(heads(realLead,now)));
});

test('Previous activity and comments: no notes on a Central phone, own time elsewhere', ()=>{
  const h=highlights();
  for (const line of [...realLead,'Comment · 9/24/2026 7:56:31 PM IMV']) assert.equal(h.localTimeNote(line,central),'',line);
  const eastern={phoneTimeZone:'America/New_York'};
  assert.equal(h.localTimeNote(realLead[0],eastern),'10:38 PM your time');
  assert.equal(h.localTimeNote('Comment · 9/24/2026 7:56:31 PM IMV',eastern),'8:56 PM your time');
  assert.equal(h.localTimeNote('No Answer on Sep 23 2026 11:05 PM by Me',eastern),'Sep 24, 12:05 AM your time');
  assert.equal(h.localTimeNote(realLead[2],eastern),'','date-only lines have no time to convert');
  assert.equal(h.localTimeNote(realLead[0],{phoneTimeZone:'America/Los_Angeles'}),'7:38 PM your time');
});

test('history captured by the extension flows straight into the heads-up', ()=>{
  const source=read('extension/src/content/impact-diagnostic.js');
  const fn=source.slice(source.indexOf('  function collectCallHistory('),source.indexOf('  async function prefetchNextLead('));
  const extension=vm.createContext({sanitizeText:value=>value.replace(/\s+/g,' ').trim()});
  vm.runInContext(fn,extension);
  const history=extension.collectCallHistory({querySelectorAll:()=>[{textContent:'Show Less... Status '+realLead.join('\n')}]});
  assert.deepEqual(heads(history,now).map(c=>c.label),['Callback due today','Had appointment','Previous tries','Recent activity']);
});

test('the phone lead card shows heads-up chips above the details and hides them when empty', async()=>{
  const elements=new Map();
  const make=()=>({children:[],listeners:{},value:'',hidden:false,open:true,disabled:false,textContent:'',className:'',attributes:{},
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,fn){this.listeners[name]=fn;}});
  const el=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  let authChanged;
  const lead={available:true,leadId:'test-a',leadName:'Fictional A',requestType:'Sample request',language:'English',email:'fictional@example.test',callHistory:realLead,phones:[{label:'Mobile',number:'555-0100',dialHref:'#sample-call'}]};
  lead.comments=['Comment · 9/24/2026 7:56:31 PM IMV'];
  lead.impactTimeZone='America/New_York'; // sent by the extension, ignored by the phone
  let state={lead,desktop_seen:new Date().toISOString(),lead_updated_at:new Date().toISOString(),device_id:'test-computer'};
  class FakeDate extends Date{constructor(...a){super(...(a.length?a:[now]));} static now(){return now;}}
  const context=vm.createContext({
    client:{auth:{onAuthStateChange:fn=>{authChanged=fn;}}}, saveLeadSchedule:async()=>false, saveAppointmentChoice:async()=>false, encourageLead:()=>{}, encourageResult:()=>{}, cloudEnabled:async()=>true,
    cloudState:async()=>state,cloudTouchPhone:async()=>{}, cloudSend:async()=>{},
    watchCloud:async()=>()=>{},visibleLead:s=>s?.lead,isOnline:()=>true,
    document:{querySelector:selector=>selector.startsWith('meta')?null:el(selector),createElement:make,addEventListener(){}},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{search:'',origin:'https://example.test',replace(){}},
    URLSearchParams, Date:FakeDate, crypto:require('node:crypto'), setInterval(){},setTimeout(){}, console
  });
  for(const file of ['time-zone.js','pending-call.js','phone-actions.js','lead-highlights.js','lead-rules.js','settings-store.js','lead-transition.js']) vm.runInContext(strip(read(`phone-web/public/${file}`)),context);
  const app=await vm.runInContext(`(async()=>{${read('phone-web/public/app.js').replace(/^import .*;\r?\n/gm,'')}\nreturn {refreshCloud};})()`,context);
  authChanged('SIGNED_IN',{user:{id:'test-user'}});
  await new Promise(setImmediate);
  const card=el('#leadCard').children;
  const names=card.map(c=>c.className||c.textContent);
  assert.equal(card.some(c=>c.children?.[0]?.textContent==='Language'),false,'English is omitted to keep the lead card compact');
  const headsUp=card.find(c=>String(c.className).includes('headsUp'));
  const comments=card.find(c=>String(c.className).includes('leadNotes'));
  assert.ok(headsUp,'heads-up section rendered');
  assert.equal(comments.children[0].textContent,'IMPACT COMMENT');
  assert.equal(comments.children[1].textContent,'Comment · 9/24/2026 7:56:31 PM IMV');
  // The rep's own time is added beside IMPACT's only when the phone is not on Central time.
  const commentNote=context.localTimeNote('Comment · 9/24/2026 7:56:31 PM IMV',{});
  assert.deepEqual(comments.children[1].children.map(c=>c.textContent),commentNote?[` · ${commentNote}`]:[]);
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
  assert.equal(el('#historyEntries').children[2].children.length,0,'date-only lines get no time note');
  const firstNote=context.localTimeNote(realLead[0],{});
  assert.deepEqual(el('#historyEntries').children[0].children.map(c=>[c.className,c.textContent]),firstNote?[['localTimeNote',` · ${firstNote}`]]:[]);
  state={...state,lead:{...lead,leadId:'test-b',callHistory:[]}};
  await app.refreshCloud();
  assert.equal(el('#leadCard').children.some(c=>String(c.className).includes('headsUp')),false);
  state={...state,lead:{...lead,leadId:'test-d',language:'Spanish',callHistory:[]}};
  await app.refreshCloud();
  assert.equal(el('#leadCard').children.some(c=>c.children?.[0]?.textContent==='Language'),true,'a non-English language remains visible');
});
