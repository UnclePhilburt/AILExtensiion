import { createClient } from '@supabase/supabase-js';
const extension = Boolean(globalThis.chrome?.runtime?.id);
const storage = extension ? {
  async getItem(key) { return (await chrome.storage.local.get(key))[key] ?? null; },
  async setItem(key, value) { await chrome.storage.local.set({ [key]: value }); },
  async removeItem(key) { await chrome.storage.local.remove(key); }
} : localStorage;
export const client = createClient('https://uawladqdbbbgddqtdjoi.supabase.co', 'sb_publishable_s2BgUBxX6_6gAGazndtaHQ_xaR6pHp3', {
  auth: { storage, storageKey: 'impact.supabase.session', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !extension }
});
export async function accessToken() {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('Sign in to your IMPACT Companion account first.');
  return data.session.access_token;
}
