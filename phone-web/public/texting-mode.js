import { chooseTextVariant, textingTimeHint } from './text-learning.js';
// Drafts survive locally; confirmed sends and reported outcomes sync to Supabase.
const LEGACY_TEXTS = {
  A: 'Hi {firstName}, this is {agentName} with {company}. I am reaching out about {topic}. Is there a good time for a brief conversation? Reply STOP to opt out.',
  B: 'Hi {firstName}, {agentName} here with {company}, reaching out about {topic}. Would earlier or later in the day work better for a brief conversation? Reply STOP to opt out.'
};
export const DEFAULT_TEXTS = {
  A: 'Hi {firstName}, this is {agentName} with {company}. I wanted to check in about {topic}. When would be a good time to talk?',
  B: 'Hey {firstName}, this is {agentName} with {company}. Do you have a few minutes to go over {topic} sometime today?'
};
export function textTemplates(type, saved) {
  const childSafe = /child[\s-]*safe/i.test(type);
  const defaults = childSafe ? {
    A: 'Hi {firstName}, this is {agentName} from American Income Life with the Child Safe Program. I wanted to touch base about the Child Safe Kit. When would be a good time to talk?',
    B: 'Hey {firstName}, this is {agentName} from American Income Life with the Child Safe Program. Do you have a few minutes to go over the Child Safe Kit sometime today?'
  } : DEFAULT_TEXTS;
  const result = { ...defaults, topic: textTopic(type), ...saved };
  for (const variant of ['A', 'B']) {
    if (!saved?.[variant] || saved[variant] === LEGACY_TEXTS[variant]) result[variant] = defaults[variant];
    result[variant] = result[variant].replace(/\s*Reply STOP to opt out\.?/gi, '').trim();
  }
  return result;
}
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
  const first = given.split(/\s+/)[0] || 'there';
  // Preserve intentional mixed case, including names such as McKenzie.
  if (first !== first.toUpperCase() && first !== first.toLowerCase()) return first;
  return first.toLowerCase().replace(/(^|[-'’])\p{L}/gu, part => part.toUpperCase());
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
    return { variant, sent: rows.length, reviewed: rows.filter(r => typeof r.replied === 'boolean').length, replies: rows.filter(r => r.replied).length, appointments: rows.filter(r => r.appointment).length };
  });
}

