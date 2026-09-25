// Saves appointments and callbacks to the calendar (Supabase scheduled_events,
// via companion_save_schedule). Used by the Workspace in Cloud mode only.
// Never throws: if the calendar migration hasn't been run yet, or the network
// fails, the Workspace keeps working exactly as before.
import { client } from './auth-runtime.js';
import { leadSnapshot, scheduleFromHistory, appointmentChoiceEvent } from './calendar-events.js';

// Missing table/function: the database setup (009_scheduled_events.sql) isn't done.
export const NOT_SET_UP_CODES = ['42P01', '42883', 'PGRST202', 'PGRST205'];
let notSetUp = false;
const lastSaved = new Map();

async function save(lead, events, replace) {
  if (notSetUp) return false;
  const snapshot = leadSnapshot(lead);
  if (!snapshot.leadKey || !events.length) return false;
  const { error } = await client.rpc('companion_save_schedule', { p_lead: snapshot, p_events: events, p_replace: replace });
  if (!error) return true;
  if (NOT_SET_UP_CODES.includes(error.code)) notSetUp = true;
  console.info('Calendar entry not saved:', error.message || error.code);
  return false;
}

// Called for every lead the Workspace receives; only sends when the lead's
// scheduled appointment/callback changed since the last save.
export async function saveLeadSchedule(lead) {
  try {
    if (!lead?.available || !Array.isArray(lead.callHistory)) return false;
    const events = scheduleFromHistory(lead.callHistory);
    if (!events.length) return false; // nothing scheduled: leave saved entries alone
    const snapshot = leadSnapshot(lead);
    const fingerprint = JSON.stringify([snapshot, events]);
    if (lastSaved.get(snapshot.leadKey) === fingerprint) return false;
    lastSaved.set(snapshot.leadKey, fingerprint);
    const saved = await save(lead, events, true);
    if (!saved && !notSetUp) lastSaved.delete(snapshot.leadKey); // retry on the next update
    return saved;
  } catch (error) {
    console.info('Calendar entry not saved:', error?.message || error);
    return false;
  }
}

// Called after the phone successfully sends a Set Virtual Appointment time.
export async function saveAppointmentChoice(lead, dayLabel, time) {
  try {
    const event = appointmentChoiceEvent(dayLabel, time, Date.now());
    return event ? await save(lead, [event], false) : false;
  } catch (error) {
    console.info('Calendar entry not saved:', error?.message || error);
    return false;
  }
}
