const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/salebase-scripts.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({ setTimeout, ...extra });
  vm.runInContext(source, context);
  return context;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const REAL = ['Select a script', 'Response Card', 'Will Kit', 'MediaPlex', 'Child Safe Referral', 'Child Safe', 'POS Beneficiary', 'POS Lapsed', 'Globe Lapse', 'Globe', 'AILPlus (Non-Customer)', 'AILPlus', 'Final Expense'];

test('Response Card leads: IMPACT calls them union/association member requests, reply cards or response cards', () => {
  const { scriptChoiceForLead: choose } = load();
  for (const type of ['Response Card', 'RESPONSE CARDS', 'Response\u00a0Card - IUOE 148 (SGK2Q)', 'Reply Card', 'Union Member Request', 'Association Member Request', 'Association Lead', 'GREATER ST LOUIS BOWLING ASSOC', 'Union Response', 'RC']) {
    assert.equal(choose(type).label, 'Response Card', type);
  }
  assert.deepEqual(plain(choose('Union Member Request')), { label: 'Response Card', rule: 'union/association member' });
  // Cody's capture: on these leads the cell read as the request type holds the group.
  assert.deepEqual(plain(choose('IBT 610 (SGCOY) (AD&D)')), { label: 'Response Card', rule: 'group code in request type' });
  assert.equal(choose('Local 150 (ABC12)').label, 'Response Card');
  assert.deepEqual(plain(choose('GREATER ST LOUIS BOWLING ASSOC (SG2FT) (AD&D)')), { label: 'Response Card', rule: 'union/association member' });
  for (const type of ['(555) 010-0100', '123 MAIN ST SPRINGFIELD, IL 62704', 'Sample request', 'Call 3 (No Answer)', 'IBT 610']) assert.equal(choose(type).label, '', type);
  // A specific product still wins over the union wording.
  assert.equal(choose('Union Child Safe Kit').label, 'Child Safe');
  assert.equal(choose('Will Kit').label, 'Will Kit');
  assert.equal(choose('Globe Life Lapse').label, 'Globe Lapse');
  // Nothing in the request type: a union group on the lead decides.
  assert.deepEqual(plain(choose('Member Request', { group: 'IUOE 148 (SGK2Q) (AD&D)' })), { label: 'Response Card', rule: 'has group' });
  assert.deepEqual(plain(choose('Member Request')), { label: '', rule: 'no rule for this request type' });
  assert.deepEqual(plain(choose('')), { label: '', rule: 'no request type' });
  // Words that merely contain the letters do not count.
  assert.equal(choose('Porch Light Request').label, '');
});

test('dropdown matching: exact, then normalized, startsWith, contains, tokens; never a wrong or ambiguous script', () => {
  const { matchScriptOption: match } = load();
  const pick = (wanted, options, hints) => plain(match(wanted, options, hints));
  assert.deepEqual(pick('Response Card', REAL), { index: 1, text: 'Response Card', how: 'exact' });
  assert.deepEqual(pick('Response Card', ['Response Cards']), { index: 0, text: 'Response Cards', how: 'normalized' });
  assert.deepEqual(pick('Response Card', ['  response\u00a0card ']), { index: 0, text: '  response\u00a0card ', how: 'normalized' });
  assert.deepEqual(pick('Response Card', ['Will Kit', 'Response Card - Union']), { index: 1, text: 'Response Card - Union', how: 'startsWith' });
  assert.deepEqual(pick('Response Card', ['AIL Response Card']), { index: 0, text: 'AIL Response Card', how: 'contains' });
  assert.deepEqual(pick('Response Card', ['Card (Response)']), { index: 0, text: 'Card (Response)', how: 'tokens' });
  assert.deepEqual(pick('AILPlus (Non-Customer)', ['AILPlus Non Customer']), { index: 0, text: 'AILPlus Non Customer', how: 'normalized' });
  // Two equally good options: the request type may break the tie, otherwise nothing is picked.
  assert.equal(pick('Response Card', ['Response Card - Union', 'Response Card - Association'], 'Association Member Request').text, 'Response Card - Association');
  assert.equal(pick('Response Card', ['Response Card - Union', 'Response Card - Association'], 'Response Card').how, 'ambiguous');
  // Another known script is never a stand-in.
  assert.equal(pick('Child Safe', ['Child Safe Referral']).index, -1);
  assert.equal(pick('Globe', ['Globe Lapse']).index, -1);
  assert.equal(pick('AILPlus', ['AILPlus (Non-Customer)']).index, -1);
  assert.equal(pick('Child Safe', ['Child Safe Referral', 'Child Safe']).text, 'Child Safe');
  assert.equal(pick('Response Card', ['Select a script', 'Will Kit']).reason, 'no option fits');
  assert.equal(pick('', REAL).index, -1);
});

