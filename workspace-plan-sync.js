// A durable, account-scoped outbox keeps native dialer navigation independent of network writes.
export function createWorkspacePlanSync({client,storage,getUser,notify}){
 let flushing=false;
 const key=user=>'impact.workspacePlanCalls.v1:'+user;
 const read=user=>{try{return JSON.parse(storage.getItem(key(user))||'[]');}catch{return [];}};
 async function flush(){
  const user=getUser();if(!user||flushing)return;flushing=true;
  try{for(const item of read(user)){
   if(getUser()!==user)break;
   const {error}=await client.rpc('plan_workspace_call',item);
   if(error)throw error;
   if(getUser()!==user)break;
   // A result may have been queued while its initial call was uploading.
   storage.setItem(key(user),JSON.stringify(read(user).filter(row=>row.p_call!==item.p_call||JSON.stringify(row)!==JSON.stringify(item))));
  }}catch(error){notify(['PGRST202','42883'].includes(error.code)?'Run the workspace/follow-up SQL update to sync call history. Calls are saved on this phone until then.':'Call history is saved on this phone and will retry syncing to your plan.');}finally{flushing=false;}
 }
 function record(call,lead,result=null){
  const user=getUser();if(!user||!call?.healthCallId)return;
  const rows=read(user),existing=rows.find(r=>r.p_call===call.healthCallId);
  const item={p_call:call.healthCallId,p_lead:existing?.p_lead||{leadId:call.leadId,leadName:call.leadName,phone:lead.phone||'',slot:lead.slot||'1'},p_started:new Date(call.startedAt).toISOString(),p_result:result||existing?.p_result||null,p_completed:result?new Date().toISOString():existing?.p_completed||null};
  try{storage.setItem(key(user),JSON.stringify([...rows.filter(r=>r.p_call!==item.p_call),item]));void flush();}catch{notify('Could not save call history on this phone. Keep this page open and check browser storage.');}
 }
 return {record,flush};
}
