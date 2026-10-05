const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const source=fs.readFileSync('phone-web/public/message-debug.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function setup(email,verifiedEmail=email){
 let verificationCalls=0,created=0;const listeners={};
 const make=()=>({style:{},dataset:{},children:[],listeners:{},setAttribute(){},append(...items){this.children.push(...items)},addEventListener(k,v){this.listeners[k]=v},removeEventListener(){},remove(){this.removed=true}});
 const dialog=make();dialog.isConnected=true;
 const context=vm.createContext({client:{auth:{getSession:async()=>({data:{session:email?{user:{id:'owner',email}}:null}}),getUser:async()=>{verificationCalls++;return {data:{user:{id:'owner',email:verifiedEmail}}}},onAuthStateChange:fn=>{listeners.auth=fn;return {data:{subscription:{unsubscribe(){}}}}}}},document:{createElement:()=>{created++;return make()},addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},navigator:{userAgent:'Android'},Date,setTimeout,clearTimeout});
 vm.runInContext(source,context);return {context,dialog,listeners,counts:()=>({verificationCalls,created})};
}
const args={href:'sms:3145550100?body=Private',number:'3145550100',body:'Private',launchHref:'intent:test',expires:Date.now()+60000};
test('other accounts and signed-out users receive no debug UI or listeners',async()=>{for(const email of [null,'someone@gmail.com','cody2931@other.com']){const h=setup(email);await h.context.attachMessageDebug(h.dialog,args);assert.deepEqual(h.counts(),{verificationCalls:0,created:0});}});
test('server-confirmed Cody account sees a report without customer details',async()=>{const h=setup('cody2931@gmail.com');await h.context.attachMessageDebug(h.dialog,args);assert.ok(h.counts().created>0);const panel=h.dialog.children[0];const report=panel.children.find(x=>x.value?.includes('text-debug-1'));assert.ok(report);assert.doesNotMatch(report.value,/3145550100|Private|cody2931/);h.listeners.auth('SIGNED_OUT',null);assert.equal(panel.removed,true);});
test('local account match alone cannot enable debug',async()=>{const h=setup('cody2931@gmail.com','other@gmail.com');await h.context.attachMessageDebug(h.dialog,args);assert.equal(h.counts().created,0);});
