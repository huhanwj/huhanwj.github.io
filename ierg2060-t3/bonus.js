// Only roster numbers cross the data channel. Names stay on the host.
export function setupBonus({ container, getEligibleNumbers, onWinner, publicBaseUrl }) {
  if (!container || typeof getEligibleNumbers !== 'function') throw new Error('Bonus draw needs a container and eligible-number provider.');
  let peer = null;
  let round = null;
  let open = false;
  let drawn = false;
  let online = false;
  let pendingRecord = null;
  let saving = false;
  const entrants = new Set();
  const connections = new Set();
  const registrationsByPeer = new Map();
  container.innerHTML = `
    <section class="bonus-panel" aria-labelledby="bonus-title">
      <div class="bonus-heading"><div><p class="bonus-kicker">BONUS ROUND</p><h2 id="bonus-title">Volunteer draw</h2></div><span class="bonus-count" aria-live="polite">0 registered</span></div>
      <div class="bonus-actions"><button type="button" data-action="open">Open registration</button><button type="button" data-action="close" disabled>Close registration</button><button type="button" data-action="draw" disabled>Draw a volunteer</button></div>
      <p class="bonus-status" role="status" aria-live="polite">Registration is closed.</p>
      <div class="bonus-share" hidden><div class="bonus-qr" aria-label="Student registration QR code"></div><div><strong>Scan to join</strong><p>Keep this page open while students register.</p><a class="bonus-link" target="_blank" rel="noopener">Open registration page</a><button type="button" data-action="copy">Copy link</button></div></div>
      <details class="bonus-advanced"><summary>Manual entry and connection help</summary><p class="bonus-network-note">If phone registration is unavailable, add a roster No. here. Students self-report their number; please check it in person.</p>
      <form class="bonus-manual"><label>Roster No. <input name="no" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 12" aria-label="Manually add roster No." disabled></label><button type="submit" disabled>Add</button></form>
      <p class="bonus-manual-status" role="status" aria-live="polite"></p>
      </details>
      <ul class="bonus-entrants" aria-label="Registered roster numbers"></ul>
      <p class="bonus-winner" role="status" aria-live="polite"></p>
      <div class="bonus-save-recovery" hidden><p class="bonus-save-status" role="alert"></p><button type="button" data-action="retry-save">Retry saving result</button><button type="button" data-action="download-result">Download backup</button></div>
    </section>`;
  const css = document.createElement('style');
  css.textContent = `.bonus-panel{border:0;border-radius:0;padding:0;background:transparent;color:inherit;font:inherit}.bonus-panel h2{margin:0;font-size:1.5rem}.bonus-panel p{line-height:1.6}.bonus-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.bonus-kicker{font-size:.72rem;letter-spacing:.14em;margin:0 0 6px;color:#e9a6d8}.bonus-count{white-space:nowrap;color:#f0c5e5}.bonus-actions{display:flex;flex-wrap:wrap;gap:10px}.bonus-panel button{font:inherit;cursor:pointer;border:1px solid #ffffff45;background:#ffffff12;color:inherit;border-radius:9px;padding:9px 13px}.bonus-panel button:disabled{opacity:.45;cursor:default}.bonus-panel [data-action=draw]{background:linear-gradient(120deg,#9c62e8,#e85ca8);border-color:transparent;color:white}.bonus-status{font-weight:600}.bonus-share{display:flex;gap:22px;align-items:center;padding:18px 0;background:transparent}.bonus-share[hidden]{display:none}.bonus-qr{flex:0 0 180px;background:white;padding:8px;border-radius:10px}.bonus-qr svg{width:180px;height:180px;display:block}.bonus-share p{font-size:.9rem;margin:8px 0}.bonus-link{display:block;word-break:break-all;color:#f2b6e1;margin-bottom:12px}.bonus-advanced{margin-top:14px;color:#ffffffb8}.bonus-advanced summary{cursor:pointer;color:#e9a6d8}.bonus-network-note{font-size:.82rem}.bonus-manual{display:flex;align-items:end;flex-wrap:wrap;gap:10px}.bonus-manual label{display:flex;gap:10px;align-items:center}.bonus-manual input{font:inherit;width:110px;border:1px solid #ffffff45;border-radius:8px;padding:9px;background:#ffffff12;color:inherit}.bonus-manual-status{min-height:1em;font-size:.86rem}.bonus-entrants{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}.bonus-entrants li{display:flex;align-items:center;gap:8px;padding:5px 8px 5px 12px;border:1px solid #ffffff30;border-radius:9px;background:#ffffff0c}.bonus-entrants button{padding:2px 7px;min-height:28px}.bonus-winner{font-size:1.3rem;font-weight:700;color:#f3b6e2}@media(max-width:550px){.bonus-share{flex-direction:column;align-items:start}.bonus-heading{align-items:start}.bonus-manual label{flex-wrap:wrap}}`;
  container.prepend(css);
  const $ = (selector) => container.querySelector(selector);
  const status = $('.bonus-status');
  const manualStatus = $('.bonus-manual-status');
  const parseNo = (value) => {
    if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value).trim())) return null;
    const no = Number(String(value).trim());
    return Number.isSafeInteger(no) && no > 0 ? no : null;
  };
  const eligible = () => new Set(Array.from(getEligibleNumbers(), parseNo).filter((no) => no !== null));
  const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('');
  const send = (connection, payload) => { try { if (connection.open) connection.send(payload); } catch { /* A disconnected phone does not remove its registration. */ } };
  function render() {
    $('.bonus-count').textContent = `${entrants.size} registered`;
    $('[data-action="open"]').disabled = !!pendingRecord;
    $('[data-action="retry-save"]').disabled = saving;
    $('[data-action="close"]').disabled = !open;
    $('[data-action="draw"]').disabled = !round || drawn || !entrants.size;
    $('.bonus-manual input').disabled = !open || drawn;
    $('.bonus-manual button').disabled = !open || drawn;
    $('.bonus-entrants').replaceChildren(...Array.from(entrants).sort((a, b) => a - b).map((no) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `No. ${no}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove No. ${no}`);
      remove.disabled = drawn;
      remove.addEventListener('click', () => { entrants.delete(no); render(); });
      item.append(label, remove);
      return item;
    }));
  }
  function join(value, token) {
    const no = parseNo(value);
    if (!open || drawn || token !== round) return { type: 'ack', status: 'closed', message: 'This round is closed. Ask your instructor for the latest QR code.' };
    if (no === null) return { type: 'ack', status: 'invalid', message: 'Enter your full roster No. using digits only.' };
    if (!eligible().has(no)) return { type: 'ack', status: 'invalid', no, message: 'This No. cannot join this round. Please check with your instructor.' };
    const duplicate = entrants.has(no);
    entrants.add(no);
    render();
    return { type: 'ack', status: 'joined', no, message: duplicate ? `No. ${no} is already registered for this round.` : `No. ${no} is registered for this round.` };
  }
  function stopNetwork(message) {
    open = false;
    online = false;
    for (const connection of connections) send(connection, { type: 'closed', message });
    connections.clear();
    if (peer) { peer.destroy(); peer = null; }
    $('.bonus-share').hidden = true;
    render();
  }
  function close() {
    stopNetwork('Registration has closed. Your accepted registration stays in the draw.');
    if (round && !drawn) status.textContent = 'Registration is closed. Existing entries remain in this round.';
  }
  function reset() {
    if (pendingRecord) return false;
    stopNetwork('This round has ended. Ask your instructor for the latest QR code.');
    entrants.clear();
    registrationsByPeer.clear();
    round = null;
    drawn = false;
    $('.bonus-winner').textContent = '';
    $('.bonus-save-recovery').hidden = true;
    $('.bonus-manual input').value = '';
    manualStatus.textContent = '';
    status.textContent = 'Registration is closed.';
    render();
    return true;
  }
  function start() {
    if (pendingRecord) return;
    stopNetwork('A new round has started. Scan the new QR code to register again.');
    entrants.clear();
    registrationsByPeer.clear();
    round = randomToken();
    drawn = false;
    open = true;
    manualStatus.textContent = '';
    $('.bonus-winner').textContent = '';
    $('.bonus-save-recovery').hidden = true;
    status.textContent = 'Registration is open. Connecting to the student sign-up service…';
    render();
    if (typeof globalThis.Peer !== 'function') { status.textContent = 'Registration is open, but phone sign-up is unavailable. Use manual entry in the help section.'; return; }
    const activeRound = round;
    const room = `ierg2060-${randomToken()}`;
    let currentPeer;
    try { currentPeer = new globalThis.Peer(room); peer = currentPeer; }
    catch { status.textContent = 'Phone sign-up could not connect. Use manual entry in the help section.'; return; }
    currentPeer.on('open', () => {
      if (!open || round !== activeRound || currentPeer !== peer) return;
      online = true;
      const url = new URL('join.html', publicBaseUrl || new URL('./', location.href));
      url.hash = `room=${encodeURIComponent(room)}&round=${encodeURIComponent(round)}`;
      $('.bonus-link').href = url.href;
      $('.bonus-link').textContent = 'Open registration page ↗';
      $('.bonus-qr').replaceChildren();
      if (typeof globalThis.qrcode === 'function') {
        const qr = globalThis.qrcode(0, 'M');
        qr.addData(url.href); qr.make();
        $('.bonus-qr').innerHTML = qr.createSvgTag({ scalable: true, margin: 8 });
      } else $('.bonus-qr').textContent = 'QR code unavailable. Copy the registration link.';
      $('.bonus-share').hidden = false;
      status.textContent = 'Registration is open. Students can scan the QR code or open the link.';
    });
    currentPeer.on('connection', (connection) => {
      if (currentPeer !== peer || activeRound !== round) { connection.close(); return; }
      connections.add(connection);
      const peerKey = connection.peer || connection;
      connection.on('data', (data) => {
        if (!data || typeof data !== 'object' || data.type !== 'join') return;
        const registeredNo = registrationsByPeer.get(peerKey) ?? null;
        if (registeredNo !== null && parseNo(data.no) !== registeredNo && activeRound === round && open) {
          send(connection, { type: 'ack', status: 'invalid', no: registeredNo, message: `This connection is already registered as No. ${registeredNo}. Ask your instructor to correct an entry.` });
          return;
        }
        // Check the captured round too, so a late event can never enter a new round.
        const result = activeRound === round ? join(data.no, data.round) : { type: 'ack', status: 'closed', message: 'This QR code has expired.' };
        if (result.status === 'joined') registrationsByPeer.set(peerKey, result.no);
        send(connection, result);
      });
      connection.on('close', () => connections.delete(connection));
      connection.on('error', () => connections.delete(connection));
    });
    const failed = () => {
      if (currentPeer !== peer || !open || activeRound !== round) return;
      online = false;
      status.textContent = 'Phone sign-up is unavailable. Accepted entries are kept; use manual entry or start a new round.';
    };
    currentPeer.on('error', failed);
    currentPeer.on('disconnected', failed);
    setTimeout(() => {
      if (currentPeer === peer && open && !online) status.textContent = 'Phone sign-up timed out. Use manual entry or start a new round.';
    }, 15000);
  }
  function draw() {
    if (!round || drawn) return;
    const valid = eligible();
    let removed = 0;
    for (const no of entrants) if (!valid.has(no)) { entrants.delete(no); removed++; }
    const pool = Array.from(entrants).sort((a, b) => a - b);
    if (!pool.length) { status.textContent = 'There are no eligible entries in this round.'; render(); return; }
    // Rejection sampling avoids modulo bias in the selected index.
    const limit = Math.floor(0x100000000 / pool.length) * pool.length;
    const values = new Uint32Array(1);
    do { crypto.getRandomValues(values); } while (values[0] >= limit);
    const no = pool[values[0] % pool.length];
    drawn = true;
    stopNetwork('This bonus round has ended.');
    status.textContent = `Round complete · ${pool.length} ${pool.length === 1 ? 'entry' : 'entries'}${removed ? ` · ${removed} ineligible ${removed === 1 ? 'entry was' : 'entries were'} removed` : ''}`;
    $('.bonus-winner').textContent = `Selected volunteer · No. ${no}`;
    pendingRecord = { no, round, entrants: pool, drawnAt: new Date().toISOString() };
    saveResult();
  }
  async function saveResult() {
    if (!pendingRecord || saving) return;
    saving = true;
    render();
    try {
      if (typeof onWinner !== 'function') throw new Error('Missing result recorder');
      // Retry the exact result; never draw another number after a storage failure.
      await onWinner({ ...pendingRecord, entrants: [...pendingRecord.entrants] });
      pendingRecord = null;
      $('.bonus-save-recovery').hidden = true;
    } catch {
      $('.bonus-save-recovery').hidden = false;
      $('.bonus-save-status').textContent = 'This result has not been saved. It is preserved and will not be drawn again. Retry saving or download a backup before starting another round.';
    } finally { saving = false; render(); }
  }
  $('[data-action="open"]').addEventListener('click', start);
  $('[data-action="close"]').addEventListener('click', close);
  $('[data-action="draw"]').addEventListener('click', draw);
  $('[data-action="retry-save"]').addEventListener('click', saveResult);
  $('[data-action="download-result"]').addEventListener('click', () => {
    if (!pendingRecord) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'ierg2060-bonus-result', ...pendingRecord }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `ierg2060-bonus-${pendingRecord.round}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('[data-action="copy"]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('.bonus-link').href); manualStatus.textContent = 'Registration link copied.'; }
    catch { manualStatus.textContent = 'Copy failed. Copy the address from the registration link.'; }
  });
  $('.bonus-manual').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('.bonus-manual input');
    const result = join(input.value, round);
    manualStatus.textContent = result.status === 'joined' ? `No. ${result.no} registered. Duplicate entries count once.` : result.status === 'closed' ? 'Registration is closed.' : 'Enter a valid roster No. from the current eligible roster.';
    if (result.status === 'joined') input.value = '';
  });
  render();
  return { close, reset, isOpen: () => open, getEntrants: () => Array.from(entrants).sort((a, b) => a - b), hasUnsavedResult: () => !!pendingRecord };
}