function fakeDropdown(texts, selectedIndex = 0, { revert = false } = {}) {
  const events = [];
  const options = texts.map((text) => ({ text, selected: false }));
  const dropdown = { tagName: 'SELECT', options, selectedIndex, dispatchEvent(event) { events.push(event.type); if (revert && event.type === 'change') this.selectedIndex = 0; } };
  return { dropdown, events };
}

test('in the Salebase page: reads the options (waiting for them) and selects like a person would', async () => {
  let dropdown = null;
  const ctx = load({ document: { querySelector: () => dropdown }, Event: class { constructor(type) { this.type = type; } }, Date });
  setTimeout(() => { dropdown = fakeDropdown(['Select a script', 'Response Card', 'Will Kit'], 2).dropdown; }, 350);
  assert.deepEqual(plain(await ctx.readScriptDropdown(2000)), { found: true, options: ['Select a script', 'Response Card', 'Will Kit'], selectedIndex: 2, values:[null,null,null] });
  dropdown = null;
  assert.deepEqual(plain(await ctx.readScriptDropdown(0)), { found: false, options: [], selectedIndex: -1 });
  const good = fakeDropdown(['Select a script', 'Response Card', 'Will Kit'], 2);
  dropdown = good.dropdown;
  assert.deepEqual(plain(await ctx.applyScriptOption(1, 'Response Card')), { ok: true });
  assert.equal(good.dropdown.selectedIndex, 1);
  assert.deepEqual(good.events, ['input', 'change']);
  assert.deepEqual(plain(await ctx.applyScriptOption(2, 'Response Card')), { ok: false, reason: 'dropdown options changed' });
  dropdown = fakeDropdown(['Select a script', 'Response Card'], 0, { revert: true }).dropdown;
  assert.deepEqual(plain(await ctx.applyScriptOption(1, 'Response Card')), { ok: false, reason: 'Salebase switched the dropdown back' });
});

test('popup Script line says what was chosen or exactly why not', () => {
  const { scriptStatusText: text } = load();
  assert.equal(text({ status: 'selected', label: 'Response Card', chosen: 'Response Card' }), 'Script: Response Card (matched)');
  assert.equal(text({ status: 'already-selected', label: 'Response Card', chosen: 'Response Cards' }), 'Script: Response Cards (matched)');
  assert.equal(text({ status: 'no-mapping', requestType: 'Member Request' }), 'Script: no match for “Member Request”');
  assert.equal(text({ status: 'no-match', label: 'Response Card', requestType: 'Union Member Request' }), 'Script: no “Response Card” option in Salebase for “Union Member Request”');
  assert.match(text({ status: 'ambiguous', label: 'Response Card', reason: 'several options fit: A | B' }), /not chosen: several options fit/);
  assert.equal(text(null), '');
});

