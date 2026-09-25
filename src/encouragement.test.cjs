const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../phone-web/public',file),'utf8');
const strip=source=>source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');

function load(){
  const context=vm.createContext({Intl,Date,Math,JSON});
  vm.runInContext(strip(read('time-zone.js'))+'\n'+strip(read('encouragement-lines.js'))+'\n'+strip(read('encouragement.js'))
    +'\n;globalThis.api={ENCOURAGEMENT_LINES,CATEGORIES,SEEN_KEY,SEEN_LIMIT,lineId,linesIn,allLines,timeOfDay,eventCategory,contextWeights,pickLine,loadSeen,rememberSeen,nextLine};',context);
  return context.api;
}
const api=load();
const memory=()=>({data:new Map(),getItem(k){return this.data.get(k)??null;},setItem(k,v){this.data.set(k,String(v));}});
// Central-time instants (September = CDT, UTC-5).
const central=hour=>Date.parse('2026-09-24T00:30:00-05:00')+hour*3600000;
const words=text=>text.trim().split(/\s+/).length;
const norm=text=>text.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();

const MINIMUMS={general:120,morning:35,afternoon:35,evening:35,lateNight:30,noAnswer:45,appointment:35,refused:40,waiting:40,calendar:30,statistics:30,settings:25,breathing:45};

test('the message bank is absurdly large: 600+ lines across every category', ()=>{
  const lines=api.allLines();
  assert.ok(lines.length>=600,`only ${lines.length} lines`);
  for(const [category,minimum] of Object.entries(MINIMUMS)){
    assert.ok(api.CATEGORIES.includes(category),`missing category ${category}`);
    assert.ok(api.linesIn(category).length>=minimum,`${category} has ${api.linesIn(category).length}, want ${minimum}+`);
  }
});

test('every line is non-empty, short enough for a phone, and unique', ()=>{
  const seenText=new Map(), seenIds=new Set();
  for(const line of api.allLines()){
    assert.equal(typeof line.text,'string');
    assert.ok(line.text.trim().length>0,'empty line');
    assert.equal(line.text,line.text.trim(),`stray spaces: "${line.text}"`);
    assert.ok(words(line.text)>=4&&words(line.text)<=18,`${words(line.text)} words: "${line.text}"`);
    assert.ok(line.text.length<=90,`${line.text.length} characters: "${line.text}"`);
    const key=norm(line.text);
    assert.ok(!seenText.has(key),`duplicate: "${line.text}" (${line.category}) and (${seenText.get(key)})`);
    seenText.set(key,line.category);
    assert.ok(!seenIds.has(line.id),`ID collision: ${line.id}`);
    seenIds.add(line.id);
  }
});

