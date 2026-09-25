const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../phone-web/public',file),'utf8');
const headerOf=html=>html.slice(html.indexOf('<header'),html.indexOf('</header>'));
const PAGES=[['calendar.html','calendar.css','calendarPage'],['statistics.html','stats.css','statsPage']];

test('Calendar and Statistics use the shared calm layout of Home and the Workspace', ()=>{
  const css=read('styles.css');
  assert.match(css,/\.app\.workspace, \.app\.calmApp \{ display: block;/,'one shared page shell');
  assert.match(css,/\.workspace :is\(\.leadCard, \.bridgeSetup, \.appointmentPicker, \.historyCard\), \.calmCard, \.statsSummary > div \{ border: 0; border-radius: 24px; background: #fff; box-shadow: 0 1px 2px #0b1f1c0f, 0 14px 34px #0b1f1c17; \}/,'one shared soft card style');
  for(const [page,pageCss,cls] of PAGES){
    const html=read(page);
    assert.match(html,new RegExp(`<body class="wsPage"><main class="app calmApp ${cls}">\\s*<div class="wsBand"><header class="wsHeader"><div class="workspaceTop calmTop">`),page);
    assert.match(html,/<\/header><\/div>\s*<div class="wsBody">/,`${page}: content sits in the shared body under the band`);
    assert.match(html,/class="[^"]*\bcalmCard\b/,`${page}: soft cards`);
    const own=read(pageCss);
    assert.doesNotMatch(own,/(^|[}\s])(header|\.backLink|\.statsStatus|\.wsBand|\.wsHeader)\s*\{/m,`${pageCss} does not restyle the shared header`);
    assert.doesNotMatch(own,/border(-left)?:\s*[1-5]px solid/,`${pageCss}: soft shadows and tints instead of hard borders`);
  }
});

test('the IMPACT logo links to Home; back links stay; no Account, Calendar or Settings links in the headers', ()=>{
  for(const [page] of PAGES){
    const header=headerOf(read(page));
    assert.match(header,/<a class="brand homeBrand" href="\.\/" aria-label="IMPACT Companion home"><span class="brandMark" aria-hidden="true">i\.<\/span> IMPACT <span class="brandSub">COMPANION<\/span><\/a>/,`${page}: logo goes Home`);
    assert.doesNotMatch(header,/account\.html|calendar\.html|settings\.html|accountLink|calendarLink|settingsLink|iconLink|headerLinks/,`${page}: no account/calendar/settings links`);
    const links=header.match(/<a [^>]*>/g);
    assert.equal(links.length,2,`${page}: only the logo and the back link`);
    assert.match(links[1],/class="backLink"/);
  }
  assert.match(headerOf(read('calendar.html')),/<a id="calendarBack" class="backLink" href="\.\/">← Home<\/a>/);
  assert.match(read('calendar.js'),/const BACK = \{ home: \['\.\/', '← Home'\], workspace: \['workspace\.html', '← Workspace'\], 'workspace-local': \['workspace\.html\?mode=local', '← Workspace'\] \};/,'back to Home, the Workspace or the local Workspace still works');
  assert.match(headerOf(read('statistics.html')),/<a class="backLink" href="index\.html">← Home<\/a>/);
  const css=read('styles.css');
  assert.match(css,/\.wsHeader \.backLink \{[^}]*min-height: 36px;[^}]*white-space: nowrap;/,'a soft back pill that never wraps');
  assert.match(css,/\.wsHeader \.calmTop \{ flex-wrap: wrap;/,'logo and back link can stack on very narrow screens');
});

test('every hook the page scripts use is still there', ()=>{
  const cal=read('calendar.html');
  for(const id of ['calendarBack','calendarStatus','calendarSetup','monthLabel','prevMonth','nextMonth','monthGrid','todayButton','dayHeading','dayList','upcomingHeading','upcomingList','calendarRefresh']) assert.match(cal,new RegExp(` id="${id}"`),id);
  const stats=read('statistics.html');
  for(const id of ['statsStatus','statsSummary','statsRows','statsRefresh']) assert.match(stats,new RegExp(` id="${id}"`),id);
  assert.match(cal,/data-encourage="calendar"/); assert.match(stats,/data-encourage="statistics"/);
  for(const [page] of PAGES) assert.match(read(page),/<script src="settings-boot\.js"><\/script><link rel="stylesheet" href="styles\.css">/);
});

test('Calendar: today and days with entries are marked gently; storage-not-set-up looks calm, not like an error', ()=>{
  const css=read('calendar.css');
  assert.match(css,/\.calCard \.calDay\.today \.calDayNumber \{[^}]*background:#dcefe5;/,'today: a soft tinted circle');
  assert.match(css,/\.calCard \.calDay:has\(\.dot\) \{[^}]*font-weight:700;/,'days with entries: slightly stronger number plus dots');
  assert.match(css,/\.calCard \.calDay\.selected \{[^}]*background:#f0f7f3;/);
  assert.match(css,/\.calEvent\.appointment \{[^}]*box-shadow:inset 3px 0 0/);
  const notice=css.split('\n').filter(line=>line.startsWith('.calNotice')).join('\n');
  assert.doesNotMatch(notice,/#d49534|#ecd3a4|#fff7e8|#6b4a0f/,'no warning-orange');
  assert.match(read('calendar.html'),/<section id="calendarSetup" class="calNotice calmCard" hidden><span class="calNoticeIcon" aria-hidden="true"><\/span>/);
  assert.match(css,/@media \(max-width: 440px\) \{ html\[data-text-size\] \.calEvent \{ grid-template-columns:minmax\(0, 1fr\);/,'large text on a phone keeps phone numbers inside the card');
});

test('Calendar and Statistics follow the text size; narrow phones get tighter padding', ()=>{
  const css=read('styles.css');
  assert.match(css,/:is\(\.workspace,\.calendarPage,\.statsPage,\.home\) \{ --text-zoom:1\.3; \}/);
  assert.match(css,/\.statsPage :is\(\.statsSummary,\.statsCard,\.statsNote\) \{ zoom:var\(--text-zoom, 1\); \}/);
  assert.match(css,/@media \(max-width: 360px\) \{ \.wsBand \{ padding-left: 12px;[^}]*\} \.wsBody \{ padding-left: 12px;/);
  assert.match(read('stats.css'),/@media \(max-width: 360px\)/); assert.match(read('calendar.css'),/@media \(max-width: 360px\)/);
  // Text placed directly on the page uses the background-aware ink colour.
  assert.match(read('calendar.css'),/\.calFootnote \{[^}]*color:var\(--page-ink\)/);
  assert.match(read('stats.css'),/\.statsNote \{[^}]*background:var\(--panel-bg\)/);
});
