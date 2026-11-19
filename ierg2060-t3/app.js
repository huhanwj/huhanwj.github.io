import {validateState, round2Presented, lotteryPool, pick, validDate} from './core.js?v=11';
import {createCloudClient} from './cloud.js?v=10';
import {readSession, beginSignIn, cancelSignIn, clearSession} from './auth.js?v=2';
import {cloudDefaults, testMode, browserStateKey} from './cloud-config.js?v=8';

// Round 2 is voluntary Bonus: volunteers sign up by SID, the server draws one
// (preferring students who have not presented in round 2), and a lottery among
// those students covers questions nobody volunteers for. No attendance is taken.
const [PENDING,CURRENT,TIMER,MINUTES,CLASS_DATE,DISMISSED,TAB_LOCK]=['ierg2060-t3-r2-pending','ierg2060-t3-r2-current','ierg2060-t3-r2-timer','ierg2060-t3-minutes','ierg2060-t3-class-date','ierg2060-t3-r2-dismissed','ierg2060-t3-v1'].map(browserStateKey);
const $=id=>document.getElementById(id);
$('test-banner').hidden=!testMode;
$('environment-status').textContent=testMode?'Test mode · Google Sheets test dataset · 35 fictional students':'Live mode · class Google Sheets';
$('mode-switch').textContent=testMode?'Switch to Live':'Switch to Test';
if(testMode)document.title='TEST · IERG2060 · Tutorial 3';

let cloud=null,connected=false,connecting=false,signingIn=false,busy=false,writable=false,revealing=false;
let state=null,revision=-1,room=null,pending=null,current=null,preview=null,timer=null,questionText=null,pollTimer=null,polling=false,tickTimer=null,recordsWarning='';
let sessionDate=today(),dismissed=null,shownCard='';

function today(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(key=>parts.find(p=>p.type===key).value).join('-');}
function load(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function store(key,value){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));}catch{/* The server keeps every confirmed record. */}}
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);$('notice').hidden=!text;if($('settings-dialog').open)$('settings-status').textContent=text;}
function handle(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){notice(error.message,true);}finally{render();}};}
async function exclusive(fn){if(busy)return;busy=true;render();try{return await fn();}finally{busy=false;render();}}
function studentName(no){return state?.students.find(p=>p.no===no)?.name||'';}
function round2Records(){return (state?.bonus||[]).filter(b=>b.stage===2);}
function currentRecord(){return current&&state?.bonus.find(b=>b.round===current.round);}
function nextQuestion(){return Math.max(1,...round2Records().filter(b=>b.date===sessionDate).map(b=>b.question+1));}
function questionNumber(){const n=Number($('question').value);if(!Number.isSafeInteger(n)||n<1||n>500)throw Error('Choose a question number from 1 to 500.');return n;}
function classDate(){if(!validDate(sessionDate))throw Error('Choose a valid class date.');return sessionDate;}

function applyResult(result){
  if(result.state&&Number.isSafeInteger(result.revision)&&result.revision>=revision){state=validateState(result.state);revision=result.revision;}
  if(Object.hasOwn(result,'room'))room=result.room;
  if(result.state)recordsWarning=result.sourceWarning||'';
  $('cloud-status').textContent=recordsWarning||'Saved in Google Sheets.';
  if(recordsWarning)notice(recordsWarning,true);
}
function expireSession(error){
  if(error.serverConfirmed&&/Your sign-in session expired/.test(error.message)){clearSession();connected=false;$('cloud-account').textContent='Sign in again to continue.';}
}
async function call(action,payload={}){
  if(!cloud||!connected)throw Error('Sign in with Google to continue.');
  try{return await cloud.call(action,payload);}catch(error){expireSession(error);throw error;}
}

// Every change carries a requestId and is retried with the exact same payload
// until the server confirms or rejects it, so a lost reply never draws twice.
async function mutate(action,payload){
  if(pending)throw Error('Retry the unconfirmed request first.');
  pending={action,payload:{...payload,requestId:crypto.randomUUID()}};store(PENDING,pending);
  return flush();
}
async function flush(){
  if(!pending)return null;
  const operation=pending;let result;
  try{result=await call(operation.action,operation.payload);}
  catch(error){
    const retryable=!error.serverConfirmed||/sign-in session expired|busy|Retry the same/i.test(error.message);
    if(!retryable){pending=null;store(PENDING,null);}
    throw error;
  }
  pending=null;store(PENDING,null);applyResult(result);
  if(operation.action==='bonusDraw'&&result.room?.winner)setCurrent(result.room.id);
  if(operation.action==='round2Lottery'){
    const {no,question,date}=operation.payload,record=round2Records().filter(b=>b.source==='lottery'&&b.no===no&&b.question===question&&b.date===date).at(-1);
    preview=null;if(record)setCurrent(record.round);
  }
  return result;
}
function setCurrent(round){current={round};store(CURRENT,current);questionText=null;}

