import { client } from '../shared/auth-runtime.js';
import { cloudUser, checkCloud, watchCloud } from '../shared/cloud-sync.js';
let devicePromise;
let owner = '', stopWatch, nextPoll = 0, lastHeartbeat = 0;
let busy = false;
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
chrome.storage.onChanged.addListener(changes => {
  if (changes['impact.supabase.session'] || changes['impact.connectionMode']) {
    stopWatch?.(); stopWatch = null; owner = ''; lastHeartbeat = 0; nextPoll = 0;
  }
});
export async function publishCloud(lead) {
  await ready();
  const {error} = await client.rpc('companion_desktop',{p_device:await device(),p_lead:lead});
  checkCloud(error); lastHeartbeat = Date.now();
  return {ok:true};
}
export async function takeCloudCommand() {
  if (busy || Date.now() < nextPoll) return {command:null};
  busy = true; nextPoll = Date.now() + 3000;
  try {
    await ready();
    if (Date.now() - lastHeartbeat > 10000) {
      const {error} = await client.rpc('companion_desktop',{p_device:await device()});
      checkCloud(error); lastHeartbeat = Date.now();
    }
    const {data,error} = await client.rpc('companion_take',{p_device:await device()});
    checkCloud(error);
    if (data) nextPoll = 0;
    return {command:data};
  } finally { busy = false; }
}
export async function reportCloudResult(message) {
  const {error} = await client.from('companion_sync').update({result:{message,at:new Date().toISOString()}})
    .eq('user_id',await cloudUser()).eq('device_id',await device());
  checkCloud(error);
}
