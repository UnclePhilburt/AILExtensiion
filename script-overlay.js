import { CALL_SCRIPTS, fillScriptText, scriptForRequestType } from './call-scripts.js';

function paragraph(text) {
  const node = document.createElement('p');
  node.textContent = text;
  return node;
}

export function createScriptOverlay(parent) {
  const overlay = document.createElement('section');
  overlay.className = 'scriptOverlay';
  overlay.hidden = true;
  overlay.setAttribute('aria-label', 'Call script');
  const sheet = document.createElement('div');
  sheet.className = 'scriptSheet';
  const bar = document.createElement('div');
  bar.className = 'scriptBar';
  const heading = document.createElement('h2');
  heading.textContent = 'Script';
  const picker = document.createElement('select');
  picker.className = 'scriptPicker';
  picker.setAttribute('aria-label', 'Which script');
  for (const script of CALL_SCRIPTS) {
    const option = document.createElement('option');
    option.value = script.id;
    option.textContent = script.label;
    picker.append(option);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'scriptClose';
  close.textContent = 'Close';
  bar.append(heading, picker, close);
  const body = document.createElement('div');
  body.className = 'scriptBody';
  sheet.append(bar, body);
  overlay.append(sheet);

  const opener = document.createElement('button');
  opener.type = 'button';
  opener.className = 'scriptOpen';
  opener.hidden = true;
  opener.textContent = 'Script';
  parent.append(opener, overlay);

  let lead = null;
  const chosen = () => CALL_SCRIPTS.find((script) => script.id === picker.value) || scriptForRequestType(lead?.requestType) || CALL_SCRIPTS[0];
  const render = () => {
    const script = chosen();
    if (script) picker.value = script.id;
    heading.textContent = script?.label || 'Script';
    body.replaceChildren();
    if (!script?.steps?.length) {
      body.append(paragraph('No script is saved for this kind of lead. Pick one above.'));
      return;
    }
    for (const step of script.steps) {
      const block = document.createElement('article');
      block.className = 'scriptStep';
      if (step.title) {
        const title = document.createElement('h3');
        title.textContent = step.title;
        block.append(title);
      }
      for (const line of String(step.body || '').split('\n')) if (line.trim()) block.append(paragraph(fillScriptText(line, lead)));
      body.append(block);
    }
  };
  const open = (nextLead) => {
    lead = nextLead || lead;
    const match = scriptForRequestType(lead?.requestType);
    if (match) picker.value = match.id;
    overlay.hidden = false;
    opener.hidden = true;
    render();
    body.scrollTop = 0;
  };
  const hide = () => { overlay.hidden = true; };
  close.addEventListener('click', hide);
  picker.addEventListener('change', render);
  opener.addEventListener('click', () => open(lead));
  return {
    open,
    hide,
    sync(state) {
      lead = state.lead || lead;
      const show = Boolean(state.enabled && state.calling);
      if (!show) { hide(); opener.hidden = true; return; }
      opener.hidden = !overlay.hidden;
    }
  };
}
