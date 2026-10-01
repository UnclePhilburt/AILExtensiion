export function reviewRows(rows, query = '', status = 'all') {
  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  return rows.filter(row => (!needle || [row.name,row.number,row.body].some(value => String(value || '').toLowerCase().includes(needle)) || (digits && String(row.number).replace(/\D/g,'').includes(digits))) && (status === 'all' || status === 'unreviewed' && row.replied == null || status === 'replied' && row.replied === true || status === 'no-reply' && row.replied === false));
}
export function unreviewedTexts(rows) { return rows.filter(row => row.replied == null && !row.appointment); }
