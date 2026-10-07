// Only roster numbers cross the data channel. Names and grades stay on the host.
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
      <div class="bonus-heading"><div><p class="bonus-kicker">VOLUNTEER BONUS</p><h2 id="bonus-title">加分抽奖</h2></div><span class="bonus-count" aria-live="polite">0 人报名</span></div>
      <p>开启独立报名轮次，学生扫描二维码并填写名册 No.。正式抽奖记录独立保留。</p>
      <div class="bonus-actions"><button type="button" data-action="open">开启新一轮报名</button><button type="button" data-action="close" disabled>停止报名</button><button type="button" data-action="draw" disabled>抽取 1 位</button></div>
      <p class="bonus-status" role="status" aria-live="polite">尚未开启。报名与抽奖仅使用当前名册中可参与的 No.。</p>
      <div class="bonus-share" hidden><div class="bonus-qr" aria-label="学生报名二维码"></div><div><strong>扫描二维码报名</strong><p>教师需保持此页打开。手机连接失败时，可由教师手动添加。</p><a class="bonus-link" target="_blank" rel="noopener">打开报名页</a><button type="button" data-action="copy">复制报名链接</button></div></div>
      <p class="bonus-network-note">手机连接可能受校园网络限制，失败时请手动添加。编号由学生自报，请教师现场核对。</p>
      <form class="bonus-manual"><label>手动添加 No. <input name="no" type="text" inputmode="numeric" autocomplete="off" placeholder="例如 12" aria-label="手动添加名册 No." disabled></label><button type="submit" disabled>添加</button></form>
      <p class="bonus-manual-status" role="status" aria-live="polite"></p>
      <ul class="bonus-entrants" aria-label="已报名 No."></ul>
      <p class="bonus-winner" role="status" aria-live="polite"></p>
      <div class="bonus-save-recovery" hidden><p class="bonus-save-status" role="alert"></p><button type="button" data-action="retry-save">重试保存同一结果</button><button type="button" data-action="download-result">下载待保存结果</button></div>
    </section>`;
  const css = document.createElement('style');
  css.textContent = `.bonus-panel{border:0;border-radius:0;padding:0;background:transparent;color:#253b2f;font-size:13px}.bonus-panel h2{margin:0;font-size:1.5rem}.bonus-panel p{line-height:1.65}.bonus-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.bonus-kicker{font-size:.72rem;letter-spacing:.12em;margin:0 0 6px;color:#65795e}.bonus-count{white-space:nowrap;color:#315b3f}.bonus-actions{display:flex;flex-wrap:wrap;gap:10px}.bonus-panel button{font:inherit;cursor:pointer;border:1px solid #bacab6;background:#edf2e6;color:#24452f;border-radius:8px;padding:9px 13px}.bonus-panel button:disabled{opacity:.45;cursor:default}.bonus-panel [data-action=draw]{background:#315b3f;color:white}.bonus-status{font-weight:600}.bonus-share{display:flex;gap:22px;align-items:center;padding:18px;background:white;border-radius:12px}.bonus-share[hidden]{display:none}.bonus-qr{flex:0 0 180px;background:white}.bonus-qr svg{width:180px;height:180px;display:block}.bonus-share p{font-size:.85rem;margin:8px 0}.bonus-link{display:block;word-break:break-all;color:#315b3f;margin-bottom:12px}.bonus-network-note{font-size:.82rem;color:#667361}.bonus-manual{display:flex;align-items:end;flex-wrap:wrap;gap:10px}.bonus-manual label{display:flex;gap:10px;align-items:center}.bonus-manual input{font:inherit;width:110px;border:1px solid #bacab6;border-radius:8px;padding:9px;background:white;color:#253b2f}.bonus-manual-status{min-height:1em;font-size:.86rem}.bonus-entrants{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}.bonus-entrants li{display:flex;align-items:center;gap:8px;padding:5px 8px 5px 12px;border:1px solid #c8d5c0;border-radius:9px;background:white}.bonus-entrants button{padding:2px 7px;min-height:28px}.bonus-winner{font-size:1.3rem;font-weight:700}@media(max-width:550px){.bonus-panel{padding:0}.bonus-share{flex-direction:column;align-items:start}.bonus-heading{align-items:start}.bonus-manual label{flex-wrap:wrap}}`;
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
    $('.bonus-count').textContent = `${entrants.size} 人报名`;
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
      remove.setAttribute('aria-label', `移除 No. ${no}`);
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
    if (round && !drawn) status.textContent = '报名已停止，已报名者仍可参与本轮抽奖。';
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
    status.textContent = '尚未开启。报名与抽奖仅使用当前名册中可参与的 No.。';
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
    status.textContent = '报名已开启，正在连接手机报名服务。也可手动添加 No.。';
    render();
    if (typeof globalThis.Peer !== 'function') { status.textContent = '手机报名服务未加载。报名已开启，请手动添加 No.。'; return; }
    const activeRound = round;
    const room = `ierg2060-${randomToken()}`;
    let currentPeer;
    try { currentPeer = new globalThis.Peer(room); peer = currentPeer; }
    catch { status.textContent = '手机报名服务连接失败，请手动添加 No.。'; return; }
    currentPeer.on('open', () => {
      if (!open || round !== activeRound || currentPeer !== peer) return;
      online = true;
      const url = new URL('join.html', publicBaseUrl || new URL('./', location.href));
      url.hash = `room=${encodeURIComponent(room)}&round=${encodeURIComponent(round)}`;
      $('.bonus-link').href = url.href;
      $('.bonus-link').textContent = '打开学生报名页 ↗';
      $('.bonus-qr').replaceChildren();
      if (typeof globalThis.qrcode === 'function') {
        const qr = globalThis.qrcode(0, 'M');
        qr.addData(url.href); qr.make();
        $('.bonus-qr').innerHTML = qr.createSvgTag({ scalable: true, margin: 8 });
      } else $('.bonus-qr').textContent = '二维码未加载，请复制报名链接。';
      $('.bonus-share').hidden = false;
      status.textContent = '报名已开启。学生可扫描二维码或打开报名链接。';
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
      status.textContent = '手机报名连接中断或不可用。已接受的报名保留；请手动添加 No.，或开启新一轮重新连接。';
    };
    currentPeer.on('error', failed);
    currentPeer.on('disconnected', failed);
    setTimeout(() => {
      if (currentPeer === peer && open && !online) status.textContent = '手机报名连接超时。请手动添加 No.，或开启新一轮重新连接。';
    }, 15000);
  }
  function draw() {
    if (!round || drawn) return;
    const valid = eligible();
    let removed = 0;
    for (const no of entrants) if (!valid.has(no)) { entrants.delete(no); removed++; }
    const pool = Array.from(entrants).sort((a, b) => a - b);
    if (!pool.length) { status.textContent = '本轮没有符合当前参与条件的报名者。'; render(); return; }
    // Rejection sampling avoids modulo bias in the selected index.
    const limit = Math.floor(0x100000000 / pool.length) * pool.length;
    const values = new Uint32Array(1);
    do { crypto.getRandomValues(values); } while (values[0] >= limit);
    const no = pool[values[0] % pool.length];
    drawn = true;
    stopNetwork('This bonus round has ended.');
    status.textContent = `本轮已锁定，共 ${pool.length} 位参与者。${removed ? `已移除 ${removed} 位不再符合当前条件的报名者。` : ''}`;
    $('.bonus-winner').textContent = `加分抽奖结果 · No. ${no}`;
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
      $('.bonus-save-status').textContent = '结果尚未保存到历史记录。此结果已保留且不会重新抽取；请重试保存，或先下载结果备份。保存成功前不能开启新一轮。';
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
    try { await navigator.clipboard.writeText($('.bonus-link').href); manualStatus.textContent = '报名链接已复制。'; }
    catch { manualStatus.textContent = '复制失败，请从“打开学生报名页”链接复制地址。'; }
  });
  $('.bonus-manual').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('.bonus-manual input');
    const result = join(input.value, round);
    manualStatus.textContent = result.status === 'joined' ? `No. ${result.no} 已报名（重复报名只计一次）。` : result.status === 'closed' ? '当前报名已关闭。' : '请输入完整数字 No.，且该 No. 必须在当前可参与名册中。';
    if (result.status === 'joined') input.value = '';
  });
  render();
  return { close, reset, isOpen: () => open, getEntrants: () => Array.from(entrants).sort((a, b) => a - b), hasUnsavedResult: () => !!pendingRecord };
}
