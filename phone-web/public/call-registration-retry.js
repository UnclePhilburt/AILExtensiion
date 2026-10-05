export function createCallRegistrationRetry({getCall,getUser,getSlot,getLead,isHidden,save,send,now=Date.now}){
 let busy=false;
 async function tick(){
  const call=getCall(),user=getUser(),lead=getLead();
  if(busy||isHidden()||!user||!call?.retryRegistration||call.confirmedAt||call.resultSentAt||call.slot!==getSlot()||String(call.leadId)!==String(lead?.leadId)||!lead?.callRetrySupported||now()-call.startedAt>=43200000)return;
  const delay=Math.min(30000,5000*2**Math.min(call.retryAttempts||0,3));
  if(now()-(call.registrationAttemptAt||call.startedAt)<delay)return;
  busy=true;
  const next={...call,registrationAttemptAt:now(),retryAttempts:(call.retryAttempts||0)+1};save(next);
  try{await send('call',{leadId:call.leadId,phoneType:call.phoneLabel,phoneNumber:call.phoneNumber,healthCallId:call.healthCallId,registrationRetry:true});}finally{busy=false;}
 }
 function confirm(message){
  const call=getCall(),match=String(message||'').match(/\[call:([0-9a-f-]+)\]/i);
  if(match&&call?.healthCallId===match[1]&&call.slot===getSlot()){save({...call,confirmedAt:now()});return true;}return false;
 }
 return {tick,confirm};
}
