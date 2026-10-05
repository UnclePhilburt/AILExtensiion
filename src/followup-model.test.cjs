const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({});
for(const name of ['call-scripts.data.js','call-scripts.js','text-learning.js','texting-mode.js','followup-model.js'])vm.runInContext(fs.readFileSync('phone-web/public/'+name,'utf8').replace(/^import .*$/gm,'').replace(/^export \{.*$/gm,'').replace(/^export /gm,''),context);
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

test('group, union and coded reply-card leads get benefits wording across all days and variants',()=>{
 for(const type of ['Group','Union','Response Card','Association','IBT 610 (SGCOY) (AD&D)','GREATER ST LOUIS BOWLING ASSOC (SG123) (ADD)']){
  const templates=context.textTemplates(type,{A:'We got your request about life insurance. Zoom?',topic:'life insurance information'});
  for(const variant of ['A','B','C','D']){assert.match(templates[variant],/reply card/);assert.match(templates[variant],/cost-free benefits program/);assert.doesNotMatch(templates[variant],/life insurance/i);}
  for(const step of ['intro','tuesday','thursday','saturday'])for(const variant of ['A','B','C','D']){
   const draft=context.planDraft('user',{...lead,request_type:type},{step,draft:{variant}},'Cody',[],[],Date.parse('2026-10-04T23:00:00Z'));
   assert.match(draft.body,/reply card/);assert.match(draft.body,/cost-free benefits program/);assert.match(draft.body,/Zoom/);assert.doesNotMatch(draft.body,/life insurance/i);assert.match(draft.experiment,/^plan-benefits-v2:/);
  }
 }
});

test('benefits messages name the actual group without internal codes or generic labels',()=>{
 assert.equal(context.benefitsGroupName('IBT 610 (SGCOY) (AD&D)'),'IBT 610');
 for(const type of ['Group','Union','Response Card'])assert.equal(context.benefitsGroupName(type),'');
 for(const variant of ['A','B','C','D']){
  const draft=context.planDraft('user',{...lead,request_type:'IBT 610 (SGCOY) (AD&D)'},{step:'intro',draft:{variant}},'Cody',[],[],Date.parse('2026-10-04T23:00:00Z'));
  assert.match(draft.body,/program for members of IBT 610/);assert.doesNotMatch(draft.body,/SGCOY|AD&D/);
  assert.match(context.textTemplates('IBT 610 (SGCOY) (AD&D)')[variant],/program for members of IBT 610/);
 }
});

test('Child Safe label variants and old insurance templates always produce kit texts',()=>{
 for(const type of ['Child Safe Kit Online Inquiry','Child Safe','Child Safety Kit','CHILD-SAFE KIT','Child–Safe','Child_Safe','CSK','Child Safe Referral','MediaPlex','Media Plex']){
  const templates=context.textTemplates(type,{A:context.textTemplates('Life Insurance').A,B:context.textTemplates('Life Insurance').B,topic:'life insurance information'});
  for(const variant of ['A','B','C','D']){
   assert.match(templates[variant],/Child Safe Program/);assert.doesNotMatch(templates[variant],/life insurance|cost-free benefits/i);
   for(const step of ['intro','tuesday','thursday','saturday']){
    const draft=context.planDraft('user',{...lead,request_type:type},{step,draft:{variant}},'Cody',[],[],Date.parse('2026-10-05T15:00:00Z'));
    assert.match(draft.body,/Child Safe Program/);assert.match(draft.body,/Child Safe Kit/);assert.doesNotMatch(draft.body,/life insurance|cost-free benefits/i);
   }
  }
 }
});

test('daily progress counts unique current leads in Central time and excludes stopped leads from remaining',()=>{
 const leads=[{lead_id:'1',status:'active'},{lead_id:'2',status:'active'},{lead_id:'3',status:'appointment'},{lead_id:'4',status:'active',archived_at:'yes'}];
 const records=[{lead_id:'1',sent_at:'2026-10-06T04:59:00Z'},{lead_id:'1',sent_at:'2026-10-05T18:00:00Z'},{lead_id:'2',sent_at:'2026-10-05T04:59:00Z'},{lead_id:'4',sent_at:'2026-10-05T18:00:00Z'},{lead_id:'2',sent_at:null}];
 assert.deepEqual(JSON.parse(JSON.stringify(context.dailyTextProgress(leads,records,Date.parse('2026-10-06T04:59:00Z')))),{total:3,texted:1,remaining:1});
 assert.equal(context.dailyTextProgress(leads,records,Date.parse('2026-10-06T05:00:00Z')).texted,0);
});
