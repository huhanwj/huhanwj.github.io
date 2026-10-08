import {createCloudClient} from './cloud.js?v=10';
import {cloudDefaults, testMode} from './cloud-config.js?v=8';
import {readSession, beginSignIn} from './auth.js?v=2';

const $ = id => document.getElementById(id);
const mode = {testMode: true};
const pendingKey = 'ierg2060-test-load-pending-v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const safeMessage = error => String(error?.message || error || 'Unknown error').replace(/[a-f0-9]{64}/gi, '[redacted]');
let client = null, verified = false, working = false, pending = null, report = null;
const frames = new Map();
const activeMode = testMode === true && new URLSearchParams(location.search).get('mode') === 'test';
const displayMs = value => Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : '—';
function show(message, state = '') { $('status').textContent = message; $('status').dataset.state = state; }
function controls() {
  $('start').disabled = !activeMode || !verified || working || !!pending;
  $('verify').disabled = !activeMode || working;
  $('signin').disabled = !activeMode || working;
  $('count').disabled = working || !!pending;
  $('duplicates').disabled = working || !!pending;
  $('scenario').disabled = working || !!pending;
  $('recover').hidden = !pending;
  $('recover').disabled = !activeMode || working;
  $('download').disabled = !report;
}
function savePending() {
  // Request IDs and test room IDs only; never authentication material.
  if (pending) sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  else sessionStorage.removeItem(pendingKey);
}
function loadPending() {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
    if (value?.kind === 'start' && uuid(value.runId) && [20,25].includes(value.count) &&
        ['reset','open'].includes(value.stage) && ['warm','cold'].includes(value.scenario) && uuid(value.openRequestId) && uuid(value.resetRequestId) &&
        (!value.oldRoomId || uuid(value.oldRoomId))) pending = value;
    else if (value?.kind === 'close' && uuid(value.requestId) && uuid(value.roomId)) pending = value;
  } catch { /* No stored operation is safer than accepting an invalid operation. */ }
}
function connect() {
  if (!activeMode) throw Error('This page runs only with ?mode=test.');
  client?.destroy();
  client = createCloudClient(cloudDefaults.student, {testMode: true, getSessionToken: () => readSession(mode)?.token});
  return client;
}
function checkMetadata(result) {
  if (result?.environment !== 'test' || result.rosterCount !== 35) throw Error('Stopped: the service did not confirm the isolated 35-student TEST environment.');
}
function snapshot(result) {
  checkMetadata(result);
  return {environment: result.environment, rosterCount: result.rosterCount,
    room: result.room ? {id: result.room.id, open: result.room.open, entrants: [...result.room.entrants], winner: result.room.winner?.no ?? null} : null,
    revision: result.revision ?? null};
}
async function verifyOwner() {
  verified = false;
  controls();
  if (!activeMode) throw Error('Open load-test.html?mode=test to use the test fixture.');
  const session = readSession(mode);
  if (!session) throw Error('Sign in with the owner Google account for TEST mode first.');
  if (!client) connect();
  const account = await client.call('auth');
  if (account?.ok !== true || account.environment !== 'test' || account.email !== session.email) throw Error('The owner session did not confirm TEST mode.');
  const result = await client.call('load');
  checkMetadata(result);
  const roster = result.roster;
  if (!Array.isArray(roster) || roster.length !== 35 || roster.some((student, i) => student.no !== i + 1 || student.name !== `Test Student ${String(i + 1).padStart(2, '0')}`)) {
    throw Error('Stopped: the roster is not exactly fictional Test Student 01–35.');
  }
  if (!result.state || !Array.isArray(result.state.students) || result.state.students.length !== 35 ||
      result.state.students.some((student, i) => student.no !== i + 1 || student.name !== roster[i].name)) throw Error('Stopped: TEST state is not initialized with the fictional roster.');
  verified = true;
  $('identity').textContent = 'Owner authenticated · TEST namespace verified · fictional roster No. 1–35 verified';
  if (typeof result.storageUrl === 'string') {
    const url = new URL(result.storageUrl);
    if (url.origin === 'https://docs.google.com' && /^\/spreadsheets\/d\/[A-Za-z0-9_-]+/.test(url.pathname)) {
      $('storage-link').href = url.href;
      $('storage-link').hidden = false;
    }
  }
  return result;
}
const quantile = (values, fraction) => values.length ? values[Math.max(0, Math.ceil(fraction * values.length) - 1)] : null;
function updateReport() {
  if (!report) return;
  const rows = report.clients || [];
  const confirmed = rows.filter(row => row.status === 'confirmed');
  const totals = confirmed.map(row => row.totalMs).filter(Number.isFinite).sort((a,b) => a-b);
  const busy = rows.reduce((sum,row) => sum + row.attempts.filter(attempt => attempt.serverBusy).length, 0);
  const transport = rows.flatMap(row => row.transportDispatches.filter(dispatch => dispatch.attemptNumber === 1).map(dispatch => dispatch.dispatchAtMs));
  report.timing.mainTransportDispatchSpreadMs = transport.length > 1 ? Math.max(...transport) - Math.min(...transport) : null;
  report.timing.mainTransportDispatchCount = transport.length;
  report.summary = {clients: rows.length, confirmed: confirmed.length, errors: rows.filter(row => row.status === 'error' || row.status === 'timeout').length,
    totalMs: {p50: quantile(totals,.5), p95: quantile(totals,.95), max: totals.at(-1) ?? null}, serverBusyResponses: busy,
    percentileDefinition: 'Nearest-rank percentiles among confirmed main-burst clients only; unresolved clients excluded and counted separately.'};
  $('success').textContent = `${confirmed.length} / ${report.requestedClients}`;
  $('p50').textContent = displayMs(report.summary.totalMs.p50);
  $('p95').textContent = displayMs(report.summary.totalMs.p95);
  $('max').textContent = displayMs(report.summary.totalMs.max);
  $('busy').textContent = String(busy);
  $('timing-detail').textContent = `${report.scenario === 'warm' ? 'Warm' : 'Cold'} scenario · all-frame startup ${displayMs(report.timing.mainAllFrameStartupMs)} · parent launch spread ${displayMs(report.timing.mainDispatchSpreadMs)} · actual first-RPC transport launch spread ${displayMs(report.timing.mainTransportDispatchSpreadMs)} (${report.timing.mainTransportDispatchCount}/${report.requestedClients} dispatched)`;
  $('clients').replaceChildren(...[...rows, ...(report.duplicateClients || [])].map(row => {
    const tr = document.createElement('tr');
    for (const value of [`${row.clientId} / ${row.no}`, row.status, displayMs(row.dispatchOffsetMs), displayMs(row.attempts[0]?.rpcMs), displayMs(row.totalMs), row.attempts.length, row.attempts.filter(a => a.serverBusy).length]) {
      const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
    }
    return tr;
  }));
  $('report').textContent = JSON.stringify(report, null, 2);
  controls();
}
function destroyFrames() {
  for (const frame of frames.values()) { clearTimeout(frame.readyTimer); clearTimeout(frame.finishTimer); frame.element.remove(); }
  frames.clear();
}
function newReport(plan, room) {
  return {schemaVersion: 1, runId: plan.runId, environment: 'test', rosterCount: 35, requestedClients: plan.count, roomId: room.id,
    createdAt: new Date().toISOString(), status: 'preparing', scenario: plan.scenario, duplicateChecksRequested: plan.duplicates,
    timing: {readiness: plan.scenario === 'warm' ? 'Every student page and Google bridge reported ready before parent submitted the burst.' : 'Every student page handler reported ready; Google bridges can still be loading.',
      total: 'Measured by actual student page from its join handler submission until confirmed/error, including bridge startup and retry waits.',
      rpc: 'Actual createCloudClient.call elapsed time for each attempt, including bridge readiness wait.',
      dispatch: 'Parent commands use performance.now offsets. Transport timestamps come from each child immediately before posting bonusJoin to its Google bridge: performance.timeOrigin+performance.now.',
      startup: 'All independent iframe startup measured from parent creating first child through readiness barrier; per-frame page and bridge readiness measured from its creation.',
      administrator: 'Owner auth/load verification and room operations excluded from student timing.',
      clientTimeoutMs: 125000}, clients: [], duplicateClients: [], operations: [], verification: {}};
}
function addFrames(ids, phase) {
  const rows = ids.map(({clientId,no}) => ({clientId,no,phase,status:'loading',attempts:[],transportDispatches:[],pageReadyMs:null,bridgeReadyMs:null,dispatchOffsetMs:null,totalMs:null}));
  report[phase === 'main' ? 'clients' : 'duplicateClients'].push(...rows);
  const readyPromises = rows.map(row => new Promise(resolve => {
    const element = document.createElement('iframe');
    const url = new URL('join.html', location.href);
    url.search = new URLSearchParams({mode:'test',loadtest:report.runId,client:row.clientId}).toString();
    url.hash = new URLSearchParams({room:report.roomId}).toString();
    element.title = `Test client ${row.clientId}: fictional student ${row.no}`;
    const started = performance.now();
    const frame = {element,row,started,readyResolve:resolve,doneResolve:null,readyTimer:null,finishTimer:null};
    frame.readyTimer = setTimeout(() => { row.status='timeout'; row.message='Student page handler did not become ready within 45 seconds.'; resolve(false); updateReport(); }, 45000);
    frames.set(row.clientId,frame);
    element.src = url.href;
    $('frames').append(element);
  }));
  return {rows,readyPromises};
}
async function runPhase(ids, phase) {
  const phaseStartup = performance.now();
  const {rows,readyPromises} = addFrames(ids,phase);
  updateReport();
  const readiness = await Promise.all(readyPromises);
  report.timing[`${phase}AllFrameStartupMs`] = performance.now() - phaseStartup;
  if (readiness.some(ready => !ready)) throw Error('A student page or Google bridge did not become ready. No submissions were dispatched in this phase.');
  const donePromises = rows.map(row => new Promise(resolve => {
    const frame = frames.get(row.clientId);
    frame.doneResolve = resolve;
    frame.finishTimer = setTimeout(() => { row.status='timeout'; row.message='No terminal student result within 125 seconds.'; resolve(); updateReport(); }, 125000);
  }));
  const dispatchStart = performance.now();
  report.timing[`${phase}DispatchAt`] = new Date().toISOString();
  for (const row of rows) {
    const frame = frames.get(row.clientId);
    row.dispatchOffsetMs = performance.now() - dispatchStart;
    row.commandAtMs = performance.timeOrigin + performance.now();
    row.status = 'submitting';
    frame.element.contentWindow.postMessage({type:'ierg2060-loadtest-submit',runId:report.runId,clientId:row.clientId,no:row.no},location.origin);
  }
  report.timing[`${phase}DispatchSpreadMs`] = performance.now() - dispatchStart;
  updateReport();
  await Promise.all(donePromises);
}
window.addEventListener('message', event => {
  if (!report || event.origin !== location.origin || !event.data || event.data.type !== 'ierg2060-loadtest' || event.data.runId !== report.runId) return;
  const data = event.data, frame = frames.get(String(data.clientId));
  if (!frame || event.source !== frame.element.contentWindow) return;
  const row = frame.row;
  if (data.event === 'ready' && ['page','bridge'].includes(data.phase)) {
    const elapsed = performance.now() - frame.started;
    if (data.phase === 'page') row.pageReadyMs=elapsed;
    else row.bridgeReadyMs=elapsed;
    if (row.status === 'loading' && data.phase === (report.scenario === 'warm' ? 'bridge' : 'page')) {
      clearTimeout(frame.readyTimer); row.status='ready'; frame.readyResolve(true);
    }
  } else if (data.event === 'error' && row.status === 'loading') {
    clearTimeout(frame.readyTimer); row.status='error';row.message=safeMessage(data.message);frame.readyResolve(false);
  } else if (data.event === 'dispatch' && row.status === 'submitting' && data.no === row.no && uuid(data.requestId) && Number.isFinite(data.dispatchAtMs) && Number.isInteger(data.attemptNumber)) {
    row.transportDispatches.push({attemptNumber:data.attemptNumber,dispatchAtMs:data.dispatchAtMs,parentReceivedAtMs:performance.timeOrigin+performance.now(),requestId:data.requestId});
  } else if (data.event === 'attempt' && row.status === 'submitting' && Number.isFinite(data.rpcMs) && data.rpcMs >= 0 && Number.isInteger(data.attemptNumber)) {
    row.attempts.push({attemptNumber:data.attemptNumber,rpcMs:data.rpcMs,success:data.success===true,serverBusy:data.serverBusy===true,
      ...(data.message ? {message:safeMessage(data.message)} : {})});
  } else if (['confirmed','error'].includes(data.event) && row.status === 'submitting' && data.no !== undefined && Number.isFinite(data.totalMs)) {
    if (data.no !== row.no || !Number.isFinite(data.totalMs) || data.totalMs < 0 || data.restored) {
      row.status='error'; row.message='Invalid or restored student timing result; this run requires a new client receipt.';
    } else {
      row.status=data.event; row.totalMs=data.totalMs; row.requestId=uuid(data.requestId) ? data.requestId : null;
      if (data.message) row.message=safeMessage(data.message);
      row.pending=data.pending===true;
    }
    clearTimeout(frame.finishTimer); frame.doneResolve?.();
  }
  updateReport();
});
async function readRoom() {
  const result = await client.call('bonusStatus'); checkMetadata(result);
  if (report && result.room?.id !== report.roomId) throw Error('The test room changed during the run. Stopped without modifying another room.');
  return snapshot(result);
}
function verifyEntries(room, expected) {
  const entrants = room?.entrants || [];
  return {expected: [...expected], actual: [...entrants].sort((a,b)=>a-b), uniqueCount:new Set(entrants).size,
    exact: entrants.length === expected.length && new Set(entrants).size === expected.length && expected.every(no => entrants.includes(no))};
}
async function finishRun() {
  const expected = Array.from({length:report.requestedClients},(_,i)=>i+1);
  show('Reading the server registration count…');
  const before = await readRoom();
  report.verification.beforeClose = verifyEntries(before.room,expected);
  if (report.duplicateChecksRequested && report.clients.every(row => row.status === 'confirmed')) {
    // Fresh contexts exercise the server deduplicator, rather than a local accepted receipt.
    destroyFrames();
    show('Main burst settled. Submitting 3 duplicate roster numbers from new student pages…');
    await runPhase([1,2,3].map(no=>({clientId:`duplicate-${no}`,no})),'duplicate');
    const after = await readRoom();
    report.verification.afterDuplicates = verifyEntries(after.room,expected);
    report.verification.duplicatesConfirmed = report.duplicateClients.filter(row=>row.status==='confirmed').length;
  }
  pending = {kind:'close',roomId:report.roomId,requestId:crypto.randomUUID()}; savePending();
  await closePending();
}
async function closePending() {
  const operation = pending;
  show('Closing the TEST room and verifying persisted entries…');
  const closed = await client.call('bonusClose',{room:operation.roomId,requestId:operation.requestId}); checkMetadata(closed);
  if (closed.room?.id !== operation.roomId || closed.room.open !== false) throw Error('No matching closed TEST room was confirmed. Retry the same close operation.');
  // Keep the same close request pending until persistence checks also finish.
  // load reads the persisted document; status exposes its hydrated room.
  const loaded = await client.call('load'); checkMetadata(loaded);
  const status = await client.call('bonusStatus'); checkMetadata(status);
  if (status.room?.id !== operation.roomId || status.room.open !== false) throw Error('The persisted closed test room did not match this run.');
  pending = null; savePending();
  if (report) {
    const expected = Array.from({length:report.requestedClients},(_,i)=>i+1);
    report.operations.push({action:'bonusClose',requestId:operation.requestId,confirmed:true});
    report.verification.afterCloseReload = {...verifyEntries(status.room,expected),closed:true,loadEnvironment:loaded.environment,loadRosterCount:loaded.rosterCount};
    report.completedAt = new Date().toISOString();
    const valid = report.clients.every(row=>row.status==='confirmed') && report.verification.afterCloseReload.exact &&
      (!report.duplicateChecksRequested || (report.verification.duplicatesConfirmed===3 && report.verification.afterDuplicates?.exact));
    report.status = valid ? 'passed' : 'failed';
    $('verification').textContent = `Persisted closed TEST room: ${status.room.entrants.length} unique entries; expected ${report.requestedClients}. ${report.duplicateChecksRequested ? `Duplicate probes confirmed: ${report.verification.duplicatesConfirmed ?? 0}/3.` : ''}`;
    updateReport();
    show(`${report.status === 'passed' ? 'Passed' : 'Completed with failures'}: ${report.summary.confirmed}/${report.requestedClients} students confirmed. The TEST room is closed and its entries were read again.`,valid?'success':'error');
  } else show('The same pending TEST close was confirmed. The closed room was reloaded.','success');
}
async function continueStart() {
  const plan = pending;
  if (plan.stage === 'reset') {
    if (plan.oldRoomId) {
      show('Clearing the previous TEST registration…');
      const reset = await client.call('bonusReset',{room:plan.oldRoomId,requestId:plan.resetRequestId}); checkMetadata(reset);
      if (reset.room !== null) throw Error('The previous TEST registration was not cleared.');
    }
    plan.stage='open'; savePending();
  }
  show('Opening one new TEST room…');
  const opened = await client.call('bonusOpen',{absent:[],requestId:plan.openRequestId}); checkMetadata(opened);
  if (!uuid(opened.room?.id) || opened.room.open !== true || opened.room.entrants?.length !== 0) throw Error('The service did not confirm a fresh empty TEST room. Retry this same open request.');
  pending=null; savePending();
  destroyFrames();
  report=newReport(plan,opened.room);
  report.operations.push({action:'bonusOpen',requestId:plan.openRequestId,confirmed:true});
  if (plan.oldRoomId) report.operations.unshift({action:'bonusReset',requestId:plan.resetRequestId,confirmed:true,roomId:plan.oldRoomId});
  report.status='running'; updateReport();
  show(`Loading ${plan.count} real student pages; the ${plan.scenario} readiness barrier must pass before submitting…`);
  await runPhase(Array.from({length:plan.count},(_,i)=>({clientId:String(i+1),no:i+1})),'main');
  await finishRun();
}
async function run(action) {
  if (working || !activeMode) return;
  working=true; controls();
  try { await action(); }
  catch (error) {
    if (!error.serverConfirmed) {client?.destroy(); client=null;}
    if (report && report.status==='running') {report.status='incomplete';report.failure=safeMessage(error);updateReport();}
    show(`${safeMessage(error)}${pending ? '\nThe pending operation keeps the same request ID. Use Retry to recover it; a fresh room is never opened automatically.' : ''}`,'error');
  } finally {working=false;controls();}
}
$('signin').addEventListener('click', () => {
  if (working || !activeMode) return;
  try {
    if (!client) connect();
    // Invoke synchronously from the click to allow the Google popup.
    const signing = beginSignIn(cloudDefaults.admin,payload=>client.call('exchangeLogin',payload,{anonymous:true}),mode);
    void run(async()=>{show('Complete Google sign-in, then return here…');await signing;await verifyOwner();show('TEST owner and fictional roster verified. Existing test registration preserved.','success');});
  } catch(error) {show(safeMessage(error),'error');}
});
$('verify').addEventListener('click',()=>void run(async()=>{
  await verifyOwner(); const status=await client.call('bonusStatus');checkMetadata(status);
  show(`TEST spreadsheet verified. ${status.room ? `Existing ${status.room.open?'open':'closed'} test room has ${status.room.entrants.length} entries and was preserved.` : 'There is no current test registration.'}`,'success');
}));
$('start').addEventListener('click',()=>void run(async()=>{
  await verifyOwner();
  const status=await client.call('bonusStatus');checkMetadata(status);
  const count=Number($('count').value);if (![20,25].includes(count)) throw Error('Choose 20 or 25 students.');
  const scenario=$('scenario').value; if (!['warm','cold'].includes(scenario)) throw Error('Choose a supported scenario.');
  pending={kind:'start',stage:'reset',runId:crypto.randomUUID(),count,scenario,duplicates:$('duplicates').checked,
    oldRoomId:status.room?.id??null,resetRequestId:crypto.randomUUID(),openRequestId:crypto.randomUUID()};
  if (pending.oldRoomId && !uuid(pending.oldRoomId)) {pending=null;throw Error('Invalid TEST room ID.');}
  savePending();await continueStart();
}));
$('recover').addEventListener('click',()=>void run(async()=>{
  await verifyOwner();if (!pending) return;
  if (pending.kind==='start') await continueStart();else await closePending();
}));
$('download').addEventListener('click',()=>{
  if (!report) return;
  const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`ierg2060-test-load-${report.runId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('pagehide',()=>{client?.destroy();destroyFrames();});
if (!activeMode) {
  show('Stopped. This dashboard works only at load-test.html?mode=test. No Google client was created.','error');controls();
} else {
  loadPending();controls();
  if (pending) show('A previous TEST operation is pending. Sign in or verify, then explicitly retry its same request.');
  else if (readSession(mode)) void run(async()=>{await verifyOwner();show('TEST owner and fictional roster verified. Existing test registration preserved.','success');});
  else show('Sign in with Google to verify the isolated test spreadsheet.');
}
