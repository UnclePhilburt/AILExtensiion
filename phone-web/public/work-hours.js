// Compatibility API: Companion access is available at every hour.
// Lead-specific quiet-hour warnings are handled separately.
export const CLOSED_MESSAGE = '';
export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
export function callingHoursOpen() { return true; }
