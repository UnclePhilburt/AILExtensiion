const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({Date,Set,Promise});vm.runInContext(fs.readFileSync('phone-web/public/uncalled-lead.js','utf8').replace(/^export /gm,''),context);
function client(rows,pass){return {from(table){const q={select:()=>q,eq:(key,user)=>{if(key==='user_id')assert.equal(user,'owner');return q;},gt:()=>q,or:()=>q,order:()=>q,maybeSingle:async()=>({data:pass}),range:async(a,b)=>({data:(rows[table]||[]).slice(a,b+1)})};return q;}};}
const now=Date.parse('2026-10-05T22:00:00Z'),start='2026-10-05T14:00:00Z';
test('direct selection excludes calls from both phones throughout the pass and wraps to uncalled leads',async()=>{
 const rows={followup_workspace_calls:Array.from({length:501},(_,i)=>({id:String(i),lead_id:'2',started_at:start})),followup_actions:[{id:'a',lead_id:'3',kind:'call',started_at:start},{id:'text',lead_id:'6',kind:'text',started_at:start}]};
 const c=client(rows,{started_at:start,lead_ids:['1','2','3','4','5','6']});
 let result=await context.findUncalledLead(c,'owner',{currentLeadId:'1',otherLeadIds:['4'],missingLeadIds:['5'],now});assert.equal(result.leadId,'6');
 result=await context.findUncalledLead(c,'owner',{currentLeadId:'6',otherLeadIds:['4'],missingLeadIds:['5'],now});assert.equal(result.leadId,'1');
});
test('a new pass still excludes recent completed calls and stops instead of replaying a blocked list',async()=>{
 const rows={followup_workspace_calls:[{id:'call',lead_id:'2',started_at:'2026-10-05T19:00:00Z',completed_at:'2026-10-05T21:00:00Z'}],followup_actions:[]};
 const c=client(rows,{started_at:'2026-10-05T21:30:00Z',lead_ids:['1','2','3']});
 assert.equal((await context.findUncalledLead(c,'owner',{currentLeadId:'1',otherLeadIds:['3'],now})).leadId,null);
});

test('future callbacks stay out of selection until their scheduled instant',async()=>{
 const at='2026-10-05T22:30:00Z',rows={followup_workspace_calls:[],followup_actions:[],scheduled_events:[{id:1,kind:'callback',impact_lead_id:'2',starts_at:at}]};
 const c=client(rows,{started_at:start,lead_ids:['1','2','3']});
 assert.equal((await context.findUncalledLead(c,'owner',{currentLeadId:'1',now})).leadId,'3');
 assert.equal((await context.findUncalledLead(c,'owner',{currentLeadId:'1',now:Date.parse(at)})).leadId,'2');
});

test('Dont show again excludes a lead even in a later pass',async()=>{
 const c=client({followup_workspace_calls:[],followup_actions:[],workspace_excluded_leads:[{lead_id:'2'}]},{started_at:start,lead_ids:['1','2','3']});
 assert.equal((await context.findUncalledLead(c,'owner',{currentLeadId:'1',now})).leadId,'3');
});
