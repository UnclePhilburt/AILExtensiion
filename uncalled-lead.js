import {currentCallPass} from './call-pass-progress.js?v=6';
// Select from the whole calling list before asking IMPACT to open anything.
export async function findUncalledLead(client,user,{currentLeadId,otherLeadIds=[],missingLeadIds=[],now=Date.now(),allowRestart=true}={}){
 const progress=await currentCallPass(client,now);
 if(progress.error)throw progress.error;
 const {data:pass,error}=await client.from('workspace_call_passes').select('started_at,lead_ids').eq('user_id',user).maybeSingle();
 if(error)throw error;
 if(!pass?.lead_ids?.length)throw new Error('Open your Inbox and let Load all pages for calling finish first.');
 const recent=now-7200000,since=new Date(Math.min(Date.parse(pass.started_at),recent)).toISOString();
 async function history(table){
  const rows=[];
  for(let offset=0;;offset+=500){
   const {data,error}=await client.from(table).select('id,lead_id,started_at,completed_at'+(table==='followup_actions'?',kind':'')).eq('user_id',user).or('started_at.gte.'+since+',completed_at.gte.'+since).order('id').range(offset,offset+499);
   if(error)throw error;rows.push(...data);if(data.length<500)return rows;
  }
 }
 async function exclusions(){
  const rows=[];for(let offset=0;;offset+=500){const {data,error}=await client.from('workspace_excluded_leads').select('lead_id').eq('user_id',user).order('lead_id').range(offset,offset+499);if(error){if(['42P01','PGRST205'].includes(error.code))return [];throw error;}rows.push(...data);if(data.length<500)return rows;}
 }
 async function upcomingCallbacks(){
  const rows=[];
  for(let offset=0;;offset+=500){
   const {data,error}=await client.from('scheduled_events').select('id,impact_lead_id,kind,starts_at').eq('user_id',user).gt('starts_at',new Date(now-86400000).toISOString()).order('id').range(offset,offset+499);
   if(error)throw error;rows.push(...data);if(data.length<500)return rows;
  }
 }
 const [workspace,actions,callbacks,excluded]=await Promise.all([history('followup_workspace_calls'),history('followup_actions'),upcomingCallbacks(),exclusions()]);
 const called=new Set(),unavailable=new Set(missingLeadIds.map(String));
 const blocked=new Set([currentLeadId,...otherLeadIds,...missingLeadIds].filter(Boolean).map(String));
 for(const c of [...workspace,...actions.filter(a=>a.kind==='call')]){
  if(c.started_at&&Date.parse(c.started_at)>=Date.parse(pass.started_at))called.add(String(c.lead_id));
  if(c.started_at&&(Date.parse(c.started_at)>=Date.parse(pass.started_at)||Math.max(Date.parse(c.started_at)||0,Date.parse(c.completed_at)||0)>=recent))blocked.add(String(c.lead_id));
 }
 const centralDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
 for(const event of callbacks){const scheduled=event.kind==='callback'?Date.parse(event.starts_at)>now:['appointment','virtual-appointment'].includes(event.kind)&&centralDay(event.starts_at)>=centralDay(now);if(scheduled&&event.impact_lead_id){blocked.add(String(event.impact_lead_id));unavailable.add(String(event.impact_lead_id));}}
 for(const lead of excluded){blocked.add(String(lead.lead_id));unavailable.add(String(lead.lead_id));}
 const ids=pass.lead_ids.map(String),position=ids.indexOf(String(currentLeadId));
 const ordered=position<0?ids:[...ids.slice(position+1),...ids.slice(0,position)];
 const leadId=ordered.find(id=>!blocked.has(id));
 const callable=ids.filter(id=>!unavailable.has(id));
 // A phone holding an uncalled lead does not mean the shared pass is finished.
 if(!leadId&&allowRestart&&callable.length&&callable.every(id=>called.has(id))){
  const restart=await client.rpc('workspace_pass_progress',{p_restart:progress.data.pass});
  if(restart.error)throw restart.error;
  return findUncalledLead(client,user,{currentLeadId,otherLeadIds,missingLeadIds,now,allowRestart:false});
 }
 return leadId?{leadId}:{leadId:null};
}
