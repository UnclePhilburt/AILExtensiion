const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({});
for(const name of ['text-learning.js','texting-mode.js','followup-model.js'])vm.runInContext(fs.readFileSync('phone-web/public/'+name,'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,''),context);
const lead={lead_id:'123',name:'DOE, JANE',request_type:'Child Safe',phones:[{label:'Mobile',number:'3145550100'},{label:'Home',number:'3145550101'}]};
test('each texting day has independent experiments and four usable variants',()=>{
 const experiments=new Set();
 for(const step of ['intro','tuesday','thursday','saturday']){
  for(const variant of ['A','B','C','D']){
   const draft=context.planDraft('user',lead,{step,draft:{variant}},'Cody',[],[],Date.parse('2026-10-04T23:00:00Z'));
   assert.equal(draft.variant,variant);assert.match(draft.body,/Hi Jane/);assert.match(draft.body,/Child Safe Program/);assert.match(draft.body,/Zoom/);assert.doesNotMatch(draft.body,/Schaefer|checking|undefined|\{/i);
   assert.equal(draft.number,'3145550100');experiments.add(draft.experiment);
   for(const time of draft.offeredSlots){const local=context.centralParts(Date.parse(time));assert.equal(local.day,5);assert.ok(local.hour>=14);}
  }
 }
 assert.equal(experiments.size,4);
});
test('after 5 C/D use free same-day times while A uses the next working day',()=>{
 const now=Date.parse('2026-10-05T22:00:00Z');
 const c=context.planDraft('user',lead,{step:'tuesday',draft:{variant:'C'}},'Cody',[],[],now);
 const a=context.planDraft('user',lead,{step:'tuesday',draft:{variant:'A'}},'Cody',[],[],now);
 assert.equal(c.offerPolicy,'same-day');assert.match(c.body,/today/);assert.match(a.body,/tomorrow/);
 const busy=c.offeredSlots.map(starts_at=>({kind:'appointment',starts_at}));
 const refreshed=context.planDraft('user',lead,{step:'tuesday',draft:c},'Cody',busy,[],now);
 assert.equal(refreshed.variant,'C');assert.ok(refreshed.offeredSlots.every(t=>!c.offeredSlots.includes(t)));
});
test('reported no reply uses Home and Central appointment input respects daylight saving',()=>{
 const draft=context.planDraft('user',lead,{step:'thursday'},'Cody',[],[{lead_id:'123',phone:'3145550100',replied:false}],Date.parse('2026-10-06T19:00:00Z'));
 assert.equal(draft.number,'3145550101');
 assert.equal(context.centralInput('2026-10-05T14:30'),'2026-10-05T19:30:00.000Z');
 assert.equal(context.centralInput('2026-12-05T10:30'),'2026-12-05T16:30:00.000Z');
});
