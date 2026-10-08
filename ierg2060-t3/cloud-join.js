import {createCloudClient} from './cloud.js?v=7';
import {cloudDefaults} from './cloud-config.js?v=7';

const params = new URLSearchParams(location.hash.slice(1));
if (params.has('round') && !params.has('cloud')) {
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
  let ready = false;
  let closed = false;
  let acceptedNo = null;
  let attempt = null;
  const storageKey = `ierg2060-cloud-join:${endpoint}:${room}`;
  const show = (message, state = '') => { status.textContent = message; status.dataset.state = state; };
  const parseNo = value => /^\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  function remember(value) { try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* The server registration remains saved. */ } }
  function forgetAttempt() { try { localStorage.removeItem(storageKey); } catch { /* Registration can still be retried. */ } }
  function controls() {
    input.disabled = busy || !ready || closed || acceptedNo !== null || !!attempt;
    button.disabled = busy || !ready || (closed && !attempt) || acceptedNo !== null;
    button.textContent = acceptedNo !== null ? `No. ${acceptedNo} registered` : busy ? 'Confirming registration…' : attempt ? `Retry No. ${attempt.no}` : 'Join the bonus draw';
    retry.disabled = busy;
    retry.textContent = attempt ? `Retry No. ${attempt.no}` : 'Retry connection';
  }
  async function info() {
    if (busy) return;
    busy = true;
    retry.hidden = true;
    controls();
    show(acceptedNo !== null ? `Your registration as No. ${acceptedNo} was confirmed. Checking this round…` : 'Checking registration…');
    try {
      const result = await client.call('bonusInfo', {room});
      ready = true;
      closed = !result.open;
      if (acceptedNo !== null) show(closed ? `Registration has closed. Your confirmed entry as No. ${acceptedNo} stays in this round.` : `You’re registered as No. ${acceptedNo}. You can now close this page.`, 'success');
      else if (closed && !attempt) show('This round is closed. Scan the latest QR code shown by your instructor.', 'error');
      else if (attempt) show(`No confirmation yet for No. ${attempt.no}. Retry to confirm the same registration.`, 'error');
      else show('Enter your roster No. to register.');
    } catch (error) {
      show(acceptedNo !== null ? `No. ${acceptedNo} was confirmed. Could not update the round status: ${error.message}` : `Could not check registration: ${error.message}`, acceptedNo !== null ? 'success' : 'error');
      retry.hidden = acceptedNo !== null;
    } finally { busy = false; controls(); }
  }
  async function join() {
    if (busy || !ready || (closed && !attempt) || acceptedNo !== null) return;
    const no = attempt?.no ?? parseNo(input.value);
    if (no === null) { show('Enter your full roster No. using digits only.', 'error'); input.focus(); return; }
    if (!attempt) attempt = {no, requestId: crypto.randomUUID()};
    remember({pending: attempt});
    input.value = String(no);
    busy = true;
    retry.hidden = true;
    show(`Confirming registration for No. ${no}…`);
    controls();
    try {
      const result = await client.call('bonusJoin', {room, ...attempt});
      if (result.status !== 'joined' || result.no !== no) throw new Error('The service did not confirm this roster No.');
      acceptedNo = result.no;
      attempt = null;
      remember({confirmed: acceptedNo});
      show(`You’re registered as No. ${acceptedNo}. You can now close this page.`, 'success');
    } catch (error) {
      if (error.serverConfirmed) { attempt = null; forgetAttempt(); }
      show(error.serverConfirmed ? error.message : `No confirmation yet for No. ${no}. Retry the same registration. ${error.message}`, 'error');
      retry.hidden = false;
    } finally { busy = false; controls(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); join(); });
  retry.addEventListener('click', () => {
    if (!ready && !busy) { client.destroy(); client = createCloudClient(endpoint); }
    if (attempt && ready) join(); else info();
  });
  try {
    if (!endpoint || !room || !/^[a-zA-Z0-9_-]{16,100}$/.test(room)) throw new Error('This registration link is incomplete. Scan the QR code shown by your instructor.');
    client = createCloudClient(endpoint);
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (parseNo(stored?.confirmed) !== null) acceptedNo = parseNo(stored.confirmed);
      else if (parseNo(stored?.pending?.no) !== null && typeof stored.pending.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(stored.pending.requestId)) attempt = stored.pending;
      if (acceptedNo !== null || attempt) input.value = String(acceptedNo ?? attempt.no);
    } catch { /* A local receipt is optional; the server deduplicates repeated numbers. */ }
    info();
    window.addEventListener('pagehide', () => client.destroy());
    window.addEventListener('pageshow', event => { if (event.persisted) { client = createCloudClient(endpoint); info(); } });
  } catch (error) {
    closed = true;
    show(error.message, 'error');
    controls();
  }
}
