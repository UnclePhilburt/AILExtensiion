const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('phone-web/public/lead-swipe.js','utf8').replace(/^export /gm,''),context);
test('deliberate horizontal swipes select the intended shortcut',()=>{
  assert.equal(context.swipeDirection(-120,12,300),'next');
  assert.equal(context.swipeDirection(120,-10,300),'previous');
});
test('scrolls, diagonal drags, taps and long holds never turn a page',()=>{
  for(const args of [[20,0,200],[120,70,300],[86,40,300],[100,0,6000],[100,0,30]]) assert.equal(context.swipeDirection(...args),'');
});

test('vertical swipes distinguish refused and callback, while diagonals cancel',()=>{
  assert.equal(context.swipeDirection(12,130,500),'refused');
  assert.equal(context.swipeDirection(12,-130,500),'callback');
  assert.equal(context.swipeDirection(120,120,500),'');
  assert.equal(context.swipeDirection(0,60,500),'');
});
test('gestures cancel for a changed lead, disabled state, interactive target and pointer cancellation',async()=>{
  let now=0,key='a',enabled=true,sent=[];const listeners={};
  const card={style:{},dataset:{},querySelector:()=>null,addEventListener:(k,fn)=>listeners[k]=fn};
  const c=vm.createContext({Date:{now:()=>now},innerWidth:400,document:{addEventListener(){}},Promise});
  vm.runInContext(fs.readFileSync('phone-web/public/lead-swipe.js','utf8').replace(/^export /gm,''),c);
  c.installLeadSwipe(card,{enabled:()=>enabled,currentKey:()=>key,navigate:d=>sent.push(d)});
  const e=(x=200,y=200,interactive=false)=>({pointerType:'touch',isPrimary:true,pointerId:1,clientX:x,clientY:y,target:{closest:()=>interactive}});
  listeners.pointerdown(e());now+=300;key='b';listeners.pointerup(e(70));
  listeners.pointerdown(e());now+=300;enabled=false;listeners.pointerup(e(70));enabled=true;
  listeners.pointerdown(e(200,200,true));now+=300;listeners.pointerup(e(70));
  listeners.pointerdown(e());listeners.pointercancel();now+=300;listeners.pointerup(e(70));
  assert.equal(sent.length,0);
  listeners.pointerdown(e());now+=300;listeners.pointerup(e(70));
  await new Promise(setImmediate);assert.deepEqual(sent,['next']);
});