export function createTextingMode(root, { storage, getUser, getSlot, getLead, getAgent, registerCall, isEnabled = () => true, tracking = null }) {
  if (!root) return { sync() {} };
  let rendered = '', busy = false;
  let refreshAt = 0, refreshing = false, trackingError = '', checkin = null, activeUser = '';
  const key = () => `impact.texting.v1.${getUser()}`;
  function read() {
    try { return JSON.parse(storage.getItem(key()) || 'null') || { enabled: false, company: 'American Income Life — Schaefer Organization', templates: {}, records: [], pending: {} }; }
    catch { return { enabled: false, company: 'American Income Life — Schaefer Organization', templates: {}, records: [], pending: {} }; }
  }
  function save(value) { storage.setItem(key(), JSON.stringify(value)); }
  async function refresh() {
    if (!tracking || refreshing || Date.now() - refreshAt < 60000 || !getUser() || !isEnabled()) return;
    const user = getUser(); refreshing = true; refreshAt = Date.now();
    try {
      for (const record of read().records.filter(r => r.sentAt && !r.cloudSaved)) {
        if (getUser() !== user) return;
        await tracking.save(record, user);
        if (getUser() !== user) return;
        const s = read(); const saved = s.records.find(r => r.id === record.id); if (saved) saved.cloudSaved = true; save(s);
      }
      const rows = await tracking.list();
      if (getUser() !== user) return;
      const s = read();
      const ids = new Set(rows.map(r => r.id));
      s.records = [...rows, ...s.records.filter(r => !ids.has(r.id))]; save(s);
      if (!checkin && !busy) checkin = await tracking.checkin();
      if (getUser() !== user) { checkin = null; return; }
      trackingError = '';
    } catch (error) { if (getUser() === user) trackingError = error.message; }
    finally { refreshing = false; if (getUser() === user) sync(true); }
  }
  const el = (tag, text, cls) => { const item = document.createElement(tag); if (text) item.textContent = text; if (cls) item.className = cls; return item; };
  function button(text, action) { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; }
  function sync(force = false) {
    const lead = getLead();
    if (activeUser !== getUser()) { activeUser = getUser(); checkin = null; refreshAt = 0; trackingError = ''; rendered = ''; }
    root.hidden = !getUser() || !isEnabled();
    if (!getUser()) { root.replaceChildren(); rendered = ''; return; }
    if (!isEnabled()) return;
    void refresh();
    const identity = `${getUser()}:${getSlot()}:${lead?.leadId || ''}`;
    if (!force && rendered === identity) return;
    if (busy) return;
    rendered = identity;
    const state = read();
    const heading = el('h2', 'Texting mode');
    const settingsLink = el('a', 'Texting mode settings'); settingsLink.href = 'settings.html?from=workspace';
    root.replaceChildren(heading, settingsLink);
    root.append(el('p', 'Open the prepared text in your messaging app, send it, then tap I sent it. If your app leaves the message blank, use Copy message and paste it.'));
    const status = el('p', '', 'textingStatus'); status.setAttribute('role', 'status'); root.append(status);
    const notify = message => { status.textContent = message; };
    if (trackingError) notify(trackingError);
    else if (!tracking) notify('Cloud mode is required to save and learn from texting activity.');
    if (checkin) {
      const item = checkin;
      const panel = el('section');
      panel.append(el('h3', `Did ${item.name} reply?`), el('p', `${item.number} · sent ${new Date(item.sentAt).toLocaleString()}`), el('p', item.body));
      for (const [label, replied, appointment] of [['Yes, replied',true,undefined], ['No reply',false,undefined], ['Booked an appointment',true,true], ['Not sure / ask later',null,undefined]]) {
        panel.append(button(label, async () => {
          try {
            if (replied !== null) {
              await tracking.outcome(item.id, replied, appointment);
              const s = read(); const row = s.records.find(r => r.id === item.id);
              if (row) { row.replied = replied; if (appointment) row.appointment = true; } save(s);
            }
            checkin = null; sync(true);
          } catch (error) { notify(error.message); }
        }));
      }
      root.append(panel);
    }
    const type = lead?.requestType || 'General';
    const templates = textTemplates(type, state.templates[type]);
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
    }));
    if (!state.company || !(state.agent || getAgent())) { settings.open = true; notify('Enter your name and company, then save your templates.'); }
    const slot = getSlot();
    const pending = state.pending[slot];
    if (pending) {
      root.append(el('h3', pending.name), el('p', `To: ${pending.number} · Version ${pending.variant}`));
      const sent = state.records.find(r => r.id === pending.id)?.sentAt;
      const actual = el('textarea'); actual.value = pending.body;
      actual.setAttribute('aria-label', 'Message actually sent'); actual.readOnly = Boolean(sent);
      root.append(el('p', 'If you changed the wording in Messages, paste the actual text below before confirming. Edited messages are tracked separately from A/B.'), actual);
      if (!sent) {
        const reopen = el('a', 'Open in Messages', 'download');
        reopen.href = smsLink(pending.number, actual.value, /iPhone|iPad|iPod/.test(navigator.userAgent));
        reopen.addEventListener('click', () => { reopen.href = smsLink(pending.number, actual.value, /iPhone|iPad|iPod/.test(navigator.userAgent)); });
        root.append(reopen, button('Copy message', async () => {
          try { await navigator.clipboard.writeText(actual.value); notify('Copied. Paste into Messages.'); }
          catch { notify('Select and copy the prepared message above.'); }
        }));
      }
      const confirm = button(pending.registered ? 'Text saved' : sent ? 'Retry IMPACT update' : 'I sent it', async () => {
        if (busy || pending.registered) return;
        const owner = getUser();
        busy = true; confirm.disabled = true;
        try {
          const s = read(); let record = s.records.find(r => r.id === pending.id);
          if (!actual.value.trim()) throw new Error('Enter the message you actually sent.');
          if (!record) { record = { ...pending, body:actual.value.trim(), variant:actual.value.trim() === pending.body ? pending.variant : 'custom', sentAt: Date.now(), localHour:new Date().getHours(), timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone }; s.records.push(record); }
          save(s);
          if (!tracking) throw new Error('Switch to Cloud mode to save this text before registering it.');
          if (!record.cloudSaved) {
            await tracking.save(record, owner);
            if (getUser() !== owner) throw new Error('Your account changed. Reopen your workspace.');
            const savedState = read(); const savedRecord = savedState.records.find(r => r.id === record.id);
            if (savedRecord) savedRecord.cloudSaved = true; save(savedState);
          }
          if (getLead()?.leadId !== pending.leadId || getSlot() !== pending.slot) {
            notify('Text saved. Return to this lead and its phone slot in IMPACT before registering the call.');
            return;
          }
          const accepted = await registerCall(pending);
          if (accepted && getUser() === owner) { const latest = read(); if (latest.pending[slot]?.id === pending.id) latest.pending[slot].registered = true; save(latest); }
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
      const prior = state.records.find(r => r.leadId === lead.leadId && r.experiment === experiment);
      const variant = prior?.variant && ['A','B'].includes(prior.variant) ? prior.variant : chooseTextVariant(state.records, experiment, textVariant(getUser(), lead.leadId, experiment));
      const body = fillText(templates[variant], { firstName: textFirstName(lead.leadName), agentName: state.agent || getAgent(), company: state.company, topic: templates.topic });
      const preview = el('textarea'); preview.value = body; preview.readOnly = true; preview.setAttribute('aria-label', `Version ${variant} message preview`);
      root.append(el('h3', lead.leadName), el('p', `To: mobile number · Version ${variant}`), select, preview);
      const consent = el('input'); consent.type = 'checkbox';
      const consentLabel = el('label', 'I have permission to text this person and have checked for opt-outs. '); consentLabel.append(consent); root.append(consentLabel);
      const link = el('a', 'Open in Messages', 'download'); link.href = '#';
      link.addEventListener('click', event => {
        if (!consent.checked || !state.company || !(state.agent || getAgent())) { event.preventDefault(); notify('Save your name and company and confirm permission before opening the text.'); return; }
        if (getLead()?.leadId !== lead.leadId) { event.preventDefault(); notify('The lead changed. Prepare its new draft.'); return; }
        try {
          const s = read();
          if (s.records.some(r => r.leadId === lead.leadId && r.experiment === experiment && r.sentAt)) { event.preventDefault(); notify('You already marked a text sent to this lead in this comparison.'); return; }
          link.href = smsLink(select.value, body, /iPhone|iPad|iPod/.test(navigator.userAgent));
          s.pending[slot] = { id: crypto.randomUUID(), leadId: lead.leadId, name: lead.leadName, number: select.value, phoneType: 'Mobile', requestType:type, slot, body, variant, experiment, registered: false };
          save(s); setTimeout(() => sync(true), 0);
        } catch (error) { event.preventDefault(); notify(error.message); }
      });
      root.append(link, button('Copy message', async () => { try { await navigator.clipboard.writeText(body); notify('Copied. Paste it into Messages if the draft does not fill automatically.'); } catch { notify('Select and copy the message above.'); } }));
      if (!phones.length) { link.hidden = true; notify('No mobile number is listed for this lead.'); }
    } else root.append(el('p', 'Open a lead in IMPACT to prepare a message.'));
    root.append(settings);
    const results = el('details'); results.append(el('summary', 'Texting results and timing'));
    root.append(results);
    results.append(el('p', 'Confirming a sent text also requests the IMPACT call-counter update.'));
    results.append(el('h3', 'A/B results · current templates'));
    for (const row of textStats(state.records, experiment)) results.append(el('p', `${row.variant}: ${row.sent} confirmed sent · ${row.reviewed} outcomes checked · ${row.replies} replies · ${row.appointments} appointments`));
    results.append(el('p', textingTimeHint(state.records, experiment, Intl.DateTimeFormat().resolvedOptions().timeZone)));
    results.append(el('p', 'Confirmed texts, numbers, wording, sending time and reported results sync privately to your account in Supabase. Time means when you confirm sending on this device. Unknown outcomes are not counted as no replies. Comparisons use up to 5,000 recent texts and suggest wording only after both versions have 20 checked outcomes.'));
    const history = el('details'); history.append(el('summary', 'Record replies and appointments'));
    for (const record of state.records.filter(r => r.sentAt).slice(-30).reverse()) {
      const row = el('div', `${record.name} · ${record.variant} · ${new Date(record.sentAt).toLocaleDateString()}`);
      for (const [field, label] of [['replied','Replied'], ['appointment','Appointment booked']]) {
        const input = el('input'); input.type = 'checkbox'; input.checked = Boolean(record[field]);
        const labelEl = el('label', label); labelEl.append(input); row.append(labelEl);
        input.addEventListener('change', async () => {
          try {
            if (!tracking) throw new Error('Cloud mode is required to save results.');
            await tracking.outcome(record.id, field === 'replied' ? input.checked : undefined, field === 'appointment' ? input.checked : undefined);
            const s = read(); const found = s.records.find(r => r.id === record.id); if (found) found[field] = input.checked; save(s); sync(true);
          } catch (error) { input.checked = Boolean(record[field]); notify(error.message); }
        });
      }
      history.append(row);
    } root.append(history);
  }
  return { sync };
}
