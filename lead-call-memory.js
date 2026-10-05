export function recentCallUntil(calls,actions,now=Date.now()){
 const times=[...calls,...actions.filter(a=>a.kind==='call')].filter(r=>r.started_at).map(r=>Math.max(Date.parse(r.started_at)||0,Date.parse(r.completed_at)||0));
 const until=Math.max(0,...times)+7200000;return until>now?until:0;
}
export async function loadLeadMemory(client,user,leadId){
 const read=async(table,order)=>{const {data,error}=await client.from(table).select('*').eq('user_id',user).eq('lead_id',String(leadId)).order(order,{ascending:false}).limit(100);if(error)throw error;return data||[];};
 const [calls,actions,texts]=await Promise.all([read('followup_workspace_calls','started_at'),read('followup_actions','started_at'),read('text_messages','sent_at')]);
 const linked=new Set(calls.map(c=>c.action_id).filter(Boolean));
 const events=[...calls.map(c=>({at:c.started_at,label:'Workspace call',number:c.phone,result:c.result||'Awaiting result'})),...actions.filter(a=>a.kind==='call'&&a.started_at&&!linked.has(a.id)).map(a=>({at:a.started_at,label:'Follow-up call',result:a.result||'Awaiting result'})),...texts.map(t=>({at:t.sent_at,label:'Text sent',number:t.phone,result:t.replied===true?'Replied':t.replied===false?'No reply reported':''}))].filter(e=>e.at).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 return {until:recentCallUntil(calls,actions),events};
}
