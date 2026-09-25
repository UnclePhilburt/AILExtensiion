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
// Eastern (IMPACT's default) = UTC-4, Central = UTC-5, Pacific = UTC-7.
const et=(day,hour=10,minute=0)=>Date.UTC(2026,8,day,hour+4,minute);
const ct=(day,hour=10,minute=0)=>Date.UTC(2026,8,day,hour+5,minute);
const now=ct(24); // Sep 24 2026 10:00 AM Central = 11:00 AM Eastern
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

test('real IMPACT Status lines parse as IMPACT (Eastern) wall-clock times', ()=>{
  const h=highlights();
  const callback=plain(h.parseHistoryEntry(realLead[2]));
  assert.equal(callback.kind,'callback');
  assert.equal(callback.scheduled,true);
  assert.equal(callback.action,'Schedule Call Back appointment');
  assert.equal(callback.preference,'No time preference');
  assert.deepEqual([callback.dates[0].at,callback.dates[0].hasTime],[et(24,0),false],'date-only = IMPACT midnight');
  const appointment=plain(h.parseHistoryEntry(realLead[7]));
  assert.deepEqual([appointment.kind,appointment.scheduled,appointment.type,appointment.preference],['appointment',true,'Virtual','']);
  assert.equal(appointment.dates[0].at,et(22,15));
  assert.equal(appointment.dates[0].at,ct(22,14),'3:00 PM Eastern is 2:00 PM Central');
  const reschedule=plain(h.parseHistoryEntry(impactHistory[2]));
  assert.deepEqual([reschedule.kind,reschedule.reschedule,reschedule.dates[0].at],['appointment',true,et(22,18,30)]);
  assert.deepEqual([h.classifyEntry(realLead[3]),h.parseHistoryEntry(realLead[3]).scheduled],['checkin',false]);
  const marker=plain(h.parseHistoryEntry('SetVirtualAppt by Me'));
  assert.deepEqual([marker.kind,marker.dates.length,marker.scheduled,marker.action],['other',0,false,'SetVirtualAppt']);
  assert.equal(h.parseHistoryEntry('No Answer on Sep 23 2026 12:05 AM by Me').dates[0].at,et(23,0,5));
  assert.equal(h.parseHistoryEntry('Schedule Call Back appointment on Sep 25 2026 - 02:30 PM by Me').dates[0].at,et(25,14,30));
  assert.equal(h.parseHistoryEntry('Schedule Call Back appointment on Sep 25 2026 - Morning by Me').preference,'Morning');
  assert.equal(h.parseHistoryEntry('Callback on 09/25/2026 10:15 AM by Me.').dates[0].at,et(25,10,15));
  assert.equal(h.parseHistoryEntry('Comment · 9/24/2026 7:56:31 PM IMV').dates[0].at,et(24,19,56));
  assert.equal(h.findDates('On Feb 30 2026 by Me').length,0,'impossible dates are ignored');
  // Another IMPACT zone.
  assert.equal(h.parseHistoryEntry(realLead[7],'America/Chicago').dates[0].at,ct(22,15));
  assert.equal(h.parseHistoryEntry(realLead[7],'America/Los_Angeles').dates[0].at,Date.UTC(2026,8,22,22));
  assert.equal(h.parseHistoryEntry(realLead[7],'Bad/Zone').dates[0].at,et(22,15),'unknown zones fall back to Eastern');
  for (const line of realLead) assert.ok(!['bad-number','refused','appointment-missed'].includes(h.classifyEntry(line)),`no false warning: ${line}`);
  assert.equal(h.classifyEntry('Refused Appointment on Sep 23 2026 04:48 PM by Me.'),'refused');
  assert.equal(h.classifyEntry('Bad Number on Sep 20 2026 09:00 AM by Me.'),'bad-number');
  assert.equal(h.classifyEntry('Appointment cancelled on Sep 23 2026 04:48 PM by Me.'),'appointment-missed');
});

test('IMPACT times respect daylight saving time', ()=>{
  const h=highlights();
  const at=line=>h.findDates(line)[0].at;
  assert.equal(at('Jan 15 2026 03:00 PM'),Date.UTC(2026,0,15,20),'EST = UTC-5');
  assert.equal(at('Mar 7 2026 03:00 PM'),Date.UTC(2026,2,7,20),'day before DST starts');
  assert.equal(at('Mar 9 2026 03:00 PM'),Date.UTC(2026,2,9,19),'day after DST starts');
  assert.equal(at('Mar 8 2026 03:30 AM'),Date.UTC(2026,2,8,7,30),'just after the spring-forward change');
  assert.equal(at('Nov 2 2026 09:00 AM'),Date.UTC(2026,10,2,14),'after DST ends');
  // Arizona has no DST while Eastern does: 3 PM ET = 12 PM in Phoenix in September.
  assert.equal(h.formatWhen(et(22,15),true,{zones:h.resolveZones({phoneTimeZone:'America/Phoenix'})}),'Tue, Sep 22, 12:00 PM');
});

