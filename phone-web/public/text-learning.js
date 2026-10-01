// Compare only eligible variants in the same timing cohort; keep exploration.
export function chooseTextVariant(records,experiment,fallback,random=Math.random,variants=['A','B']) {
 const samples=variants.map(v=>records.filter(r=>r.experiment===experiment&&r.variant===v&&typeof r.replied==='boolean'));
 if(samples.some(rows=>rows.length<20))return fallback;
 const rates=samples.map(rows=>rows.filter(r=>r.replied).length/rows.length);
 const best=Math.max(...rates),worst=Math.min(...rates);
 if(best-worst<.1||random()<.2)return fallback;
 return variants[rates.indexOf(best)];
}
export function textingTimeHint(records, experiment, zone) {
  const bins = new Map();
  for (const r of records) {
    if (r.experiment !== experiment || r.timeZone !== zone || !['A','B','C','D'].includes(r.variant) || typeof r.replied !== 'boolean' || !Number.isInteger(r.localHour)) continue;
    const hour = Math.floor(r.localHour / 3) * 3;
    const bin = bins.get(hour) || { hour, reviewed:0, replies:0 };
    bin.reviewed++; if(r.replied) bin.replies++; bins.set(hour,bin);
  }
  const eligible = [...bins.values()].filter(b => b.reviewed >= 20);
  if (eligible.length < 2) return 'Still learning sending times: need at least 20 checked outcomes in each of two time windows.';
  eligible.sort((a,b) => b.replies/b.reviewed - a.replies/a.reviewed);
  const best = eligible[0];
  return `Promising send window: ${String(best.hour).padStart(2,'0')}:00–${String(best.hour+3).padStart(2,'0')}:00 (${zone}), ${best.replies}/${best.reviewed} checked texts got replies. Observational result, not a guaranteed best time.`;
}
