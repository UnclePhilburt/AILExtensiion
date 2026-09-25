(() => {
  if (window.__impactCompanionSalebasePickerLoaded) return;
  window.__impactCompanionSalebasePickerLoaded = true;
  let picker = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'impact/startPicker') return;
    startPicker().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  async function startPicker() {
    stopPicker();
    const outline = document.createElement('div');
    outline.id = 'impact-companion-picker-outline';
    Object.assign(outline.style, { position:'fixed', pointerEvents:'none', zIndex:'2147483647', border:'3px solid #1d4ed8', background:'rgba(29,78,216,.08)', display:'none' });
    document.documentElement.append(outline);
    const move = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target === outline) return;
      const rect = target.getBoundingClientRect();
      Object.assign(outline.style, { display:'block', left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px` });
    };
    const click = async (event) => {
      event.preventDefault(); event.stopPropagation();
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest('button, a, label, input, select, textarea, [role="button"], [onclick]') || target;
      const info = describe(control);
      await chrome.storage.local.set({ 'impact.lastPickedElement': info });
      stopPicker();
      alert('Element captured. Return to Companion Options and copy it.');
    };
    const key = (event) => { if (event.key === 'Escape') stopPicker(); };
    picker = { outline, move, click, key };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
  }

  function stopPicker() {
    if (!picker) return;
    document.removeEventListener('mousemove', picker.move, true);
    document.removeEventListener('click', picker.click, true);
    document.removeEventListener('keydown', picker.key, true);
    picker.outline.remove(); picker = null;
  }

  function describe(element) {
    return { selector: selectorFor(element), tagName:element.tagName.toLowerCase(), id:element.id || '', name:element.getAttribute('name') || '', type:element.getAttribute('type') || '', ariaLabel:element.getAttribute('aria-label') || '', role:element.getAttribute('role') || '', labelText:'', textSample:String(element.innerText || element.textContent || element.value || '').replace(/\s+/g,' ').trim().slice(0,200), clickableAncestor:null, nearbyStableAttributes:[], url:location.href.split(/[?#]/)[0], capturedAt:new Date().toISOString() };
  }

  function selectorFor(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const name = node.getAttribute('name');
      if (name) part += `[name="${CSS.escape(name)}"]`;
      else { const siblings = Array.from(node.parentElement?.children || []).filter((item) => item.tagName === node.tagName); if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`; }
      parts.unshift(part);
    }
    return `body > ${parts.join(' > ')}`;
  }
})();
