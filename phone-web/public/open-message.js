import {attachMessageDebug} from './message-debug.js?v=2';
// Keep a real link available when asynchronous preparation outlasts the
// browser's user activation. Opening a composer never confirms a sent text.
export function openMessage(href) {
  const match = /^sms:(\+?\d{10,15})(?:[?&]body=(.*))?$/i.exec(href);
  if (!match) throw new Error('A text message needs a valid phone link.');
  const number = match[1], body = decodeURIComponent(match[2] || '');
  const android = /Android/i.test(navigator.userAgent || '');
  // SENDTO/smsto asks Android for a text composer without assuming Google or
  // Samsung Messages. The body is an Intent extra, not part of the recipient.
  const launchHref = android
    ? `intent:${number}#Intent;scheme=smsto;action=android.intent.action.SENDTO;S.sms_body=${encodeURIComponent(body)};end`
    : href;
  const previous = document.querySelector('#messageLauncher');
  if (previous) { previous.close(); previous.remove(); }
  const dialog = document.createElement('dialog');
  dialog.id = 'messageLauncher';
  dialog.setAttribute('aria-label', 'Open your text message');
  Object.assign(dialog.style, { padding:'24px', border:'1px solid #ccd7cb', borderRadius:'20px', maxWidth:'360px', width:'calc(100% - 32px)', color:'#173e32', background:'#fff', font:'16px/1.5 system-ui' });
  const heading = document.createElement('h2'); heading.textContent = 'Your text is ready';
  const recipient = document.createElement('p'); recipient.textContent = 'To: ' + number;
  const hint = document.createElement('p'); hint.textContent = 'If your texting app did not open, tap below. Send the message there, then return to confirm it.';
  const link = document.createElement('a'); link.href = launchHref; link.textContent = 'Open Messages';
  Object.assign(link.style, {display:'block', padding:'12px 18px', borderRadius:'12px', background:'#173e32', color:'white', textAlign:'center', textDecoration:'none'});
  const expires = Date.now() + 60000;
  const checkExpiry = event => {
    if (Date.now() > expires) {
      event.preventDefault(); hint.textContent = 'Please close this and open the text again to recheck the lead and available times.';
    }
  };
  link.addEventListener('click', checkExpiry);
  const alternatives = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Still not opening?';
  const numberLink = document.createElement('a'); numberLink.href = `sms:${number}`; numberLink.textContent = `Open number only · ${number}`;
  numberLink.addEventListener('click', checkExpiry);
  const preview = document.createElement('textarea'); preview.value = body; preview.readOnly = true;
  preview.setAttribute('aria-label', 'Message to copy');
  Object.assign(preview.style, {display:'block', width:'100%', minHeight:'120px', marginTop:'12px', font:'inherit'});
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy message';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(body); copy.textContent = 'Copied — paste in Messages'; }
    catch { preview.focus(); preview.select(); copy.textContent = 'Hold the selected text to copy'; }
  });
  const instructions = document.createElement('p'); instructions.textContent = 'Copy the message, then open the number above and paste it. If neither link opens, open this page in Chrome and check that your phone has a default SMS app selected.';
  alternatives.append(summary, instructions, numberLink, preview, copy);
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Back to lead';
  Object.assign(close.style, {marginTop:'16px', padding:'10px', font:'inherit'});
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.append(heading, recipient, hint, link, alternatives, close); document.body.append(dialog); dialog.showModal();
  void attachMessageDebug(dialog, {href,number,body,launchHref,expires}).catch(() => { const note=document.createElement('p');note.textContent='Texting diagnostics could not load. Refresh this page and check your account sign-in.';dialog.append(note); });
  // A fresh tap on the link remains available even if this attempt is blocked.
  if (!android && navigator.userActivation?.isActive) window.location.href = href;
}
