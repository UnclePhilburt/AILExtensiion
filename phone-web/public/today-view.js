const count = (items, type) => (items || []).filter(item => item.event_type === type).length;

export function startOfToday(now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0); return start;
}

export function todayMetrics(events, outcomes) {
  return {
    calls: count(events, 'call'),
    noAnswer: count(events, 'no-answer'),
    appointments: count(events, 'virtual-appointment'),
    refused: count(events, 'refused-appointment'),
    held: (outcomes || []).filter(row => row.status === 'held').length
  };
}

export function laneStatus(state, slot, now = Date.now()) {
  const id = slot === '2' ? '2' : '1';
  const seen = state?.slot_phone_seen?.[id] || (id === '1' ? state?.phone_seen : null);
  const lead = state?.slot_leads?.[id] || (id === '1' ? state?.lead : null);
  const computerOnline = Boolean(state?.desktop_seen && now - Date.parse(state.desktop_seen) < 45000);
  const connected = Boolean(seen && now - Date.parse(seen) < 45000);
  if (!computerOnline) return { id, kind: 'offline', label: 'Computer offline', lead: null };
  if (connected) return { id, kind: 'ready', label: lead ? 'Lead ready' : 'Connected', lead };
  if (lead) return { id, kind: 'reconnect', label: `Reconnect Phone ${id}`, lead };
  return { id, kind: 'waiting', label: 'Waiting to connect', lead: null };
}

export function dashboardNote(metrics, lanes, appointments) {
  const reconnect = (lanes || []).find(lane => lane.kind === 'reconnect');
  if (reconnect) return `Phone ${reconnect.id} is away, and its lead is being held for reconnection.`;
  if ((appointments || []).length) return `Your next saved commitment is ${appointments[0].kind === 'callback' ? 'a callback' : 'an appointment'}.`;
  if (metrics.appointments) return `${metrics.appointments} appointment${metrics.appointments === 1 ? '' : 's'} set today. Keep the next conversation simple.`;
  if (metrics.calls >= 10) return `${metrics.calls} calls recorded today. A steady pace is real progress.`;
  if (metrics.calls) return `${metrics.calls} call${metrics.calls === 1 ? '' : 's'} recorded. Give the next conversation your full attention.`;
  return 'The desk is ready when you are. One useful call is enough to begin.';
}

export function upcomingEvents(rows, now = new Date()) {
  return (rows || []).filter(row => !row.all_day && Date.parse(row.starts_at) >= now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).slice(0, 4);
}
