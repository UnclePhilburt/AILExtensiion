const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const source=fs.readFileSync('phone-web/public/followup-plan.js','utf8');
test('regular text launch opens the lead draft even when IMPACT is unavailable',async()=>{
 const events=[];const ctx=vm.createContext({isChildSafeLead:()=>false,current:{lead:{request_type:'Child Safe'},action:{kind:'text',draft:{number:'3145550123',body:'Actual lead message',offeredSlots:[]}}},load:async()=>{},operation:async op=>events.push(op),alignIMPACT:async()=>{throw Error('Computer offline')},impactResult:async()=>{throw Error('Computer offline')},openMessage:href=>events.push(href),smsLink:(number,body)=>'sms:'+number+'?body='+encodeURIComponent(body),navigator:{userAgent:'Android'},$:()=>({})});
 vm.runInContext(source.slice(source.indexOf('async function launch()'),source.indexOf('function render()')),ctx);await ctx.launch();assert.deepEqual(events,['start','sms:3145550123?body=Actual%20lead%20message']);
});
test('failed plan start still prevents opening an unassigned text',async()=>{
 let opened=false;const ctx=vm.createContext({isChildSafeLead:()=>false,current:{lead:{request_type:'Child Safe'},action:{kind:'text',draft:{offeredSlots:[]}}},load:async()=>{},operation:async()=>{throw Error('Action no longer assigned')},openMessage:()=>opened=true});vm.runInContext(source.slice(source.indexOf('async function launch()'),source.indexOf('function render()')),ctx);await assert.rejects(ctx.launch(),/no longer assigned/);assert.equal(opened,false);
});
test('debug uses the selected lead draft without asking for the agent number',()=>{
 const calls=[];const debug={};const ctx=vm.createContext({debug,current:{action:{kind:'text',draft:{number:'3145550123',body:'Lead-specific draft'}}},navigator:{userAgent:'Android'},smsLink:(number,body)=>{calls.push([number,body]);return 'sms:3145550123';},openMessage:href=>calls.push(href),window:{prompt:()=>{throw Error('Must not ask for own number')}},$:()=>({})});
 const start=source.indexOf('debug.onclick=');const end=source.indexOf(";$('.toolsActions').append(debug)",start);
 vm.runInContext(source.slice(start,end),ctx);debug.onclick();assert.deepEqual(calls,[['3145550123','Lead-specific draft'],'sms:3145550123']);
});

test('old opened Child Safe insurance drafts are flagged while sent history is preserved',()=>{const ctx=vm.createContext({isChildSafeLead:type=>type==='Child Safe Kit Online Inquiry'});vm.runInContext(source.slice(source.indexOf('function wrongChildSafeDraft('),source.indexOf('function render()')),ctx);const lead={request_type:'Child Safe Kit Online Inquiry'};const action={kind:'text',status:'claimed',started_at:'now',draft:{body:'Your life insurance options'}};assert.equal(ctx.wrongChildSafeDraft(lead,action),true);assert.equal(ctx.wrongChildSafeDraft(lead,{...action,status:'done'}),false);assert.equal(ctx.wrongChildSafeDraft(lead,{...action,draft:{body:'Your Child Safe Kit'}}),false);});

function prepareSetup(live,started=false){
 const events=[];const ctx=vm.createContext({});
 for(const name of ['call-scripts.data.js','call-scripts.js','text-learning.js','texting-mode.js','followup-model.js'])vm.runInContext(fs.readFileSync('phone-web/public/'+name,'utf8').replace(/^import .*$/gm,'').replace(/^export \{.*$/gm,'').replace(/^export /gm,''),ctx);
 Object.assign(ctx,{current:{detailsReady:false,lead:{lead_id:'123',name:'TEST, JANE',request_type:'Life Insurance',phones:[{label:'Mobile',number:'3145550100'}]},action:{kind:'text',step:'intro',status:'claimed',started_at:started?'now':null,draft:{variant:'B',body:'Your life insurance options'}}},owner:'user',agent:'Cody',meetings:[],records:[],visibleLead:()=>live,$:()=>({value:'2',textContent:'Import complete'}),rpc:async(name,args)=>events.push([name,args]),operation:async(op,payload)=>{events.push([op,payload]);ctx.current.action.draft=payload;}});
 vm.runInContext(source.slice(source.indexOf('async function prepareCurrent('),source.indexOf('async function next()')),ctx);return {ctx,events};
}

test('saved Child Safe type repairs an insurance draft without contacting IMPACT',async()=>{
 const {ctx,events}=prepareSetup(null);ctx.current.lead.request_type='Child Safe Kit Offer';await ctx.prepareCurrent();assert.equal(events.length,1);assert.equal(events[0][0],'prepare');assert.match(ctx.current.action.draft.body,/Child Safe Program/);assert.doesNotMatch(ctx.current.action.draft.body,/life insurance/i);
});
test('refresh uses the newest Supabase lead type and never contacts IMPACT',async()=>{
 const {ctx}=prepareSetup(null);ctx.leads=[{...ctx.current.lead,request_type:'Child Safe Kit Online Inquiry'}];ctx.alignIMPACT=()=>{throw Error('Must not contact IMPACT')};await ctx.refreshCurrent();assert.match(ctx.current.action.draft.body,/Child Safe Program/);
});
test('phone dialer opens without an IMPACT connection',async()=>{
 const events=[];const ctx=vm.createContext({current:{action:{kind:'call'},lead:{phones:[{label:'Mobile',number:'3145550100'}]}},load:async()=>{},operation:async op=>events.push(op),alignIMPACT:()=>{throw Error('Offline')},location:{},$:()=>({})});vm.runInContext(source.slice(source.indexOf('async function launch()'),source.indexOf('function render()')),ctx);await ctx.launch();assert.equal(ctx.location.href,'tel:3145550100');assert.deepEqual(events,['start']);
});
test('confirming a text saves it and advances without updating IMPACT',async()=>{
 const events=[];const ctx=vm.createContext({operation:async op=>events.push(op),next:async()=>events.push('next'),$:()=>({value:'1'}),impactResult:()=>{throw Error('Offline')}});vm.runInContext(source.slice(source.indexOf('async function textNoAnswer()'),source.indexOf('async function launch()')),ctx);await ctx.textNoAnswer();assert.deepEqual(events,['complete','next']);
});
