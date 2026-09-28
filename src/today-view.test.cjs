const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=vm.createContext({Date});
vm.runInContext(fs.readFileSync('phone-web/public/today-view.js','utf8').replace(/^export /gm,''),model);
const at=(hour,minute=0,second=0)=>new Date(2026,8,28,hour,minute,second);

test('tablet scorecard counts only meaningful calling events',()=>{
  const metrics=model.todayMetrics([{event_type:'call'},{event_type:'call'},{event_type:'no-answer'},{event_type:'virtual-appointment'},{event_type:'next'}],[{status:'held'},{status:'no-show'}]);
  assert.deepEqual({...metrics},{calls:2,noAnswer:1,appointments:1,refused:0,held:1});
});
test('tablet identifies a disconnected second phone while preserving its lead',()=>{
  const now=+at(12), state={desktop_seen:at(11,59,30).toISOString(),slot_phone_seen:{'1':at(11,59,30).toISOString()},slot_leads:{'2':{leadName:'Fictional lead'}}};
  const phone2=model.laneStatus(state,'2',now);
  assert.equal(phone2.kind,'reconnect');assert.equal(phone2.label,'Reconnect Phone 2');assert.equal(phone2.lead.leadName,'Fictional lead');
  assert.equal(model.laneStatus({...state,desktop_seen:at(11,0).toISOString()},'2',now).kind,'offline');
});
test('tablet note prioritizes recovery, commitments, then real progress',()=>{
  const base={calls:0,noAnswer:0,appointments:0,refused:0,held:0};
  assert.match(model.dashboardNote(base,[{id:'2',kind:'reconnect'}],[]),/Phone 2 is away/);
  assert.match(model.dashboardNote(base,[],[{kind:'callback'}]),/next saved commitment/);
  assert.match(model.dashboardNote({...base,calls:12},[],[]),/12 calls/);
});
test('only upcoming timed commitments appear on the tablet',()=>{
  const now=at(12);const rows=[{id:1,starts_at:at(11).toISOString()},{id:2,starts_at:at(13).toISOString()},{id:3,starts_at:at(14).toISOString(),all_day:true},{id:4,starts_at:at(13,30).toISOString()}];
  assert.deepEqual(model.upcomingEvents(rows,now).map(row=>row.id),[2,4]);
});
