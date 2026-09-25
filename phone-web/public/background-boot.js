// Applies the saved phone background before the page paints (no flash of the
// default). Loaded as a plain, blocking script in <head>; keep it tiny.
// The list of choices and the settings logic are in backgrounds.js.
(function () {
  try {
    var id = localStorage.getItem('impact.phoneBackground');
    if (id && id !== 'default' && /^[a-z0-9-]{1,32}$/.test(id)) document.documentElement.setAttribute('data-bg', id);
  } catch (_error) {
    // No storage access: keep the default background.
  }
})();
