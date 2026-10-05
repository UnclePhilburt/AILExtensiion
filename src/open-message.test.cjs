const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('phone-web/public/open-message.js','utf8').replace(/^import .*;\r?\n/gm, '').replace('export function','function');
function setup(active){
 const elements=[];let now=0;
 const make=tag=>{const el={tag,style:{},events:{},children:[],setAttribute(){},append(...items){this.children.push(...items)},addEventListener(k,v){this.events[k]=v},showModal(){this.open=true},close(){this.events.close()},remove(){this.removed=true}};elements.push(el);return el;};
 const context=vm.createContext({attachMessageDebug:async()=>{},document:{querySelector:()=>elements.find(e=>e.id==='messageLauncher'&&!e.removed),createElement:make,body:make('body')},navigator:{userActivation:{isActive:active}},window:{location:{href:''}},Date:{now:()=>now}});
 vm.runInContext(source,context);return {context,elements,advance:()=>now=61000};
}
test('expired activation leaves an actual SMS link with the exact recipient and body',()=>{
 const {context,elements}=setup(false);const href='sms:3145550100?body=Hi%20Jane';context.openMessage(href);
 assert.equal(context.window.location.href,'');assert.equal(elements.find(e=>e.tag==='a').href,href);assert.equal(elements.find(e=>e.tag==='dialog').open,true);
 let prevented=false;elements.find(e=>e.tag==='a').events.click({preventDefault(){prevented=true}});assert.equal(prevented,false);
});
test('active gesture attempts opening immediately and leaves a fallback link',()=>{
 const {context,elements}=setup(true);context.openMessage('sms:3145550100&body=Hello');assert.equal(context.window.location.href,'sms:3145550100&body=Hello');assert.ok(elements.find(e=>e.tag==='a'));
});
test('old links require refreshing the prepared draft and close returns to the lead',()=>{
 const {context,elements,advance}=setup(false);context.openMessage('sms:3145550100');advance();let prevented=false;elements.find(e=>e.tag==='a').events.click({preventDefault(){prevented=true}});assert.equal(prevented,true);elements.find(e=>e.textContent==='Back to lead').events.click();assert.equal(elements.find(e=>e.tag==='dialog').removed,true);
});
test('non-text URLs cannot be launched',()=>{const {context}=setup(true);assert.throws(()=>context.openMessage('https://example.com'),/phone link/);});

test('Android uses a direct SENDTO intent with encoded body and a number-only fallback',()=>{
 const {context,elements}=setup(true);context.navigator.userAgent='Mozilla/5.0 Android';
 const body='Hi Jane; #Intent & Zoom?';context.openMessage('sms:+13145550100?body='+encodeURIComponent(body));
 const links=elements.filter(e=>e.tag==='a');
 assert.equal(links[0].href,'intent:+13145550100#Intent;scheme=smsto;action=android.intent.action.SENDTO;S.sms_body='+encodeURIComponent(body)+';end');
 assert.equal(links[1].href,'sms:+13145550100');assert.equal(context.window.location.href,'');
 assert.equal(elements.find(e=>e.tag==='textarea').value,body);
});
test('copy fallback preserves the exact prepared message',async()=>{
 const {context,elements}=setup(false);let copied='';context.navigator.clipboard={writeText:async text=>{copied=text}};
 context.openMessage('sms:3145550100?body=Hello%20Jane');await elements.find(e=>e.textContent==='Copy message').events.click();assert.equal(copied,'Hello Jane');
});

test('regular launch goes straight to Messages without a dialog or debug panel',()=>{const {context,elements}=setup(false);context.navigator.userAgent='Android';context.openMessage('sms:3145550100?body=Hello',{direct:true});assert.equal(context.window.location.href,'sms:3145550100?body=Hello');assert.equal(elements.filter(e=>e.tag==='dialog').length,0);});
