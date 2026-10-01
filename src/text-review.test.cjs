const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../phone-web/public/text-review.js'),'utf8').replace(/^import .*;\r?\n/gm,'').split("client.auth.onAuthStateChange")[0];
const model=fs.readFileSync(path.join(__dirname,'../phone-web/public/text-review-model.js'),'utf8').replace(/^export /gm,'');
function harness(records,failSecond=false) {
 const nodes=new Map();const make=()=>({value:'',children:[],append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},addEventListener(){}});
 const document={querySelector:key=>{if(!nodes.has(key))nodes.set(key,make());return nodes.get(key);},createElement:make};document.querySelector('#filter').value='all';
 let calls=0;const database=records.map(r=>({...r}));
 const client={from:()=>{let ids=[],unknown=false,appointmentFilter=false,user='';return {update(){return this;},eq(key,val){if(key==='user_id')user=val;if(key==='appointment')appointmentFilter=val===false;return this;},in(key,values){assert.equal(key,'id');ids=values;return this;},is(key,value){assert.equal(key,'replied');assert.equal(value,null);unknown=true;return this;},async select(){calls++;assert.equal(user,'user');assert.ok(unknown);assert.ok(appointmentFilter);if(failSecond&&calls===2)return {error:{message:'Offline'}};const changed=database.filter(r=>ids.includes(r.id)&&r.replied==null&&!r.appointment);changed.forEach(r=>r.replied=false);return {data:changed.map(r=>({id:r.id}))};}};}};
 const context=vm.createContext({document,client,localStorage:{getItem:()=>null,setItem(){}},location:{replace(){}},Date,Set});vm.runInContext(model+source,context);context.seed=records;vm.runInContext("owner='user'; rows=seed;",context);
 return {context,database,nodes};
}
test('review search and filters find phone numbers and only unreviewed nonappointments are bulk candidates',()=>{
 const c=vm.createContext({});vm.runInContext(model,c);const rows=[{name:'Jane',number:'(314) 555-0100',replied:null},{name:'Sam',replied:true},{name:'Kim',replied:false},{name:'Pat',replied:null,appointment:true}];
 assert.equal(c.reviewRows(rows,'3145550100').length,1);assert.equal(c.reviewRows(rows,'','replied').length,1);assert.equal(c.unreviewedTexts(rows).length,1);
});
test('bulk no reply preserves previously saved and concurrently updated replies',async()=>{
 const seed=[{id:'a',name:'A',leadId:'a',replied:null},{id:'b',name:'B',leadId:'b',replied:true},{id:'c',name:'C',leadId:'c',replied:null}];const h=harness(seed);h.database.find(r=>r.id==='c').replied=true;
 await h.context.markRemaining();assert.equal(h.database[0].replied,false);assert.equal(h.database[1].replied,true);assert.equal(h.database[2].replied,true);
 assert.match(h.nodes.get('#status').textContent,/1 texts marked/);
});
test('partial bulk failure keeps saved rows and leaves unsaved rows unreviewed for retry',async()=>{
 const seed=Array.from({length:101},(_,i)=>({id:String(i),name:'Lead',leadId:String(i),replied:null}));const h=harness(seed,true);await h.context.markRemaining();assert.equal(h.database.filter(r=>r.replied===false).length,100);assert.equal(h.database[100].replied,null);assert.match(h.nodes.get('#status').textContent,/100 saved.*Offline/);
});
