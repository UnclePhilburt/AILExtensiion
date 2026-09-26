// Swipes use the same guarded navigation as the visible buttons.
export function swipeDirection(dx, dy, elapsed) {
  if (elapsed < 60 || elapsed > 850 || Math.abs(dx) < 85 || Math.abs(dy) > 45 || Math.abs(dx) < Math.abs(dy) * 2.5) return '';
  return dx < 0 ? 'next' : 'previous';
}

export function installLeadSwipe(card, { enabled, currentKey, navigate }) {
  let start = null;
  const clear = () => { start = null; };
  card.addEventListener('pointerdown', (event) => {
    clear();
    if (event.pointerType !== 'touch' || !event.isPrimary || !enabled()) return;
    if (event.clientX < 28 || event.clientX > innerWidth - 28) return;
    if (event.target.closest('a,button,input,select,textarea,label,summary,[role="button"],[contenteditable]')) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now(), key: currentKey() };
  }, { passive: true });
  card.addEventListener('pointermove', (event) => {
    if (start && (event.pointerId !== start.id || Math.abs(event.clientY - start.y) > 45)) clear();
  }, { passive: true });
  card.addEventListener('pointerup', (event) => {
    const from = start; clear();
    if (!from || from.id !== event.pointerId || !enabled() || from.key !== currentKey() || globalThis.getSelection?.()?.toString()) return;
    const direction = swipeDirection(event.clientX - from.x, event.clientY - from.y, Date.now() - from.time);
    if (direction) void navigate(direction);
  }, { passive: true });
  card.addEventListener('pointercancel', clear, { passive: true });
  document.addEventListener('visibilitychange', clear);
}
