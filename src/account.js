import { createClient } from '@supabase/supabase-js';
import { cleanFirstName, loadPhoneSettings, savePhoneSettings } from '../phone-web/public/settings-store.js';
import { CLOSED_MESSAGE, callingHoursOpen } from '../phone-web/public/work-hours.js';

// Public client configuration only. Never put secret/service-role keys here.
const projectUrl = 'https://uawladqdbbbgddqtdjoi.supabase.co';
const publishableKey = 'sb_publishable_s2BgUBxX6_6gAGazndtaHQ_xaR6pHp3';
const hostedAccountUrl = 'https://unclephilburt.github.io/AILExtensiion/account.html';
const isExtension = Boolean(globalThis.chrome?.runtime?.id);
const storage = isExtension ? {
  async getItem(key) { return (await chrome.storage.local.get(key))[key] ?? null; },
  async setItem(key, value) { await chrome.storage.local.set({ [key]: value }); },
  async removeItem(key) { await chrome.storage.local.remove(key); }
} : localStorage;
const client = createClient(projectUrl, publishableKey, {
  auth: { storage, storageKey: 'impact.supabase.session', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isExtension }
});
const form = document.querySelector('#signInForm');
const passwordForm = document.querySelector('#passwordForm');
const message = document.querySelector('#message');
const account = document.querySelector('#account');
const email = document.querySelector('#email');
const password = document.querySelector('#password');
const originalHash = new URLSearchParams(location.hash.slice(1));
let completingInvite = ['invite', 'recovery'].includes(originalHash.get('type'));
let busy = false;

const requestedNext = new URLSearchParams(location.search).get('next');
const phoneNext = requestedNext === 'workspace.html' ? 'workspace.html' : './';
document.querySelector('#back').href = isExtension ? '../options/options.html' : phoneNext;
document.querySelector('#continue').href = isExtension ? '../options/options.html' : phoneNext;
if (!isExtension && new URLSearchParams(location.search).get('mode') === 'local') {
  document.querySelector('#back').href = document.querySelector('#continue').href = `${phoneNext}?mode=local`;
}
function say(text, error = false) { message.textContent = text; message.classList.toggle('error', error); }
function render(session) {
  const signedIn = Boolean(session?.user);
  form.hidden = signedIn;
  account.hidden = !signedIn;
  passwordForm.hidden = !signedIn;
  document.querySelector('#signedInEmail').textContent = session?.user?.email || '';
  document.querySelector('#teamAdmin').hidden = session?.user?.email?.toLowerCase() !== 'cody2931@gmail.com';
  document.querySelector('#passwordTitle').textContent = completingInvite ? 'Set your password' : 'Change password';
  const nameField = document.querySelector('#accountFirstName');
  if (nameField && !nameField.value) {
    nameField.value = loadPhoneSettings(localStorage).firstName || session?.user?.user_metadata?.first_name || '';
  }
  if (nameField) nameField.required = completingInvite;
  if (signedIn && completingInvite) say('Choose a password and enter your first name to finish setting up your account.');
}
async function run(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(button => button.disabled = true);
  say('Working…');
  try { await work(); } catch (error) { say(error.message || 'Could not complete that request.', true); }
  finally { busy = false; document.querySelectorAll('button').forEach(button => button.disabled = false); }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  void run(async () => {
    if (!callingHoursOpen()) throw new Error(CLOSED_MESSAGE);
    const { data, error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    password.value = '';
    if (error) throw error;
    render(data.session);
    say('Signed in. Your account is ready.');
    if (!completingInvite) location.assign(isExtension ? '../options/options.html' : new URLSearchParams(location.search).get('mode') === 'local' ? './?mode=local' : './');
  });
});
document.querySelector('#resetPassword').addEventListener('click', () => {
  if (!email.value.trim() || !email.reportValidity()) { say('Enter your account email first.', true); return; }
  void run(async () => {
    const { error } = await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: hostedAccountUrl });
    if (error) throw error;
    say('If that account exists, check your email for a password reset link.');
  });
});
passwordForm.addEventListener('submit', event => {
  event.preventDefault();
  const nextPassword = document.querySelector('#newPassword');
  const confirmation = document.querySelector('#confirmPassword');
  if (nextPassword.value !== confirmation.value) { say('The passwords do not match.', true); return; }
  const given = cleanFirstName(document.querySelector('#accountFirstName').value);
  if (completingInvite && !given) { say('Enter your first name. Use letters, not numbers.', true); return; }
  void run(async () => {
    const update = { password: nextPassword.value };
    if (given) update.data = { first_name: given };
    const { error } = await client.auth.updateUser(update);
    nextPassword.value = confirmation.value = '';
    if (error) throw error;
    if (given) {
      savePhoneSettings(localStorage, { firstName: given });
      try { await client.rpc('alongside_set_profile', { p_name: given, p_share: loadPhoneSettings(localStorage).shareAlongside !== false }); }
      catch { /* Alongside storage may not be set up yet. The name is still saved on this phone. */ }
    }
    completingInvite = false;
    say('Password saved. Use this email and password on your phone and in the extension.');
  });
});
document.querySelector('#signOut').addEventListener('click', () => void run(async () => {
  const { data } = await client.auth.getSession();
  if (data.session) {
    // Remove the shared snapshot and pending actions when ending a work session.
    // A still-open signed-in computer may publish fresh data again.
    try { await client.from('companion_sync').delete().eq('user_id',data.session.user.id).abortSignal(AbortSignal.timeout(3000)); }
    catch { /* Signing out must also work while offline. */ }
  }
  const bridgeSettings = isExtension ? await chrome.storage.local.get(['impact.bridgeUrl', 'impact.bridgeToken']) : null;
  const bridgeUrl = isExtension ? (bridgeSettings['impact.bridgeUrl'] || 'http://127.0.0.1:8787') : localStorage.getItem('impact.bridgeUrl');
  const bridgeToken = isExtension ? bridgeSettings['impact.bridgeToken'] : localStorage.getItem('impact.bridgeToken');
  if (bridgeUrl && bridgeToken && data.session) {
    try {
      await fetch(`${bridgeUrl}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'x-bridge-token': bridgeToken }, signal: AbortSignal.timeout(3000) });
    } catch { /* Still clear this device's session if its bridge is offline. */ }
  }
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw error;
  completingInvite = false;
  render(null);
  say('Signed out on this device.');
}));
client.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') completingInvite = true;
  render(session);
});
async function closeForTheNight() {
  if (callingHoursOpen()) return;
  const { data } = await client.auth.getSession();
  if (data?.session) await client.auth.signOut({ scope: 'local' });
  render(null);
  say(CLOSED_MESSAGE, true);
}
void client.auth.getSession().then(async ({ data, error }) => {
  if (error) throw error;
  if (!callingHoursOpen()) { await closeForTheNight(); return; }
  render(data.session);
  if (originalHash.get('error_description')) say(originalHash.get('error_description'), true);
  else if (new URLSearchParams(location.search).get('closed')) say(CLOSED_MESSAGE, true);
}).catch(error => say(error.message, true));
setInterval(() => void closeForTheNight().catch(() => {}), 30000);
