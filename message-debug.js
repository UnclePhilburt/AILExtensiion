import {client} from './auth-runtime.js';

export const isMessageDebugAccount = user => user?.email?.toLowerCase() === 'cody2931@gmail.com';

export async function attachMessageDebug(dialog, {href, number, body, launchHref, expires}) {
  const {data} = await client.auth.getSession();
  if (!isMessageDebugAccount(data?.session?.user)) return;
  const verified = await client.auth.getUser();
  if (!dialog.isConnected) return;
  if (verified.error) throw new Error('Could not verify the debug account.');
  if (!isMessageDebugAccount(verified.data?.user)) return;
  const owner = verified.data.user.id;
  const panel = document.createElement('section');
  panel.style.cssText = 'margin-top:20px;padding-top:16px;border-top:1px solid #ccd7cb';
  const title = document.createElement('h3'); title.textContent = 'Cody · texting debug';
  const note = document.createElement('p');
  note.textContent = 'Try one method at a time without sending. Then tap Worked or Did not open. Copy the report back into this chat. Leaving the browser does not prove Messages opened.';
  const output = document.createElement('textarea'); output.readOnly = true;
  output.setAttribute('aria-label', 'Texting debug report');
  output.style.cssText = 'width:100%;height:180px;font:12px monospace';
  const entries = []; let lastMethod = 'none', timer;
  const started = Date.now();
  const record = (event, details = {}) => {
    entries.push({ms:Date.now()-started,event,...details});
    if(entries.length>80)entries.shift();
    output.value = JSON.stringify({version:'text-debug-1',browser:navigator.userAgent,
      standalone:window.matchMedia?.('(display-mode: standalone)').matches || false,
      topLevel:window.top===window,secure:window.isSecureContext,
      numberDigits:number.replace(/\D/g,'').length,messageLength:body.length,entries},null,2);
  };
  const click = event => {
    const anchor = event.target.closest('a'); if (!anchor || !dialog.contains(anchor)) return;
    lastMethod = anchor.dataset.debugMethod || (anchor.getAttribute('href')===launchHref?'primary':'number-only');
    record('tap',{method:lastMethod,trusted:event.isTrusted,active:navigator.userActivation?.isActive ?? null,expired:Date.now()>expires});
    clearTimeout(timer); timer=setTimeout(()=>record('after 2 seconds',{method:lastMethod,visibility:document.visibilityState,focused:document.hasFocus()}),2000);
  };
  const visibility=()=>record('visibility',{state:document.visibilityState});
  const blur=()=>record('browser blur'); const focus=()=>record('browser focus');
  dialog.addEventListener('click',click);
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('blur',blur); window.addEventListener('focus',focus);
  panel.append(title,note);
  for(const [label,url] of [['Original SMS link',href],['Android text link',`smsto:${number}?body=${encodeURIComponent(body)}`],['Android intent',`intent:${number}#Intent;scheme=smsto;action=android.intent.action.SENDTO;S.sms_body=${encodeURIComponent(body)};end`]]){
    const link=document.createElement('a');link.textContent=label;link.href=url;link.dataset.debugMethod=label;
    link.style.cssText='display:block;padding:10px;margin:6px 0;border:1px solid #ccd7cb;border-radius:8px';
    link.addEventListener('click',event=>{if(Date.now()>expires){event.preventDefault();record('blocked: draft expired');note.textContent='Close this box and open the text again to recheck the draft.';}});
    panel.append(link);
  }
  for(const label of ['Worked','Did not open']){
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.addEventListener('click',()=>record('your result',{method:lastMethod,result:label}));panel.append(button);
  }
  const copy=document.createElement('button');copy.type='button';copy.textContent='Copy debug report';
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(output.value);copy.textContent='Copied';}catch{output.focus();output.select();copy.textContent='Hold selected report to copy';}});
  panel.append(output,copy);dialog.prepend(panel);record('debug ready');
  let subscription;
  const cleanup=()=>{clearTimeout(timer);dialog.removeEventListener('click',click);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);subscription?.unsubscribe();panel.remove();};
  subscription=client.auth.onAuthStateChange((_event,session)=>{if(session?.user?.id!==owner)cleanup();}).data.subscription;
  dialog.addEventListener('close',cleanup,{once:true});
}
