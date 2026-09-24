import { client } from './auth-runtime.js';

const ADMIN_EMAIL = 'cody2931@gmail.com';
const isExtension = Boolean(globalThis.chrome?.runtime?.id);
const message = document.querySelector('#message');
const team = document.querySelector('#team');
const summary = document.querySelector('#summary');
document.querySelector('#back').href = isExtension ? '../options/options.html' : 'account.html';

const { data: { session } } = await client.auth.getSession();
if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
  location.replace(isExtension ? '../options/options.html' : 'account.html');
  throw new Error('Administrator access required.');
}
document.querySelector('#refresh').addEventListener('click', () => void loadTeam());

function online(at) { return Boolean(at && Date.now() - Date.parse(at) < 45000); }
function badge(text, active) {
  const node = document.createElement('span'); node.className = `badge ${active ? 'online' : 'off'}`; node.textContent = text; return node;
}
function formatSeen(at) { return at ? `last seen ${new Date(at).toLocaleTimeString()}` : 'not connected'; }
async function loadTeam() {
  message.textContent = 'Loading team…';
  const { data, error } = await client.rpc('companion_admin_team');
  if (error) { message.textContent = error.message || 'Could not load the team.'; return; }
  const members = data || [];
  team.replaceChildren();
  const active = members.filter(member => member.enabled).length;
  summary.replaceChildren();
  for (const [value, label] of [[members.length, 'Team members'], [active, 'Access enabled']]) {
    const card = document.createElement('div'); const number = document.createElement('strong'); const caption = document.createElement('span');
    number.textContent = String(value); caption.textContent = label; card.append(number, caption); summary.append(card);
  }
  for (const member of members) {
    const card = document.createElement('article'); card.className = 'member';
    const email = document.createElement('div'); email.className = 'memberEmail'; email.textContent = member.email;
    const statuses = document.createElement('div'); statuses.className = 'memberStatus';
    statuses.append(badge(member.enabled ? 'Access enabled' : 'Access disabled', member.enabled));
    statuses.append(badge(`Computer: ${formatSeen(member.desktop_seen)}`, online(member.desktop_seen)));
    statuses.append(badge(`Phone: ${formatSeen(member.phone_seen)}`, online(member.phone_seen)));
    card.append(email, statuses); team.append(card);
  }
  summary.hidden = team.hidden = false;
  message.textContent = members.length ? `Updated ${new Date().toLocaleTimeString()}` : 'No invited team members yet.';
}
void loadTeam();
