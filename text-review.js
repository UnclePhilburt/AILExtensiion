import { client } from './auth-runtime.js';
import { reviewRows, unreviewedTexts } from './text-review-model.js';
const $ = selector => document.querySelector(selector);
const el = (tag, value, cls='') => { const node=document.createElement(tag); node.textContent=value; node.className=cls; return node; };
let owner = '', rows = [], busy = false, shown = 100, generation = 0;
const name = value => String(value || 'Unnamed lead').split(',').reverse().join(' ').trim().split(/\s+/).map(part=>part===part.toUpperCase()?part.charAt(0)+part.slice(1).toLowerCase():part).join(' ');
const visible = () => reviewRows(rows,$('#search').value,$('#filter').value);
function render() {
 const filtered=visible(), remaining=unreviewedTexts(filtered);
 $('#counts').textContent=filtered.length+' texts · '+filtered.filter(r=>r.replied===true).length+' replied · '+remaining.length+' unreviewed';
 $('#bulk').textContent='Mark remaining no reply ('+remaining.length+')'; $('#bulk').disabled=busy||!remaining.length;
 $('#refresh').disabled=busy; $('#search').disabled=busy; $('#filter').disabled=busy;
 $('#texts').replaceChildren();
 if (!filtered.length) $('#texts').append(el('p',rows.length?'No matching texts.':'No confirmed texts yet. Texts appear after you tap I sent it.'));
 for(const row of filtered.slice(0,shown)) {
  const card=el('article','','textReviewRow'); card.append(el('h2',name(row.name)),el('p',row.number));
  card.append(el('p',new Date(row.sentAt).toLocaleString()+' · '+(row.variant==='custom'?'Custom text':'Version '+row.variant)+' · '+(row.appointment?'Appointment booked':row.replied===true?'Replied':row.replied===false?'No reply':'Unreviewed'),'reviewMeta'));
  const actions=el('div','','reviewActions');
  for(const [label,value] of [['Replied',true],['No reply',false]]) {
   const button=el('button',label); button.type='button'; button.disabled=busy||(!value&&row.appointment); button.setAttribute('aria-pressed',String(row.replied===value)); button.setAttribute('aria-label',label+' — '+name(row.name)+' '+row.number); button.addEventListener('click',()=>void saveOutcome(row,value)); actions.append(button);
  }
  const details=el('details',''); details.append(el('summary','View message'),el('p',row.body,'reviewBody'));card.append(actions,details);$('#texts').append(card);
 }
 $('#more').hidden=filtered.length<=shown; $('#more').disabled=busy;
}
function rememberOutcomes(changed, replied, user) {
 // The workspace consumes these Home follow-ups without an extra question.
 try {
  const key='impact.texting.v1.'+user;
  const state=JSON.parse(localStorage.getItem(key)||'null')||{company:'American Income Life',templates:{},records:[],pending:{}};
  state.homeFollowups ||= {};
  for(const row of changed) {
   const record=state.records.find(r=>r.id===row.id); if(record) record.replied=replied;
   if(replied) delete state.homeFollowups[row.leadId];
   else state.homeFollowups[row.leadId]={leadId:row.leadId,name:row.name,number:row.number};
  }
  localStorage.setItem(key,JSON.stringify(state));
 } catch { $('#status').textContent='Results saved. Home follow-ups could not be queued on this device.'; }
}
async function load() {
 if(busy||!owner)return;
 const user=owner, token=++generation;busy=true;render();$('#status').textContent='Loading your texts…';
 try {
  const loaded=[];
  for(let offset=0;;offset+=500) {
   const {data,error}=await client.from('text_messages').select('*').eq('user_id',user).order('sent_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
   if(error)throw error;if(owner!==user||token!==generation)return;
   loaded.push(...data.map(r=>({id:r.id,leadId:r.lead_id,name:r.lead_name,number:r.phone,body:r.body,variant:r.variant,sentAt:Date.parse(r.sent_at),replied:r.replied,appointment:r.appointment})));
   if(data.length<500)break;
  }
  rows=loaded;$('#status').textContent='';
 }catch(error){if(owner===user)$('#status').textContent=error.message||'Could not load texts.';}
 finally{if(owner===user){busy=false;render();}}
}
async function saveOutcome(row,replied) {
 if(busy||!owner)return; const user=owner; busy=true;render();$('#status').textContent='Saving…';
 try {
  let query=client.from('text_messages').update({replied,reviewed_at:new Date().toISOString()}).eq('user_id',user).eq('id',row.id);
  if(!replied)query=query.eq('appointment',false);
  const {data,error}=await query.select('id');if(error)throw error;if(owner!==user)return;
  if(!data.length)throw new Error('This text changed on another device. Refresh to see its latest result.');
  row.replied=replied;$('#status').textContent='Saved';rememberOutcomes([row],replied,user);
 }catch(error){if(owner===user)$('#status').textContent=error.message||'Could not save.';}
 finally{if(owner===user){busy=false;render();}}
}
async function markRemaining() {
 if(busy||!owner)return; const candidates=unreviewedTexts(visible());if(!candidates.length)return;
 const user=owner;busy=true;render();let saved=0;$('#status').textContent='Saving remaining results…';
 try {
  for(let offset=0;offset<candidates.length;offset+=100) {
   if(owner!==user)return;
   const batch=candidates.slice(offset,offset+100);
   // Recheck unknown status in the database so another phone's replies are preserved.
   const {data,error}=await client.from('text_messages').update({replied:false,reviewed_at:new Date().toISOString()}).eq('user_id',user).in('id',batch.map(r=>r.id)).is('replied',null).eq('appointment',false).select('id');
   if(error)throw error;if(owner!==user)return;
   const ids=new Set(data.map(r=>r.id)), changed=batch.filter(r=>ids.has(r.id));
   changed.forEach(r=>r.replied=false);saved+=changed.length;rememberOutcomes(changed,false,user);
  }
  $('#status').textContent=saved+' texts marked no reply. Existing replies were preserved.';
 }catch(error){if(owner===user)$('#status').textContent=saved+' saved. '+(error.message||'Could not finish; try again for the remaining texts.');}
 finally{if(owner===user){busy=false;render();}}
}
$('#search').addEventListener('input',()=>{shown=100;render();});$('#filter').addEventListener('change',()=>{shown=100;render();});$('#refresh').addEventListener('click',()=>void load());$('#bulk').addEventListener('click',()=>void markRemaining());$('#more').addEventListener('click',()=>{shown+=100;render();});
function sessionChanged(session) {
 const id=session?.user?.id||'';if(!id){owner='';rows=[];generation++;render();location.replace('account.html?next=text-review.html');return;}
 if(id!==owner){owner=id;rows=[];busy=false;shown=100;void load();}
}
client.auth.onAuthStateChange((_event,session)=>sessionChanged(session));
const {data}=await client.auth.getSession();sessionChanged(data.session);
