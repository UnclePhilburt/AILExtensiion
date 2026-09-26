// Applies the saved background and display settings to <html> before the page
// paints (no flash), and again when the page is restored from the back/forward
// cache or another tab changes them. A plain, blocking script in <head>; keep it
// tiny. The rules mirror backgrounds.js and settings-store.js (tested together).
(function () {
  function apply() {
    var root = document.documentElement, bg = null, s = {};
    try { bg = localStorage.getItem('impact.phoneBackground'); } catch (_error) {}
    try { s = JSON.parse(localStorage.getItem('impact.phoneSettings') || 'null') || {}; } catch (_error) { s = {}; }
    function set(name, value) { if (value === null) root.removeAttribute(name); else root.setAttribute(name, value); }
    set('data-bg', bg && bg !== 'default' && /^[a-z0-9-]{1,32}$/.test(bg) ? bg : null);
    set('data-text-size', s.textSize === 'large' || s.textSize === 'xlarge' ? s.textSize : null);
    set('data-hide-heads-up', s.showHeadsUp === false ? '' : null);
    set('data-hide-dnk', s.showDoNotKnock === false ? '' : null);
    set('data-theme', s.darkMode === true ? 'dark' : null);
    set('data-lead-paper', s.beigeLeadCard === true ? 'beige' : null);
  }
  window.impactApplySavedSettings = apply;
  apply();
  window.addEventListener('pageshow', apply);
  window.addEventListener('storage', function (event) {
    if (event.key === null || event.key === 'impact.phoneBackground' || event.key === 'impact.phoneSettings') apply();
  });
})();