test('service worker: every lead write re-checks the script, logs each outcome and keeps the group local', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
  const writeLead = worker.slice(worker.indexOf('async function writeLead'), worker.indexOf('async function sendLeadToPhone'));
  assert.match(writeLead, /void openMatchingSalebaseScript\(lead, slot\);/, 'auto, follow-after-result, resync and Sync phone all write through each phone lane');
  const opener = worker.slice(worker.indexOf('async function openMatchingSalebaseScript'), worker.indexOf('async function clickSalebaseCallLink'));
  // Selection in open script tabs comes before (and never behind) the open-once-per-lead guard.
  assert.ok(opener.indexOf('selectSalebaseScript(assigned.id, request, lane)') < opener.indexOf('if (openKey === lastSalebaseOpenKeys.get(lane)) return;'));
  assert.match(opener, /pendingSalebaseChoices\.set\(lane, request\);/, 'each phone lane retains its own pending script choice');
  assert.match(opener, /if \(twoPhoneLanesActive\(\)\)/, 'a second script is created only for two active phone lanes');
  assert.match(opener, /status: 'no-mapping'/);
  assert.match(opener, /scriptChoiceForLead\(requestType, \{ group \}\)/);
  const select = worker.slice(worker.indexOf('async function selectSalebaseScript'), worker.indexOf("// ---- Keeping the phone on IMPACT's lead ----"));
  for (const status of ['tab-not-ready', 'no-dropdown', 'ambiguous', 'no-match', 'already-selected', 'selected', 'select-failed']) assert.match(select, new RegExp(`'${status}'`), status);
  assert.match(select, /'salebase\.scriptSelect'/);
  assert.match(select, /requestType: request\?\.requestType[\s\S]*label: request\?\.label[\s\S]*chosen:[\s\S]*options:/);
  assert.match(select, /'impact\.scriptSelect'/);
  assert.match(worker, /func: readScriptDropdown/);
  assert.match(worker, /func: applyScriptOption, args: \[match\.index, match\.text\]/);
  // The group rides only in memory for this browser.
  assert.equal((worker.match(/noteScriptGroup\(lead, scriptDetails\);/g) || []).length, 3, 'auto-publish, follow-after-result, and per-phone recovery');
  assert.doesNotMatch(worker.slice(worker.indexOf('async function sendLeadToPhone'), worker.indexOf('// The group (e.g.')), /group/i);
  const popup = fs.readFileSync(path.join(__dirname, '../extension/src/popup/popup.js'), 'utf8');
  assert.match(popup, /scriptStatusText/);
  assert.match(popup, /changes\['impact\.scriptSelect'\]/);
  assert.match(fs.readFileSync(path.join(__dirname, '../extension/src/popup/popup.html'), 'utf8'), /id="scriptStatus"/);
});

