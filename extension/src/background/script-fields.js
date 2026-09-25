// Turns the current IMPACT lead into the values the Salebase phone script can
// show in place of its placeholders ((Member), NAME, (ADDRESS), DOB, ...).
// Pure functions: the service worker stores the result for the Salebase tab.

const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STREET_WORDS = new Set(['ST', 'STREET', 'AVE', 'AVENUE', 'AV', 'RD', 'ROAD', 'DR', 'DRIVE', 'LN', 'LANE', 'BLVD', 'BOULEVARD', 'CT', 'COURT', 'WAY', 'PL', 'PLACE',
  'CIR', 'CIRCLE', 'HWY', 'HIGHWAY', 'PKWY', 'PARKWAY', 'TER', 'TERRACE', 'TRL', 'TRAIL', 'LOOP', 'SQ', 'PIKE', 'ROW', 'RUN', 'XING', 'EXPY', 'FWY']);
const UNIT_WORDS = new Set(['APT', 'UNIT', 'STE', 'SUITE', 'LOT', 'BLDG', 'TRLR', 'RM', 'FL', 'BOX']);
const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// "JAMES" -> "James", "MARY-ANN" -> "Mary-Ann", "O'NEIL" -> "O'Neil", "MCDONALD" -> "McDonald".
export function titleCaseWord(word) {
  const lower = String(word || '').toLowerCase();
  let out = lower.replace(/(^|[-'\u2019])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
  out = out.replace(/^Mc([a-z])/, (_m, ch) => `Mc${ch.toUpperCase()}`);
  return out;
}

const titleCase = (text) => clean(text).split(' ').map(titleCaseWord).join(' ');

function tokens(text) {
  return clean(text).replace(/[.]/g, ' ').split(' ').map((token) => token.replace(/^[^A-Za-z'\u2019-]+|[^A-Za-z'\u2019-]+$/g, '')).filter(Boolean);
}

// IMPACT shows "LAST, FIRST" (sometimes with a middle name/initial or suffix);
// other sources may give "First Last". Returns title-cased parts.
export function splitPersonName(raw) {
  const text = clean(raw);
  if (!text) return { firstName: '', lastName: '', suffix: '', fullName: '' };
  let first = []; let last = []; let suffix = '';
  const pullSuffix = (list) => list.filter((token) => {
    if (SUFFIXES.has(token.toUpperCase())) { suffix = suffix || token.toUpperCase(); return false; }
    return true;
  });
  if (text.includes(',')) {
    const [lastPart, ...rest] = text.split(',');
    last = pullSuffix(tokens(lastPart));
    first = pullSuffix(tokens(rest.join(' ')));
    if (!first.length && rest.length > 1) first = pullSuffix(tokens(rest.slice(1).join(' ')));
  } else {
    const all = pullSuffix(tokens(text));
    first = all.slice(0, Math.max(1, all.length - 1));
    last = all.length > 1 ? all.slice(-1) : [];
  }
  // Skip a leading single initial ("J ROBERT" goes by Robert); drop middle names/initials.
  const given = first.length > 1 && first[0].replace(/['\u2019-]/g, '').length === 1 ? first[1] : first[0];
  const firstName = given ? titleCaseWord(given) : '';
  const lastName = last.map(titleCaseWord).join(' ');
  const suffixText = suffix ? (suffix === 'JR' || suffix === 'SR' ? `${titleCaseWord(suffix)}.` : suffix) : '';
  const fullName = [firstName, lastName, suffixText].filter(Boolean).join(' ');
  return { firstName, lastName, suffix: suffixText, fullName };
}

// "123 N MAIN ST APT 4B SPRINGFIELD, IL 62704" -> street/city/state/zip.
// City is only split off when it can be told apart from the street.
export function parseAddress(raw) {
  const text = clean(raw).replace(/\s*,\s*/g, ', ');
  const empty = { street: '', city: '', state: '', zip: '', full: '' };
  if (!text) return empty;
  const tail = text.match(/^(.*?)[,\s]+([A-Za-z]{2})\.?,?\s+(\d{5})(?:-\d{4})?\s*$/);
  if (!tail) return { ...empty, full: formatStreet(text) };
  const [, before, stateRaw, zip] = tail;
  const state = stateRaw.toUpperCase();
  let street = ''; let city = '';
  const parts = before.split(',').map(clean).filter(Boolean);
  if (parts.length >= 2) {
    city = parts.pop();
    street = parts.join(', ');
  } else {
    const words = clean(before).split(' ');
    let cut = -1;
    words.forEach((word, index) => {
      const upper = word.toUpperCase().replace(/[.]/g, '');
      if (index > 0 && STREET_WORDS.has(upper)) cut = index;
      if (DIRECTIONS.has(upper) && cut === index - 1 && index > 1) cut = index;
      if (index > 0 && UNIT_WORDS.has(upper) && words[index + 1]) cut = index + 1;
      if (/^#\w+$/.test(word)) cut = index;
    });
    if (cut > 0 && cut < words.length - 1) {
      street = words.slice(0, cut + 1).join(' ');
      city = words.slice(cut + 1).join(' ');
    } else {
      street = clean(before);
    }
  }
  street = formatStreet(street);
  city = titleCase(city);
  const full = city ? `${street}, ${city}, ${state} ${zip}` : `${street}, ${state} ${zip}`;
  return { street, city, state, zip, full };
}

function formatStreet(text) {
  return clean(text).split(' ').map((word) => {
    const upper = word.toUpperCase().replace(/[.,]/g, '');
    if (DIRECTIONS.has(upper) || ['PO', 'RR', 'HC'].includes(upper)) return word.toUpperCase();
    if (/^\d+(ST|ND|RD|TH)$/i.test(word)) return word.toLowerCase();
    if (/\d/.test(word)) return word.toUpperCase();
    return titleCaseWord(word);
  }).join(' ');
}

// "03/04/1985", "1985-03-04", "3-4-85" -> "March 4, 1985". '' when not a date.
export function formatDob(raw) {
  const text = clean(raw);
  let year; let month; let day;
  let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (match) { [, month, day, year] = match.map(Number); if (year < 100) year += year > (new Date().getFullYear() % 100) ? 1900 : 2000; }
  match = match || text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match && !year) { [, year, month, day] = match.map(Number); }
  if (!year) {
    const named = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    const index = named ? MONTHS.findIndex((name) => name.toLowerCase().startsWith(named[1].toLowerCase().slice(0, 3))) : -1;
    if (index >= 0) { month = index + 1; day = Number(named[2]); year = Number(named[3]); }
  }
  if (!year || month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return '';
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function displayPerson(raw) {
  const { fullName } = splitPersonName(raw);
  return fullName;
}

// First name of the signed-in rep from their account profile ('' if none).
export function agentFirstName(user) {
  const meta = user?.user_metadata || {};
  for (const value of [meta.first_name, meta.given_name, meta.full_name, meta.name, meta.display_name]) {
    if (typeof value !== 'string') continue;
    const first = value.trim().split(/\s+/)[0] || '';
    if (first && !first.includes('@') && first.length <= 30) return titleCaseWord(first);
  }
  return '';
}

// What to say for a group: "IUOE 148 (SGK2Q) (AD&D)" -> "IUOE 148". The
// bracketed plan codes at the end are for IMPACT, not for the member.
export function speakableGroup(raw) {
  const text = clean(raw);
  const spoken = text.replace(/(?:\s*\([^()]*\))+\s*$/, '').replace(/[\s,;:\-\u2013\u2014]+$/, '').trim();
  return (spoken || text).slice(0, 80);
}

// lead: the payload IMPACT's content script publishes (leadName, address,
// email, phones, requestType, ...). details: optional extra labelled values
// read from the same lead panel (dob, group, beneficiary, spouse, kits).
// Every value is '' when IMPACT does not have it, so the script keeps its
// placeholder.
export function scriptFieldsFromLead(lead, details = {}, user = null) {
  if (!lead?.available) return null;
  const name = splitPersonName(lead.leadName);
  const address = parseAddress(lead.address);
  const phone = (lead.phones || []).find((entry) => entry?.label === 'Mobile') || (lead.phones || [])[0];
  const kits = clean(details.kits).match(/^\d{1,2}$/)?.[0] || '';
  return {
    firstName: name.firstName,
    lastName: name.lastName,
    fullName: name.fullName,
    address: address.full,
    street: address.street,
    city: address.city,
    state: address.state,
    zip: address.zip,
    email: clean(lead.email).toLowerCase(),
    phone: clean(phone?.number),
    requestType: clean(lead.requestType),
    dob: formatDob(details.dob),
    group: speakableGroup(details.group),
    // Full value for the tooltip on the filled-in group (browser-only).
    groupRaw: clean(details.group).slice(0, 120),
    beneficiary: displayPerson(details.beneficiary),
    spouse: displayPerson(details.spouse),
    kits,
    agent: agentFirstName(user)
  };
}
