// Appointment results saved from Calendar. Kept separate from scheduled_events
// so automatic schedule refreshes can never overwrite a rep's APL or notes.
const number = (value, max, decimals = false) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return 0;
  return decimals ? Math.round(parsed * 100) / 100 : Math.floor(parsed);
};
export function appointmentOutcomeInput(value = {}) {
  const status = ['held', 'no-show', 'rescheduled'].includes(value.status) ? value.status : 'held';
  const rescheduledAt = Date.parse(value.rescheduledFor || '');
  return {
    status,
    apl: number(value.apl, 10000000, true),
    referrals: number(value.referrals, 1000),
    notes: String(value.notes || '').trim().slice(0, 2000),
    rescheduled_for: status === 'rescheduled' && Number.isFinite(rescheduledAt) ? new Date(rescheduledAt).toISOString() : null
  };
}
export function appointmentTotals(rows, now = new Date()) {
  const today = now.toDateString();
  const current = (Array.isArray(rows) ? rows : []).filter((row) => new Date(row.created_at).toDateString() === today);
  return { held: current.filter((row) => row.status === 'held').length, noShow: current.filter((row) => row.status === 'no-show').length, rescheduled: current.filter((row) => row.status === 'rescheduled').length, apl: current.reduce((sum, row) => sum + number(row.apl, 10000000, true), 0), referrals: current.reduce((sum, row) => sum + number(row.referrals, 1000), 0) };
}
export function formatApl(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(number(value, 10000000, true)); }
