import { client } from './auth-runtime.js';
import { normalizeCallingNumber, formatCallingNumber, numberHealth } from './calling-numbers-model.js?v=1';
import { applyUserName } from './user-name.js';

// Carrier forms open in the browser. Companion does not send the number.
const SPAM_REMOVAL = [
  ['Verizon', 'https://www.voicespamfeedback.com/vsf/'],
  ['T-Mobile', 'https://callreporting.t-mobile.com/'],
  ['AT&T', 'https://hiyahelp.zendesk.com/hc/en-us/requests/new?ticket_form_id=824667'],
  ['Sprint', 'https://reportarobocall.com/trf/'],
  ['Register as a real number', 'https://www.freecallerregistry.com/fcr/']
];
const SPAM_HELP = [
  ['My number is showing as spam', 'https://www.youtube.com/results?search_query=my+number+is+showing+as+spam'],
  ['Twilio video', 'https://www.youtube.com/watch?v=TatXBxVXPzs']
];

if (typeof applyUserName === 'function') applyUserName();

const section = document.querySelector('#callingNumbers');
const form = document.querySelector('#callingNumberForm');
const list = document.querySelector('#callingNumberList');
const status = document.querySelector('#callingNumberStatus');
const refresh = document.querySelector('#refreshCallingNumbers');
let generation = 0;
let busy = false;
function node(tag, text, className) {
  const item = document.createElement(tag); item.textContent = text;
  if (className) item.className = className;
  return item;
}
function controls(disabled) { section.querySelectorAll('button,input').forEach(item => { item.disabled = disabled; }); }
function render(numbers, stats) {
  list.replaceChildren();
  if (!numbers.length) {
    list.append(node('p', 'No calling numbers saved. Add one above, then set it active before the next call.', 'emptyNumbers'));
    return;
  }
  const live = numbers.filter((number) => !number.archived).sort((a, b) => Number(b.active) - Number(a.active));
  const archived = numbers.filter((number) => number.archived);
  for (const number of live) list.append(numberCard(number, stats));
  if (!archived.length) return;
  const box = document.createElement('details');
  box.className = 'archivedNumbers';
  box.append(node('summary', `Archived (${archived.length})`));
  for (const number of archived) box.append(numberCard(number, stats));
  list.append(box);
}

function numberCard(number, stats) {
  const card = node('article', '', `callingNumberCard${number.active ? ' isActive' : ''}`);
  const top = document.createElement('div');
  top.className = 'cardTop';
  const state = number.active ? 'Active for new calls' : number.archived ? 'Archived · history saved' : 'Not in use';
  if (stats) {
    const health = numberHealth(stats, number.id);
    top.append(node('p', health.estimateLabel, `healthEstimate ${health.estimate}`), node('p', state, 'numberState'));
    card.append(top, node('h3', formatCallingNumber(number.phone)));
    if (number.label) card.append(node('p', number.label, 'numberName'));
    card.append(countRow([[health.answered, 'Answered'], [health.no_answer, 'No answer'], [health.appointments, 'Appointments']]));
    if (health.estimate === 'early') card.append(node('p', health.estimateDetail, 'earlyNote'));
  } else {
    top.append(node('p', state, 'numberState'));
    card.append(top, node('h3', formatCallingNumber(number.phone)));
    if (number.label) card.append(node('p', number.label, 'numberName'));
    card.append(node('p', 'Statistics are unavailable. Refresh to try again.', 'earlyNote'));
  }
  if (!number.archived) {
    const actions = node('div', '', 'numberActions');
    const active = node('button', number.active ? 'Stop tracking new calls' : 'Set active');
    active.type = 'button';
    active.addEventListener('click', () => void run(() => manage(number.id, number.active ? 'pause' : 'activate')));
    const archive = node('button', 'Archive');
    archive.type = 'button';
    archive.className = 'secondary';
    archive.addEventListener('click', () => void run(() => manage(number.id, 'archive')));
    actions.append(active, archive);
    card.append(actions);
  }
  card.append(spamRemoval(formatCallingNumber(number.phone)));
  return card;
}

