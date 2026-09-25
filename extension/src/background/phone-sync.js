// Keeps the phone on the lead IMPACT is showing. Pure helpers with injected
// side effects so the races can be tested without Chrome.

export const IMPACT_LEAD_URL = /^https:\/\/mobile\.impact\.ailife\.com\/Lead\/(InboxDetail|WhatHappend|SetAppointment)(?:[?#]|$)/;
// Commands after which IMPACT moves to another lead.
export const LEAD_CHANGING_COMMANDS = ['no-answer', 'refused-appointment', 'virtual-appointment-slot', 'next', 'previous'];

// May this IMPACT tab publish its lead? '' = yes, otherwise the reason.
// It only has to be the tab showing in its own window. Being in the last
// focused window is NOT required: the rep often has the Salebase script window
// focused (a rebuttal focuses it), and then every lead IMPACT moved to was
// silently dropped. Only another IMPACT lead tab in front wins over it.
export function publisherDecision(senderTab, focusedTab) {
  if (!senderTab?.id) return 'no tab';
  if (!IMPACT_LEAD_URL.test(senderTab.url || '')) return 'not an IMPACT lead page';
  if (senderTab.active === false) return 'background tab';
  if (focusedTab?.id && focusedTab.id !== senderTab.id && IMPACT_LEAD_URL.test(focusedTab.url || '')) return 'another IMPACT tab is in front';
  return '';
}

// Runs lead writes one at a time, in the order they were requested, so an
// older lead can never land after a newer one. A queued write that has been
// overtaken by a newer one is skipped (the newer one carries the latest lead).
export function createLatestWinsQueue() {
  let chain = Promise.resolve();
  let requested = 0;
  let written = 0;
  return {
    get requested() { return requested; },
    get written() { return written; },
    run(task, { mustRun = false } = {}) {
      const seq = ++requested;
      const result = chain.then(async () => {
        if (!mustRun && seq < requested) return { skipped: true, reason: 'superseded', seq };
        const value = await task(seq);
        written = Math.max(written, seq);
        return value;
      });
      chain = result.catch(() => {});
      return result;
    }
  };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// After a command that moves IMPACT on, watch the IMPACT tab until it shows a
// different lead, then publish that lead straight away (not waiting on the
// page's own auto-publish) and check the phone really has it.
export async function followLeadChange({ fromLeadId, readLead, publish, verify, log, isCurrent = () => true, now = Date.now, sleep = defaultSleep, timeoutMs = 45000, stepMs = 1000 }) {
  const deadline = now() + timeoutMs;
  await log('info', 'phoneSync.followStarted', {});
  while (now() < deadline) {
    if (!isCurrent()) return 'replaced';
    const lead = await readLead().catch(() => null);
    if (lead?.available && lead.leadId && lead.leadId !== fromLeadId) {
      await log('info', 'phoneSync.newLeadSeen', { waitedMs: timeoutMs - (deadline - now()) });
      await publish(lead);
      await verify(lead.leadId);
      return 'published';
    }
    await sleep(stepMs);
  }
  await log('warn', 'phoneSync.followTimedOut', {});
  return 'timed-out';
}

// Reads back what the phone will see. If it is not the lead IMPACT is on,
// publish the current lead again (what "Sync phone" does), a few times.
export async function verifyPhoneLead({ expectedLeadId, readPhoneLeadId, currentLeadId = () => expectedLeadId, republish, log, sleep = defaultSleep, delayMs = 3000, attempts = 3 }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await sleep(delayMs);
    const wanted = currentLeadId();
    if (!wanted || wanted !== expectedLeadId) return 'lead-moved-on';
    let seen;
    try { seen = await readPhoneLeadId(); } catch (error) { await log('warn', 'phoneSync.verifyFailed', { reason: error.message }); return 'unknown'; }
    if (seen === wanted) {
      await log('info', 'phoneSync.verified', { attempt });
      return 'ok';
    }
    await log('warn', 'phoneSync.mismatch', { attempt, phoneHasLead: Boolean(seen) });
    await republish();
    await log('info', 'phoneSync.resynced', { attempt });
  }
  return 'gave-up';
}
