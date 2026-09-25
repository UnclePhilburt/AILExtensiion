const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../phone-web/public',file),'utf8');
const strip=source=>source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');

const context=vm.createContext({Intl,Date,Math,JSON});
vm.runInContext(['time-zone.js','lead-highlights.js','calendar-events.js','encouragement-lines.js','encouragement.js','home-view.js'].map(f=>strip(read(f))).join('\n')
  +'\n;globalThis.api={displayName,greeting,dateLine,todaySummary};',context);
const api=context.api;
const central=(hour,minute=0)=>Date.parse('2026-09-24T00:00:00-05:00')+(hour*60+minute)*60000;

test('greeting follows Central time of day, with a name only when the account has one', ()=>{
  assert.equal(api.greeting(central(8)),'Good morning');
  assert.equal(api.greeting(central(13)),'Good afternoon');
  assert.equal(api.greeting(central(20,30)),'Good evening');
  assert.equal(api.greeting(central(23)),'Welcome back');
  assert.equal(api.greeting(central(20),'Cody'),'Good evening, Cody');
  assert.equal(api.dateLine(central(20)),'Thursday, September 24');
});

test('the name comes from profile data only, never guessed from the email', ()=>{
  assert.equal(api.displayName({email:'cody@example.test'}),'');
  assert.equal(api.displayName({email:'cody@example.test',user_metadata:{}}),'');
  assert.equal(api.displayName({user_metadata:{full_name:'Cody Smith'}}),'Cody');
  assert.equal(api.displayName({user_metadata:{first_name:'  Cody '}}),'Cody');
  assert.equal(api.displayName({user_metadata:{name:'cody@example.test'}}),'');
  assert.equal(api.displayName({user_metadata:{full_name:42}}),'');
  assert.equal(api.displayName(null),'');
});

test('today line counts only today\'s Central-day entries, and anything odd keeps the default caption', ()=>{
  const at=(hour,minute=0)=>new Date(central(hour,minute)).toISOString();
  const rows=[
    {id:1,kind:'virtual-appointment',starts_at:at(9,30),all_day:false},
    {id:2,kind:'callback',starts_at:at(0),all_day:true},
    {id:3,kind:'appointment',starts_at:at(16),all_day:false},
    {id:4,kind:'callback',starts_at:at(24+11),all_day:false},  // tomorrow
    {id:5,kind:'callback',starts_at:at(-2),all_day:false},     // yesterday 10 PM
    {id:6,kind:'mystery',starts_at:at(10)}, {id:7,kind:'callback',starts_at:'nope'}
  ];
  assert.equal(api.todaySummary(rows,central(20)),'2 appointments · 1 callback today');
  assert.equal(api.todaySummary(rows.slice(1,2),central(20)),'1 callback today');
  assert.equal(api.todaySummary([],central(20)),'Nothing scheduled today');
  assert.equal(api.todaySummary(null,central(20)),'');
});

test('Home keeps every way in: workspace, sign in, account, calendar, statistics, settings, setup, privacy', ()=>{
  const html=read('index.html');
  for(const href of ['workspace.html','account.html?next=workspace.html','account.html','calendar.html?from=home','statistics.html','settings.html?from=home','start.html','privacy.html'])
    assert.ok(html.includes(`href="${href}"`),href);
  for(const id of ['signedIn','signedOut','homeShortcuts','accountName','homeStatus','homeGreeting','homeDate','calendarToday']) assert.match(html,new RegExp(`id="${id}"`),id);
  assert.match(html,/data-encourage="home"/);
  const js=read('home.js');
  assert.match(js,/signedIn\.hidden = !ready; signedOut\.hidden = ready; shortcuts\.hidden = !ready;/);
  assert.match(js,/if \(queryError\) return;/,'calendar problems stay silent');
  const css=read('home.css');
  assert.match(css,/prefers-reduced-motion: reduce\)[^}]*\.homeBand \{ animation: none; \}/);
  assert.doesNotMatch(css,/\.homeStatus \{[^}]*#d0eade/,'status text is not light-on-light any more');
});
