// Runs in the page itself (not the extension's isolated script) so it can see
// IMPACT's dtLeadGrid. The Inbox otherwise opens at 10 rows; the first request
// should ask for 100, which is the largest size IMPACT offers.
(function startInboxAt100() {
  if (!/\/Lead\/Inbox\/?$/.test(location.pathname)) return;
  let settled = false;
  const apply = () => {
    const size = document.getElementById('hdnPageSize');
    if (size && size.value !== '100') size.value = '100';
    const grid = window.dtLeadGrid;
    if (!grid || typeof grid.page?.len !== 'function') return;
    if (grid.page.len() !== 100) {
      const menu = document.querySelector('select[name="LeadTable_length"]');
      if (menu) menu.value = '100';
      grid.page.len(100).page(0).draw(false);
      return;
    }
    settled = true;
  };
  const timer = setInterval(() => {
    apply();
    if (settled) clearInterval(timer);
  }, 50);
  setTimeout(() => clearInterval(timer), 20000);
})();
