import {createCloudClient} from './cloud.js?v=11';
import {cloudDefaults, groupId, testMode, browserStateKey} from './cloud-config.js?v=10';

document.getElementById('test-banner').hidden = !testMode;
if (testMode) document.title = 'TEST · Bonus registration';
const query = new URLSearchParams(location.search);
const harnessRun = query.get('loadtest');
const harnessClient = query.get('client');
const harness = testMode && window.parent !== window && /^[a-f0-9-]{36}$/i.test(harnessRun || '') && /^[a-zA-Z0-9_-]{1,80}$/.test(harnessClient || '');
const params = new URLSearchParams(location.hash.slice(1));
{
  const form = document.getElementById('join-form');
  const input = document.getElementById('sid');
  const button = document.getElementById('join-button');
  const retry = document.getElementById('retry-button');
  const status = document.getElementById('status');
  // Registration links cannot select a different Apps Script deployment.
  const endpoint = cloudDefaults.student;
  const room = params.get('room');
  let client = null;
  let busy = false;
  let closed = false;
  let accepted = null;
  let attempt = null;
  let suspended = false;
  let run = 0;
  let retryWait = null;
  let reconnect = false;
  // The server queues signups for up to 20 s, so busy replies should be rare.
  const maxAttempts = 4;
  const transientMessages = new Set([
    'The cloud service is busy. Retry the same request.',
    'Registration service unavailable. Retry or check with the instructor.'
  ]);
  const storageKey = browserStateKey(`ierg2060-cloud-join:${endpoint}:${room}${harness ? `:${harnessRun}:${harnessClient}` : ''}`);
  function report(event, detail={}) {
    if (harness) window.parent.postMessage({type:'ierg2060-loadtest',runId:harnessRun,clientId:harnessClient,event,...detail},location.origin);
  }
  const show = (message, state = '') => { status.textContent = message; status.dataset.state = state; };
  const parseNo = value => /^\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const parseSid = value => /^\d{8,12}$/.test(String(value).trim()) ? String(value).trim() : null;
  const maskSid = sid => '•'.repeat(Math.max(0, sid.length - 3)) + sid.slice(-3);
  const receipt = value => value && parseNo(value.no) !== null && typeof value.name === 'string' && value.name.length <= 200 ? {no: parseNo(value.no), name: value.name} : null;
  const acceptedText = () => `You’re signed up: No. ${accepted.no}${accepted.name ? ` · ${accepted.name}` : ''}. If this is not you, tell your instructor. You can close this page.`;
  // Load-test frames know their fictional roster No.; real students do not.
  let harnessNo = null;
  function remember(value) { try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* The server registration remains saved. */ } }
  function forgetAttempt() { try { localStorage.removeItem(storageKey); } catch { /* Registration can still be retried. */ } }
  function controls() {
    input.disabled = busy || suspended || closed || accepted !== null || !!attempt;
    button.disabled = busy || suspended || closed || accepted !== null;
    button.textContent = accepted !== null ? `No. ${accepted.no} signed up` : busy ? 'Confirming…' : attempt ? 'Retry sign-up' : 'Volunteer';
    retry.disabled = busy || suspended;
    retry.textContent = attempt ? 'Retry sign-up' : 'Retry connection';
  }
  function connect() {
    client?.destroy();
    client = null;
    client = createCloudClient(endpoint, {testMode, group: groupId});
    if (harness) client.ready().then(() => {
      if (!suspended) report('ready', {phase:'bridge'});
    }).catch(error => {if (!suspended) report('error', {pending:!!attempt,message:error.message});});
    reconnect = false;
  }
  function cancelWait() {
    if (!retryWait) return;
    clearTimeout(retryWait.timer);
    retryWait.resolve(false);
    retryWait = null;
  }
  function waitToRetry(number) {
    // Spread retries across the class instead of sending another burst together.
    const delay = 700 * 2 ** number + Math.floor(Math.random() * 1000);
    return new Promise(resolve => {
      const timer = setTimeout(() => { retryWait = null; resolve(true); }, delay);
      retryWait = {timer, resolve};
    });
  }
  function restoredStatus() {
    retry.hidden = !attempt;
    if (accepted !== null) show(acceptedText(), 'success');
    else if (attempt) show(`No confirmation yet for SID ${maskSid(attempt.sid)}. Retry to confirm the same sign-up.`, 'error');
    else if (!closed) show('Enter your SID to volunteer.');
    controls();
  }
  async function join() {
    if (busy || suspended || closed || accepted !== null) return;
    const sid = attempt?.sid ?? parseSid(input.value);
    if (sid === null) { show('Enter your full SID using digits only.', 'error'); input.focus(); return; }
    if (!attempt) attempt = {sid, requestId: crypto.randomUUID()};
    const requestId = attempt.requestId;
    const no = harnessNo;
    const startedAt = performance.now();
    remember({pending: attempt});
    input.value = sid;
    busy = true;
    retry.hidden = true;
    show(`Confirming sign-up for SID ${maskSid(sid)}…`);
    controls();
    const currentRun = ++run;
    const isCurrent = () => currentRun === run && !suspended;
    // Keep this exact payload through automatic retries and uncertain responses.
    const payload = {room, ...attempt};
    try {
      for (let number = 0; number < maxAttempts && isCurrent(); number++) {
        const rpcStartedAt = performance.now();
        try {
          if (!client || reconnect) connect();
          const result = await client.call('bonusJoin', payload, {onDispatch:() => report('dispatch', {no,requestId,attemptNumber:number+1,dispatchAtMs:performance.timeOrigin+performance.now()})});
          if (!isCurrent()) return;
          if (result?.status !== 'joined' || !receipt(result)) {
            const error = new Error('The service did not confirm this sign-up.');
            error.invalidResult = true;
            throw error;
          }
          report('attempt', {no,requestId,attemptNumber:number+1,rpcMs:performance.now()-rpcStartedAt,success:true,serverBusy:false});
          accepted = receipt(result);
          attempt = null;
          remember({confirmed: accepted});
          show(acceptedText(), 'success');
          report('confirmed', {no:accepted.no,requestId,totalMs:performance.now()-startedAt,pending:false});
          return;
        } catch (error) {
          if (!isCurrent()) return;
          // Apps Script may prefix its server exception text with 'Error:'.
          const serverMessage = String(error.message || '').replace(/^(?:Error:\s*)+/, '').trim();
          const knownTransient = transientMessages.has(serverMessage);
          report('attempt', {no,requestId,attemptNumber:number+1,rpcMs:performance.now()-rpcStartedAt,success:false,serverBusy:error.serverConfirmed && knownTransient,message:error.message});
          const transient = !error.invalidResult && (!error.serverConfirmed || knownTransient);
          reconnect = !error.serverConfirmed;
          if (transient && number + 1 < maxAttempts) {
            show(`No confirmation yet. Retrying the same sign-up (${number + 2}/${maxAttempts})…`);
            if (!await waitToRetry(number) || !isCurrent()) return;
            continue;
          }
          if (error.serverConfirmed && !transient) {
            attempt = null;
            forgetAttempt();
            closed = /closed|expired/i.test(error.message);
            show(error.message, 'error');
          } else {
            show(`No confirmation yet. Retry the same sign-up. ${error.message}`, 'error');
          }
          retry.hidden = !attempt;
          report('error', {no,requestId,totalMs:performance.now()-startedAt,pending:!!attempt,message:status.textContent});
          return;
        }
      }
    } finally {
      if (isCurrent()) { busy = false; controls(); }
    }
  }
  if (harness) window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || event.origin !== location.origin || !data || data.type !== 'ierg2060-loadtest-submit' || data.runId !== harnessRun || data.clientId !== harnessClient) return;
    const no = parseNo(data.no);
    if (no === null || no > 35) return;
    // Fictional test SIDs 1155000001-1155000035 map to Test Student 01-35.
    const sid = '1155' + String(no).padStart(6, '0');
    if (accepted !== null) {report('confirmed', {no:accepted.no,totalMs:0,pending:false,restored:true});return;}
    if (busy || suspended || closed || (attempt && attempt.sid !== sid)) {report('error', {no,pending:!!attempt,message:'This student page already has a different or active registration.'});return;}
    harnessNo = no;
    input.value = sid;
    void join();
  });
  form.addEventListener('submit', event => { event.preventDefault(); join(); });
  retry.addEventListener('click', () => {
    if (attempt) join();
  });
  try {
    if (!endpoint || !room || !/^[a-zA-Z0-9_-]{16,100}$/.test(room)) throw new Error('This registration link is incomplete. Scan the QR code shown by your instructor.');
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (receipt(stored?.confirmed)) accepted = receipt(stored.confirmed);
      else if (parseSid(stored?.pending?.sid) !== null && typeof stored.pending.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(stored.pending.requestId)) attempt = {sid: parseSid(stored.pending.sid), requestId: stored.pending.requestId};
      if (attempt) input.value = attempt.sid;
    } catch { /* A local receipt is optional; the server deduplicates repeated sign-ups. */ }
    // Warm the bridge while students type. bonusJoin performs round validation.
    if (accepted === null) connect();
    restoredStatus();
    report('ready', {phase:'page'});
    window.addEventListener('pagehide', () => {
      suspended = true;
      run++;
      cancelWait();
      client?.destroy();
      client = null;
      busy = false;
    });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      suspended = false;
      restoredStatus();
      // The next submission creates a fresh bridge and keeps the saved request.
    });
  } catch (error) {
    closed = true;
    show(error.message, 'error');
    controls();
    report('error', {pending:!!attempt,message:error.message});
  }
}
