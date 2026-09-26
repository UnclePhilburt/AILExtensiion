// Plain-English checks and messages for phone taps, so a tap after the phone
// has been in the background either goes through or tells the rep why not.

export const FRESH_STATE_MS = 8000;
export const COMPUTER_ONLINE_MS = 45000;
export const LEAD_MAX_AGE_MS = 30 * 60 * 1000;
export const NETWORK_MESSAGE = "Couldn't reach the server. Check your phone's signal and try again.";
export const SIGN_IN_MESSAGE = "Reconnecting to your account didn't work. Check your signal and try again. If it keeps happening, sign in again.";
export const RESULT_COMMANDS = ['no-answer', 'refused-appointment', 'virtual-appointment', 'virtual-appointment-day', 'virtual-appointment-slot'];

export function formatAgo(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function offlineMessage(desktopSeen, now) {
  const seen = Date.parse(desktopSeen || '');
  if (!Number.isFinite(seen)) return "Your computer isn't connected. Open IMPACT on your computer and try again.";
  return `Your computer hasn't checked in for ${formatAgo(now - seen)}. Make sure IMPACT is open and showing on your computer, then try again.`;
}

export const STALE_LEAD_MESSAGE = "Your computer hasn't sent this lead recently. Open the lead in IMPACT on your computer, then try again.";

// Returns '' when the command can be sent with this (fresh) cloud state,
// otherwise the reason it would be rejected, in plain English.
export function checkBeforeSend(state, command, now) {
  const seen = Date.parse(state?.desktop_seen || '');
  if (!state || !Number.isFinite(seen) || now - seen >= COMPUTER_ONLINE_MS) return offlineMessage(state?.desktop_seen, now);
  const updated = Date.parse(state.lead_updated_at || '');
  if (!state.lead || !Number.isFinite(updated) || now - updated >= LEAD_MAX_AGE_MS) return STALE_LEAD_MESSAGE;
  if (!command?.leadId || state.lead.leadId !== command.leadId) {
    const name = state.lead.leadName ? ` (${state.lead.leadName})` : '';
    return `IMPACT is on a different lead now${name}. Check the lead on your phone and try again.`;
  }
  return '';
}

export function isStateFresh(fetchedAt, hiddenAt, now) {
  return Boolean(fetchedAt) && fetchedAt > hiddenAt && now - fetchedAt < FRESH_STATE_MS;
}

export function isAuthFailure(message) {
  return /jwt|token|not authenticated|unauthori[sz]ed|sign in|needs access from the administrator|permission denied/i.test(String(message || ''));
}

export function isNetworkFailure(message) {
  return /failed to fetch|networkerror|network request failed|load failed|network connection|timed? ?out|couldn't reach/i.test(String(message || ''));
}

export function friendlySendError(message, type) {
  const text = String(message || '');
  if (isNetworkFailure(text)) return NETWORK_MESSAGE;
  if (/lead changed/i.test(text)) {
    return ['next', 'previous', 'best-next'].includes(type)
      ? 'Your phone was still catching up to IMPACT. Check the lead shown and tap again.'
      : 'IMPACT is on a different lead now. Check the lead on your phone and try again.';
  }
  if (/offline/i.test(text)) return "Your computer isn't connected. Make sure IMPACT is open and showing on your computer, then try again.";
  return text || 'That did not go through. Try again.';
}

export function withTimeout(promise, ms, message = NETWORK_MESSAGE) {
  let timer;
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => globalThis.clearTimeout?.(timer));
}
