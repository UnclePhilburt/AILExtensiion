const PROJECT = 'https://uawladqdbbbgddqtdjoi.supabase.co';
const KEY = 'sb_publishable_s2BgUBxX6_6gAGazndtaHQ_xaR6pHp3';
const crypto = require('node:crypto');
const cache = new Map();
async function verifyUser(token) {
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.user;
  let response;
  try {
    response = await fetch(`${PROJECT}/auth/v1/user`, {
      headers: { apikey: KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000)
    });
  } catch {
    const error = new Error('The computer bridge cannot reach Supabase. Check its internet access; signing in again will not fix this.');
    error.statusCode = 503;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(response.status >= 500 ? 'Supabase is temporarily unavailable. Try again shortly.' : 'Your account session is invalid. Sign in again in the extension.');
    error.statusCode = response.status >= 500 ? 503 : 401;
    throw error;
  }
  const user = await response.json();
  if (!user.id) throw new Error('Invalid account session.');
  if (cache.size > 100) cache.clear();
  cache.set(key, { user, until: Date.now() + 5000 });
  return user;
}
module.exports = { verifyUser };
