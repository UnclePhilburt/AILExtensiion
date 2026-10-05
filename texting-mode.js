import {openMessage as launchMessage} from './open-message.js?v=5';
import { chooseTextVariant, textingTimeHint } from './text-learning.js?v=2';
// Drafts survive locally; confirmed sends and reported outcomes sync to Supabase.
const LEGACY_TEXTS = {
  A: 'Hi {firstName}, this is {agentName} with {company}. I am reaching out about {topic}. Is there a good time for a brief conversation? Reply STOP to opt out.',
  B: 'Hi {firstName}, {agentName} here with {company}, reaching out about {topic}. Would earlier or later in the day work better for a brief conversation? Reply STOP to opt out.'
};
const PREVIOUS_ZOOM_TEXTS = ['Hi {firstName}, this is {agentName} with {company}. I wanted to set up a Zoom meeting to go over {topic}. What day and time works for you?','Hey {firstName}, this is {agentName} with {company}. Would earlier or later in the day work better for a Zoom meeting to go over {topic}?','Hi {firstName}, this is {agentName} from American Income Life with the Child Safe Program. I wanted to set up a Zoom meeting to go over the Child Safe Kit with you. What day and time works for you?','Hey {firstName}, this is {agentName} from American Income Life with the Child Safe Program. Would earlier or later in the day work better for a Zoom meeting to go over the Child Safe Kit?'];
const KIT_TEXTS = {
  A: 'Hi {firstName}, this is {agentName} with {company}. I have {meetingTimeA} or {meetingTimeB} open for a Zoom meeting to go over {topic}. Which time works best for you?',
  B: 'Hey {firstName}, this is {agentName} with {company}. What time are you usually available for a Zoom meeting to go over {topic}?'
};
export const DEFAULT_TEXTS = {
  A: 'Hi {firstName}, this is {agentName} with {company}. We got your request to talk with an agent about life insurance options. I have {meetingTimeA} or {meetingTimeB} open to go over them with you on Zoom. Which time works best for you?',
  B: 'Hey {firstName}, this is {agentName} with {company}. We got your request to talk with an agent about life insurance options. What time are you usually available to go over them with me on Zoom?'
};
export function isChildSafeLead(type) {
 return /\bchild[\s_\u2010-\u2015-]*saf(?:e|ety)\b|\bcsk\b/i.test(String(type||''));
}
export function isBenefitsReplyLead(type) {
  const value=String(type||'');
  if(isChildSafeLead(value)||/will\s*kit/i.test(value))return false;
  return /\b(?:union|unions|group|groups|association|assoc|response\s*cards?|reply\s*cards?|rc)\b/i.test(value)
    || /(?:^|[\s,;:|-])(?:[A-Z][A-Z&.'\/-]*[A-Z&.]|Local|Lodge|District|Council|Chapter)\s+#?\d{1,5}[A-Z]?\s*\((?=[^()]*[A-Za-z])[A-Za-z0-9&\/.' -]{1,20}\)/.test(value)
    || /\([A-Z]{2,}\d[A-Z0-9]*\)\s*\([A-Z&]{2,}\)/i.test(value);
}
const BENEFITS_TEXTS = {
 A: 'Hi {firstName}, this is {agentName} with {company}. We received the reply card you sent in for the cost-free benefits program. I have {meetingTimeA} or {meetingTimeB} open to go over it with you on Zoom. Which time works best for you?',
 B: 'Hey {firstName}, this is {agentName} with {company}. We received the reply card you sent in for the cost-free benefits program. What time are you usually available to go over it with me on Zoom?'
};
export function benefitsGroupName(type, explicit = '') {
  const raw=String(explicit||type||'').replace(/\s+/g,' ').trim();
  if(!explicit&&!isBenefitsReplyLead(raw))return '';
  const name=raw.replace(/(?:\s*\([^()]*\))+\s*$/,'').replace(/^(?:request type|group name|union name|association name)\s*:\s*/i,'').replace(/^(?:response|reply)\s*cards?\s*[-:–]\s*/i,'').trim();
  if(!name||/^(?:groups?|unions?|associations?|assoc|response\s*cards?|reply\s*cards?|rc|unknown|n\/a)$/i.test(name))return '';
  return name.slice(0,120);
}
export function textTemplates(type, saved, group = '') {
  const childSafe = isChildSafeLead(type);
  const defaults = childSafe ? {
    A: 'Hi {firstName}, this is {agentName} from American Income Life with the Child Safe Program. I have {meetingTimeA} or {meetingTimeB} open for a Zoom meeting to go over the Child Safe Kit with you. Which time works best for you?',
    B: 'Hey {firstName}, this is {agentName} from American Income Life with the Child Safe Program. What time are you usually available for a Zoom meeting to go over the Child Safe Kit?'
  } : /will\s*kit/i.test(type) ? KIT_TEXTS : isBenefitsReplyLead(type) ? BENEFITS_TEXTS : DEFAULT_TEXTS;
  defaults.C = defaults.A;
  defaults.D = defaults.A.split('I have')[0] + 'Would {meetingTimeA} or {meetingTimeB} work for a Zoom meeting about {topic}? If neither works, what time is usually best for you?';
  const result = { ...defaults, topic: textTopic(type), ...saved };
  for (const variant of ['A', 'B', 'C', 'D']) {
    if (!saved?.[variant] || saved[variant] === LEGACY_TEXTS[variant] || saved[variant] === KIT_TEXTS[variant] || PREVIOUS_ZOOM_TEXTS.includes(saved[variant])) result[variant] = defaults[variant];
    result[variant] = result[variant].replace(/\s*Reply STOP to opt out\.?/gi, '').trim();
  }
  if(childSafe){result.topic='the Child Safe Kit';for(const variant of ['A','B','C','D'])if(/life insurance|cost-free benefits/i.test(result[variant]))result[variant]=defaults[variant];}
  if(isBenefitsReplyLead(type)){result.topic=textTopic(type);for(const variant of ['A','B','C','D'])if(/life insurance/i.test(result[variant]))result[variant]=defaults[variant];}
  const groupName=benefitsGroupName(type,group);
  if(isBenefitsReplyLead(type)&&groupName){for(const variant of ['A','B','C','D'])result[variant]=result[variant].replace('cost-free benefits program through '+groupName,'cost-free benefits program for members of '+groupName).replace(/cost-free benefits program(?! for members of )/g,'cost-free benefits program for members of '+groupName);}
  return result;
}
export function textHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
export function textVariant(userId, leadId, experiment, variants=['A','B']) {
  return variants[parseInt(textHash(`${userId}:${leadId}:${experiment}`), 16) % variants.length];
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
  if(isBenefitsReplyLead(type))return 'the cost-free benefits program';
  if (/will\s*kit/i.test(type)) return 'the will kit';
  if (isChildSafeLead(type)) return 'the Child Safe Kit';
  return 'life insurance information';
}
export function withoutOrganization(value) {
  return String(value || '').replace(/\s*[—–,-]?\s*Schaefer\s+Organization/gi, '').trim();
}
export function fillText(template, values) {
  return withoutOrganization(String(template).replace(/\{(firstName|agentName|company|topic|meetingTimeA|meetingTimeB)\}/g, (_, key) => values[key] || ''));
}
export function centralParts(time) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time)).map(p=>[p.type,p.value]));
 return {year:+parts.year,month:+parts.month,day:+parts.day,hour:+parts.hour};
}
function centralTimestamp(year,month,day,hour) {
 let guess=Date.UTC(year,month-1,day,hour);
 for(let i=0;i<3;i++){const p=centralParts(guess);guess+=Date.UTC(year,month-1,day,hour)-Date.UTC(p.year,p.month-1,p.day,p.hour);}
 return guess;
}
export function textMeetingSlots(rows, now=Date.now(), policy='standard') {
 const p=centralParts(now), base=Date.UTC(p.year,p.month-1,p.day), slots=[];
 for(let day=policy==='standard'&&p.hour>=17?1:0;day<7;day++) {
  if(policy==='same-day'&&day>0)break;
  const date=new Date(base+day*86400000), dow=date.getUTCDay();if(dow===0)continue;
  for(let hour=dow===6?9:14;hour<=(dow===6?13:20);hour++) {
   const time=centralTimestamp(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),hour);
   if(time<now+3600000)continue;
   if(rows.some(row=>{
    if(row.kind==='callback')return false;
    const busy=Date.parse(row.starts_at);
    if(row.all_day){const b=centralParts(busy),t=centralParts(time);return b.year===t.year&&b.month===t.month&&b.day===t.day;}
    return time<busy+3600000&&time+3600000>busy;
   }))continue;
   slots.push(time);
  }
 }
 return slots;
}
export function availableTextMeetings(rows,now=Date.now(),policy='standard') {
 const slots=textMeetingSlots(rows,now,policy);if(!slots.length)return [];
 const first=slots[0],p=centralParts(first);
 const same=slots.filter(t=>{const q=centralParts(t);return q.year===p.year&&q.month===p.month&&q.day===p.day;});
 const later=same.filter(t=>t>first), preferred=later.find(t=>centralParts(t).hour===19);
 return later.length?[first,preferred||later[later.length-1]]:policy==='same-day'?[first]:slots.slice(0,2);
}
export function meetingTimeLabel(time,now=Date.now()) {
 const p=centralParts(time),n=centralParts(now), diff=(Date.UTC(p.year,p.month-1,p.day)-Date.UTC(n.year,n.month-1,n.day))/86400000;
 const day=diff===0?'today':diff===1?'tomorrow':new Date(time).toLocaleDateString('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric'});
 return day+' at '+new Date(time).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
}
export function smsLink(number, body, apple = false) {
  const clean = String(number || '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{10,15}$/.test(clean)) throw new Error('Choose a valid phone number.');
  return `sms:${clean}${apple ? '&' : '?'}body=${encodeURIComponent(body)}`;
}
export function textStats(records, experiment) {
  return ['A', 'B', 'C', 'D'].map(variant => {
    const rows = records.filter(r => r.experiment === experiment && r.variant === variant && r.sentAt);
    return { variant, sent: rows.length, reviewed: rows.filter(r => typeof r.replied === 'boolean').length, replies: rows.filter(r => r.replied).length, appointments: rows.filter(r => r.appointment).length };
  });
}

export function createTextingMode(root, { storage, getUser, getSlot, getLead, getAgent, registerCall, isEnabled = () => true, tracking = null, getMeetings = null, activateLead = null, openMessage = launchMessage }) {
  if (!root) return { sync() {} };
  let rendered = '', busy = false, openingFollowup = '', fourVariants = false, calendarRows = null, calendarAt = 0;
  const numberKey = number => String(number || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  let refreshAt = 0, refreshing = false, trackingError = '', checkin = null, activeUser = '';
  const key = () => `impact.texting.v1.${getUser()}`;
  function read() {
    try { return JSON.parse(storage.getItem(key()) || 'null') || { enabled: false, company: 'American Income Life', templates: {}, records: [], pending: {} }; }
    catch { return { enabled: false, company: 'American Income Life', templates: {}, records: [], pending: {} }; }
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
      fourVariants = tracking.experimentsReady ? await tracking.experimentsReady() : false;
      if (getMeetings) { try { calendarRows = await getMeetings(); calendarAt = Date.now(); } catch { calendarRows = null; } }
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
  const displayName = name => String(name || '').split(',').reverse().join(' ').trim().split(/\s+/).map(textFirstName).join(' ');
  const el = (tag, text, cls) => { const item = document.createElement(tag); if (text) item.textContent = text; if (cls) item.className = cls; return item; };
  function button(text, action) { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; }
  function sync(force = false) {
    const lead = getLead();
    if (activeUser !== getUser()) { activeUser = getUser(); fourVariants = false; calendarRows = null; calendarAt = 0; openingFollowup = ''; checkin = null; refreshAt = 0; trackingError = ''; rendered = ''; }
    root.hidden = !getUser() || !isEnabled();
    if (!getUser()) { root.replaceChildren(); rendered = ''; return; }
    if (!isEnabled()) return;
    void refresh();
    const identity = `${getUser()}:${getSlot()}:${lead?.leadId || ''}`;
    if (!force && rendered === identity) return;
    if (busy) return;
    rendered = identity;
    const state = read();
    state.company = withoutOrganization(state.company) || 'American Income Life';
    const heading = el('h2', 'Text a lead');
    const settingsLink = el('a', 'Settings'); settingsLink.href = 'settings.html?from=workspace';
    const header = el('div', '', 'textingHeader'); header.append(heading, settingsLink);
    root.replaceChildren(header);
    const reviewLink = el('a', 'Review texts'); reviewLink.href = 'text-review.html';
    const more = el('details', '', 'textingMore'); more.append(el('summary', 'Messages & results'));
    let checkinPanel = null;
    const status = el('p', '', 'textingStatus'); status.setAttribute('role', 'status'); root.append(status);
    const notify = message => { status.textContent = message; };
    if (trackingError) notify(trackingError);
    else if (!tracking) notify('Cloud mode is required to save and learn from texting activity.');
    if (checkin) {
      const item = checkin;
      const panel = el('details', '', 'textingCheckin'); panel.append(el('summary', `Quick check-in · ${textFirstName(item.name)}`));
      panel.append(el('h3', `Did ${item.name} reply?`), el('p', `${item.number} · sent ${new Date(item.sentAt).toLocaleString()}`), el('p', item.body));
      for (const [label, replied, appointment] of [['Yes, replied',true,undefined], ['No reply',false,undefined], ['Booked an appointment',true,true], ['Not sure / ask later',null,undefined]]) {
        panel.append(button(label, async () => {
          try {
            if (replied !== null) {
              await tracking.outcome(item.id, replied, appointment);
              const s = read(); const row = s.records.find(r => r.id === item.id);
              if (row) { row.replied = replied; if (appointment) row.appointment = true; }
              if (replied === false) {
                s.homeFollowups ||= {};
                s.homeFollowups[item.leadId] = { leadId:item.leadId, name:item.name, number:item.number };
                if (s.pending[getSlot()]?.registered) delete s.pending[getSlot()];
              }
              save(s);
            }
            checkin = null; sync(true);
          } catch (error) { notify(error.message); }
        }));
      }
      checkinPanel = panel;
    }
    const type = lead?.requestType || 'General';
    const templates = textTemplates(type, state.templates[type], lead?.group || lead?.groupName);
    const experiment = textHash(JSON.stringify(['central-schedule-v1',type, templates, state.company]));
    const settings = el('details'); settings.append(el('summary', `Edit messages · ${type}`));
    const fields = {};
    for (const [id, label, value] of [['company','Company name',state.company], ['agent','Your name',state.agent || getAgent()], ['topic','Topic for this lead type',templates.topic], ['A','Version A',templates.A], ['B','B · Ask availability',templates.B], ['C','C · Same-day direct',templates.C], ['D','D · Same-day gentle',templates.D]]) {
      const wrapper = el('label', label); const field = el(['A','B','C','D'].includes(id) ? 'textarea' : 'input'); field.value = value || ''; field.maxLength = 1200; wrapper.append(field); settings.append(wrapper); fields[id] = field;
    }
    if (!fourVariants) settings.append(el('p', 'C/D testing activates after database update 023. A/B remain available.'));
    settings.append(el('p', 'Central Time: weekdays 2–9 p.m., Saturdays 9 a.m.–2 p.m., no Sundays. One hour per meeting, one hour notice. A offers the next working day after 5; B asks availability. C/D test same-day offers after 5 when two times remain. Callbacks do not block times.'));
    settings.append(el('p', 'Draft wording: review with your agency before use. Placeholders: {firstName}, {agentName}, {company}, {topic}, {meetingTimeA}, {meetingTimeB}. Saving changed templates starts a separate comparison.'));
    settings.append(button('Save templates', () => {
      const s = read(); s.company = fields.company.value.trim(); s.agent = fields.agent.value.trim();
      if (!s.company || !s.agent || !fields.A.value.trim() || !fields.B.value.trim() || !fields.topic.value.trim()) { notify('Fill in your name, company, topic, and both messages.'); return; }
      s.templates[type] = { A: fields.A.value.trim(), B: fields.B.value.trim(), C:fields.C.value.trim(), D:fields.D.value.trim(), topic: fields.topic.value.trim() }; save(s); sync(true);
    }));
    if (!state.company || !(state.agent || getAgent())) { settings.open = true; notify('Enter your name and company, then save your templates.'); }
    const slot = getSlot();
    const pending = state.pending[slot];
    const followup = Object.values(state.homeFollowups || {})[0];
    if (!pending && followup && String(lead?.leadId) !== String(followup.leadId)) {
      notify('Opening ' + displayName(followup.name) + ' to prepare the Home-number follow-up…');
      if (activateLead && openingFollowup !== followup.leadId) {
        openingFollowup = followup.leadId;
        const owner = getUser();
        Promise.resolve(activateLead(followup.leadId)).catch(error => {
          if (getUser() === owner) { openingFollowup = ''; notify(error.message); }
        });
      }
    }
    if (followup && String(lead?.leadId) === String(followup.leadId)) openingFollowup = '';

    if (pending) {
      if(isChildSafeLead(pending.requestType)&&/life insurance|cost-free benefits/i.test(pending.body)&&!state.records.some(r=>r.id===pending.id&&r.sentAt)){delete state.pending[slot];save(state);sync(true);return;}
      root.append(el('h3', displayName(pending.name), 'textingName'), el('p', pending.number, 'textingRecipient'));
      const sent = state.records.find(r => r.id === pending.id)?.sentAt;
      const actual = el('textarea'); actual.value = pending.body;
      actual.setAttribute('aria-label', 'Message actually sent'); actual.readOnly = Boolean(sent);
      const message = el('p', pending.body, 'textingBubble'); root.append(message);
      const edit = el('details'); edit.append(el('summary', 'Edit sent wording'), el('p', 'Changed it in Messages? Paste what you sent here.'), actual);
      actual.addEventListener('input', () => { message.textContent = actual.value; });
      more.append(edit);
      if (!sent) root.append(el('p', 'After sending, tap I sent it.', 'textingHint'));
      if (!sent) {
        const reopen = el('a', 'Open in Messages', 'textingSecondary');
        reopen.href = smsLink(pending.number, actual.value, /iPhone|iPad|iPod/.test(navigator.userAgent));
        reopen.addEventListener('click', async event => {
          event.preventDefault();
          if (busy) return;
          busy = true;
          try {
            const owner = getUser();
            if (pending.offeredSlots?.length) {
              if (!getMeetings) throw new Error('Connect your calendar to check these meeting times.');
              const rows = await getMeetings();
              if (pending.offeredSlots.some(time => !textMeetingSlots(rows, Date.now(), 'all').includes(time))) throw new Error('An offered time is no longer available. Discard this draft and prepare a new one.');
              if (pending.offeredSlots.some(time => time < Date.now() + 3600000)) throw new Error('These times need updating. Discard this draft and prepare a new one.');
            }
            if (owner !== getUser()) throw new Error('Your account changed. Reopen your workspace.');
            openMessage(smsLink(pending.number, actual.value, /iPhone|iPad|iPod/.test(navigator.userAgent)));
          } catch (error) { notify(error.message); } finally { busy = false; }
        });
        const secondary = el('div', '', 'textingActions');
        secondary.append(reopen, button('Copy message', async () => {
          try { await navigator.clipboard.writeText(actual.value); notify('Copied. Paste into Messages.'); }
          catch { edit.open = true; more.open = true; notify('Select and copy the message under Edit sent wording.'); }
        }));
        root.append(secondary);
      }
      const confirm = button(pending.registered ? 'Text saved' : sent ? 'Retry IMPACT update' : 'I sent it', async () => {
        if (busy || pending.registered) return;
        const owner = getUser();
        busy = true; confirm.disabled = true;
        try {
          const s = read(); let record = s.records.find(r => r.id === pending.id);
          if (!actual.value.trim()) throw new Error('Enter the message you actually sent.');
          if (!record) { record = { ...pending, body:actual.value.trim(), variant:actual.value.trim() === pending.body ? pending.variant : 'custom', sentAt: Date.now(), localHour:centralParts(Date.now()).hour, timeZone:'America/Chicago' }; s.records.push(record); }
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
      confirm.disabled = Boolean(pending.registered); confirm.className = 'textingPrimary'; root.append(confirm);
      const finish = button(sent ? 'Done with this text' : 'Discard draft (not sent)', () => { const s = read(); delete s.pending[slot]; save(s); sync(true); });
      if (sent) root.append(finish); else more.append(finish);
    } else if (lead?.available) {
      const phones = (lead.phones || []).filter(p => ['Mobile', 'Home'].includes(p.label) && p.number).sort((a, b) => Number(b.label === 'Mobile') - Number(a.label === 'Mobile'));
      const homeFollowup = state.homeFollowups?.[lead.leadId];
      const home = phones.find(phone => phone.label === 'Home' && numberKey(phone.number) !== numberKey(homeFollowup?.number));
      const homeAlreadySent = home && state.records.some(record => record.leadId === lead.leadId && record.sentAt && numberKey(record.number) === numberKey(home.number));
      const selectedPhone = homeFollowup ? (homeAlreadySent ? null : home) : phones[0];
      const selectedNumber = selectedPhone?.number || '';
      if (homeFollowup && !selectedPhone) {
        const latest = read(); delete latest.homeFollowups[lead.leadId]; save(latest);
        notify(homeAlreadySent ? 'The Home number has already been texted.' : 'No different Home number is available.');
      }

      const prior = state.records.find(r => r.leadId === lead.leadId && r.experiment === experiment);
      const afterFive = centralParts(Date.now()).hour >= 17;
      const eligible = fourVariants && afterFive && calendarRows && Date.now()-calendarAt<60000 && availableTextMeetings(calendarRows,Date.now(),'same-day').length===2;
      const variants = eligible ? ['A','B','C','D'] : ['A','B'];
      const timingCohort = eligible ? 'after5-same-day-eligible' : 'standard';
      const variant = prior?.variant && variants.includes(prior.variant) ? prior.variant : chooseTextVariant(state.records.filter(r=>r.timingCohort===timingCohort), experiment, textVariant(getUser(),lead.leadId,experiment+timingCohort,variants), Math.random, variants);
      const offerPolicy = ['C','D'].includes(variant) ? 'same-day' : 'standard';
      let body = fillText(templates[variant], { firstName: textFirstName(lead.leadName), agentName: state.agent || getAgent(), company: state.company, topic: templates.topic, meetingTimeA: "", meetingTimeB: "" });
      const preview = el('textarea', '', 'textingPreview'); preview.value = body; preview.readOnly = true; preview.setAttribute('aria-label', `Version ${variant} message preview`);
      root.append(el('h3', displayName(lead.leadName), 'textingName'));
      if (selectedPhone) root.append(el('p', `${selectedPhone.label} · ${selectedNumber}`, 'textingRecipient'));
      root.append(preview);
      const needsTimes = /\{meetingTime[AB]\}/.test(templates[variant]);
      let previewReady = !needsTimes;
      const previewOwner = getUser();
      async function loadPreviewTimes() {
        if (!needsTimes) return;
        previewReady = false; preview.value = ''; preview.placeholder = 'Checking your calendar…';
        try {
          if (!getMeetings) throw new Error('Connect your Companion calendar to load meeting times.');
          const slots = availableTextMeetings(await getMeetings(), Date.now(), offerPolicy);
          if (getUser() !== previewOwner || getLead()?.leadId !== lead.leadId || getSlot() !== slot) return;
          if (slots.length < 2) throw new Error('No two open meeting times found in the next seven days. Check your calendar.');
          body = fillText(templates[variant], { firstName:textFirstName(lead.leadName), agentName:state.agent || getAgent(), company:state.company, topic:templates.topic, meetingTimeA:meetingTimeLabel(slots[0]), meetingTimeB:meetingTimeLabel(slots[1]) });
          preview.value = body; previewReady = true;
        } catch (error) { preview.placeholder = 'Meeting times could not load.'; notify(error.message); }
      }
      void loadPreviewTimes();
      const link = el('a', 'Open in Messages', 'download'); link.href = '#';
      link.addEventListener('click', async event => {
        event.preventDefault();
        if (busy) return;
        if (!state.company || !(state.agent || getAgent())) { event.preventDefault(); notify('Save your name and company before opening the text.'); return; }
        if (getLead()?.leadId !== lead.leadId) { event.preventDefault(); notify('The lead changed. Prepare its new draft.'); return; }
        try {
          const s = read();
          if (s.records.some(r => r.leadId === lead.leadId && r.experiment === experiment && r.sentAt && (!homeFollowup || numberKey(r.number) === numberKey(selectedNumber)))) { event.preventDefault(); notify('You already marked a text sent to this lead in this comparison.'); return; }
          let preparedBody = body, offeredSlots = [];
          if (/\{meetingTime[AB]\}/.test(templates[variant])) {
            if (!getMeetings) throw new Error('Connect your Companion calendar before offering meeting times.');
            busy = true; notify('Checking your meetings…');
            const owner = getUser();
            offeredSlots = availableTextMeetings(await getMeetings());
            if (owner !== getUser() || getLead()?.leadId !== lead.leadId || getSlot() !== slot) throw new Error('The lead or account changed. Prepare a new message.');
            if (offeredSlots.length < 2) throw new Error('There are not two open meeting times in the next seven days. Check your calendar or edit the message.');
            preparedBody = fillText(templates[variant], { firstName:textFirstName(lead.leadName), agentName:state.agent || getAgent(), company:state.company, topic:templates.topic, meetingTimeA:meetingTimeLabel(offeredSlots[0]), meetingTimeB:meetingTimeLabel(offeredSlots[1]) });
          }
          link.href = smsLink(selectedNumber, preparedBody, /iPhone|iPad|iPod/.test(navigator.userAgent));
          const latest = read();
          latest.pending[slot] = { id: crypto.randomUUID(), leadId: lead.leadId, name: lead.leadName, number: selectedNumber, phoneType: selectedPhone.label, requestType:type, slot, body: preparedBody, offeredSlots, variant, timingCohort, offerPolicy, experiment, registered: false };
          if (homeFollowup) delete latest.homeFollowups[lead.leadId];
          save(latest); busy = false; sync(true); openMessage(link.href);
        } catch (error) { notify(error.message); } finally { busy = false; }
      });
      root.append(link);
      root.append(button('Copy message', async () => { try { if (!previewReady) { await loadPreviewTimes(); if (!previewReady) return; } await navigator.clipboard.writeText(body); notify('Copied. Paste it into Messages if the draft does not fill automatically.'); } catch { notify('Select and copy the message above.'); } }));
      if (!selectedPhone) { link.hidden = true; if (!homeFollowup) notify('No home or mobile number is listed for this lead.'); }
    } else root.append(el('p', 'Open a lead in IMPACT to prepare a message.'));
    more.append(settings);
    if (settings.open) more.open = true;
    const results = el('details'); results.append(el('summary', 'Texting results and timing'));
    more.append(results);
    results.append(el('p', 'Confirming a sent text also requests the IMPACT call-counter update.'));
    results.append(el('h3', 'Message results · current templates'));
    for (const row of textStats(state.records, experiment)) results.append(el('p', `${row.variant}: ${row.sent} confirmed sent · ${row.reviewed} outcomes checked · ${row.replies} replies · ${row.appointments} appointments`));
    results.append(el('h3', 'After 5 · same-day openings available'));
    for (const row of textStats(state.records.filter(r => r.timingCohort === 'after5-same-day-eligible'), experiment)) results.append(el('p', `${row.variant}: ${row.reviewed} checked · ${row.replies} replies · ${row.appointments} appointments`));
    results.append(el('p', textingTimeHint(state.records, experiment, 'America/Chicago')));
    results.append(el('p', 'Confirmed texts, numbers, wording, sending time and reported results sync privately to your account in Supabase. Time means when you confirm sending on this device. Unknown outcomes are not counted as no replies. Comparisons use up to 5,000 recent texts and suggest wording only after every eligible version has 20 checked outcomes in the same timing group.'));
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
    } more.append(history);
    root.append(reviewLink, more);
    if (checkinPanel) root.append(checkinPanel);
  }
  return { sync };
}