test('IMPACT page logs what group it read, once per lead', () => {
  const impact = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
  assert.match(impact, /"impact\.groupRead", \{\r?\n\s*requestType: lead\.requestType \|\| "", group: details\.group \|\| "", source: details\.groupSource \|\| "none"/);
  assert.equal((impact.match(/logGroupRead\(lead\);/g) || []).length, 2);
});

test('manual script opening works without a mapped type and without a loaded lead',async()=>{
 const worker=fs.readFileSync('extension/src/background/service-worker.js','utf8');
 const source=worker.slice(worker.indexOf('async function openMatchingSalebaseScript'),worker.indexOf('async function reopenPhoneScripts()'));
 const created=[],bound=[];
 const ctx=vm.createContext({laneKey:String,scriptGroupsByLead:new Map(),pendingSalebaseChoices:new Map(),scriptChoiceForLead:()=>({label:'',rule:'no request type'}),SALEBASE_SCRIPTS_URL:'https://salebase.ai/scripts',chrome:{windows:{create:async opts=>{created.push(opts);return {tabs:[{id:42}]};}}},bindScriptTab:async(id,lane)=>bound.push([id,lane])});
 vm.runInContext(source,ctx);await ctx.openMatchingSalebaseScript(null,'2',true);
 assert.equal(created.length,1);assert.deepEqual(bound,[[42,'2']]);
 const recovery=worker.slice(worker.indexOf('async function reopenPhoneScriptsForLane'),worker.indexOf('async function impactTabForLane'));
 assert.match(recovery,/openMatchingSalebaseScript\(null, lane, true\)/);
});

test('specific programs win over reply-card wording and accept separators and reversed referrals',()=>{
 const choose=load().scriptChoiceForLead;
 for(const type of ['Child Safe Kit Reply Card','Child-Safe Kit Offer','Child_Safe Online Inquiry'])assert.equal(choose(type).label,'Child Safe',type);
 assert.equal(choose('Referral Child Safe Kit').label,'Child Safe Referral');
 assert.equal(choose('Will Kit Response Card').label,'Will Kit');
 assert.equal(choose('Globe Lapsed Response Card').label,'Globe Lapse');
});

test('a delayed dropdown read cannot apply the previous leads script',async()=>{
 const worker=fs.readFileSync('extension/src/background/service-worker.js','utf8');
 const source=worker.slice(worker.indexOf('async function selectSalebaseScript'),worker.indexOf('async function reportScriptSelect'));
 const pending=new Map(),old={label:'Response Card'},latest={label:'Child Safe'};pending.set('2',old);let applies=0;
 const ctx=vm.createContext({laneKey:String,pendingSalebaseChoices:pending,readScriptDropdown(){},chrome:{scripting:{executeScript:async()=>{pending.set('2',latest);return [{result:{found:true,options:['Response Card'],selectedIndex:0}}];}}},matchScriptOption:()=>{applies++;return {index:0};}});
 vm.runInContext(source,ctx);await ctx.selectSalebaseScript(42,old,'2');assert.equal(applies,0);
});

test('Phone 2 manual button opens and focuses its window even when IMPACT recovery never resolves',async()=>{
 const worker=fs.readFileSync('extension/src/background/service-worker.js','utf8');
 const source=worker.slice(worker.indexOf('async function openPhoneScriptWindow'),worker.indexOf('async function reopenPhoneScriptsForLane'));
 let saved,created;
 const ctx=vm.createContext({laneKey:String,SALEBASE_SCRIPTS_URL:'https://salebase.ai/phone_scripts/phone_scripts.php',chrome:{windows:{create:async opts=>{created=opts;return {tabs:[{id:99}]};}}},scriptSlotMap:async()=>({'10':'1','20':'2'}),writeScriptSlotMap:async map=>{saved=map;},laneScriptFields:new Map([['2',{}]]),syncScriptLeadForLane:async()=>{},reopenPhoneScriptsForLane:()=>new Promise(()=>{})});
 vm.runInContext(source,ctx);const result=await ctx.openPhoneScriptWindow('2');
 assert.equal(result.lane,'2');assert.equal(created.focused,true);assert.equal(saved['99'],'2');assert.equal(saved['10'],'1');assert.equal(saved['20'],undefined);
});

test('new Phone 2 script attaches only Phone 2 saved fields before live recovery',async()=>{
 const worker=fs.readFileSync('extension/src/background/service-worker.js','utf8');
 const source=worker.slice(worker.indexOf('async function openPhoneScriptWindow'),worker.indexOf('async function reopenPhoneScriptsForLane'));
 const fields=new Map(),synced=[],record={slot:'2',fields:{firstName:'Test'},sourceTabId:22};
 const ctx=vm.createContext({laneKey:String,SALEBASE_SCRIPTS_URL:'url',SCRIPT_LEADS_KEY:'leads',laneScriptFields:fields,chrome:{windows:{create:async()=>({tabs:[{id:99}]})},storage:{session:{get:async()=>({leads:{old:record,other:{slot:'1',fields:{firstName:'Wrong'}}}})}}},scriptSlotMap:async()=>({}),writeScriptSlotMap:async()=>{},syncScriptLeadForLane:async lane=>synced.push([lane,fields.get(lane)]),reopenPhoneScriptsForLane:async()=>true});
 vm.runInContext(source,ctx);await ctx.openPhoneScriptWindow('2');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(synced[0][0],'2');assert.equal(synced[0][1].fields.firstName,'Test');assert.equal(fields.has('1'),false);
});

test('actual saved Salebase dropdown IDs select every lead program despite label differences',()=>{
 const html=fs.readFileSync('htmls/Phone Scripts - Salebase.html','utf8');
 const dropdown=html.match(/<select id="myDropdown"[\s\S]*?<\/select>/)[0];
 const options=[...dropdown.matchAll(/<option value="([^"]+)"[^>]*>\s*([^<]+)<\/option>/g)];
 const values=options.map(o=>o[1]),labels=options.map(o=>o[2].trim()),ctx=load();
 for(const [type,id] of [['Child Safe Kit Online Inquiry','CHILDSAFE'],['Child Safe Referral','REFERRAL'],['POS Beneficiary','BENEFICIARY'],['Lapsed POS','LAPSED-POS'],['POS','POS'],['MediaPlex Child Safe','MPCHILDSAFE'],['Globe Lapse','GLOBELAPSE'],['Will Kit','WILLKIT']]){
 const choice=ctx.scriptChoiceForLead(type),match=ctx.matchScriptOption(choice.label,labels,type,values);
 assert.equal(values[match.index],id,type);assert.equal(match.how,'script-id');
 }
});
