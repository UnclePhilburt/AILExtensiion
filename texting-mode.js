// Text drafts and experiment results stay on this device, separately from calls.
export const DEFAULT_TEXTS = {
  A: 'Hi {firstName}, this is {agentName} with {company}. I am reaching out about {topic}. Is there a good time for a brief conversation? Reply STOP to opt out.',
  B: 'Hi {firstName}, {agentName} here with {company}, reaching out about {topic}. Would earlier or later in the day work better for a brief conversation? Reply STOP to opt out.'
};
export function textHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
export function textVariant(userId, leadId, experiment) {
  return parseInt(textHash(`${userId}:${leadId}:${experiment}`), 16) % 2 ? 'B' : 'A';
}
export function textFirstName(name) {
  const value = String(name || '').trim();
  const given = value.includes(',') ? value.split(',').slice(1).join(' ').trim() : value;
  return given.split(/\s+/)[0] || 'there';
}
export function textTopic(type) {
  if (/will\s*kit/i.test(type)) return 'the will kit';
  if (/child\s*safe/i.test(type)) return 'the child safety kit';
  return 'life insurance information';
}
export function fillText(template, values) {
  return String(template).replace(/\{(firstName|agentName|company|topic)\}/g, (_, key) => values[key] || '');
}
export function smsLink(number, body, apple = false) {
  const clean = String(number || '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{10,15}$/.test(clean)) throw new Error('Choose a valid mobile number.');
  return `sms:${clean}${apple ? '&' : '?'}body=${encodeURIComponent(body)}`;
}
export function textStats(records, experiment) {
  return ['A', 'B'].map(variant => {
    const rows = records.filter(r => r.experiment === experiment && r.variant === variant && r.sentAt);
    return { variant, sent: rows.length, replies: rows.filter(r => r.replied).length, appointments: rows.filter(r => r.appointment).length };
  });
}

export function createTextingMode(root, { storage, getUser, getSlot, getLead, getAgent, registerCall }) {
  if (!root) return { sync() {} };
  let rendered = '', busy = false;
  const key = () => `impact.texting.v1.${getUser()}`;
  function read() {
    try { return JSON.parse(storage.getItem(key()) || 'null') || { enabled: false, company: 'American Income Life — Schaefer Organization', templates: {}, records: [], pending: {} }; }
    catch { return { enabled: false, company: 'American Income Life — Schaefer Organization', templates: {}, records: [], pending: {} }; }
  }
  function save(value) { storage.setItem(key(), JSON.stringify(value)); }
  const el = (tag, text, cls) => { const item = document.createElement(tag); if (text) item.textContent = text; if (cls) item.className = cls; return item; };
  function button(text, action) { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; }
  function sync(force = false) {
    const lead = getLead();
    root.hidden = !getUser();
    if (!getUser()) { root.replaceChildren(); rendered = ''; return; }
    const identity = `${getUser()}:${getSlot()}:${lead?.leadId || ''}`;
    if (!force && rendered === identity) return;
    if (busy) return;
    rendered = identity;
    const state = read();
    const heading = el('h2', 'Texting mode');
    const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = state.enabled;
    const toggleLabel = el('label', 'Prepare a text before calling '); toggleLabel.append(toggle);
    toggle.addEventListener('change', () => { const s = read(); s.enabled = toggle.checked; save(s); sync(true); });
    root.replaceChildren(heading, toggleLabel);
    if (!state.enabled) return;
    root.append(el('p', 'Review the draft, send it yourself in Messages, then confirm below. Confirming registers a call in IMPACT and opens its call-result screen. Text results below are tracked separately.'));
    const status = el('p', '', 'textingStatus'); status.setAttribute('role', 'status'); root.append(status);
    const notify = message => { status.textContent = message; };
    const type = lead?.requestType || 'General';
    const templates = state.templates[type] || { ...DEFAULT_TEXTS, topic: textTopic(type) };
    const experiment = textHash(JSON.stringify([type, templates, state.company]));
    const settings = el('details'); settings.append(el('summary', `Edit A/B messages · ${type}`));
    const fields = {};
    for (const [id, label, value] of [['company','Agency / company name',state.company], ['agent','Your name',state.agent || getAgent()], ['topic','Topic for this lead type',templates.topic], ['A','Version A',templates.A], ['B','Version B',templates.B]]) {
      const wrapper = el('label', label); const field = el(id === 'A' || id === 'B' ? 'textarea' : 'input'); field.value = value || ''; field.maxLength = 1200; wrapper.append(field); settings.append(wrapper); fields[id] = field;
    }
    settings.append(el('p', 'Draft wording: review with your agency before use. Placeholders: {firstName}, {agentName}, {company}, {topic}. Saving changed templates starts a separate comparison.'));
    settings.append(button('Save templates', () => {
      const s = read(); s.company = fields.company.value.trim(); s.agent = fields.agent.value.trim();
      if (!s.company || !s.agent || !fields.A.value.trim() || !fields.B.value.trim() || !fields.topic.value.trim()) { notify('Fill in your name, company, topic, and both messages.'); return; }
      s.templates[type] = { A: fields.A.value.trim(), B: fields.B.value.trim(), topic: fields.topic.value.trim() }; save(s); sync(true);
    })); root.append(settings);
    if (!state.company || !(state.agent || getAgent())) { settings.open = true; notify('Enter your name and company, then save your templates.'); }
    const slot = getSlot();
    const pending = state.pending[slot];
    if (pending) {
      root.append(el('h3', `Prepared text · ${pending.name} · ${pending.variant}`), el('p', pending.body));
      const sent = state.records.find(r => r.id === pending.id)?.sentAt;
      if (!sent) {
        const reopen = el('a', 'Reopen draft in Messages', 'download');
        reopen.href = smsLink(pending.number, pending.body, /iPhone|iPad|iPod/.test(navigator.userAgent));
        root.append(reopen, button('Copy prepared message', async () => {
          try { await navigator.clipboard.writeText(pending.body); notify('Copied. Paste into Messages.'); }
          catch { notify('Select and copy the prepared message above.'); }
        }));
      }
      const confirm = button(pending.registered ? 'IMPACT registration requested' : sent ? 'Register in IMPACT' : 'I sent it — register in IMPACT', async () => {
        if (busy || pending.registered) return;
        if (getLead()?.leadId !== pending.leadId) { notify('Return to this text’s lead in IMPACT before registering it. No call was recorded.'); return; }
        busy = true; confirm.disabled = true;
        try {
          const s = read(); let record = s.records.find(r => r.id === pending.id);
          if (!record) { record = { ...pending, sentAt: Date.now() }; s.records.push(record); }
          save(s);
          const accepted = await registerCall(pending);
          if (accepted) { const latest = read(); if (latest.pending[slot]?.id === pending.id) latest.pending[slot].registered = true; save(latest); }
          else notify('Text saved. IMPACT did not accept the request. Check the connection and lead before retrying.');
        } catch (error) { notify(error.message); }
        finally { busy = false; confirm.disabled = false; if (read().pending[slot]?.registered) sync(true); }
      });
      confirm.disabled = Boolean(pending.registered); root.append(confirm);
      root.append(button(sent ? 'Done with this text' : 'Discard draft (not sent)', () => { const s = read(); delete s.pending[slot]; save(s); sync(true); }));
    } else if (lead?.available) {
      const phones = (lead.phones || []).filter(p => p.label === 'Mobile');
      const select = el('select'); select.setAttribute('aria-label', 'Mobile number to text');
      for (const phone of phones) { const option = el('option', phone.number); option.value = phone.number; select.append(option); }
      select.value = phones[0]?.number || '';
      const variant = textVariant(getUser(), lead.leadId, experiment);
      const body = fillText(templates[variant], { firstName: textFirstName(lead.leadName), agentName: state.agent || getAgent(), company: state.company, topic: templates.topic });
      const preview = el('textarea'); preview.value = body; preview.readOnly = true; preview.setAttribute('aria-label', `Version ${variant} message preview`);
      root.append(el('h3', `Version ${variant} · ${lead.leadName}`), select, preview);
      const consent = el('input'); consent.type = 'checkbox';
      const consentLabel = el('label', 'I have permission to text this person and have checked for opt-outs. '); consentLabel.append(consent); root.append(consentLabel);
      const link = el('a', 'Open text in Messages', 'download'); link.href = '#';
      link.addEventListener('click', event => {
        if (!consent.checked || !state.company || !(state.agent || getAgent())) { event.preventDefault(); notify('Save your name and company and confirm permission before opening the text.'); return; }
        if (getLead()?.leadId !== lead.leadId) { event.preventDefault(); notify('The lead changed. Prepare its new draft.'); return; }
        try {
          const s = read();
          if (s.records.some(r => r.leadId === lead.leadId && r.experiment === experiment && r.sentAt)) { event.preventDefault(); notify('You already marked a text sent to this lead in this comparison.'); return; }
          link.href = smsLink(select.value, body, /iPhone|iPad|iPod/.test(navigator.userAgent));
          s.pending[slot] = { id: crypto.randomUUID(), leadId: lead.leadId, name: lead.leadName, number: select.value, phoneType: 'Mobile', slot, body, variant, experiment, registered: false };
          save(s); setTimeout(() => sync(true), 0);
        } catch (error) { event.preventDefault(); notify(error.message); }
      });
      root.append(link, button('Copy message', async () => { try { await navigator.clipboard.writeText(body); notify('Copied. Paste it into Messages if the draft does not fill automatically.'); } catch { notify('Select and copy the message above.'); } }));
      if (!phones.length) { link.hidden = true; notify('No mobile number is listed for this lead.'); }
    } else root.append(el('p', 'Open a lead in IMPACT to prepare a message.'));
    root.append(el('h3', 'A/B results · current templates'));
    for (const row of textStats(state.records, experiment)) root.append(el('p', `${row.variant}: ${row.sent} confirmed sent · ${row.replies} replies · ${row.appointments} appointments`));
    root.append(el('p', 'Results are entered by you and stored only in this browser on this phone. Opening Messages is not proof of sending. A/B compares groups of leads; each lead keeps one version.'));
    const history = el('details'); history.append(el('summary', 'Record replies and appointments'));
    for (const record of state.records.filter(r => r.sentAt).slice(-30).reverse()) {
      const row = el('div', `${record.name} · ${record.variant} · ${new Date(record.sentAt).toLocaleDateString()}`);
      for (const [field, label] of [['replied','Replied'], ['appointment','Appointment booked']]) {
        const input = el('input'); input.type = 'checkbox'; input.checked = Boolean(record[field]);
        const labelEl = el('label', label); labelEl.append(input); row.append(labelEl);
        input.addEventListener('change', () => { const s = read(); const found = s.records.find(r => r.id === record.id); if (found) found[field] = input.checked; save(s); sync(true); });
      }
      history.append(row);
    } root.append(history);
  }
  return { sync };
}