function countRow(pairs) {
  const row = document.createElement('div');
  row.className = 'countRow';
  for (const [value, label] of pairs) {
    const cell = document.createElement('div');
    cell.append(node('strong', String(value)), node('span', label));
    row.append(cell);
  }
  return row;
}

function spamRemoval(phone) {
  const box = document.createElement('details');
  box.className = 'spamRemoval';
  box.append(node('summary', 'Clear spam lists'));
  box.append(node('p', 'About once a month. Copy this number, then paste it into each form.'));
  const copy = node('button', 'Copy this number');
  copy.type = 'button';
  copy.addEventListener('click', () => { void copyNumber(copy, phone); });
  box.append(copy, linkRow(SPAM_REMOVAL, 'spamLinks'), linkRow(SPAM_HELP, 'spamLinks spamHelp'));
  return box;
}

function linkRow(items, className) {
  const row = document.createElement('div');
  row.className = className;
  for (const [label, href] of items) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    row.append(link);
  }
  return row;
}

async function copyNumber(button, phone) {
  try {
    await navigator.clipboard.writeText(phone);
    button.textContent = 'Copied';
    setTimeout(() => { if (button.textContent === 'Copied') button.textContent = 'Copy this number'; }, 1600);
  } catch (_error) {
    status.textContent = `Copy didn't work. Select this number and copy it: ${phone}`;
  }
}

async function manage(id,action) {
  const {error} = await client.rpc('calling_number_manage',{p_id:id,p_action:action});
  if(error) throw error;
}
async function load() {
  const token = ++generation;
  controls(true); status.textContent='Loading calling numbers…';
  try {
    const {data:auth,error:authError}=await client.auth.getSession();
    if(token!==generation) return;
    if(authError) throw authError;
    if(!auth.session) { list.replaceChildren(); status.textContent='Sign in to save calling numbers and view their stats.'; return; }
    const [numbers,stats] = await Promise.all([
      client.from('calling_numbers').select('id,phone,label,active,archived').order('created_at',{ascending:true}),
      client.rpc('calling_number_stats')
    ]);
    if(token!==generation) return;
    if(numbers.error) throw numbers.error;
    render(numbers.data || [], stats.error ? null : stats.data || []);
    status.textContent=stats.error ? 'Numbers loaded; statistics could not be loaded.' : 'Saved to your account. '+(numbers.data?.some(n=>n.active)?'New calls use your active number.':'No active number selected. New calls will not be assigned to a number.');
    controls(false);
  } catch(error) {
    if(token!==generation) return;
    list.replaceChildren();
    status.textContent = ['42P01','PGRST202','PGRST205'].includes(error.code)
      ? 'Calling-number tracking is not available yet. The account update needs to be installed.'
      : 'Could not load calling numbers. Please try Refresh.';
  } finally { if(token===generation) refresh.disabled=false; }
}
async function run(work) {
  if(busy) return;
  busy=true; controls(true);
  try { await work(); await load(); }
  catch(error) { status.textContent=error.message || 'Could not save this change. Please try again.'; controls(false); }
  finally { busy=false; }
}
form.addEventListener('submit',event=>{
  event.preventDefault();
  const phone=normalizeCallingNumber(form.elements.phone.value);
  if(!phone) { status.textContent='Enter a 10-digit US/Canada number or include + and the country code.'; return; }
  void run(async()=>{
    const {error}=await client.rpc('calling_number_save',{p_phone:phone,p_label:form.elements.label.value.trim()});
    if(error) throw error;
    form.reset();
  });
});
refresh.addEventListener('click',()=>{if(!busy)void load();});
client.auth.onAuthStateChange((event)=>{
  if(!['SIGNED_IN','SIGNED_OUT','INITIAL_SESSION'].includes(event)) return;
  generation++; list.replaceChildren(); controls(true);
  setTimeout(()=>void load(),0);
});
void load();
