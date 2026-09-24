import { createClient } from '@supabase/supabase-js';

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

document.querySelector('#back').href = isExtension ? '../options/options.html' : './';
function say(text, error = false) { message.textContent = text; message.classList.toggle('error', error); }
function render(session) {
  const signedIn = Boolean(session?.user);
  form.hidden = signedIn;
  account.hidden = !signedIn;
  passwordForm.hidden = !signedIn;
  document.querySelector('#signedInEmail').textContent = session?.user?.email || '';
  document.querySelector('#passwordTitle').textContent = completingInvite ? 'Set your password' : 'Change password';
  if (signedIn && completingInvite) say('Choose a password to finish setting up your account.');
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
    const { data, error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    password.value = '';
    if (error) throw error;
    render(data.session);
    say('Signed in. Your account is ready.');
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
  void run(async () => {
    const { error } = await client.auth.updateUser({ password: nextPassword.value });
    nextPassword.value = confirmation.value = '';
    if (error) throw error;
    completingInvite = false;
    say('Password saved. Use this email and password on your phone and in the extension.');
  });
});
document.querySelector('#signOut').addEventListener('click', () => void run(async () => {
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
void client.auth.getSession().then(({ data, error }) => {
  if (error) throw error;
  render(data.session);
  if (originalHash.get('error_description')) say(originalHash.get('error_description'), true);
}).catch(error => say(error.message, true));
