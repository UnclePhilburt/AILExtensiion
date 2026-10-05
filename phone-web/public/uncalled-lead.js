// Select from the whole calling list before asking IMPACT to open anything.
export async function findUncalledLead(client,user,{currentLeadId,otherLeadIds=[],missingLeadIds=[],now=Date.now()}={}){
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
 const [workspace,actions]=await Promise.all([history('followup_workspace_calls'),history('followup_actions')]);
 const blocked=new Set([currentLeadId,...otherLeadIds,...missingLeadIds].filter(Boolean).map(String));
 for(const c of [...workspace,...actions.filter(a=>a.kind==='call')]){
  if(c.started_at&&(Date.parse(c.started_at)>=Date.parse(pass.started_at)||Math.max(Date.parse(c.started_at)||0,Date.parse(c.completed_at)||0)>=recent))blocked.add(String(c.lead_id));
 }
 const ids=pass.lead_ids.map(String),position=ids.indexOf(String(currentLeadId));
 const ordered=position<0?ids:[...ids.slice(position+1),...ids.slice(0,position)];
 const leadId=ordered.find(id=>!blocked.has(id));
 return leadId?{leadId}:{leadId:null};
}
