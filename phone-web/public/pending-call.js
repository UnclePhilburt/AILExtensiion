// Remembers a call the rep started from the phone so the "How did it go?"
// controls survive a page reload. Mobile browsers often reload the tab after
// the rep switches to the dialer app, which used to lose this state.
// Stored in localStorage (survives the browser killing the tab), one entry per
// signed-in user so two accounts on the same phone never see each other's call.

export const PENDING_CALL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const RESULT_TYPES = ['no-answer', 'refused-appointment', 'virtual-appointment-slot'];

export function pendingCallStorageKey(userId) {
  return `impact.pendingCall.v1:${userId || 'unknown-user'}`;
}

export function createPendingCall({ leadKey, leadId, leadName, phoneLabel, now }) {
  return {
    leadKey: String(leadKey || ''),
    leadId: String(leadId || ''),
    leadName: String(leadName || ''),
    phoneLabel: String(phoneLabel || ''),
    startedAt: now,
    resultSentAt: 0
  };
}

export function isPendingCallValid(record, now) {
  return Boolean(record && typeof record.leadKey === 'string' && record.leadKey &&
    Number.isFinite(record.startedAt) && record.startedAt <= now + 60000 &&
    now - record.startedAt < PENDING_CALL_MAX_AGE_MS);
}

export function readPendingCall(storage, userId, now) {
  const key = pendingCallStorageKey(userId);
  let record = null;
  try { record = JSON.parse(storage?.getItem(key) || 'null'); } catch (_error) { record = null; }
  if (isPendingCallValid(record, now)) return record;
  // Drop expired or unreadable entries so old lead details do not linger.
  if (record) writePendingCall(storage, userId, null);
  return null;
}

export function writePendingCall(storage, userId, record) {
  const key = pendingCallStorageKey(userId);
  try {
    if (record) storage?.setItem(key, JSON.stringify(record));
    else storage?.removeItem(key);
  } catch (_error) {
    // Storage can be unavailable (private mode, quota). The in-memory copy still works.
  }
}

export function isCallResultCommand(type) {
  return RESULT_TYPES.includes(type);
}

export function markPendingCallResult(record, now) {
  return record ? { ...record, resultSentAt: now } : record;
}

// Decides what the phone shows for the lead IMPACT is currently on:
// - same lead as the call: restore the call result controls
// - no lead visible right now (computer offline, still loading): keep waiting
// - a different lead, after a result was sent: IMPACT moved on normally, forget the call
// - a different lead, no result sent: remind the rep the called lead still needs a result
export function pendingCallDecision(record, leadKey, now) {
  if (!record) return { calledLeadKey: '', reminder: null, clear: false };
  if (!isPendingCallValid(record, now)) return { calledLeadKey: '', reminder: null, clear: true };
  if (!leadKey) return { calledLeadKey: '', reminder: null, clear: false };
  if (leadKey === record.leadKey) return { calledLeadKey: leadKey, reminder: null, clear: false };
  if (record.resultSentAt) return { calledLeadKey: '', reminder: null, clear: true };
  return { calledLeadKey: '', reminder: record, clear: false };
}
