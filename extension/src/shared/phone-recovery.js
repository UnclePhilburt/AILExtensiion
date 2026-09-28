export function phoneRecovery(state, slot, now = Date.now()) {
  const id = slot === '2' ? '2' : '1';
  const seen = state?.slot_phone_seen?.[id] || (id === '1' ? state?.phone_seen : null);
  const lead = state?.slot_leads?.[id] || (id === '1' ? state?.lead : null);
  const computerReady = Boolean(state?.desktop_seen && now - Date.parse(state.desktop_seen) < 45000);
  const connected = Boolean(seen && now - Date.parse(seen) < 45000);
  if (!computerReady) return { id, connected: false, lead, state: 'computer-offline', message: 'Computer needs attention' };
  if (connected) return { id, connected: true, lead, state: 'connected', message: 'Connected' };
  if (lead) return { id, connected: false, lead, state: 'reconnect', message: `Reconnect Phone ${id} — its lead is waiting` };
  return { id, connected: false, lead: null, state: 'waiting', message: `Phone ${id} is not connected` };
}
