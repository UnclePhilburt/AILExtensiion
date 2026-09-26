const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('phone-web/public/lead-swipe.js','utf8').replace(/^export /gm,''),context);
test('clear horizontal swipes turn one page in the intended direction',()=>{
  assert.equal(context.swipeDirection(-120,12,300),'next');
  assert.equal(context.swipeDirection(120,-10,300),'previous');
});
test('scrolls, diagonal drags, taps and long holds never turn a page',()=>{
  for(const args of [[20,0,200],[120,70,300],[86,40,300],[100,0,1200],[100,0,30]]) assert.equal(context.swipeDirection(...args),'');
});
