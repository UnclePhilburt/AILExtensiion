import { client, accessToken } from '../shared/auth-runtime.js';
import { parseBridgeUrl } from '../shared/bridge-config.js';
import { STORAGE_KEYS } from '../shared/storage-keys.js';
import { cloudEnabled, cloudState, isOnline, PHONE_URL } from '../shared/cloud-sync.js';
const $ = selector => document.querySelector(selector);
let session = null;
let checking = false;
let busy = false;
function say(message, error = false) { $('#message').textContent = message; $('#message').classList.toggle('error', error); }
function renderListener(listening, error = '') {
  $('#objectionListening').checked = Boolean(listening);
  $('#listenerHint').textContent = error || (listening
    ? 'Listening locally for saved objection phrases. No audio is saved.'
    : 'Off — it never listens unless you turn this on.');
}
async function refreshListener() {
  const local = await chrome.storage.local.get(['impact.objectionListening', 'impact.objectionListenerError']);
  renderListener(local['impact.objectionListening'], local['impact.objectionListenerError']);
}
function renderSession(next) {
  session = next;
  $('#loading').hidden = true;
  $('#login').hidden = Boolean(next);
  $('#dashboard').hidden = !next;
  $('#accountEmail').textContent = next?.user?.email || '';
  if (next) { void refreshStatus(); void refreshListener(); }
}
async function accountPage() { await chrome.tabs.create({url:chrome.runtime.getURL('src/account/account.html')}); window.close(); }
$('#manageLogin').addEventListener('click', accountPage);
$('#manageAccount').addEventListener('click', accountPage);
$('#openPhone').addEventListener('click', () => chrome.tabs.create({url:PHONE_URL}));
$('#openOptions').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (tab?.id) await chrome.storage.session.set({'impact.debugTabId':tab.id});
  await chrome.runtime.openOptionsPage();
});
$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#signIn').disabled = true; say('Signing in…');
  try {
    const {data,error} = await client.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    $('#password').value = '';
    if (error) throw error;
    renderSession(data.session); say('');
  } catch (error) { say(error.message,true); }
  finally { $('#signIn').disabled = false; }
});
client.auth.onAuthStateChange((_event,next) => renderSession(next));
chrome.storage.onChanged.addListener(changes => {
  if (changes['impact.supabase.session']) void client.auth.getSession().then(({data})=>renderSession(data.session));
  if (changes['impact.objectionListening'] || changes['impact.objectionListenerError']) void refreshListener();
});
$('#objectionListening').addEventListener('change', async (event) => {
  const enabled = event.target.checked;
  event.target.disabled = true;
  renderListener(enabled, enabled ? 'Starting local listening…' : 'Turning listening off…');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'impact/setObjectionListening', enabled });
    if (!result?.ok) throw new Error(result?.error || 'Could not change listening.');
    renderListener(result.listening);
  } catch (error) {
    renderListener(false, error.message || 'Could not start local listening.');
  } finally { event.target.disabled = false; }
});
async function refreshStatus() {
  if (!session || checking) return;
  checking = true;
  const accountId = session.user.id;
  try {
    const [active] = await chrome.tabs.query({active:true,currentWindow:true});
    const onImpact = Boolean(active?.url?.startsWith('https://mobile.impact.ailife.com/Lead/'));
    $('#impactState').textContent = onImpact ? 'Open and ready' : 'Select an IMPACT tab';
    const useCloud = await cloudEnabled();
    $('#connectionLabel').textContent = useCloud ? 'Cloud connection' : 'Computer bridge';
    $('#phoneSetup').hidden = !useCloud;
    let status;
    if (useCloud) {
      const state = await cloudState();
      const local = await chrome.storage.local.get('impact.deviceId');
      if (isOnline(state?.desktop_seen) && state.device_id !== local['impact.deviceId']) throw new Error('Another computer is connected. Close IMPACT there and wait 45 seconds.');
      status = {phoneConnected:isOnline(state?.phone_seen),updatedAt:state?.lead_updated_at};
    } else {
    const settings = await chrome.storage.local.get([STORAGE_KEYS.bridgeUrl,STORAGE_KEYS.bridgeToken]);
    const bridgeUrl = parseBridgeUrl(settings[STORAGE_KEYS.bridgeUrl]);
    if (!settings[STORAGE_KEYS.bridgeToken]) throw new Error('Set up the bridge connection in Options.');
    const response = await fetch(`${bridgeUrl}/api/status`, {headers:{Authorization:`Bearer ${await accessToken()}`,'x-bridge-token':settings[STORAGE_KEYS.bridgeToken]},signal:AbortSignal.timeout(10000)});
    status = await response.json();
    if (!response.ok) throw new Error(status.error || 'The bridge did not respond.');
    }
    if (session?.user.id !== accountId) return;
    $('#bridgeState').textContent = 'Connected';
    $('#phoneState').textContent = status.phoneConnected ? 'Connected' : 'Not connected';
    $('#lastUpdate').textContent = status.updatedAt ? new Date(status.updatedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : 'No updates yet';
    const connected = status.phoneConnected && onImpact;
    $('#connectionCard').dataset.state = connected ? 'connected' : 'checking';
    $('#connectionTitle').textContent = connected ? 'Connected' : 'Almost ready';
    $('#connectionHint').textContent = !onImpact ? 'Select your IMPACT lead tab to use the phone controls.' : !status.phoneConnected ? 'Open the phone page and sign in with this account.' : 'Your computer and phone are ready to work together.';
    $('#updatePhone').disabled = !onImpact || busy;
  } catch (error) {
    $('#bridgeState').textContent = 'Not connected'; $('#phoneState').textContent = 'Unavailable'; $('#lastUpdate').textContent = '—';
    $('#connectionCard').dataset.state = 'offline'; $('#connectionTitle').textContent = 'Connection needed';
    $('#connectionHint').textContent = error.name==='TimeoutError' || error instanceof TypeError ? 'Cannot reach your connection. Check your internet and connection settings.' : error.message;
    $('#updatePhone').disabled = true;
  } finally { checking = false; }
}
$('#updatePhone').addEventListener('click', async () => {
  if (busy) return;
  busy=true; $('#updatePhone').disabled=true; say('Syncing your phone…');
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.url?.startsWith('https://mobile.impact.ailife.com/Lead/')) throw new Error('Open your IMPACT lead tab first.');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/content/selector-config.js','src/content/impact-diagnostic.js']});
    const result = await withTimeout(chrome.tabs.sendMessage(tab.id,{type:'impact/getSnapshot',includeNextLead:false}),10000);
    if (!result?.ok) throw new Error(result?.error || 'Could not read IMPACT.');
    const sent = await withTimeout(chrome.runtime.sendMessage({type:'impact/publishLead',lead:result.snapshot.localLeadPreview}),12000);
    if (!sent?.ok) throw new Error(sent?.error || 'Could not sync the phone.');
    say('Phone synced.');
  } catch (error) { say(error.message,true); }
  finally { busy=false; void refreshStatus(); }
});
function withTimeout(promise, ms) { let timer; return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The request timed out. Refresh IMPACT and try again.')),ms);})]).finally(()=>clearTimeout(timer)); }
setInterval(refreshStatus,5000);
