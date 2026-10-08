// The service persists live registrations and archives the closed round to Sheets.
export function setupCloudBonus({container, call, endpoint, getAbsent, getStudentName, onState, publicBaseUrl, testMode=false}) {
  if (!container || typeof call !== 'function') throw new Error('Bonus draw needs a container and cloud connection.');
  let room = null;
  let busy = false;
  let disposed = false;
  let pending = null;
  let active = null;
  let timer = null;
  let shareKey = '';
  const dialog = container.closest('dialog');
  container.innerHTML = `
    <section class="bonus-panel" aria-labelledby="bonus-title">
      <div class="bonus-heading"><h2 id="bonus-title">Volunteer draw</h2><span class="bonus-count" aria-live="polite">0 registered</span></div>
      <div class="bonus-actions"><button type="button" data-action="open">Open registration</button><button type="button" data-action="close" disabled>Close registration</button><button type="button" data-action="draw" disabled>Draw a volunteer</button></div>
      <p class="bonus-status" role="status" aria-live="polite">Reading registration…</p>
      <div class="bonus-share" hidden><div class="bonus-qr" aria-label="Student registration QR code"></div><div><strong>Scan to join</strong><p>Entries are confirmed by the registration service.</p><a class="bonus-link" target="_blank" rel="noopener">Open registration page</a><button type="button" data-action="copy">Copy link</button></div></div>
      <details class="bonus-advanced"><summary>Manual entry</summary><p>Students self-report their roster No. Please check it in person.</p><form class="bonus-manual"><label>Roster No. <input name="no" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 12" disabled></label><button type="submit" disabled>Add</button></form><p class="bonus-manual-status" role="status" aria-live="polite"></p><button type="button" data-action="reset" disabled>Clear registrations</button></details>
      <ul class="bonus-entrants" aria-label="Registered roster numbers"></ul>
      <p class="bonus-winner" role="status" aria-live="polite"></p>
      <div class="bonus-recovery" hidden><p class="bonus-recovery-status" role="alert"></p><button type="button" data-action="retry">Retry</button></div>
    </section>`;
  const css = document.createElement('style');
  css.textContent = `.bonus-panel{color:inherit;font:inherit}.bonus-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.bonus-panel h2{margin:0;font-size:125%;color:#527bbd;border-bottom:1px solid #aaa;padding-bottom:4px;flex:1}.bonus-count{white-space:nowrap;color:#555;font-size:13px}.bonus-actions{display:flex;flex-wrap:wrap;gap:8px}.bonus-panel button{font:inherit;cursor:pointer;border:1px solid gray;background:#f6f6f6;color:#224b8d;border-radius:2px;padding:4px 10px}.bonus-panel button:hover:enabled{background:#ffffee}.bonus-panel button:disabled{opacity:.45;cursor:default}.bonus-panel [data-action=draw]{background:#ffffdd;border-color:#224b8d;font-weight:bold}.bonus-status{font-weight:bold}.bonus-share{display:flex;gap:22px;align-items:center;padding:16px 0}.bonus-share[hidden]{display:none}.bonus-qr{flex:0 0 180px;background:white;padding:6px;border:1px solid gray}.bonus-qr svg{width:180px;height:180px;display:block}.bonus-share p{font-size:13px;margin:6px 0}.bonus-link{display:inline-block;word-break:break-all;color:#224b8d;margin-bottom:10px}.bonus-advanced{margin-top:12px;color:#333}.bonus-advanced summary{cursor:pointer;color:#224b8d}.bonus-manual{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.bonus-manual label{display:flex;gap:8px;align-items:center}.bonus-manual input{font:inherit;width:110px;border:1px solid gray;border-radius:2px;padding:4px 8px;background:white;color:#000}.bonus-manual-status{min-height:1em;font-size:13px}.bonus-entrants{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0}.bonus-entrants li{display:flex;align-items:center;gap:6px;padding:3px 5px 3px 10px;border:1px solid gray;border-radius:2px;background:#f6f6f6}.bonus-entrants button{padding:1px 6px;min-height:24px}.bonus-winner{font-size:1.2rem;font-weight:bold;color:#224b8d}.bonus-recovery-status{color:#aa0000}@media(max-width:550px){.bonus-share{flex-direction:column;align-items:start}.bonus-heading{align-items:start}.bonus-manual label{flex-wrap:wrap}}`;
  container.prepend(css);
  const $ = selector => container.querySelector(selector);
  const status = $('.bonus-status');
  const manualStatus = $('.bonus-manual-status');
  const entrants = () => [...(room?.entrants || [])].sort((a, b) => a - b);
  const parseNo = value => /^\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  function render() {
    if (disposed) return;
    const locked = !!pending;
    $('.bonus-count').textContent = `${entrants().length} registered`;
    $('[data-action="open"]').disabled = locked || !!room?.open || (!!room && !room.winner && !!entrants().length);
    $('[data-action="close"]').disabled = locked || !room?.open;
    $('[data-action="draw"]').disabled = locked || !room || room.open || !!room.winner || !entrants().length;
    $('[data-action="reset"]').disabled = locked || !room || room.open || !!room.winner;
    $('.bonus-manual input').disabled = locked || !room?.open;
    $('.bonus-manual button').disabled = locked || !room?.open;
    $('[data-action="retry"]').disabled = busy;
    $('.bonus-recovery').hidden = !pending;
    $('.bonus-entrants').replaceChildren(...entrants().map(no => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `No. ${no}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove No. ${no}`);
      remove.disabled = locked || !!room.winner;
      remove.addEventListener('click', () => mutate('bonusRemove', {room: room.id, no}));
      item.append(label, remove);
      return item;
    }));
    const winner = room?.winner;
    const name = winner ? (getStudentName?.(winner.no) || winner.name || '') : '';
    $('.bonus-winner').textContent = winner ? `Selected volunteer · No. ${winner.no}${name ? ` · ${name}` : ''}` : '';
    const endpointUrl = typeof endpoint === 'function' ? endpoint() : endpoint;
    $('.bonus-share').hidden = !room?.open || !endpointUrl;
    if (room?.open && endpointUrl && shareKey !== `${endpointUrl}|${room.id}`) {
      const url = new URL('join.html', publicBaseUrl || new URL('./', location.href));
      if(testMode)url.searchParams.set('mode','test');
      url.hash = new URLSearchParams({room: room.id}).toString();
      $('.bonus-link').href = url.href;
      $('.bonus-link').textContent = 'Open registration page ↗';
      $('.bonus-qr').replaceChildren();
      if (typeof globalThis.qrcode === 'function') {
        const qr = globalThis.qrcode(0, 'M');
        qr.addData(url.href); qr.make();
        $('.bonus-qr').innerHTML = qr.createSvgTag({scalable: true, margin: 8});
      } else $('.bonus-qr').textContent = 'QR code unavailable. Copy the registration link.';
      shareKey = `${endpointUrl}|${room.id}`;
    }
  }
  function roomMessage() {
    return room?.winner ? `Round complete · ${entrants().length} registered` : room?.open ? 'Registration is open. Students can scan the QR code or open the link.' : room ? 'Registration is closed. Confirmed entries remain in this round.' : 'Registration is closed.';
  }
  function shouldPoll() { return !disposed && !document.hidden && (!dialog || dialog.open || room?.open); }
  function schedule() {
    clearTimeout(timer);
    if (shouldPoll() && !pending) timer = setTimeout(() => { refresh().catch(() => {}); }, 5000);
  }
  async function apply(result) {
    if (disposed) return;
    if (Object.hasOwn(result, 'room')) room = result.room;
    if (result.state && typeof onState === 'function') await onState(result);
  }
  function refresh() {
    if (disposed) return Promise.resolve();
    if (active) return active;
    busy = true;
    render();
    active = (async () => {
      try {
        const result = await call('bonusStatus', {});
        await apply(result);
        if (!disposed && !pending) status.textContent = roomMessage();
        return result;
      } catch (error) {
        if (!disposed && !pending) status.textContent = `Could not update registration: ${error.message}. Retrying shortly.`;
        throw error;
      } finally {
        busy = false; active = null;
        if (!disposed) { render(); schedule(); }
      }
    })();
    return active;
  }
  async function sendPending() {
    if (!pending || busy || disposed) return false;
    const operation = pending;
    busy = true;
    clearTimeout(timer);
    status.textContent = operation.action === 'bonusDraw' ? 'Saving the volunteer draw…' : 'Saving registration…';
    render();
    active = (async () => {
      try {
        const result = await call(operation.action, operation.payload);
        await apply(result);
        if (disposed) return false;
        pending = null;
        status.textContent = roomMessage();
        if (operation.action === 'bonusJoin') {
          manualStatus.textContent = `No. ${result.no} registered. Duplicate entries count once.`;
          $('.bonus-manual input').value = '';
          // Public join receipts omit the admin room; the next refresh reads it.
        }
        return true;
      } catch (error) {
        if (!disposed) {
          if (error.serverConfirmed) pending = null;
          status.textContent = `Could not confirm the change: ${error.message}`;
          $('.bonus-recovery-status').textContent = 'Retry to confirm the same request. A retry keeps the same draw result.';
          if (operation.action === 'bonusJoin') manualStatus.textContent = error.message;
        }
        return false;
      } finally {
        busy = false; active = null;
        if (!disposed) { render(); schedule(); }
      }
    })();
    const completed = await active;
    if (completed && operation.action === 'bonusJoin') await refresh().catch(() => {});
    return completed;
  }
  async function mutate(action, payload) {
    if (disposed || pending) return false;
    // A background status refresh must not swallow an instructor click.
    if (active) await active.catch(() => {});
    if (disposed || pending) return false;
    pending = {action, payload: {...payload, requestId: crypto.randomUUID()}};
    return sendPending();
  }
  $('[data-action="open"]').addEventListener('click', () => {
    try {
      const absent = getAbsent?.() ?? [];
      if (!Array.isArray(absent)) throw new Error('Enter valid absent roster numbers before opening registration.');
      manualStatus.textContent = '';
      mutate('bonusOpen', {absent});
    } catch (error) { status.textContent = error.message; }
  });
  $('[data-action="close"]').addEventListener('click', () => close());
  $('[data-action="draw"]').addEventListener('click', () => mutate('bonusDraw', {room: room?.id}));
  $('[data-action="retry"]').addEventListener('click', sendPending);
  $('[data-action="reset"]').addEventListener('click', reset);
  $('[data-action="copy"]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('.bonus-link').href); manualStatus.textContent = 'Registration link copied.'; }
    catch { manualStatus.textContent = 'Copy failed. Copy the address from the registration link.'; }
  });
  $('.bonus-manual').addEventListener('submit', event => {
    event.preventDefault();
    const no = parseNo($('.bonus-manual input').value);
    if (no === null) { manualStatus.textContent = 'Enter your full roster No. using digits only.'; return; }
    if (room?.open) mutate('bonusJoin', {room: room.id, no});
  });
  const visibility = () => { if (shouldPoll()) refresh().catch(() => {}); else clearTimeout(timer); };
  document.addEventListener('visibilitychange', visibility);
  const observer = dialog ? new MutationObserver(visibility) : null;
  observer?.observe(dialog, {attributes: true, attributeFilter: ['open']});
  function close() { return room?.open ? mutate('bonusClose', {room: room.id}) : Promise.resolve(true); }
  function reset() { return mutate('bonusReset', {room: room?.id}); }
  render();
  refresh().catch(() => {});
  return {
    close, reset, refresh,
    isOpen: () => !!room?.open,
    hasUnsavedResult: () => !!pending,
    getEntrants: entrants,
    destroy() { disposed = true; clearTimeout(timer); observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); }
  };
}
