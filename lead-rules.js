// Time-sensitive instructions that need to stand out before a rep calls.
export function doNotKnockWarning(lead, now = new Date()) {
  const requestType = String(lead?.requestType || '');
  if (now.getHours() < 20 || !/\b(union|association)\b/i.test(requestType)) return null;
  const kind = /\bunion\b/i.test(requestType) ? 'Union member' : 'Association';
  return {
    title: 'DO NOT KNOCK AFTER 8 PM',
    detail: `${kind} lead · Use Next to skip this lead.`
  };
}
