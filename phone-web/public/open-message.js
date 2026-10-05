// Keep a real link available when asynchronous preparation outlasts the
// browser's user activation. Opening a composer never confirms a sent text.
export function openMessage(href) {
  if (!/^sms:/i.test(href)) throw new Error('A text message needs a valid phone link.');
  document.querySelector('#messageLauncher')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'messageLauncher';
  dialog.setAttribute('aria-label', 'Open your text message');
  Object.assign(dialog.style, { padding:'24px', border:'1px solid #ccd7cb', borderRadius:'20px', maxWidth:'360px', width:'calc(100% - 32px)', color:'#173e32', background:'#fff', font:'16px/1.5 system-ui' });
  const heading = document.createElement('h2'); heading.textContent = 'Your text is ready';
  const hint = document.createElement('p'); hint.textContent = 'If your texting app did not open, tap below. Send the message there, then return to confirm it.';
  const link = document.createElement('a'); link.href = href; link.textContent = 'Open Messages';
  Object.assign(link.style, {display:'block', padding:'12px 18px', borderRadius:'12px', background:'#173e32', color:'white', textAlign:'center', textDecoration:'none'});
  const expires = Date.now() + 60000;
  link.addEventListener('click', event => {
    if (Date.now() > expires) {
      event.preventDefault(); hint.textContent = 'Please close this and open the text again to recheck the lead and available times.';
    }
  });
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Back to lead';
  Object.assign(close.style, {marginTop:'16px', padding:'10px', font:'inherit'});
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.append(heading, hint, link, close); document.body.append(dialog); dialog.showModal();
  // A fresh tap on the link remains available even if this attempt is blocked.
  if (navigator.userActivation?.isActive) window.location.href = href;
}
