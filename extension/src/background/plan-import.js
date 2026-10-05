import {leadSnapshot,scheduleFromHistory} from '../shared/calendar-events.js';
import { client } from '../shared/auth-runtime.js';
import { cloudUser, checkCloud } from '../shared/cloud-sync.js';
export async function planImportMessage(message,sender) {
 const url=new URL(sender.tab?.url || 'https://invalid/');
 if(url.origin!=='https://mobile.impact.ailife.com'||!/^\/Lead\/Inbox\/?$/.test(url.pathname))throw new Error('Open the IMPACT inbox to import leads.');
 const user=await cloudUser();
 if(message.expectedUser && message.expectedUser!==user)throw new Error('Account changed. Restart the import.');
 if(message.type==='impact/planStatus') {
  const {data,error}=await client.from('followup_settings').select('enabled').eq('user_id',user).maybeSingle();
  checkCloud(error);
  return {ok:true,enabled:!error&&data?.enabled===true,userId:user};
 }
 for(const lead of message.leads||[]) {
  const events=scheduleFromHistory(lead.callHistory||[]);
  if(events.length){const {error}=await client.rpc('companion_save_schedule',{p_lead:leadSnapshot(lead),p_events:events,p_replace:true});if(error)throw new Error('Could not save this lead’s appointments: '+error.message);}
 }
 const {data,error}=await client.rpc('plan_import',{p_leads:message.leads||[],p_note:message.note||''});
 checkCloud(error);return {ok:true,added:data,userId:user};
}