test('real lead, Central phone, Sep 24 10:00 AM CT: times shown in Central, IMPACT clock on scheduled times', ()=>{
  const chips=heads(realLead,now);
  assert.deepEqual(summary(chips),[
    'Callback due today | Today · No time preference | Call back any time today',
    'Had appointment | Tue, Sep 22, 2:00 PM (3:00 PM ET) | Virtual appointment · 2 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 8:38 PM · yesterday',
    'Recent activity | Checkin | Tue, Sep 22, 3:41 PM · 2 days ago'
  ]);
  assert.deepEqual(chips.map(c=>c.tone),['callback','neutral','neutral','neutral']);
  assert.equal(chips[0].soon,true);
  assert.ok(!chips.some(c=>c.tone==='danger'),'no false warnings');
  // A date-only callback is due for IMPACT's whole calendar day: until midnight Eastern (11 PM Central).
  assert.equal(heads(realLead,ct(24,22,59))[0].label,'Callback due today');
  assert.equal(heads(realLead,ct(24,23,5))[0].label,'Callback date passed');
});

test('the same lead on an Eastern or Pacific phone', ()=>{
  assert.deepEqual(summary(heads(realLead,now,{phoneTimeZone:'America/New_York'})),[
    'Callback due today | Today · No time preference | Call back any time today',
    'Had appointment | Tue, Sep 22, 3:00 PM | Virtual appointment · 2 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 9:38 PM · yesterday',
    'Recent activity | Checkin | Tue, Sep 22, 4:41 PM · 2 days ago'
  ]);
  assert.deepEqual(summary(heads(realLead,now,{phoneTimeZone:'America/Los_Angeles'})).slice(1,3),[
    'Had appointment | Tue, Sep 22, 12:00 PM (3:00 PM ET) | Virtual appointment · 2 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 6:38 PM · yesterday'
  ]);
});

test('IMPACT set to Central: a Central phone shows IMPACT times unchanged', ()=>{
  const chips=heads(realLead,now,{...central,impactTimeZone:'America/Chicago'});
  assert.deepEqual(summary(chips).slice(1),[
    'Had appointment | Tue, Sep 22, 3:00 PM | Virtual appointment · 2 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 9:38 PM · yesterday',
    'Recent activity | Checkin | Tue, Sep 22, 4:41 PM · 2 days ago'
  ]);
  const pacificImpact=heads(realLead,now,{...central,impactTimeZone:'America/Los_Angeles'});
  assert.equal(pacificImpact[1].title,'Tue, Sep 22, 5:00 PM (3:00 PM PT)');
});

test('real lead on Sep 25: the callback date has passed and the appointment is past', ()=>{
  assert.deepEqual(summary(heads(realLead,ct(25))),[
    'Callback date passed | Thu, Sep 24 · No time preference | yesterday',
    'Had appointment | Tue, Sep 22, 2:00 PM (3:00 PM ET) | Virtual appointment · 3 days ago',
    'Previous tries | 5 no answers | Last Sep 23, 8:38 PM · 2 days ago',
    'Recent activity | Checkin | Tue, Sep 22, 3:41 PM · 3 days ago'
  ]);
});

test('real lead on Sep 21: the virtual appointment is upcoming and soon, the callback is set', ()=>{
  const chips=heads(realLead,ct(21));
  assert.deepEqual(summary(chips),[
    'Upcoming appointment | Tue, Sep 22, 2:00 PM (3:00 PM ET) | Virtual appointment · tomorrow',
    'Callback set | Thu, Sep 24 · No time preference | in 3 days'
  ]);
  assert.deepEqual(chips.map(c=>[c.tone,c.soon]),[['appointment',true],['callback',false]]);
});

test('relative labels use the real time: "min ago", "2 today", and IMPACT days for date-only callbacks', ()=>{
  // 9:00 PM Central = 10:00 PM Eastern; the last try was 9:38 PM Eastern = 8:38 PM Central.
  const chips=heads(realLead,ct(23,21));
  assert.equal(chips.find(c=>c.label==='Previous tries').detail,'Last Sep 23, 8:38 PM · 22 min ago · 2 today');
  assert.equal(chips[0].label,'Callback set');
  assert.equal(chips[0].detail,'tomorrow');
  // 11:30 PM Central is already Sep 24 in IMPACT, so the Sep 24 callback is due.
  assert.equal(heads(realLead,ct(23,23,30))[0].label,'Callback due today');
  const h=highlights();
  const zones=h.resolveZones(central);
  assert.equal(h.relativeTime(now+30*60000,now,true,zones),'in 30 min');
  assert.equal(h.relativeTime(et(24,14),now,true,zones),'in 3 hrs','2:00 PM Eastern is 3 hours after 10:00 AM Central');
  assert.equal(h.relativeTime(et(24,0),now,false,zones),'today');
  assert.equal(h.relativeTime(et(23,0),now,false,zones),'yesterday');
});

