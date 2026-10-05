const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const source=fs.readFileSync('phone-web/public/followup-plan.js','utf8');
test('regular text launch opens the lead draft even when IMPACT is unavailable',async()=>{
 const events=[];const ctx=vm.createContext({isChildSafeLead:()=>false,current:{lead:{request_type:'Child Safe'},action:{kind:'text',draft:{number:'3145550123',body:'Actual lead message',offeredSlots:[]}}},load:async()=>{},operation:async op=>events.push(op),alignIMPACT:async()=>{throw Error('Computer offline')},impactResult:async()=>{throw Error('Computer offline')},openMessage:href=>events.push(href),smsLink:(number,body)=>'sms:'+number+'?body='+encodeURIComponent(body),navigator:{userAgent:'Android'},$:()=>({})});
 vm.runInContext(source.slice(source.indexOf('async function launch()'),source.indexOf('function render()')),ctx);await ctx.launch();assert.deepEqual(events,['start','sms:3145550123?body=Actual%20lead%20message']);
});
test('failed plan start still prevents opening an unassigned text',async()=>{
 let opened=false;const ctx=vm.createContext({isChildSafeLead:()=>false,current:{lead:{request_type:'Child Safe'},action:{kind:'text',draft:{offeredSlots:[]}}},load:async()=>{},operation:async()=>{throw Error('Action no longer assigned')},openMessage:()=>opened=true});vm.runInContext(source.slice(source.indexOf('async function launch()'),source.indexOf('function render()')),ctx);await assert.rejects(ctx.launch(),/no longer assigned/);assert.equal(opened,false);
});
function setup(fail=false){const events=[];const status={textContent:''};const context=vm.createContext({prepareCurrent:async()=>{},current:null,enabled:true,device:'phone',owner:'user',agent:'Cody',meetings:[],records:[],load:async()=>events.push('load'),rpc:async(name)=>{events.push(name);return {lead:{lead_id:'123'},action:{kind:'call',status:'claimed'}}},render:()=>events.push('render'),alignIMPACT:async()=>{events.push('open');if(fail)throw Error('Computer offline')},$:s=>s==='#slot'?{value:'2'}:status});vm.runInContext(source.slice(source.indexOf('async function next()'),source.indexOf('function button(')),context);return {context,events,status};}
test('selecting the next plan lead opens it on the computer before any call or text action',async()=>{const {context,events,status}=setup();await context.next();assert.deepEqual(events,['load','plan_claim','render','open']);assert.match(status.textContent,/open in IMPACT window 2/);});
test('an offline computer preserves the selected lead and does not report a successful open',async()=>{const {context,status}=setup(true);await assert.rejects(context.next(),/offline/);assert.equal(context.current.lead.lead_id,'123');assert.doesNotMatch(status.textContent,/is open/);});

test('debug uses the selected lead draft without asking for the agent number',()=>{
 const calls=[];const debug={};const ctx=vm.createContext({debug,current:{action:{kind:'text',draft:{number:'3145550123',body:'Lead-specific draft'}}},navigator:{userAgent:'Android'},smsLink:(number,body)=>{calls.push([number,body]);return 'sms:3145550123';},openMessage:href=>calls.push(href),window:{prompt:()=>{throw Error('Must not ask for own number')}},$:()=>({})});
 const start=source.indexOf('debug.onclick=');const end=source.indexOf(";$('.toolsActions').append(debug)",start);
 vm.runInContext(source.slice(start,end),ctx);debug.onclick();assert.deepEqual(calls,[['3145550123','Lead-specific draft'],'sms:3145550123']);
});

test('Next asks whether an opened text was sent before advancing or saving',async()=>{const {context,events}=setup();context.current={action:{status:'claimed',started_at:'now',kind:'text'},lead:{lead_id:'old'}};let asked=false;context.showTextResult=()=>asked=true;await context.next();assert.equal(asked,true);assert.equal(context.current.lead.lead_id,'old');assert.deepEqual(events,[]);});

test('old opened Child Safe insurance drafts are flagged while sent history is preserved',()=>{const ctx=vm.createContext({isChildSafeLead:type=>type==='Child Safe Kit Online Inquiry'});vm.runInContext(source.slice(source.indexOf('function wrongChildSafeDraft('),source.indexOf('function render()')),ctx);const lead={request_type:'Child Safe Kit Online Inquiry'};const action={kind:'text',status:'claimed',started_at:'now',draft:{body:'Your life insurance options'}};assert.equal(ctx.wrongChildSafeDraft(lead,action),true);assert.equal(ctx.wrongChildSafeDraft(lead,{...action,status:'done'}),false);assert.equal(ctx.wrongChildSafeDraft(lead,{...action,draft:{body:'Your Child Safe Kit'}}),false);});

function prepareSetup(live,started=false){
 const events=[];const ctx=vm.createContext({});
 for(const name of ['call-scripts.data.js','call-scripts.js','text-learning.js','texting-mode.js','followup-model.js'])vm.runInContext(fs.readFileSync('phone-web/public/'+name,'utf8').replace(/^import .*$/gm,'').replace(/^export \{.*$/gm,'').replace(/^export /gm,''),ctx);
 Object.assign(ctx,{current:{detailsReady:false,lead:{lead_id:'123',name:'TEST, JANE',request_type:'Life Insurance',phones:[{label:'Mobile',number:'3145550100'}]},action:{kind:'text',step:'intro',status:'claimed',started_at:started?'now':null,draft:{variant:'B',body:'Your life insurance options'}}},owner:'user',agent:'Cody',meetings:[],records:[],visibleLead:()=>live,$:()=>({value:'2',textContent:'Import complete'}),rpc:async(name,args)=>events.push([name,args]),operation:async(op,payload)=>{events.push([op,payload]);ctx.current.action.draft=payload;}});
 vm.runInContext(source.slice(source.indexOf('async function prepareCurrent('),source.indexOf('async function next()')),ctx);return {ctx,events};
}
test('matching IMPACT type repairs a wrongly imported type before saving a Child Safe draft',async()=>{
 const {ctx,events}=prepareSetup({leadId:'123',requestType:'Child Safe Kit Offer'});await ctx.prepareCurrent({});
 assert.equal(events[0][0],'plan_import');assert.equal(events[0][1].p_leads[0].requestType,'Child Safe Kit Offer');assert.equal(events[1][0],'prepare');assert.match(events[1][1].body,/Child Safe Program/);assert.doesNotMatch(events[1][1].body,/life insurance/i);assert.equal(ctx.current.detailsReady,true);
});
test('wrong phone lane and missing live type cannot change or prepare the lead',async()=>{
 for(const live of [{leadId:'999',requestType:'Child Safe Kit Offer'},{leadId:'123',requestType:''}]){const {ctx,events}=prepareSetup(live);await assert.rejects(ctx.prepareCurrent({}),/IMPACT/);assert.deepEqual(events,[]);assert.equal(ctx.current.detailsReady,false);}
});
test('an already opened draft is preserved for the send confirmation instead of silently rewritten',async()=>{
 const {ctx,events}=prepareSetup({leadId:'123',requestType:'Child Safe Kit Offer'},true);await ctx.prepareCurrent({});assert.equal(events.length,1);assert.equal(ctx.current.action.draft.body,'Your life insurance options');assert.equal(ctx.current.lead.request_type,'Child Safe Kit Offer');
});
