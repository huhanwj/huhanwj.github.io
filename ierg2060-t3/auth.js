import {cloudDefaults, testMode as configuredTestMode} from './cloud-config.js?v=8';

const AUTH_ORIGIN = 'https://huhanwj.github.io';
const sessionKey = testMode => testMode === true ? 'ierg2060-test:ierg2060-auth-session' : 'ierg2060-auth-session';
const SECRET = /^[a-f0-9]{64}$/;
const SIGN_IN_TIMEOUT = 5 * 60 * 1000;
let activeSignIn = null;

function sessionValue(value) {
  if (!value || typeof value !== 'object' || typeof value.token !== 'string' || !SECRET.test(value.token) ||
      typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() ||
      typeof value.email !== 'string' || !value.email.trim() || value.email.length > 254) return null;
  return {token: value.token, expiresAt: value.expiresAt, email: value.email};
}

export function clearSession({testMode=configuredTestMode}={}) {
  try {sessionStorage.removeItem(sessionKey(testMode));} catch (_) {}
}

export function readSession({testMode=configuredTestMode}={}) {
  try {
    const session = sessionValue(JSON.parse(sessionStorage.getItem(sessionKey(testMode)) || 'null'));
    if (session) return session;
  } catch (_) {}
  clearSession({testMode});
  return null;
}

function signInUrl(value, state) {
  const url = new URL(value);
  const configured = new URL(cloudDefaults.admin);
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) ||
      url.username || url.password || url.search || url.hash || url.href !== configured.href) {
    throw Error('Use the configured instructor Google sign-in address.');
  }
  url.searchParams.set('login', state);
  return url.href;
}

export function cancelSignIn() {
  activeSignIn?.cancel();
}

// Keep this function synchronous until window.open: callers invoke it directly
// from the Sign in button's click so browsers permit the Google popup.
export function beginSignIn(adminUrl, exchangeFn, {testMode=configuredTestMode}={}) {
  if (activeSignIn) {
    try {activeSignIn.popup?.focus();} catch (_) {}
    return activeSignIn.promise;
  }
  if (location.origin !== AUTH_ORIGIN) throw Error('Open the published course page to sign in with Google.');
  if (typeof exchangeFn !== 'function') throw Error('Google sign-in is unavailable. Reload the course page.');
  const state = crypto.randomUUID();
  const loginUrl = signInUrl(adminUrl, state);
  let channel = null, popup = null, timer = null, finished = false, exchanging = false, acceptedCode = null;
  let resolve, reject;
  const promise = new Promise((ok, fail) => {resolve = ok; reject = fail;});

  function relay(type, source = null) {
    const message = {type, state};
    try {channel?.postMessage(message);} catch (_) {}
    try {(source || popup)?.postMessage(message, AUTH_ORIGIN);} catch (_) {}
  }
  function cleanup() {
    clearTimeout(timer);
    window.removeEventListener('message', receiveWindow);
    if (channel) {channel.onmessage = null; try {channel.close();} catch (_) {} channel = null;}
    if (activeSignIn?.promise === promise) activeSignIn = null;
  }
  function finish(error, session = null) {
    if (finished) return;
    finished = true;
    cleanup();
    if (error) {
      try {popup?.close();} catch (_) {}
      reject(error);
    } else resolve(session);
  }
  function cancel() {
    if (finished) return;
    relay('ierg-auth-cancel');
    const error = Error('Sign-in cancelled. Click Sign in with Google to start again.');
    error.cancelled = true;
    finish(error);
  }
  async function receive(data, source = null) {
    if (finished || !data || data.type !== 'ierg-auth-code' || data.state !== state ||
        typeof data.code !== 'string' || !SECRET.test(data.code)) return;
    // Once a valid grant arrives, only that same grant may be retried.
    if (acceptedCode && acceptedCode !== data.code) return;
    acceptedCode = data.code;
    relay('ierg-auth-pending', source);
    if (exchanging) return;
    exchanging = true;
    try {
      const result = await exchangeFn({code: acceptedCode, state});
      if (finished) return;
      const session = sessionValue(result);
      if (!session) {
        const error = Error('Google returned an invalid sign-in session. Sign in again.');
        error.serverConfirmed = true;
        throw error;
      }
      try {sessionStorage.setItem(sessionKey(testMode), JSON.stringify(session));}
      catch (_) {
        const error = Error('This browser cannot save the sign-in session. Allow session storage and sign in again.');
        error.serverConfirmed = true;
        throw error;
      }
      relay('ierg-auth-ack', source);
      finish(null, session);
    } catch (error) {
      if (finished) return;
      if (error?.serverConfirmed) {
        relay('ierg-auth-error', source);
        finish(error);
      } else {
        // A lost response is not an authentication refusal. The callback's
        // Retry button resends this same grant to recover its server receipt.
        relay('ierg-auth-retry', source);
      }
    } finally {exchanging = false;}
  }
  function receiveWindow(event) {
    if (event.origin !== AUTH_ORIGIN || !popup || event.source !== popup) return;
    void receive(event.data, event.source);
  }

  window.addEventListener('message', receiveWindow);
  try {
    channel = new BroadcastChannel('ierg2060-auth-' + state);
    channel.onmessage = event => {void receive(event.data);};
  } catch (_) {
    // postMessage remains available when BroadcastChannel is disabled.
  }
  activeSignIn = {promise, cancel, popup: null};
  promise.cancel = cancel;
  try {popup = window.open(loginUrl, '_blank', 'popup,width=520,height=720');}
  catch (_) {}
  activeSignIn.popup = popup;
  if (!popup) {
    finish(Error('The browser blocked the Google sign-in popup. Allow popups for this page and try again.'));
  } else {
    timer = setTimeout(() => {
      relay('ierg-auth-cancel');
      finish(Error('Sign-in timed out without confirmation. Click Sign in with Google to try again.'));
    }, SIGN_IN_TIMEOUT);
  }
  return promise;
}
