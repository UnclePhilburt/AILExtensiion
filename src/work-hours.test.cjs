const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
for(const file of ['phone-web/public/work-hours.js','extension/src/shared/work-hours.js']) {
  test(file+' never blocks account access, including overnight',()=>{
    const c=vm.createContext({Intl,Date});vm.runInContext(fs.readFileSync(file,'utf8').replace(/^export /gm,''),c);
    for(const hour of [0,7,8,9,20,21,23]) assert.equal(c.callingHoursOpen(new Date(2026,8,27,hour),'America/Chicago'),true);
  });
}
test('the legacy phone guard cannot sign out or redirect',()=>{
  vm.runInNewContext(fs.readFileSync('phone-web/public/work-hours-guard.js','utf8'),{});
});
