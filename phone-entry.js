// Old LAN bookmarks should land on the secure hosted workspace by default.
// An explicit Local choice keeps the bridge interface available.
if (document.querySelector('meta[name="impact-bridge-token"]')) {
  location.replace(new URLSearchParams(location.search).get('mode') === 'local' ? 'workspace.html?mode=local' : 'https://unclephilburt.github.io/AILExtensiion/');
} else await import('./home.js?v=home-4');
