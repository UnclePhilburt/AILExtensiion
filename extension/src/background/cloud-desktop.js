import { client } from '../shared/auth-runtime.js';
import { cloudUser, checkCloud, watchCloud } from '../shared/cloud-sync.js';
let devicePromise;
let owner = '', stopWatch, nextPoll = 0, lastHeartbeat = 0;
let busy = false;
let liveOwner = '', liveChannel, liveReady;
async function device() {
  if (!devicePromise) devicePromise = (async () => {
    const stored = await chrome.storage.local.get('impact.deviceId');
    const id = stored['impact.deviceId'] || crypto.randomUUID();
    await chrome.storage.local.set({'impact.deviceId':id});
    return id;
  })();
  return devicePromise;
}
async function ready() {
  const user = await cloudUser();
  if (owner !== user) {
    stopWatch?.(); owner = user; nextPoll = 0; lastHeartbeat = 0;
    stopWatch = await watchCloud(() => { nextPoll = 0; });
  }
}
async function publishLiveLane(lead, slot, clear = false) {
  const user = await cloudUser();
  if (liveOwner !== user) {
    liveChannel?.unsubscribe?.();
    liveOwner = user;
    liveChannel = client.channel(`companion-live-${user}`, {config:{broadcast:{self:false}}});
    liveReady = new Promise(resolve => liveChannel.subscribe(status => { if (status === 'SUBSCRIBED') resolve(); }));
  }
  await liveReady;
  await liveChannel.send({type:'broadcast',event:'lane',payload:{slot,lead,clear,at:new Date().toISOString()}});
}
chrome.storage.onChanged.addListener(changes => {
  if (changes['impact.supabase.session'] || changes['impact.connectionMode']) {
    stopWatch?.(); stopWatch = null; owner = ''; lastHeartbeat = 0; nextPoll = 0;
    liveChannel?.unsubscribe?.(); liveChannel = null; liveOwner = ''; liveReady = null;
  }
});
function missingSlotRpc(error) {
  return /PGRST202|schema cache|Could not find the function/i.test(error?.message || error?.code || '');
}
export async function publishCloud(lead, slot = '1') {
  await ready();
  const phone = slot === '2' ? '2' : '1';
  // Bounded, so a hung request cannot hold up the (ordered) lead writes forever.
  let {error} = await client.rpc('companion_desktop',{p_device:await device(),p_lead:lead,p_slot:phone}).abortSignal(AbortSignal.timeout(10000));
  if (error && phone === '1' && missingSlotRpc(error)) {
    ({error} = await client.rpc('companion_desktop',{p_device:await device(),p_lead:lead}).abortSignal(AbortSignal.timeout(10000)));
  }
  checkCloud(error); lastHeartbeat = Date.now();
  void publishLiveLane(lead, phone).catch(() => {});
  return {ok:true};
}
export async function clearCloudSlot(slot) {
  await ready();
  const phone = slot === '2' ? '2' : '1';
  const {error} = await client.rpc('companion_desktop',{p_device:await device(),p_slot:phone,p_clear:true}).abortSignal(AbortSignal.timeout(10000));
  if (error && missingSlotRpc(error)) return {ok:false};
  checkCloud(error);
  void publishLiveLane(null, phone, true).catch(() => {});
  return {ok:true};
}
// The lead id the phone will read from the cloud right now ('' if none).
export async function cloudLeadId(slot = '1') {
  const phone = slot === '2' ? '2' : '1';
  const {data,error} = await client.from('companion_sync').select('lead,slot_leads')
    .eq('user_id',await cloudUser()).eq('device_id',await device()).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
  checkCloud(error);
  const slotted = data?.slot_leads?.[phone];
  return slotted?.leadId || (phone === '1' ? data?.lead?.leadId : '') || '';
}
export async function takeCloudCommand(slot = '1') {
  if (busy || Date.now() < nextPoll) return {command:null};
  // Phone controls should feel immediate; the cloud command queue is still
  // bounded and command IDs make repeated taps safe.
  busy = true; nextPoll = Date.now() + 600;
  try {
    await ready();
    if (Date.now() - lastHeartbeat > 10000) {
      const {error} = await client.rpc('companion_desktop',{p_device:await device()});
      checkCloud(error); lastHeartbeat = Date.now();
    }
    const phone = slot === '2' ? '2' : '1';
    let {data,error} = await client.rpc('companion_take',{p_device:await device(),p_slot:phone});
    if (error && missingSlotRpc(error)) {
      if (phone === '2') return {command:null};
      ({data,error} = await client.rpc('companion_take',{p_device:await device()}));
    }
    checkCloud(error);
    if (data) nextPoll = 0;
    return {command:data};
  } finally { busy = false; }
}
export async function reportCloudResult(message, slot = '1') {
  const phone = slot === '2' ? '2' : '1';
  const {error} = await client.from('companion_sync').update({result:{message,at:new Date().toISOString(),slot:phone}})
    .eq('user_id',await cloudUser()).eq('device_id',await device());
  checkCloud(error);
}
