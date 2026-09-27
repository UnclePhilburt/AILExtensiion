import { client } from './auth-runtime.js';
import { normalizeCallingNumber, formatCallingNumber, numberHealth } from './calling-numbers-model.js';

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
  if (!numbers.length) list.append(node('p', 'No calling numbers saved. Add a number, then set it active before your next call.'));
  for (const number of numbers) {
    const card = node('article', '', 'callingNumberCard');
    card.append(node('h3', formatCallingNumber(number.phone)), node('p', `${number.label || 'Calling number'} · ${number.active ? 'Active for new calls' : number.archived ? 'Archived · history saved' : 'Not active'}`, 'numberState'));
    if (stats) {
      const health = numberHealth(stats, number.id);
      const grid = node('dl', '', 'numberMetrics');
      for (const [label,value] of [['Calls started',health.calls],['Results recorded',health.recorded],['No-answer rate',health.noAnswerRate],['Appointment rate',health.appointmentRate],['Appointments',health.appointments],['Refused',health.refused]]) {
        const item = node('div',''); item.append(node('dt',label),node('dd',String(value))); grid.append(item);
      }
      card.append(node('p','Last 30 days','numberPeriod'),grid,
        node('p',`${health.missing} calls without a recorded result. Rates use recorded results only.`),node('p',health.trend));
    } else card.append(node('p','Statistics are unavailable. Refresh to try again.'));
    if (!number.archived) {
      const actions = node('div','','numberActions');
      const active = node('button',number.active ? 'Stop tracking new calls' : 'Set active'); active.type='button';
      active.addEventListener('click',()=>void run(()=>manage(number.id,number.active?'pause':'activate')));
      const archive = node('button','Archive'); archive.type='button'; archive.className='secondary';
      archive.addEventListener('click',()=>void run(()=>manage(number.id,'archive')));
      actions.append(active,archive); card.append(actions);
    }
    list.append(card);
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
