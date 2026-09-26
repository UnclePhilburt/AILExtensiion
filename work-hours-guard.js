import { client } from './auth-runtime.js';
import { CLOSED_MESSAGE, callingHoursOpen } from './work-hours.js';

async function closeIfNeeded() {
  if (callingHoursOpen()) return;
  const { data } = await client.auth.getSession().catch(() => ({ data: {} }));
  if (!data?.session) return;
  await client.auth.signOut({ scope: 'local' }).catch(() => {});
  const here = location.pathname.endsWith('/account.html') || location.pathname.endsWith('/account');
  if (!here) location.replace('account.html?closed=1');
}

void closeIfNeeded();
setInterval(() => void closeIfNeeded(), 30000);
void CLOSED_MESSAGE;
