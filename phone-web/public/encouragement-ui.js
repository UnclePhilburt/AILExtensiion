// Puts encouragement lines on the page. Any element with data-encourage="<page>"
// gets a line on load (data-rotate="<ms>" rotates it while the page is visible).
// The Workspace also calls encourageLead() when the lead changes and
// encourageResult() after a result is sent. All of it respects the Settings
// switches "Show encouraging messages" and "Messages after results".
//
// Lines never move the layout while the user is tapping: the line boxes reserve
// two lines of height in CSS, and the after-result message is a fixed toast that
// ignores taps.

import { eventCategory, nextLine } from './encouragement.js';
import { loadPhoneSettings } from './settings-store.js';

const TOAST_MS = 4800;
const mounted = [];
let workspaceKey = null;
let toastTimer = null;

function settings() {
  return loadPhoneSettings(globalThis.localStorage);
}

function reducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function fadeIn(element) {
  if (reducedMotion()) return;
  element.classList.remove('encFade');
  void element.offsetWidth; // restart the animation
  element.classList.add('encFade');
}

function showLine(element, context) {
  if (!settings().showEncouragement) {
    element.hidden = true;
    element.textContent = '';
    return;
  }
  const line = nextLine(globalThis.localStorage, context);
  element.textContent = line.text;
  element.dataset.category = line.category;
  element.hidden = false;
  fadeIn(element);
}

function contextFor(element) {
  return { page: element.dataset.encourage, waiting: element.dataset.waiting === 'true', now: Date.now() };
}

export function mountEncouragement(root = document) {
  for (const element of root.querySelectorAll('[data-encourage]')) {
    if (mounted.includes(element)) continue;
    mounted.push(element);
    if (element.dataset.encourage === 'workspace') workspaceKey = element.dataset.waiting === 'true' ? '' : null;
    showLine(element, contextFor(element));
    const every = Number(element.dataset.rotate);
    if (every >= 5000) {
      setInterval(() => {
        if (!document.hidden && settings().showEncouragement) showLine(element, contextFor(element));
      }, every);
    }
  }
}

// After a settings change: show or hide the lines right away.
export function refreshEncouragement() {
  for (const element of mounted) showLine(element, contextFor(element));
  if (!settings().showEncouragement) hideToast();
}

// Workspace: a new line when the lead changes (or the page starts waiting).
export function encourageLead(leadKey) {
  const element = mounted.find((item) => item.dataset.encourage === 'workspace');
  const key = leadKey ? String(leadKey) : '';
  if (!element || key === workspaceKey) return;
  workspaceKey = key;
  element.dataset.waiting = key ? 'false' : 'true';
  showLine(element, contextFor(element));
}

function toastElement() {
  let toast = document.querySelector('.encToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'encToast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  return toast;
}

function hideToast() {
  const toast = document.querySelector('.encToast');
  if (toast) toast.classList.remove('show');
}

// Workspace: a short, gentle message after a result is sent.
export function encourageResult(type) {
  const current = settings();
  const category = eventCategory(type);
  if (!category || !current.showEncouragement || !current.encourageAfterResults) return null;
  const line = nextLine(globalThis.localStorage, { event: type, now: Date.now() });
  const toast = toastElement();
  toast.textContent = line.text;
  toast.dataset.category = line.category;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
  return line;
}

// Another tab changed the settings.
globalThis.addEventListener?.('storage', (event) => {
  if (event.key === null || event.key === 'impact.phoneSettings') refreshEncouragement();
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountEncouragement());
else mountEncouragement();
