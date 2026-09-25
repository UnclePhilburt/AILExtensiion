// Gentle lead changes on the Workspace lead card. Presentation only: app.js has
// already rendered the new lead (and updated every piece of state) before this
// runs, so the new lead's buttons work straight away. Nothing here delays,
// blocks or defers a tap, a render or a command.
//
//   Next      -> the old lead slides a little to the left, the new one comes in from the right
//   Previous  -> the mirror image
//   anything else (e.g. IMPACT moved on after a result) -> soft fade-up
//   same lead re-rendered (status, heartbeat, contact update) -> no animation
//   prefers-reduced-motion -> no slide, just a quick fade-in

export const LEAD_TRANSITION_MS = 260;
// A Next/Previous tap explains a lead change seen within this window.
export const NAV_INTENT_MS = 15000;
const SHIFT_PX = 16;
const EASE_OUT = 'cubic-bezier(.2, .7, .3, 1)';
let moveSeq = 0;

// Which transition a render should play, or '' for none. No animation for the
// same lead, for "no lead", or for the first lead shown after the page opens.
export function leadTransitionKind(previousKey, nextKey, navIntent, now) {
  if (!previousKey || !nextKey || previousKey === nextKey) return '';
  if (navIntent && (navIntent.type === 'next' || navIntent.type === 'previous') && now - navIntent.at >= 0 && now - navIntent.at < NAV_INTENT_MS) return navIntent.type;
  return 'arrive';
}

// Keyframes and timings for one transition. Total time stays within ~200-280ms.
export function leadTransitionPlan(kind, reducedMotion = false) {
  if (!kind) return null;
  if (reducedMotion) {
    return { out: null, in: [{ opacity: 0 }, { opacity: 1 }], outMs: 0, inMs: 140, inDelay: 0, easing: 'ease-out' };
  }
  const x = kind === 'next' ? -SHIFT_PX : kind === 'previous' ? SHIFT_PX : 0;
  const move = (dx, dy) => `translate(${dx}px, ${dy}px)`;
  const out = x
    ? [{ opacity: 1, transform: move(0, 0) }, { opacity: 0, transform: move(x, 0) }]
    : [{ opacity: 1, transform: move(0, 0) }, { opacity: 0, transform: move(0, -4) }];
  const incoming = x
    ? [{ opacity: 0, transform: move(-x, 0) }, { opacity: 1, transform: move(0, 0) }]
    : [{ opacity: 0, transform: move(0, 10) }, { opacity: 1, transform: move(0, 0) }];
  return { out, in: incoming, outMs: 120, inMs: 170, inDelay: 90, easing: EASE_OUT };
}

export function prefersReducedMotion() {
  try { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches); } catch (_error) { return false; }
}

// Copies of what the card shows now, taken just before it is re-rendered, so the
// old lead can be shown leaving. Copies carry no event listeners. Nothing to copy
// when the card was showing a waiting message.
export function snapshotLeadCard(card) {
  if (!card || typeof card.cloneNode !== 'function' || !card.classList || card.classList.contains('empty')) return null;
  const nodes = [];
  for (const child of card.children || []) if (!child.classList?.contains('leadGhost')) nodes.push(child.cloneNode(true));
  return nodes.length ? nodes : null;
}

// Plays the transition on the already re-rendered card. Returns the plan used
// (or null when nothing was played, e.g. no animation support).
export function playLeadTransition(card, kind, outgoing, { reducedMotion = prefersReducedMotion() } = {}) {
  const plan = leadTransitionPlan(kind, reducedMotion);
  if (!plan || !card || typeof card.animate !== 'function') return null;
  for (const old of card.querySelectorAll?.(':scope > .leadGhost') || []) old.remove();
  let ghost = null;
  if (plan.out && outgoing?.length && card.ownerDocument) {
    ghost = card.ownerDocument.createElement('div');
    ghost.className = 'leadGhost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.append(...outgoing);
    card.append(ghost);
    const leaving = ghost.animate(plan.out, { duration: plan.outMs, easing: 'ease-out', fill: 'forwards' });
    const cleanUp = () => ghost.remove();
    leaving.addEventListener?.('finish', cleanUp);
    leaving.addEventListener?.('cancel', cleanUp);
  }
  // While things slide, nothing may poke out sideways (no sideways scroll on narrow phones).
  const seq = ++moveSeq;
  if (!reducedMotion) card.classList?.add?.('leadMoving');
  let last = null;
  for (const child of card.children) {
    if (child === ghost) continue;
    last = child.animate(plan.in, { duration: plan.inMs, delay: plan.inDelay, easing: plan.easing, fill: 'backwards' });
  }
  const settled = () => { if (seq === moveSeq) card.classList?.remove?.('leadMoving'); };
  if (last) { last.addEventListener?.('finish', settled); last.addEventListener?.('cancel', settled); } else settled();
  return plan;
}
