import { client } from './auth-runtime.js';
function check(error) {
  if (!error) return;
  if (['42P01','PGRST202','PGRST205','42883'].includes(error.code)) throw new Error('Text tracking needs database setup. Ask your administrator to apply migration 022. Your draft is saved on this phone.');
  throw new Error(error.message || 'Text tracking could not sync. Try again.');
}
function fromRow(row) {
  return { id:row.id, leadId:row.lead_id, name:row.lead_name, number:row.phone, body:row.body, variant:row.variant, experiment:row.experiment, requestType:row.request_type, slot:row.slot, sentAt:Date.parse(row.sent_at), localHour:row.local_hour, timeZone:row.time_zone, replied:row.replied, appointment:row.appointment, cloudSaved:true };
}
export const textTracking = {
  async save(record, expectedUser) {
    const { data:auth, error:authError } = await client.auth.getUser(); check(authError);
    if (!auth?.user) throw new Error('Sign in before saving text activity.');
    if (expectedUser && auth.user.id !== expectedUser) throw new Error('Your account changed. Sign back in before syncing this text.');
    const row = { user_id:auth.user.id, id:record.id, lead_id:record.leadId, lead_name:record.name, phone:String(record.number).replace(/[^\d+]/g,''), body:record.body, variant:record.variant, experiment:record.experiment, request_type:record.requestType || '', slot:record.slot, sent_at:new Date(record.sentAt).toISOString(), local_hour:record.localHour ?? new Date(record.sentAt).getHours(), time_zone:record.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
    // A stable draft ID makes reconnect/retry safe without changing the original text.
    const { error } = await client.from('text_messages').upsert(row,{onConflict:'user_id,id',ignoreDuplicates:true}); check(error);
  },
  async list() {
    const { data,error } = await client.from('text_messages').select('*').order('sent_at',{ascending:false}).limit(5000); check(error);
    return (data || []).map(fromRow);
  },
  async outcome(id, replied, appointment) {
    const patch = { reviewed_at:new Date().toISOString() };
    if (typeof replied === 'boolean') patch.replied = replied;
    if (typeof appointment === 'boolean') patch.appointment = appointment;
    const { error } = await client.from('text_messages').update(patch).eq('id',id); check(error);
  },
  async checkin() {
    const {data,error} = await client.rpc('companion_text_checkin'); check(error);
    return data?.[0] ? fromRow(data[0]) : null;
  }
};