function phase(){
  if(!state)return 'none';
  if(preview||currentRecord())return 'result';
  if(room?.open)return 'open';
  // An empty closed sign-up is dismissed once the lottery covers its question.
  if(room&&!room.winner&&(room.entrants.length||room.id!==dismissed))return 'closed';
  return 'idle';
}

// ---- Polling: lock-free journal reads while sign-up is open ----
function schedulePoll(){
  if(!(connected&&room?.open&&!document.hidden)){clearTimeout(pollTimer);pollTimer=null;return;}
  if(!pollTimer)pollTimer=setTimeout(()=>{pollTimer=null;poll();},2000);
}
async function poll(){
  if(polling||!connected||!room?.open||pending)return schedulePoll();
  polling=true;
  try{
    const {live}=await call('bonusLive');
    if(live&&live.id===room?.id&&live.open===room.open)room={...room,entrants:live.entrants};
    else applyResult(await call('bonusStatus'));
  }catch{/* The next poll retries; registrations are stored on the server. */}
  finally{polling=false;render();schedulePoll();}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});

// ---- Rendering ----
function renderQr(){
  const url=new URL('join.html',new URL('./',location.href));
  if(testMode)url.searchParams.set('mode','test');
  url.hash=new URLSearchParams({room:room.id}).toString();
  if($('signup-link').href===url.href)return;
  $('signup-link').href=url.href;
  if(typeof globalThis.qrcode==='function'){const qr=globalThis.qrcode(0,'M');qr.addData(url.href);qr.make();$('signup-qr').innerHTML=qr.createSvgTag({scalable:true,margin:4});}
  else $('signup-qr').textContent='QR code unavailable. Open the sign-up link.';
}
function renderVolunteers(show){
  $('volunteers').hidden=!show;
  if(!show)return;
  const presented=round2Presented(state);
  $('volunteer-list').replaceChildren(...[...room.entrants].sort((a,b)=>a-b).map(no=>{
    const item=document.createElement('li'),label=document.createElement('span'),tag=document.createElement('small'),remove=document.createElement('button');
    label.textContent=`No. ${no} ${studentName(no)}`;
    item.className=presented.has(no)?'repeat':'fresh';
    tag.textContent=presented.has(no)?'presented before':'first time';
    remove.type='button';remove.className='remove';remove.textContent='×';remove.setAttribute('aria-label',`Remove No. ${no}`);
    remove.disabled=busy||!!pending;remove.onclick=handle(()=>exclusive(()=>mutate('bonusRemove',{room:room.id,no})));
    item.append(label,tag,remove);return item;
  }));
  $('manual-no').disabled=$('manual-form').querySelector('button').disabled=busy||!!pending;
}
function renderCard(no,label){
  // Rebuild only when the card changes, so re-renders do not replay the reveal.
  const key=`${revealing}|${no}|${label}`;if(key===shownCard)return;shownCard=key;
  const results=$('results');results.replaceChildren();
  if(revealing){const card=document.createElement('div');card.className='card-back shuffling';card.setAttribute('aria-hidden','true');const emblem=document.createElement('span');emblem.textContent='?';card.append(emblem);results.append(card);return;}
  const list=document.createElement('ol'),item=document.createElement('li'),q=document.createElement('span'),n=document.createElement('strong'),name=document.createElement('span');
  list.className='draw-results single-result';q.className='result-q';q.textContent=label;n.className='result-no';n.textContent=String(no).padStart(2,'0');name.className='result-name';name.textContent=studentName(no);
  item.append(q,n,name);list.append(item);results.append(list);
}
function timerTick(){
  const active=timer&&timer.round===current?.round?timer:null;
  const minutes=Number($('answer-minutes').value)||0;
  const remaining=active?.deadline?Math.max(0,Math.ceil((active.deadline-Date.now())/1000)):minutes*60;
  $('answer-clock').textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
  const expired=!!active?.deadline&&remaining===0;
  $('answer-clock').classList.toggle('expired',expired);
  $('timer-status').textContent=active?.deadline?(expired?'Time is up.':'Answer in progress.'):'Ready to start.';
  if(!active?.deadline||expired){clearInterval(tickTimer);tickTimer=null;}
}
function render(){
  schedulePoll();
  const p=phase(),locked=busy||connecting||revealing||!!pending||!connected;
  $('connection-panel').hidden=connected&&!!state;
  $('connect-main').disabled=busy||connecting||!writable;
  $('connect-main').textContent=signingIn?'Waiting for Google…':connecting?'Connecting…':readSession()?'Reconnect':'Sign in with Google';
  $('sign-in-cancel').hidden=!signingIn;
  $('connection-status').textContent=signingIn?'Complete sign-in in the Google window and click Continue. This page connects automatically.':connecting?'Loading class records…':'Sign in to load this class.';
  $('cloud-form').querySelector('button').disabled=busy||connecting||!writable;
  $('cloud-refresh').hidden=$('records-refresh').hidden=!connected;
  $('cloud-refresh').disabled=$('records-refresh').disabled=locked;
  $('backup').disabled=!state;
  $('draw-table').hidden=!state;
  for(const name of ['idle','open','closed','result'])$(`phase-${name}`).hidden=p!==name;
  if(!state)return;

  const presented=round2Presented(state),remaining=state.students.length-presented.size;
  $('r2-progress').textContent=`${remaining} of ${state.students.length} have not presented in round 2`;
  const record=currentRecord();
  $('question').value=record?record.question:preview?preview.question:(questionText??nextQuestion());
  $('session-date').value=sessionDate;
  $('question').disabled=$('session-date').disabled=locked||p==='result'||p==='open';
  $('deck-caption').textContent=p==='open'?'Sign-up open':p==='closed'?'Sign-up closed':p==='result'?(preview?'Lottery preview · not saved yet':'Saved'):'';

  $('open-signup').disabled=$('lottery-start').disabled=locked;
  if(p==='open'){renderQr();$('signup-count').textContent=String(room.entrants.length);}
  $('close-draw').disabled=$('cancel-signup').disabled=locked;
  if(p==='closed'){
    const count=room.entrants.length;
    $('closed-lead').textContent=count?`Sign-up closed with ${count} volunteer${count===1?'':'s'}.`:'Nobody volunteered for this question. Run the lottery among students who have not presented in round 2.';
    $('draw-volunteer').hidden=!count;$('lottery-fallback').hidden=!!count;
    $('draw-volunteer').disabled=$('lottery-fallback').disabled=$('reopen-signup').disabled=locked;
  }
  renderVolunteers((p==='open'||p==='closed')&&!!room);

  if(p==='result'){
    $('lottery-actions').hidden=!preview;$('answer-panel').hidden=!!preview;
    $('lottery-confirm').disabled=$('lottery-skip').disabled=$('lottery-cancel').disabled=locked;
    if(preview){
      renderCard(preview.no,`QUESTION ${preview.question} · LOTTERY`);
      $('result-detail').textContent=revealing?'':`${presented.has(preview.no)?'Has presented in round 2 before.':'First round 2 presentation.'} Confirm if the student is here${preview.skipped.length?` · skipped: ${preview.skipped.map(no=>`No. ${no}`).join(', ')}`:''}.`;
    }else{
      const index=state.bonus.indexOf(record),before=state.bonus.slice(0,index).some(b=>b.stage===2&&b.no===record.no)||state.r2Source.includes(record.no);
      renderCard(record.no,`QUESTION ${record.question} · ${record.source==='volunteer'?'VOLUNTEER':'LOTTERY'}`);
      $('result-detail').textContent=record.source==='volunteer'?`Drawn from ${record.entrants.length} volunteer${record.entrants.length===1?'':'s'} · ${before?'had presented in round 2 before':'first round 2 presentation'}.`:`Lottery · ${before?'had presented in round 2 before':'first round 2 presentation'}.`;
      const active=timer?.round===record.round?timer:null;
      $('answer-minutes').disabled=!!active?.deadline;
      $('timer-start').disabled=!!active?.deadline;$('timer-start').textContent=active?.deadline?'Started':'Start';
      $('next-question').disabled=locked;
      timerTick();
    }
  }
  $('pending-panel').hidden=!pending||busy;
  $('pending-text').textContent=pending?`Not confirmed by Google yet (${pending.action}).`:'';
  $('pending-retry').disabled=busy||!connected;

  const todays=round2Records().filter(b=>b.date===sessionDate);
  $('today-list').replaceChildren(...todays.map(b=>{const li=document.createElement('li');li.textContent=`Q${b.question} · No. ${b.no} ${studentName(b.no)} · ${b.source==='volunteer'?`volunteer (${b.entrants.length} signed up)`:'lottery'}`;return li;}));
  if(!todays.length){const li=document.createElement('li');li.textContent=`No round 2 records on ${sessionDate}.`;$('today-list').append(li);}
  const waiting=state.students.filter(s=>!presented.has(s.no)).map(s=>s.no);
  $('not-presented').textContent=waiting.length?`Not yet presented: ${waiting.join(', ')}`:'Everyone has presented in round 2.';
}

