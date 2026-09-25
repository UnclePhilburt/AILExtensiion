// Finds a useful calling-time pattern from completed calls. A refusal means the
// person answered, while No Answer means they did not. We only show a pattern
// after enough outcomes have been recorded to avoid guessing from a few calls.
const WINDOWS = [
  { id: 'morning', label: '8–11 AM', start: 8, end: 11 },
  { id: 'midday', label: '11 AM–2 PM', start: 11, end: 14 },
  { id: 'afternoon', label: '2–5 PM', start: 14, end: 17 },
  { id: 'evening', label: '5–8 PM', start: 17, end: 20 }
];

function cleanType(value) { return String(value || '').trim().toLowerCase(); }
function bucketFor(hour) { return WINDOWS.find((window) => hour >= window.start && hour < window.end); }
function answered(outcome) { return outcome === 'refused-appointment' || outcome === 'virtual-appointment'; }

export function findBestCallingTime(outcomes, requestType) {
  const completed = (Array.isArray(outcomes) ? outcomes : []).filter((entry) =>
    ['no-answer', 'refused-appointment', 'virtual-appointment'].includes(entry?.outcome) && Number.isInteger(entry?.local_hour)
  );
  const wantedType = cleanType(requestType);
  const typed = wantedType ? completed.filter((entry) => cleanType(entry.request_type) === wantedType) : [];
  const entries = typed.length >= 12 ? typed : completed.length >= 20 ? completed : [];
  if (!entries.length) return null;

  const buckets = WINDOWS.map((window) => ({ ...window, total: 0, reached: 0 }));
  for (const entry of entries) {
    const bucket = buckets.find((item) => item.id === bucketFor(entry.local_hour)?.id);
    if (!bucket) continue;
    bucket.total++;
    if (answered(entry.outcome)) bucket.reached++;
  }
  const usable = buckets.filter((bucket) => bucket.total >= 4);
  if (!usable.length) return null;
  const overallRate = entries.filter((entry) => answered(entry.outcome)).length / entries.length;
  const best = usable.sort((a, b) => (b.reached / b.total) - (a.reached / a.total) || b.total - a.total)[0];
  const rate = best.reached / best.total;
  // A small difference is noise, so keep learning instead of showing a weak tip.
  if (rate < overallRate + 0.1) return null;
  return {
    timeLabel: best.label,
    reached: best.reached,
    total: best.total,
    rate: Math.round(rate * 100),
    scope: entries === typed ? 'this lead type' : 'your overall calls'
  };
}
