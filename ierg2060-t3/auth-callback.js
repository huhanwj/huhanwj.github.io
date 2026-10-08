const AUTH_ORIGIN = 'https://huhanwj.github.io';
const fragment = location.hash;
// Remove the grant before any asynchronous work or user interaction.
history.replaceState(null, document.title, location.pathname + location.search);

const status = document.querySelector('#sign-in-status');
const retry = document.querySelector('#retry-sign-in');
const close = document.querySelector('#close-sign-in');
const params = new URLSearchParams(fragment.slice(1));
const code = params.get('code');
const state = params.get('state');
const valid = location.origin === AUTH_ORIGIN && fragment.length <= 160 &&
  [...params.keys()].length === 2 && params.getAll('code').length === 1 && params.getAll('state').length === 1 &&
  /^[a-f0-9]{64}$/.test(code || '') &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(state || '');
let channel = null, deliveryTimer = null, waitTimer = null, expiryTimer = null, done = false, deliveries = 0;

function show(message, canRetry = false) {
  status.textContent = message;
  retry.hidden = !canRetry;
  retry.disabled = false;
  close.hidden = false;
}
function cleanup() {
  clearInterval(deliveryTimer);
  clearTimeout(waitTimer);
  clearTimeout(expiryTimer);
  window.removeEventListener('message', receiveWindow);
  if (channel) {channel.onmessage = null; try {channel.close();} catch (_) {} channel = null;}
}
function receive(data) {
  if (done || !data || data.state !== state) return;
  if (data.type === 'ierg-auth-pending') {
    clearInterval(deliveryTimer);
    clearTimeout(waitTimer);
    status.textContent = 'The class page is confirming your sign-in. Keep the original class page open.';
    retry.hidden = true;
  } else if (data.type === 'ierg-auth-retry') {
    clearInterval(deliveryTimer);
    clearTimeout(waitTimer);
    show('Google has not confirmed the connection yet. Retry confirmation to recover the same sign-in.', true);
  } else if (data.type === 'ierg-auth-ack') {
    done = true;
    cleanup();
    show('Google sign-in is complete. Return to the original class page. You can close this window.');
    try {window.close();} catch (_) {}
  } else if (data.type === 'ierg-auth-error' || data.type === 'ierg-auth-cancel') {
    done = true;
    cleanup();
    show('This sign-in has ended. Return to the original class page and start sign-in again.');
  }
}
function receiveWindow(event) {
  if (event.origin !== AUTH_ORIGIN || !window.opener || event.source !== window.opener) return;
  receive(event.data);
}
function send() {
  const message = {type: 'ierg-auth-code', code, state};
  let sent = false;
  try {if (channel) {channel.postMessage(message); sent = true;}} catch (_) {}
  try {if (window.opener) {window.opener.postMessage(message, AUTH_ORIGIN); sent = true;}} catch (_) {}
  if (!sent) {
    show('This browser cannot contact the original class page. Keep it open, allow communication between these tabs, then retry confirmation.', true);
  }
}
function beginDelivery() {
  if (done) return;
  clearInterval(deliveryTimer);
  clearTimeout(waitTimer);
  status.textContent = 'Confirming Google sign-in with the original class page…';
  retry.hidden = true;
  deliveries = 0;
  send();
  // Repeat only the relay until the original tab acknowledges receipt. The
  // original tab deduplicates exchange requests while one is in progress.
  deliveryTimer = setInterval(() => {
    if (++deliveries >= 4) {clearInterval(deliveryTimer); return;}
    send();
  }, 1000);
  waitTimer = setTimeout(() => {
    show('The original class page has not responded. Keep that page open and retry confirmation. If the browser blocks tab communication, start sign-in again from the class page.', true);
  }, 6000);
}

close.addEventListener('click', () => {try {window.close();} catch (_) {}});
if (!valid) {
  done = true;
  show('This sign-in link is invalid or expired. Return to the class page and click Sign in with Google again.');
} else {
  window.addEventListener('message', receiveWindow);
  try {
    channel = new BroadcastChannel('ierg2060-auth-' + state);
    channel.onmessage = event => receive(event.data);
  } catch (_) {}
  retry.addEventListener('click', beginDelivery);
  expiryTimer = setTimeout(() => {
    done = true;
    cleanup();
    show('This sign-in confirmation has expired. Return to the class page and start sign-in again.');
  }, 5 * 60 * 1000);
  window.addEventListener('pagehide', cleanup, {once: true});
  beginDelivery();
}
