// SpeechRecognition is asked to process only on-device. We intentionally do
// not fall back to a browser/server recognizer: this listener must remain local.
let recognition = null;
let listening = false;

function report(type, details = {}) { chrome.runtime.sendMessage({ type, ...details }); }

function stop() {
  listening = false;
  try { recognition?.stop(); } catch (_error) {}
  recognition = null;
}

async function start() {
  stop();
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) throw new Error('This browser does not support on-device speech recognition.');
  if (typeof Recognition.available !== 'function' || !('processLocally' in Recognition.prototype)) {
    throw new Error('On-device speech recognition is not available in this browser.');
  }
  const availability = await Recognition.available({ langs: ['en-US'], processLocally: true });
  if (availability !== 'available') {
    throw new Error(availability === 'downloadable'
      ? 'Install the English on-device speech pack in your browser, then try again.'
      : 'On-device English speech recognition is not available on this computer.');
  }
  recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.processLocally = true;
  listening = true;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) report('impact/objectionTranscript', { transcript: result[0].transcript });
    }
  };
  recognition.onerror = (event) => {
    if (event.error === 'aborted' || !listening) return;
    report('impact/objectionListenerError', { error: event.error === 'not-allowed' ? 'Microphone permission was not allowed.' : `Listening stopped: ${event.error}.` });
  };
  recognition.onend = () => {
    if (!listening || !recognition) return;
    try { recognition.start(); } catch (_error) { report('impact/objectionListenerError', { error: 'Could not continue local listening.' }); }
  };
  recognition.start();
  report('impact/objectionListenerState', { listening: true });
}

async function installEnglishPack() {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition || typeof Recognition.available !== 'function' || typeof Recognition.install !== 'function') {
    throw new Error('This browser cannot install an on-device English speech pack.');
  }
  const availability = await Recognition.available({ langs: ['en-US'], processLocally: true });
  if (availability === 'available') return { installed: true, message: 'The local English speech pack is ready.' };
  if (availability !== 'downloadable') throw new Error('The local English speech pack is not available in this browser.');
  const installed = await Recognition.install({ langs: ['en-US'], processLocally: true });
  if (!installed) throw new Error('The English speech pack could not be installed.');
  return { installed: true, message: 'English voice pack installed. Turn listening on.' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'impact/offscreenSetObjectionListening') {
    (message.enabled ? start() : Promise.resolve(stop()))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => { stop(); report('impact/objectionListenerError', { error: error.message }); sendResponse({ ok: false, error: error.message }); });
    return true;
  }
  if (message?.type === 'impact/installEnglishSpeechPack') {
    installEnglishPack().then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

// Storage is a second stop channel. It makes the listener stop even if the
// runtime message is delayed while this hidden page is being restarted.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['impact.objectionListening']?.newValue === false) stop();
});
