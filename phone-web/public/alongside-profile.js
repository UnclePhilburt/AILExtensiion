import { client } from './auth-runtime.js';
import { loadPhoneSettings } from './settings-store.js';

// Saves the first name and the Alongside switch. A missing database function
// just means the shared page is not set up yet; the name still lives on this phone.
export async function publishAlongsideProfile() {
  const settings = loadPhoneSettings(localStorage);
  const { error } = await client.rpc('alongside_set_profile', { p_name: settings.firstName, p_share: settings.shareAlongside !== false });
  if (error && !/function|schema|PGRST202|could not find|404/i.test(`${error.code || ''} ${error.message || ''}`)) return error;
  return null;
}
