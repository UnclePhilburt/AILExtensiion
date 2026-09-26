// Release beyond the threshold to commit; returning to the center cancels.
export function swipeDirection(dx, dy, elapsed) {
  if (elapsed < 60 || elapsed > 5000) return '';
  if (Math.abs(dx) >= 100 && Math.abs(dx) > Math.abs(dy) * 1.8) return dx < 0 ? 'next' : 'previous';
  if (Math.abs(dy) >= 110 && Math.abs(dy) > Math.abs(dx) * 1.8) return dy > 0 ? 'refused' : 'callback';
  return '';
}

// Left (No answer) and right (Set appointment) leave the screen. dy keeps a
// little of the finger's vertical drift so the toss is not perfectly flat.
export function throwTransform(direction, dy, width) {
  const travel = Math.max(Number(width) || 360, 320) + 160;
  const x = direction === 'next' ? -travel : travel;
  const y = Math.max(-100, Math.min(100, Number(dy) * 0.35 || 0));
  const rot = direction === 'next' ? -18 : 18;
  return `translate(${Math.round(x)}px, ${Math.round(y)}px) rotate(${rot}deg)`;
}

function motionReduced() {
  try { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches); } catch (_error) { return false; }
}

export function installLeadSwipe(card, { enabled, currentKey, navigate }) {
  let start = null, busy = false, flying = false;
  const labels = { next: 'No answer', previous: 'Set appointment', refused: 'Refused appointment', callback: 'Callback · not connected yet' };
  const stamp = () => card.querySelector('.profileSwipeStamp');
  const settle = () => {
    card.style.transition = 'transform .28s ease, opacity .28s ease';
    card.style.transform = '';
    card.style.opacity = '';
    delete card.dataset.swipe; delete card.dataset.dragging; delete card.dataset.thrown;
    const mark = stamp(); if (mark) mark.textContent = '';
  };
  const clear = () => {
    if (flying) return;
    if (start && card.hasPointerCapture?.(start.id)) card.releasePointerCapture(start.id);
    start = null;
    settle();
  };
  const followFinger = (dx, dy) => {
    if (motionReduced()) return;
    const width = card.offsetWidth || globalThis.innerWidth || 360;
    const x = Math.max(-width, Math.min(width, dx));
    const y = Math.max(-140, Math.min(140, dy * 0.55));
    const rot = Math.max(-16, Math.min(16, dx / width * 14));
    card.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
  };
  const throwOff = (direction, dy) => {
    delete card.dataset.dragging;
    card.dataset.thrown = 'true';
    card.style.opacity = '1';
    card.style.transition = 'transform .46s cubic-bezier(.12,.8,.2,1), opacity .46s ease';
    const apply = () => {
      card.style.transform = throwTransform(direction, dy, card.offsetWidth || globalThis.innerWidth);
      card.style.opacity = '0';
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    else apply();
  };
  card.addEventListener('pointerdown', event => {
    if (flying) return;
    clear();
    if (event.pointerType !== 'touch' || !event.isPrimary || !enabled() || busy) return;
    if (event.clientX < 28 || event.clientX > innerWidth - 28) return;
    if (event.target.closest('a,button,input,select,textarea,label,summary,details,[role="button"],[contenteditable]')) return;
    start = { id:event.pointerId, x:event.clientX, y:event.clientY, time:Date.now(), key:currentKey() };
    card.setPointerCapture?.(event.pointerId);
  }, {passive:true});
  card.addEventListener('pointermove', event => {
    if (!start || flying) return;
    if (event.pointerId !== start.id || !enabled() || start.key !== currentKey()) { clear(); return; }
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const direction = Math.abs(dx) > Math.abs(dy) * 1.8 ? (dx < 0 ? 'next' : 'previous') : Math.abs(dy) > Math.abs(dx) * 1.8 ? (dy > 0 ? 'refused' : 'callback') : '';
    const mark = stamp();
    const ready = swipeDirection(dx, dy, Date.now() - start.time);
    if (mark) mark.textContent = direction && Math.max(Math.abs(dx), Math.abs(dy)) > 15 ? labels[direction] + (direction === 'callback' ? '' : ready ? ' · release' : ' · keep moving') : '';
    card.dataset.swipe = direction; card.dataset.dragging = 'true';
    followFinger(dx, dy);
  }, {passive:true});
  card.addEventListener('pointerup', event => {
    const from = start;
    if (!from || from.id !== event.pointerId || flying || !enabled() || from.key !== currentKey() || globalThis.getSelection?.()?.toString()) { clear(); return; }
    const dx = event.clientX - from.x, dy = event.clientY - from.y;
    const direction = swipeDirection(dx, dy, Date.now() - from.time);
    const toss = (direction === 'next' || direction === 'previous') && !motionReduced();
    if (!toss) {
      clear();
      if (direction) { busy = true; Promise.resolve().then(() => navigate(direction)).finally(() => { busy = false; }).catch(() => {}); }
      return;
    }
    flying = true;
    start = null;
    if (card.hasPointerCapture?.(from.id)) card.releasePointerCapture(from.id);
    throwOff(direction, dy);
    busy = true;
    const release = () => { flying = false; };
    if (typeof setTimeout === 'function') setTimeout(release, 480);
    else release();
    Promise.resolve().then(() => navigate(direction)).then((sent) => { if (sent === false) { release(); settle(); } }).finally(() => { busy = false; }).catch(() => {});
  }, {passive:true});
  card.addEventListener('pointercancel', clear, {passive:true});
  card.addEventListener('lostpointercapture', clear, {passive:true});
  document.addEventListener('visibilitychange', clear);
}
