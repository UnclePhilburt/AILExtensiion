const address = document.querySelector('#extensionsAddress');
const copyButton = document.querySelector('#copyExtensions');
const status = document.querySelector('#copyStatus');
if (navigator.brave) address.textContent = 'brave://extensions';
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(address.textContent);
    status.textContent = 'Copied. Paste into the browser address bar at the top, then press Enter.';
  } catch {
    status.textContent = 'Select and copy the address above, then paste it into your browser address bar.';
  }
});