test('the tone rules hold: no attributions, quotes, profanity or hype words', ()=>{
  for(const line of api.allLines()){
    assert.doesNotMatch(line.text,/["“”]|\s[-–—]\s*[A-Z][a-z]+\s*$/,`looks like a quote or attribution: "${line.text}"`);
    assert.doesNotMatch(line.text,/\b(damn|hell|crap|crush it|killing it|grind|hustle|beast|pray|blessed|god|amen)\b/i,`off-tone: "${line.text}"`);
    assert.doesNotMatch(line.text,/!{1}/,`no exclamation hype: "${line.text}"`);
  }
});

test('time of day uses Central time: morning before noon, evening after 5 PM, late night after 10 PM', ()=>{
  assert.equal(api.timeOfDay(central(6)),'morning');
  assert.equal(api.timeOfDay(central(11)),'morning');
  assert.equal(api.timeOfDay(central(12)),'afternoon');
  assert.equal(api.timeOfDay(central(16)),'afternoon');
  assert.equal(api.timeOfDay(central(17)),'evening');
  assert.equal(api.timeOfDay(central(21)),'evening');
  assert.equal(api.timeOfDay(central(22)),'lateNight');
  assert.equal(api.timeOfDay(Date.parse('2026-09-25T07:30:00Z')),'lateNight'); // 2:30 AM Central
  assert.equal(api.timeOfDay(Date.parse('2026-01-15T17:30:00Z')),'morning'); // 11:30 AM CST
});

test('weights follow the context: page, waiting, time of day and the result just sent', ()=>{
  const at=central(9);
  const top=w=>Object.entries(w).sort((a,b)=>b[1]-a[1])[0][0];
  assert.equal(top(api.contextWeights({page:'calendar',now:at})),'calendar');
  assert.equal(top(api.contextWeights({page:'statistics',now:at})),'statistics');
  assert.equal(top(api.contextWeights({page:'settings',now:at})),'settings');
  assert.equal(top(api.contextWeights({page:'workspace',waiting:true,now:at})),'waiting');
  assert.ok(api.contextWeights({page:'home',now:at}).morning>0);
  assert.ok(api.contextWeights({page:'home',now:central(19)}).evening>0);
  assert.equal(api.contextWeights({page:'home',now:central(19)}).morning,undefined);
  assert.equal(top(api.contextWeights({page:'workspace',event:'no-answer',now:at})),'noAnswer');
  assert.equal(top(api.contextWeights({page:'workspace',event:'refused-appointment',now:at})),'refused');
  assert.equal(top(api.contextWeights({page:'workspace',event:'virtual-appointment-slot',now:at})),'appointment');
  assert.equal(api.eventCategory('virtual-appointment'),null,'opening the picker is not an appointment yet');
  assert.equal(api.eventCategory('next'),null);
});

test('picking is weighted: after No Answer almost every message is a No Answer line', ()=>{
  let seed=7; const random=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
  const counts={};
  for(let i=0;i<1000;i++){const line=api.pickLine({event:'no-answer',now:central(10),random});counts[line.category]=(counts[line.category]||0)+1;}
  assert.ok(counts.noAnswer>700,JSON.stringify(counts));
  assert.deepEqual(Object.keys(counts).sort(),['breathing','general','noAnswer']);
});

test('no repeats until a large share of the pool is seen (history ring in localStorage)', ()=>{
  const storage=memory(); let seed=11; const random=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
  const shown=[];
  for(let i=0;i<api.SEEN_LIMIT;i++) shown.push(api.nextLine(storage,{page:'home',now:central(14),random}).id);
  assert.equal(new Set(shown).size,shown.length,'200 in a row without a repeat');
  const saved=JSON.parse(storage.getItem(api.SEEN_KEY));
  assert.equal(saved.length,api.SEEN_LIMIT);
  api.nextLine(storage,{page:'home',now:central(14),random});
  assert.equal(JSON.parse(storage.getItem(api.SEEN_KEY)).length,api.SEEN_LIMIT,'ring stays capped');
  assert.equal(api.SEEN_KEY,'impact.encouragementSeen');
});

test('a used-up category steps aside; when everything is used up, the oldest line comes back', ()=>{
  const storage=memory(), size=api.linesIn('settings').length, order=[];
  // A category name as the event weights it first; random 0.01 always lands on the first category.
  for(let i=0;i<size;i++){const line=api.pickLine({event:'settings',seen:api.loadSeen(storage),random:()=>0.01});api.rememberSeen(storage,line.id);order.push(line);}
  assert.ok(order.every(line=>line.category==='settings'));
  assert.equal(new Set(order.map(line=>line.id)).size,size,'every settings line once, no repeats');
  const after=api.pickLine({event:'settings',seen:api.loadSeen(storage),random:()=>0.01});
  assert.notEqual(after.category,'settings','settings is used up, so another category in the mix takes over');
  const everything=['settings','breathing','general'].flatMap(c=>api.linesIn(c).map(line=>line.id));
  const oldest=api.pickLine({event:'settings',seen:everything,random:()=>0.01});
  assert.equal(oldest.id,everything[0],'all used up: the one seen longest ago');
});

test('broken or missing history is ignored safely', ()=>{
  const storage=memory();
  storage.setItem(api.SEEN_KEY,'not json');
  assert.deepEqual(Array.from(api.loadSeen(storage)),[]);
  storage.setItem(api.SEEN_KEY,JSON.stringify({a:1}));
  assert.deepEqual(Array.from(api.loadSeen(storage)),[]);
  assert.deepEqual(Array.from(api.loadSeen(null)),[]);
  const line=api.nextLine({getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}},{page:'home'});
  assert.ok(line.text);
});

test('pages show a line in the header, and the Workspace wires it outside the lead card', ()=>{
  for(const [file,page] of [['index.html','home'],['workspace.html','workspace'],['calendar.html','calendar'],['statistics.html','statistics'],['settings.html','settings']]){
    const html=read(file);
    assert.match(html,new RegExp(`data-encourage="${page}"`),`${file} has a line`);
    assert.match(html+read('app.js'),/encouragement-ui\.js/,`${file} loads the line script`);
  }
  const workspace=read('workspace.html');
  const lineAt=workspace.indexOf('data-encourage="workspace"'), cardAt=workspace.indexOf('id="leadCard"');
  assert.ok(lineAt>0&&lineAt<cardAt,'Workspace line is in the header, before the lead card');
  assert.match(workspace,/id="status"/,'IMPACT status text is still on the page');
  const ui=read('encouragement-ui.js');
  assert.match(ui,/showEncouragement/); assert.match(ui,/encourageAfterResults/);
  assert.match(ui,/prefers-reduced-motion/);
  const css=read('styles.css');
  assert.match(css,/\.encToast[^{]*\{[^}]*pointer-events:\s*none/,'the toast never blocks taps');
  assert.match(css,/\.encLine[^{]*\{[^}]*min-height/,'lines reserve their height (no layout shift)');
  assert.match(css,/prefers-reduced-motion/);
});
