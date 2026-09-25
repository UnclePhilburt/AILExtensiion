const button = document.querySelector('#allow');
const status = document.querySelector('#status');

button.addEventListener('click', async () => {
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Waiting for your browser…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    status.textContent = 'Microphone allowed. Return to the extension and turn on Objection listening.';
  } catch (_error) {
    status.classList.add('error');
    status.textContent = 'Microphone access was blocked. Allow IMPACT Companion in browser settings, then try again.';
    button.disabled = false;
  }
});
