import {createCloudClient} from './cloud.js?v=10';
import {cloudDefaults, testMode, browserStateKey} from './cloud-config.js?v=8';

document.getElementById('test-banner').hidden = !testMode;
if (testMode) document.title = 'TEST · Bonus registration';
const query = new URLSearchParams(location.search);
const harnessRun = query.get('loadtest');
const harnessClient = query.get('client');
const harness = testMode && window.parent !== window && /^[a-f0-9-]{36}$/i.test(harnessRun || '') && /^[a-zA-Z0-9_-]{1,80}$/.test(harnessClient || '');
const params = new URLSearchParams(location.hash.slice(1));
if (!testMode && params.has('round') && !params.has('cloud')) {
  // Existing PeerJS links still use the original registration flow.
  await import('./join.js?v=2');
} else {
  const form = document.getElementById('join-form');
  const input = document.getElementById('roster-no');
  const button = document.getElementById('join-button');
  const retry = document.getElementById('retry-button');
  const status = document.getElementById('status');
  // Registration links cannot select a different Apps Script deployment.
  const endpoint = cloudDefaults.student;
  const room = params.get('room');
  let client = null;
  let busy = false;
  let closed = false;
  let acceptedNo = null;
  let attempt = null;
  let suspended = false;
  let run = 0;
  let retryWait = null;
  let reconnect = false;
  const maxAttempts = 3;
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
  function remember(value) { try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* The server registration remains saved. */ } }
  function forgetAttempt() { try { localStorage.removeItem(storageKey); } catch { /* Registration can still be retried. */ } }
  function controls() {
    input.disabled = busy || suspended || closed || acceptedNo !== null || !!attempt;
    button.disabled = busy || suspended || closed || acceptedNo !== null;
    button.textContent = acceptedNo !== null ? `No. ${acceptedNo} registered` : busy ? 'Confirming registration…' : attempt ? `Retry No. ${attempt.no}` : 'Join the bonus draw';
    retry.disabled = busy || suspended;
    retry.textContent = attempt ? `Retry No. ${attempt.no}` : 'Retry connection';
  }
  function connect() {
    client?.destroy();
    client = null;
    client = createCloudClient(endpoint, {testMode});
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
    if (acceptedNo !== null) show(`You’re registered as No. ${acceptedNo}. You can now close this page.`, 'success');
    else if (attempt) show(`No confirmation yet for No. ${attempt.no}. Retry to confirm the same registration.`, 'error');
    else if (!closed) show('Enter your roster No. to register.');
    controls();
  }
  async function join() {
    if (busy || suspended || closed || acceptedNo !== null) return;
    const no = attempt?.no ?? parseNo(input.value);
    if (no === null) { show('Enter your full roster No. using digits only.', 'error'); input.focus(); return; }
    if (!attempt) attempt = {no, requestId: crypto.randomUUID()};
    const requestId = attempt.requestId;
    const startedAt = performance.now();
    remember({pending: attempt});
    input.value = String(no);
    busy = true;
    retry.hidden = true;
    show(`Confirming registration for No. ${no}…`);
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
          if (result?.status !== 'joined' || result.no !== no) {
            const error = new Error('The service did not confirm this roster No.');
            error.invalidResult = true;
            throw error;
          }
          report('attempt', {no,requestId,attemptNumber:number+1,rpcMs:performance.now()-rpcStartedAt,success:true,serverBusy:false});
          acceptedNo = result.no;
          attempt = null;
          remember({confirmed: acceptedNo});
          show(`You’re registered as No. ${acceptedNo}. You can now close this page.`, 'success');
          report('confirmed', {no,requestId,totalMs:performance.now()-startedAt,pending:false});
          return;
        } catch (error) {
          if (!isCurrent()) return;
          report('attempt', {no,requestId,attemptNumber:number+1,rpcMs:performance.now()-rpcStartedAt,success:false,serverBusy:error.serverConfirmed && transientMessages.has(error.message),message:error.message});
          const transient = !error.invalidResult && (!error.serverConfirmed || transientMessages.has(error.message));
          reconnect = !error.serverConfirmed;
          if (transient && number + 1 < maxAttempts) {
            show(`No confirmation yet for No. ${no}. Retrying the same registration (${number + 2}/${maxAttempts})…`);
            if (!await waitToRetry(number) || !isCurrent()) return;
            continue;
          }
          if (error.serverConfirmed && !transient) {
            attempt = null;
            forgetAttempt();
            closed = /closed|expired/i.test(error.message);
            show(error.message, 'error');
          } else {
            show(`No confirmation yet for No. ${no}. Retry the same registration. ${error.message}`, 'error');
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
    if (acceptedNo !== null) {report('confirmed', {no:acceptedNo,totalMs:0,pending:false,restored:true});return;}
    if (busy || suspended || closed || (attempt && attempt.no !== no)) {report('error', {no,pending:!!attempt,message:'This student page already has a different or active registration.'});return;}
    input.value = String(no);
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
      if (parseNo(stored?.confirmed) !== null) acceptedNo = parseNo(stored.confirmed);
      else if (parseNo(stored?.pending?.no) !== null && typeof stored.pending.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(stored.pending.requestId)) attempt = {no: parseNo(stored.pending.no), requestId: stored.pending.requestId};
      if (acceptedNo !== null || attempt) input.value = String(acceptedNo ?? attempt.no);
    } catch { /* A local receipt is optional; the server deduplicates repeated numbers. */ }
    // Warm the bridge while students type. bonusJoin performs round validation.
    if (acceptedNo === null) connect();
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
