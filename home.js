import { client } from './auth-runtime.js';
const signedIn = document.querySelector('#signedIn'); const signedOut = document.querySelector('#signedOut'); const account = document.querySelector('#accountName'); const message = document.querySelector('#homeStatus');
client.auth.onAuthStateChange((_event, session) => render(session));
const { data, error } = await client.auth.getSession(); if (error) message.textContent = error.message; render(data.session);
function render(session) { const ready = Boolean(session?.user); signedIn.hidden = !ready; signedOut.hidden = ready; account.textContent = session?.user?.email || ''; message.textContent = ready ? 'Your phone is ready to connect.' : 'Sign in once to use your phone workspace.'; }
