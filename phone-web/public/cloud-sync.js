import { client } from './auth-runtime.js';

export const PHONE_URL = 'https://unclephilburt.github.io/AILExtensiion/';
export async function cloudEnabled() {
  if (globalThis.chrome?.runtime?.id) {
    const settings = await chrome.storage.local.get('impact.connectionMode');
    return settings['impact.connectionMode'] !== 'local';
  }
  return new URLSearchParams(location.search).get('mode') !== 'local';
}
export async function cloudUser() {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('Sign in to your account first.');
  return data.session.user.id;
}
export function checkCloud(error) {
  if (!error) return;
  if (['42P01','PGRST202','PGRST205'].includes(error.code)) throw new Error('Cloud setup is not finished yet. Ask your administrator to complete Supabase setup.');
  if (error.code === '42501') throw new Error('Your account needs access from the administrator.');
  throw new Error(error.message || 'Cloud connection failed. Try again.');
}
export async function cloudState() {
  const user = await cloudUser();
  const membership = await client.from('companion_members').select('enabled').eq('user_id',user).maybeSingle();
  checkCloud(membership.error);
  if (!membership.data?.enabled) throw new Error('Your account needs access from the administrator.');
  const { data, error } = await client.from('companion_sync').select('*').eq('user_id',user).maybeSingle();
  checkCloud(error);
  return data;
}
export function isOnline(timestamp) { return Boolean(timestamp && Date.now() - Date.parse(timestamp) < 45000); }
export function visibleLead(state) {
  return isOnline(state?.desktop_seen) && Date.now() - Date.parse(state?.lead_updated_at) < 1800000 ? state?.lead : null;
}
export async function cloudTouchPhone() {
  const { error } = await client.from('companion_sync').update({phone_seen:new Date().toISOString()}).eq('user_id',await cloudUser());
  checkCloud(error);
}
export async function cloudSend(state, command, id = crypto.randomUUID()) {
  if (!isOnline(state?.desktop_seen)) throw new Error('Your computer is offline. Open IMPACT and try again.');
  const { error } = await client.rpc('companion_send',{p_id:id,p_device:state.device_id,p_command:command});
  checkCloud(error);
}
export async function watchCloud(onChange, onStatus = () => {}) {
  const user = await cloudUser();
  const channel = client.channel(`companion-${crypto.randomUUID()}`).on('postgres_changes', {
    event:'*',schema:'public',table:'companion_sync',filter:`user_id=eq.${user}`
  }, () => onChange()).subscribe(onStatus);
  return () => { void client.removeChannel(channel); };
}
