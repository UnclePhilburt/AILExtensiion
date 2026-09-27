export function normalizeCallingNumber(value) {
  const raw = String(value || '').trim();
  if (!/^[+\d\s().-]+$/.test(raw) || raw.slice(1).includes('+')) return null;
  const digits = raw.replace(/\D/g, '');
  if (!raw.startsWith('+')) {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return null;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

export function formatCallingNumber(phone) {
  return /^\+1\d{10}$/.test(phone) ? `(${phone.slice(2,5)}) ${phone.slice(5,8)}-${phone.slice(8)}` : phone;
}

export function numberHealth(stats, id) {
  const empty = {calls:0, recorded:0, no_answer:0, appointments:0, refused:0};
  const period = name => Object.fromEntries(Object.keys(empty).map(key => [key, Number(stats.find(row => row.number_id === id && row.period === name)?.[key] || 0)]));
  const current = period('current'), previous = period('previous');
  const rate = (count, total) => total ? `${Math.round(count / total * 100)}%` : '—';
  let trend = 'Record at least 20 results in each 30-day period to compare no-answer rates.';
  if (current.recorded >= 20 && previous.recorded >= 20) {
    const change = Math.round(100 * (current.no_answer / current.recorded - previous.no_answer / previous.recorded));
    trend = change === 0 ? 'No-answer rate is unchanged from the previous 30 days.' : `No-answer rate is ${Math.abs(change)} percentage points ${change > 0 ? 'higher' : 'lower'} than the previous 30 days.`;
  }
  const answered = current.appointments + current.refused;
  const estimate = estimateHealth(current, answered);
  return {...current, answered, missing:Math.max(0,current.calls-current.recorded),
    noAnswerRate:rate(current.no_answer,current.recorded), appointmentRate:rate(current.appointments,current.recorded),
    coverage:rate(current.recorded,current.calls), trend, ...estimate};
}

// A plain estimate from this account's own logged results. It is not a carrier spam label.
// Answered means someone refused or an appointment was set. Fewer than 8 results stays undecided.
function estimateHealth(current, answered) {
  if (current.recorded < 8) {
    return {
      estimate: 'early',
      estimateLabel: 'Not enough calls yet',
      estimateDetail: `Log at least 8 results to estimate this number. ${current.recorded} so far in the last 30 days.`
    };
  }
  const noRate = current.no_answer / current.recorded;
  const appointmentRate = current.appointments / current.recorded;
  const score = Math.max(0, Math.min(100, Math.round(100 - noRate * 70 + appointmentRate * 40)));
  const estimate = score >= 70 ? 'steady' : score >= 45 ? 'mixed' : 'wearing';
  const estimateLabel = estimate === 'steady' ? 'Steady' : estimate === 'mixed' ? 'Mixed' : 'Wearing out';
  return {
    estimate,
    estimateLabel,
    estimateDetail: `${answered} answered · ${current.no_answer} no answer, out of ${current.recorded} results in the last 30 days. Answered means a refusal or an appointment was logged. This estimate comes from your calls, not from a carrier.`
  };
}
