// Stand-in for Salebase's own page scripts, which are not part of the saved
// copy in salebase-phone-scripts.html. Just enough behaviour to drive the
// fixture like the live page: the script dropdown, the response buttons, the
// SINGLE toggle and the rebuttal list (Expand All / Collapse All, click a title).
(() => {
  const dropdown = document.getElementById('myDropdown');
  const blocks = () => [...document.querySelectorAll('.container .script-type')];
  const answerOf = (item) => item.querySelector('.rebuttal-answer') || (item.nextElementSibling?.classList.contains('rebuttal-answer') ? item.nextElementSibling : null);
  const setOpen = (item, open) => { item.classList.toggle('collapsed', !open); const answer = answerOf(item); if (answer) answer.style.display = open ? '' : 'none'; };
  function showScript(value) { for (const block of blocks()) block.style.display = block.classList.contains(value) ? 'inline' : 'none'; }
  window.handleSelection = () => { window.__selections = (window.__selections || 0) + 1; showScript(dropdown.value); };
  window.togglesingle = () => {
    const box = document.getElementById('singleCheckbox');
    setTimeout(() => {
      document.querySelectorAll('.couple').forEach((node) => { node.style.display = box.checked ? 'none' : 'inline'; });
      document.querySelectorAll('.single').forEach((node) => { node.style.display = box.checked ? 'inline' : 'none'; });
    }, 0);
  };
  const shown = blocks().find((block) => !block.closest('#rebuttalsColumn') && block.style.display !== 'none');
  const value = shown && [...dropdown.options].map((option) => option.value).find((option) => shown.classList.contains(option));
  if (value) { dropdown.value = value; showScript(value); }
  document.querySelectorAll('.rebuttal-item').forEach((item) => setOpen(item, false));
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button.showhide[data-target]');
    if (button) {
      const target = document.getElementById(button.dataset.target);
      button.closest('.button-response-container')?.querySelectorAll('.response').forEach((response) => {
        response.style.display = response === target && response.style.display === 'none' ? 'inline' : 'none';
      });
    }
    const item = event.target.closest?.('.rebuttal-item');
    if (item) { window.__rebuttalClicks = (window.__rebuttalClicks || 0) + 1; setOpen(item, item.classList.contains('collapsed')); }
    if (event.target.closest?.('#expandAllRebuttals')) document.querySelectorAll('.rebuttal-item').forEach((node) => setOpen(node, true));
    if (event.target.closest?.('#collapseAllRebuttals')) document.querySelectorAll('.rebuttal-item').forEach((node) => setOpen(node, false));
  });
})();
