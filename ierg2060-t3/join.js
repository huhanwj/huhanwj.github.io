(() => {
  'use strict';
  const form = document.getElementById('join-form');
  const input = document.getElementById('roster-no');
  const button = document.getElementById('join-button');
  const retry = document.getElementById('retry-button');
  const status = document.getElementById('status');
  const params = new URLSearchParams(location.hash.slice(1));
  const room = params.get('room');
  const round = params.get('round');
  let peer = null;
  let connection = null;
  let pending = false;
  let accepted = false;
  let acceptedNo = null;
  let expired = false;
  let connectTimer = null;
  let submitTimer = null;
  let attempt = 0;
  function show(message, state = '') { status.textContent = message; status.dataset.state = state; }
  function controls() {
    input.disabled = accepted || expired || pending || !connection?.open;
    button.disabled = accepted || expired || pending || !connection?.open;
    button.textContent = accepted ? `No. ${acceptedNo} registered` : pending ? 'Confirming registration…' : 'Join the bonus draw';
  }
  function failed(message) {
    clearTimeout(connectTimer);
    clearTimeout(submitTimer);
    pending = false;
    controls();
    if (accepted || expired) return;
    show(message, 'error');
    retry.hidden = false;
  }
  function connect() {
    const currentAttempt = ++attempt;
    clearTimeout(connectTimer);
    clearTimeout(submitTimer);
    if (peer) peer.destroy();
    connection = null;
    pending = false;
    retry.hidden = true;
    controls();
    show('Connecting to your instructor…');
    if (typeof globalThis.Peer !== 'function') { failed('The connection service could not load. Retry, or ask your instructor to add your No. manually.'); return; }
    let activePeer;
    try { activePeer = new globalThis.Peer(); peer = activePeer; }
    catch { failed('The connection service is unavailable. Ask your instructor to add your No. manually.'); return; }
    const isCurrent = () => currentAttempt === attempt && peer === activePeer;
    connectTimer = setTimeout(() => {
      if (isCurrent() && !connection?.open) failed('Cannot reach the instructor. Check your connection and the latest QR code, or ask to be added manually.');
    }, 15000);
    activePeer.on('open', () => {
      if (!isCurrent()) return;
      const activeConnection = activePeer.connect(room, { reliable: true, serialization: 'json' });
      connection = activeConnection;
      activeConnection.on('open', () => {
        if (!isCurrent()) return;
        clearTimeout(connectTimer);
        retry.hidden = true;
        show('Connected. Enter your roster No. to register.');
        controls();
      });
      activeConnection.on('data', (data) => {
        if (!isCurrent() || !data || typeof data !== 'object') return;
        if (data.type === 'closed' || (data.type === 'ack' && data.status === 'closed')) {
          expired = true;
          pending = false;
          clearTimeout(submitTimer);
          show(accepted ? 'Registration has closed. Your confirmed entry stays in this draw.' : String(data.message || 'This round is closed. Scan the latest QR code.'), accepted ? 'success' : 'error');
          retry.hidden = true;
          controls();
          return;
        }
        if (data.type !== 'ack') return;
        clearTimeout(submitTimer);
        pending = false;
        if (data.status === 'joined' && Number.isSafeInteger(data.no) && data.no > 0) {
          accepted = true;
          acceptedNo = data.no;
          show(`You’re registered as No. ${data.no}. You can now close this page.`, 'success');
          retry.hidden = true;
        } else show(String(data.message || 'Registration could not be accepted. Please check with your instructor.'), 'error');
        controls();
      });
      activeConnection.on('close', () => { if (isCurrent()) failed('The instructor connection closed. Retry or ask to be added manually.'); });
      activeConnection.on('error', () => { if (isCurrent()) failed('Could not connect through this network. Retry or ask to be added manually.'); });
    });
    activePeer.on('error', () => { if (isCurrent()) failed('Could not reach the instructor. Use the latest QR code, retry, or ask to be added manually.'); });
    activePeer.on('disconnected', () => { if (isCurrent() && !connection?.open) failed('Connection service interrupted. Retry or ask to be added manually.'); });
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (accepted || expired || pending || !connection?.open) return;
    const raw = input.value.trim();
    const no = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(no) || no < 1) { show('Enter your full roster No. using digits only.', 'error'); input.focus(); return; }
    pending = true;
    controls();
    show('Waiting for your instructor to confirm…');
    try { connection.send({ type: 'join', round, no }); }
    catch { failed('Your registration could not be sent. Retry or ask to be added manually.'); return; }
    submitTimer = setTimeout(() => {
      pending = false;
      controls();
      show('No confirmation yet. You can submit again; the same No. is counted only once. Or ask your instructor to check.', 'error');
    }, 12000);
  });
  retry.addEventListener('click', connect);
  if (!room || !/^ierg2060-[a-f0-9]{32}$/.test(room) || !round || !/^[a-f0-9]{32}$/.test(round)) {
    expired = true;
    show('This registration link is incomplete. Scan the QR code shown by your instructor.', 'error');
    controls();
  } else connect();
})();
