// Release beyond the threshold to commit; returning to the center cancels.
export function swipeDirection(dx, dy, elapsed) {
  if (elapsed < 60 || elapsed > 5000) return '';
  if (Math.abs(dx) >= 100 && Math.abs(dx) > Math.abs(dy) * 1.8) return dx < 0 ? 'next' : 'previous';
  if (Math.abs(dy) >= 110 && Math.abs(dy) > Math.abs(dx) * 1.8) return dy > 0 ? 'refused' : 'callback';
  return '';
}
export function installLeadSwipe(card, { enabled, currentKey, navigate }) {
  let start = null, busy = false;
  const labels = { next: 'No answer', previous: 'Set appointment', refused: 'Refused appointment', callback: 'Callback · not connected yet' };
  const clear = () => {
    if (start && card.hasPointerCapture?.(start.id)) card.releasePointerCapture(start.id);
    start = null; card.style.transform = ''; delete card.dataset.swipe; delete card.dataset.dragging;
    const stamp = card.querySelector('.profileSwipeStamp'); if (stamp) stamp.textContent = '';
  };
  card.addEventListener('pointerdown', event => {
    clear();
    if (event.pointerType !== 'touch' || !event.isPrimary || !enabled() || busy) return;
    if (event.clientX < 28 || event.clientX > innerWidth - 28) return;
    if (event.target.closest('a,button,input,select,textarea,label,summary,details,[role="button"],[contenteditable]')) return;
    start = { id:event.pointerId, x:event.clientX, y:event.clientY, time:Date.now(), key:currentKey() };
    card.setPointerCapture?.(event.pointerId);
  }, {passive:true});
  card.addEventListener('pointermove', event => {
    if (!start) return;
    if (event.pointerId !== start.id || !enabled() || start.key !== currentKey()) { clear(); return; }
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const direction = Math.abs(dx) > Math.abs(dy) * 1.8 ? (dx < 0 ? 'next' : 'previous') : Math.abs(dy) > Math.abs(dx) * 1.8 ? (dy > 0 ? 'refused' : 'callback') : '';
    const stamp = card.querySelector('.profileSwipeStamp');
    const ready = swipeDirection(dx,dy,Date.now()-start.time);
    if (stamp) stamp.textContent = direction && Math.max(Math.abs(dx),Math.abs(dy)) > 15 ? labels[direction] + (direction === 'callback' ? '' : ready ? ' · release' : ' · keep moving') : '';
    card.dataset.swipe = direction; card.dataset.dragging = 'true';
    if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) card.style.transform = 'translate(' + Math.max(-90,Math.min(90,dx*.5)) + 'px,' + Math.max(-70,Math.min(70,dy*.4)) + 'px) rotate(' + Math.max(-6,Math.min(6,dx*.035)) + 'deg)';
  }, {passive:true});
  card.addEventListener('pointerup', event => {
    const from = start; clear();
    if (!from || from.id !== event.pointerId || !enabled() || from.key !== currentKey() || globalThis.getSelection?.()?.toString()) return;
    const direction = swipeDirection(event.clientX-from.x,event.clientY-from.y,Date.now()-from.time);
    if (direction) { busy=true; Promise.resolve().then(()=>navigate(direction)).finally(()=>{busy=false;}).catch(()=>{}); }
  }, {passive:true});
  card.addEventListener('pointercancel',clear,{passive:true});
  card.addEventListener('lostpointercapture',clear,{passive:true});
  document.addEventListener('visibilitychange',clear);
}