test('the newest scheduled line wins, and appointments today show their time', ()=>{
  const h=highlights();
  const chips=heads([
    'Reschedule appointment on Sep 24 2026 06:30 PM by Me',
    'Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me',
    'Schedule Call Back appointment on Sep 26 2026 - Afternoon by Me',
    'Schedule Call Back appointment on Sep 25 2026 - No Time Preference by Me'
  ],now);
  assert.deepEqual(summary(chips),[
    'Appointment today | Today, 5:30 PM (6:30 PM ET) | Appointment (rescheduled) · in 8 hrs',
    'Callback set | Sat, Sep 26 · Afternoon | in 2 days'
  ]);
  assert.equal(chips[0].soon,true);
  assert.equal(heads(impactHistory,now)[0].label,'Had appointment');
  assert.equal(heads(['Schedule Virtual Appointment on Aug 01 2026 03:00 PM by Me'],now).length,0,'old appointments are not shown');
  // An appointment at 11:30 AM Eastern has already started for a 10:40 AM Central phone.
  assert.equal(heads(['Schedule Virtual Appointment on Sep 24 2026 11:30 AM by Me'],ct(24,10,40))[0].label,'Had appointment');
});

test('warnings, lines without dates and run-together lines are handled', ()=>{
  const h=highlights();
  const chips=heads(['No Answer on Sep 23 2026 04:48 PM by Me.','Bad Number on Sep 20 2026 09:00 AM by Me.'],now);
  assert.deepEqual(chips.map(c=>[c.tone,c.label]),[['danger','Check the number'],['neutral','Previous tries']]);
  assert.equal(chips[0].detail,'Sun, Sep 20, 8:00 AM · 4 days ago');
  assert.equal(heads(['Refused Appointment on Sep 10 2026 11:00 AM by Me.'],now)[0].label,'Refused before');
  assert.deepEqual(heads(['SetVirtualAppt by Me'],now),[]);
  assert.deepEqual(heads([],now),[]);
  assert.deepEqual(heads(undefined,now),[]);
  assert.equal(heads(['No Answer yesterday'],now)[0].title,'1 no answer');
  // If IMPACT's text arrives as one run-together string, the lines are split back apart.
  assert.equal(h.splitHistory([realLead.join(' ')]).length,9);
  assert.equal(h.splitHistory([realLead.join('')]).length,9);
  assert.deepEqual(plain(h.splitHistory(['No Answer on Sep 23 2026 04:48 PM by Me. Comment · 9/24/2026 7:56:31 PM IMV'])),['No Answer on Sep 23 2026 04:48 PM by Me.','Comment · 9/24/2026 7:56:31 PM IMV']);
  assert.deepEqual(summary(heads([realLead.join(' ')],now)),summary(heads(realLead,now)));
});

test('Previous activity and comments get the rep\'s own time beside IMPACT\'s', ()=>{
  const h=highlights();
  assert.equal(h.localTimeNote(realLead[0],central),'8:38 PM your time');
  assert.equal(h.localTimeNote(realLead[7],central),'2:00 PM your time');
  assert.equal(h.localTimeNote('Comment · 9/24/2026 7:56:31 PM IMV',central),'6:56 PM your time');
  assert.equal(h.localTimeNote('No Answer on Sep 23 2026 12:05 AM by Me',central),'Sep 22, 11:05 PM your time');
  assert.equal(h.localTimeNote(realLead[2],central),'','date-only lines have no time to convert');
  assert.equal(h.localTimeNote('SetVirtualAppt by Me',central),'');
  assert.equal(h.localTimeNote(realLead[0],{phoneTimeZone:'America/New_York'}),'','same clock: no note');
  assert.equal(h.localTimeNote(realLead[0],{...central,impactTimeZone:'America/Chicago'}),'');
  assert.equal(h.localTimeNote(realLead[0],{phoneTimeZone:'America/Los_Angeles'}),'6:38 PM your time');
});

test('history captured by the extension flows straight into the heads-up', ()=>{
  const source=read('extension/src/content/impact-diagnostic.js');
  const fn=source.slice(source.indexOf('  function collectCallHistory('),source.indexOf('  async function prefetchNextLead('));
  const extension=vm.createContext({sanitizeText:value=>value.replace(/\s+/g,' ').trim()});
  vm.runInContext(fn,extension);
  const history=extension.collectCallHistory({querySelectorAll:()=>[{textContent:'Show Less... Status '+realLead.join('\n')}]});
  const chips=heads(history,now);
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
  lead.comments=['Comment · 9/24/2026 7:56:31 PM IMV'];
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
  for(const file of ['time-zone.js','pending-call.js','phone-actions.js','lead-highlights.js','lead-rules.js']) vm.runInContext(strip(read(`phone-web/public/${file}`)),context);
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
  // The rep's own time is added beside IMPACT's when the phone's clock differs from Eastern.
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
