const PROJECT = 'https://uawladqdbbbgddqtdjoi.supabase.co';
const KEY = 'sb_publishable_s2BgUBxX6_6gAGazndtaHQ_xaR6pHp3';
const crypto = require('node:crypto');
const cache = new Map();
async function verifyUser(token) {
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.user;
  const response = await fetch(`${PROJECT}/auth/v1/user`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Sign in again to connect to the bridge.');
  const user = await response.json();
  if (!user.id) throw new Error('Invalid account session.');
  if (cache.size > 100) cache.clear();
  cache.set(key, { user, until: Date.now() + 5000 });
  return user;
}
module.exports = { verifyUser };