// ---- Actions ----
async function openSignup(){
  // Undrawn volunteers from an earlier sign-up are discarded for the new question.
  if(room&&!room.open&&!room.winner&&room.entrants.length)await mutate('bonusReset',{room:room.id});
  await mutate('bonusOpen',{absent:[]});notice('');
}
$('open-signup').onclick=handle(()=>exclusive(openSignup));
$('reopen-signup').onclick=$('open-signup').onclick;
async function closeAndDraw(){
  if(room?.open)await mutate('bonusClose',{room:room.id});
  if(room&&!room.open&&!room.winner&&room.entrants.length)await mutate('bonusDraw',{room:room.id,question:questionNumber(),date:classDate()});
}
$('close-draw').onclick=handle(()=>exclusive(closeAndDraw));
$('draw-volunteer').onclick=handle(()=>exclusive(closeAndDraw));
$('cancel-signup').onclick=handle(()=>exclusive(async()=>{
  if(!confirm('Cancel this sign-up? Registered volunteers are discarded.'))return;
  if(room?.open)await mutate('bonusClose',{room:room.id});
  if(room&&!room.winner)await mutate('bonusReset',{room:room.id});
}));
$('manual-form').onsubmit=handle(()=>exclusive(async()=>{
  const raw=$('manual-no').value.trim(),no=Number(raw);
  if(!/^\d+$/.test(raw)||!state.students.some(p=>p.no===no))throw Error('Enter a roster No. from this class.');
  await mutate('bonusAdd',{room:room.id,no});$('manual-no').value='';notice('');
}));
async function reveal(){
  revealing=true;render();
  try{if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,1100));}
  finally{revealing=false;}
  if(preview)$('announcement').textContent=`Question ${preview.question}: No. ${preview.no} ${studentName(preview.no)}`;
}
async function startLottery(){
  const question=questionNumber();classDate();
  if(room&&!room.open&&!room.winner&&!room.entrants.length){dismissed=room.id;store(DISMISSED,dismissed);}
  const pool=lotteryPool(state);
  if(!pool.length)throw Error('No students are available for the lottery.');
  preview={no:pick(pool),question,skipped:[]};notice('');
  // Re-read the answer sheet during the reveal, so marks entered since sign-in count.
  const [fresh]=await Promise.all([call('recordsRefresh').catch(()=>null),reveal()]);
  if(fresh){applyResult(fresh);if(recordsWarning)notice(recordsWarning,true);}
  if(preview&&round2Presented(state).has(preview.no)&&lotteryPool(state).length){preview={...preview,no:pick(lotteryPool(state))};shownCard='';}
}
$('lottery-start').onclick=handle(()=>exclusive(startLottery));
$('lottery-fallback').onclick=$('lottery-start').onclick;
$('lottery-skip').onclick=handle(()=>exclusive(async()=>{
  if(!preview)return;
  const skipped=[...preview.skipped,preview.no],pool=lotteryPool(state,skipped);
  if(!pool.length)throw Error('Everyone else has been skipped for this question.');
  preview={...preview,no:pick(pool),skipped};await reveal();
}));
$('lottery-cancel').onclick=handle(()=>{preview=null;notice('');});
$('lottery-confirm').onclick=handle(()=>exclusive(async()=>{
  if(!preview)return;
  await mutate('round2Lottery',{no:preview.no,question:preview.question,date:classDate(),skipped:preview.skipped});
}));
$('timer-start').onclick=handle(()=>{
  const minutes=Number($('answer-minutes').value);
  if(!Number.isInteger(minutes)||minutes<1||minutes>180)throw Error('Enter a whole number of minutes from 1 to 180.');
  if(!current)return;
  timer={round:current.round,minutes,deadline:Date.now()+minutes*60000};store(TIMER,timer);store(MINUTES,minutes);
  clearInterval(tickTimer);tickTimer=setInterval(timerTick,250);
});
$('next-question').onclick=handle(()=>{current=null;timer=null;store(CURRENT,null);store(TIMER,null);questionText=null;notice('');});
$('answer-minutes').oninput=timerTick;
$('question').oninput=()=>{questionText=$('question').value;};
$('session-date').onchange=handle(()=>{
  const date=$('session-date').value;if(!validDate(date))throw Error('Choose a valid class date.');
  sessionDate=date;store(CLASS_DATE,date);questionText=null;
});
$('pending-retry').onclick=handle(()=>exclusive(async()=>{await flush();if(room?.open===false&&!room.winner&&!pending)await call('bonusStatus').then(applyResult);}));
$('records-refresh').onclick=handle(()=>exclusive(async()=>{applyResult(await call('recordsRefresh'));notice(recordsWarning||'Answer sheet re-read.');}));
$('cloud-refresh').onclick=handle(()=>exclusive(async()=>{applyResult(await call('load'));applyResult(await call('bonusStatus'));notice('');}));
$('backup').onclick=handle(()=>{
  if(!state)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=`IERG2060-T3-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('settings-open').onclick=()=>{$('settings-status').textContent='';$('settings-dialog').showModal();};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
$('mode-switch').onclick=handle(()=>{
  if(busy||connecting||pending||preview)throw Error('Finish or confirm the current request before switching modes.');
  const url=new URL(location.href);
  if(testMode)url.searchParams.delete('mode');else url.searchParams.set('mode','test');
  location.assign(url.href);
});

// ---- Connection ----
async function connectOwner(signIn=false){
  if(connecting)return;
  connecting=true;connected=false;cloud?.destroy();cloud=null;render();
  let proposed;
  try{
    proposed=createCloudClient(cloudDefaults.student,{testMode,getSessionToken:()=>readSession()?.token??null});
    if(signIn){
      signingIn=true;render();
      // Open synchronously in the button click, before the bridge is awaited.
      await beginSignIn(cloudDefaults.admin,payload=>proposed.call('exchangeLogin',payload,{anonymous:true}));
      signingIn=false;
    }
    if(!readSession())throw Error('Sign in with Google to load this class.');
    const account=await proposed.call('auth');
    if(testMode&&account.environment!=='test')throw Error('The Google connection did not confirm the test dataset.');
    const loaded=await proposed.call('load');
    if(testMode&&(loaded.environment!=='test'||loaded.state?.students?.length!==35))throw Error('The Google test dataset must contain 35 fictional students.');
    if(!loaded.state)throw Error('Cloud progress is not initialized. Run setup in Apps Script first.');
    cloud=proposed;connected=true;
    $('cloud-account').textContent=`Google account: ${account.email}`;
    applyResult(loaded);
    if(pending){try{await flush();}catch(error){notice(`Saved request still unconfirmed: ${error.message}`,true);}}
    applyResult(await call('bonusStatus'));
    if(current&&!currentRecord()){current=null;store(CURRENT,null);}
    if(timer?.deadline&&timer.round===current?.round){clearInterval(tickTimer);tickTimer=setInterval(timerTick,250);}
  }catch(error){proposed?.destroy();cloud=null;connected=false;expireSession(error);throw error;}
  finally{signingIn=false;connecting=false;render();schedulePoll();}
}
const connectFromButton=handle(()=>exclusive(()=>connectOwner(!readSession())));
$('cloud-form').onsubmit=connectFromButton;
$('connect-main').onclick=connectFromButton;
$('sign-in-cancel').onclick=()=>cancelSignIn();

async function activate(){
  writable=true;
  const date=load(CLASS_DATE);if(validDate(date))sessionDate=date;
  const minutes=Number(load(MINUTES));if(Number.isInteger(minutes)&&minutes>=1&&minutes<=180)$('answer-minutes').value=minutes;
  const saved=load(PENDING);if(saved&&typeof saved.action==='string'&&saved.payload&&typeof saved.payload.requestId==='string')pending=saved;
  const savedDismissed=load(DISMISSED);if(typeof savedDismissed==='string')dismissed=savedDismissed;
  const savedCurrent=load(CURRENT);if(typeof savedCurrent?.round==='string')current=savedCurrent;
  const savedTimer=load(TIMER);if(typeof savedTimer?.round==='string'&&Number.isFinite(savedTimer.deadline))timer=savedTimer;
  if(testMode&&!cloudDefaults.student)throw Error('The separate Google test connection is not deployed yet.');
  if(readSession())await connectOwner();
  else notice('Sign in with Google to load this class.');
}
render();
if(navigator.locks)navigator.locks.request(TAB_LOCK,{ifAvailable:true},async lock=>{
  if(!lock){notice('Close the other draw page, then reload this one.',true);return;}
  try{await activate();}catch(error){notice(`Could not connect: ${error.message}`,true);render();}
  await new Promise(()=>{});
}).catch(error=>notice(error.message,true));
else notice('Use a current browser to run the draw.',true);
window.addEventListener('beforeunload',event=>{if(pending||preview){event.preventDefault();event.returnValue='';}});
window.addEventListener('pageshow',timerTick);
