// Old LAN bookmarks should land on the secure hosted workspace by default.
// An explicit Local choice keeps the bridge interface available.
if (document.querySelector('meta[name="impact-bridge-token"]') &&
    new URLSearchParams(location.search).get('mode') !== 'local') {
  location.replace('https://unclephilburt.github.io/AILExtensiion/');
} else {
  await import('./app.js');
}
