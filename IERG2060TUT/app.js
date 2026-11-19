import {validateState, round2Presented, lotteryPool, pick, validDate} from './core.js?v=11';
import {createCloudClient} from './cloud.js?v=11';
import {readSession, beginSignIn, cancelSignIn, clearSession, saveSession, renderGoogleButton} from './auth.js?v=3';
import {cloudDefaults, groupId, groupChoices, groupChosen, googleClientId, testMode, browserStateKey, pageQuery} from './cloud-config.js?v=11';

// Round 2 is voluntary Bonus: volunteers sign up by SID, the server draws one
// (preferring students who have not presented in round 2), and a lottery among
// those students covers questions nobody volunteers for. No attendance is taken.
const [PENDING,CURRENT,CLASS_DATE,DISMISSED,QUESTION_SET,TAB_LOCK]=['ierg2060-t3-r2-pending','ierg2060-t3-r2-current','ierg2060-t3-class-date','ierg2060-t3-r2-dismissed','ierg2060-question-set','ierg2060-t3-v1'].map(browserStateKey);
const $=id=>document.getElementById(id);
$('test-badge').hidden=!testMode;
$('mode-switch').textContent=testMode?'Switch to Live':'Switch to Test';
// The group's label comes from the backend after sign-in.
function showGroup(label){
  $('brand-group').textContent=label;
  document.title=`${testMode?'TEST · ':''}IERG2060 · ${label}`;
  $('environment-status').textContent=`${label} · ${testMode?'Test dataset · 35 fictional students':'Live class data'}`;
}
showGroup(groupChoices.find(choice=>choice.id===groupId)?.label||groupId);

let cloud=null,connected=false,connecting=false,signingIn=false,busy=false,writable=false,revealing=false;
let state=null,revision=-1,room=null,pending=null,current=null,preview=null,questionText=null,pollTimer=null,polling=false,recordsWarning='';
let sessionDate=today(),dismissed=null,shownCard='',questionSets=[],questionSet='';

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
  if(error.serverConfirmed&&/Your sign-in session expired/.test(error.message)){
    clearSession();connected=false;$('cloud-account').textContent='Sign in again to continue.';
    if(googleClientId)renderGoogleButton($('google-button'),googleClientId,googleCredential).catch(()=>{});
  }
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
  if(['bonusDraw','bonusRedraw'].includes(operation.action)&&result.room?.winner)setCurrent(result.room.winner.round||result.room.id);
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

// ---- Question sets: one cropped image per question, from questions/ ----
async function loadQuestionSets(){
  try{
    const response=await fetch('questions/index.json',{cache:'no-cache'});
    if(!response.ok)return;
    const sets=await response.json();
    questionSets=Array.isArray(sets)?sets.filter(s=>typeof s?.id==='string'&&typeof s.title==='string'&&Array.isArray(s.questions)):[];
  }catch{questionSets=[];}
  $('question-set').replaceChildren(new Option('None',''),...questionSets.map(s=>new Option(s.title,s.id)));
  const saved=load(QUESTION_SET);
  questionSet=questionSets.some(s=>s.id===saved)?saved:'';
  $('question-set').value=questionSet;
  render();
}
function questionImage(number){
  const entry=questionSets.find(s=>s.id===questionSet)?.questions.find(q=>q.number===number);
  return entry&&/^[\w-]+\/[\w-]+\.png$/.test(entry.image)?`questions/${entry.image}`:null;
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
  url.search=pageQuery().toString();
  url.hash=new URLSearchParams({room:room.id}).toString();
  if($('signup-link').href===url.href)return;
  $('signup-link').href=url.href;
  if(typeof globalThis.qrcode==='function'){const qr=globalThis.qrcode(0,'M');qr.addData(url.href);qr.make();$('signup-qr').innerHTML=qr.createSvgTag({scalable:true,margin:2});}
  else $('signup-qr').textContent='QR code unavailable. Open the sign-up link.';
}
function renderVolunteers(show){
  $('volunteers').hidden=!show;
  if(!show)return;
  const presented=round2Presented(state),drawn=room.drawn||[];
  $('volunteer-list').replaceChildren(...[...room.entrants].sort((a,b)=>a-b).map(no=>{
    const item=document.createElement('li'),label=document.createElement('span'),remove=document.createElement('button');
    label.textContent=`${no} · ${studentName(no)}${drawn.includes(no)?' (drawn)':''}`;
    item.className=presented.has(no)?'repeat':'fresh';
    item.title=presented.has(no)?'Presented in round 2 before':'First round 2 presentation';
    remove.type='button';remove.className='remove';remove.textContent='×';remove.setAttribute('aria-label',`Remove No. ${no}`);
    remove.disabled=busy||!!pending;remove.hidden=!!room.winner;remove.onclick=handle(()=>exclusive(()=>mutate('bonusRemove',{room:room.id,no})));
    item.append(label,remove);return item;
  }));
  $('manual-form').hidden=!!room.winner;
  $('manual-no').disabled=$('manual-form').querySelector('button').disabled=busy||!!pending;
}
function renderCard(no,label){
  // Rebuild only when the card changes, so re-renders do not replay the reveal.
  const key=`${revealing}|${no}|${label}`;if(key===shownCard)return;shownCard=key;
  const results=$('results');results.replaceChildren();
  if(revealing){const back=document.createElement('div');back.className='card-back shuffling';back.setAttribute('aria-hidden','true');back.textContent='?';results.append(back);return;}
  const face=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');
  face.className='card-face';small.textContent=label;strong.textContent=String(no).padStart(2,'0');
  face.append(small,strong);results.append(face);
}
function renderQuestion(p,number){
  const src=p==='none'||p==='closed'?null:questionImage(number);
  $('question-figure').hidden=!src;
  // The one figure moves into the current phase's slot.
  const slot=document.querySelector(`#phase-${p} .question-slot`);
  if(src&&slot&&$('question-figure').parentElement!==slot)slot.append($('question-figure'));
  document.querySelector('.presenter').classList.toggle('has-question',!!src&&p==='result');
  if(!src)return;
  $('question-caption').textContent=`${questionSets.find(s=>s.id===questionSet).title} · Question ${number}`;
  if($('question-image').getAttribute('src')!==src){$('question-image').src=src;$('question-image').alt=`Question ${number}`;}
}
function render(){
  if(!groupChosen)return;
  schedulePoll();
  const p=phase(),locked=busy||connecting||revealing||!!pending||!connected;
  document.body.classList.toggle('wide',p==='open'||p==='result');
  $('connection-panel').hidden=connected&&!!state;
  // With a configured client ID everyone uses Google's button; otherwise the
  // owner-only sign-in window remains.
  $('connect-main').hidden=!!googleClientId&&!readSession();
  $('google-button').hidden=!googleClientId||!!readSession()||connecting;
  $('connect-main').disabled=busy||connecting||!writable;
  $('connect-main').textContent=signingIn?'Waiting for Google…':connecting?'Connecting…':readSession()?'Reconnect':'Sign in with Google';
  $('sign-in-cancel').hidden=!signingIn;
  $('connection-status').textContent=signingIn?'Complete sign-in in the Google window and click Continue. This page connects automatically.':connecting?'Loading class records…':'Sign in to load this class.';
  $('cloud-form').querySelector('button').disabled=busy||connecting||!writable;
  $('cloud-refresh').hidden=$('records-refresh').hidden=!connected;
  $('cloud-refresh').disabled=$('records-refresh').disabled=locked;
  $('backup').disabled=!state;
  $('stage').hidden=!state;
  for(const name of ['idle','open','closed','result'])$(`phase-${name}`).hidden=p!==name;
  if(!state)return;

  const presented=round2Presented(state),remaining=state.students.length-presented.size;
  $('r2-progress').textContent=`${remaining} / ${state.students.length} not yet presented`;
  const record=currentRecord();
  $('question').value=record?record.question:preview?preview.question:(questionText??nextQuestion());
  const number=Number($('question').value);
  document.querySelectorAll('.question-ref').forEach(span=>{span.textContent=`Question ${number}`;});
  $('session-date').value=sessionDate;
  $('question').disabled=$('session-date').disabled=locked||p==='result'||p==='open';
  $('question-set').disabled=revealing;
  renderQuestion(p,number);

  $('open-signup').disabled=$('lottery-start').disabled=locked;
  if(p==='open'){renderQr();$('signup-count').textContent=String(room.entrants.length);}
  $('close-draw').disabled=$('cancel-signup').disabled=locked;
  if(p==='closed'){
    const count=room.entrants.length;
    $('closed-lead').textContent=count?`${count} volunteer${count===1?'':'s'} signed up.`:'Nobody volunteered. Run the lottery among students who have not presented.';
    $('draw-volunteer').hidden=!count;$('lottery-fallback').hidden=!!count;
    $('draw-volunteer').disabled=$('lottery-fallback').disabled=$('reopen-signup').disabled=locked;
  }
  // Volunteers stay visible after a draw, so the class sees who signed up.
  const roomShown=room&&(p==='open'||p==='closed'||(p==='result'&&record?.source==='volunteer'&&record.round.startsWith(room.id)));
  renderVolunteers(!!roomShown);

  if(p==='result'){
    $('lottery-actions').hidden=!preview;$('result-actions').hidden=!!preview;
    $('lottery-confirm').disabled=$('lottery-skip').disabled=$('lottery-cancel').disabled=locked;
    const no=preview?preview.no:record.no;
    $('result-name').textContent=revealing?'Drawing…':studentName(no);
    if(preview){
      renderCard(no,'LOTTERY');
      $('result-source').textContent=`Question ${preview.question} · Lottery preview`;
      $('result-detail').textContent=revealing?'':`${presented.has(no)?'Has presented in round 2 before.':'First round 2 presentation.'} Confirm if the student is here.${preview.skipped.length?` Skipped: ${preview.skipped.join(', ')}.`:''}`;
    }else{
      const index=state.bonus.indexOf(record),before=state.bonus.slice(0,index).some(b=>b.stage===2&&b.no===no)||state.r2Source.includes(no);
      renderCard(no,record.source==='volunteer'?'VOLUNTEER':'LOTTERY');
      $('result-source').textContent=`Question ${record.question} · ${record.source==='volunteer'?`Volunteer · drawn from ${record.entrants.length}`:'Lottery'}`;
      $('result-detail').textContent=before?'Has presented in round 2 before.':'First round 2 presentation.';
      const left=room&&record.source==='volunteer'&&record.round.startsWith(room.id)?room.entrants.filter(n=>!(room.drawn||[room.winner?.no]).includes(n)).length:0;
      $('redraw-volunteer').hidden=!left;
      $('redraw-volunteer').textContent=`Another volunteer (${left} left)`;
      $('next-question').disabled=$('redraw-volunteer').disabled=$('redo-lottery').disabled=locked;
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
async function startLottery(question=questionNumber()){
  classDate();
  if(room&&!room.open&&!room.winner&&!room.entrants.length){dismissed=room.id;store(DISMISSED,dismissed);}
  const pool=lotteryPool(state);
  if(!pool.length)throw Error('No students are available for the lottery.');
  preview={no:pick(pool),question,skipped:[]};notice('');
  // Re-read the answer sheet during the reveal, so marks entered since sign-in count.
  const [fresh]=await Promise.all([call('recordsRefresh').catch(()=>null),reveal()]);
  if(fresh){applyResult(fresh);if(recordsWarning)notice(recordsWarning,true);}
  if(preview&&round2Presented(state).has(preview.no)&&lotteryPool(state).length){preview={...preview,no:pick(lotteryPool(state))};shownCard='';}
}
$('lottery-start').onclick=handle(()=>exclusive(()=>startLottery()));
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
// The same question can go to another student: another volunteer from the
// same sign-up, or a lottery. Both keep the first student's record.
$('redraw-volunteer').onclick=handle(()=>exclusive(async()=>{
  const record=currentRecord();if(!record||!room)return;
  await mutate('bonusRedraw',{room:room.id,question:record.question,date:record.date});
}));
$('redo-lottery').onclick=handle(()=>exclusive(async()=>{
  const record=currentRecord();if(!record)return;
  current=null;store(CURRENT,null);
  await startLottery(record.question);
}));
$('next-question').onclick=handle(()=>{current=null;store(CURRENT,null);questionText=null;notice('');});
$('question').oninput=()=>{questionText=$('question').value;render();};
$('question-set').onchange=()=>{questionSet=$('question-set').value;store(QUESTION_SET,questionSet||null);render();};
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
  a.href=url;a.download=`IERG2060-${groupId}-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
function bridge(){return createCloudClient(cloudDefaults.student,{testMode,group:groupId,getSessionToken:()=>readSession()?.token??null});}
// A TA who opens another group's address moves to their own group.
function ensureAllowedGroup(session){
  if(!session?.groups||testMode||session.groups.some(g=>g.id===groupId))return true;
  if(!session.groups.length)return true;
  const url=new URL(location.href);url.search=pageQuery(session.groups[0].id).toString();location.replace(url.href);
  return false;
}
function renderGroupSwitch(session){
  const options=session?.groups||[];
  $('group-switch').hidden=testMode||options.length<2;
  document.querySelector('.brand').classList.toggle('switchable',!$('group-switch').hidden);
  $('group-switch').replaceChildren(...options.map(g=>new Option(g.label,g.id)));
  $('group-switch').value=groupId;
  const own=options.find(g=>g.id===groupId);if(own)showGroup(own.label);
}
$('group-switch').onchange=()=>{
  if(pending||preview||busy){$('group-switch').value=groupId;notice('Finish or confirm the current request before switching groups.',true);return;}
  const url=new URL(location.href);url.search=pageQuery($('group-switch').value).toString();location.assign(url.href);
};
async function googleCredential(credential){
  if(connecting)return;
  connecting=true;render();
  let client;
  try{
    client=bridge();
    const session=saveSession(await client.call('googleLogin',{credential},{anonymous:true}));
    if(!ensureAllowedGroup(session))return;
  }catch(error){notice(error.message,true);return;}
  finally{client?.destroy();connecting=false;render();}
  await exclusive(()=>connectOwner()).catch(error=>notice(`Could not connect: ${error.message}`,true));
}
async function connectOwner(signIn=false){
  if(connecting)return;
  connecting=true;connected=false;cloud?.destroy();cloud=null;render();
  let proposed;
  try{
    proposed=bridge();
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
    renderGroupSwitch({groups:account.groups});
    applyResult(loaded);
    if(pending){try{await flush();}catch(error){notice(`Saved request still unconfirmed: ${error.message}`,true);}}
    applyResult(await call('bonusStatus'));
    if(current&&!currentRecord()){current=null;store(CURRENT,null);}
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
  const saved=load(PENDING);if(saved&&typeof saved.action==='string'&&saved.payload&&typeof saved.payload.requestId==='string')pending=saved;
  const savedDismissed=load(DISMISSED);if(typeof savedDismissed==='string')dismissed=savedDismissed;
  const savedCurrent=load(CURRENT);if(typeof savedCurrent?.round==='string')current=savedCurrent;
  const session=readSession();
  if(session&&!ensureAllowedGroup(session))return;
  if(googleClientId&&!session)renderGoogleButton($('google-button'),googleClientId,googleCredential).catch(error=>notice(error.message,true));
  if(session)await connectOwner();
  else notice('');
  render();
}
// The start page lists the groups; each card opens that group's page.
if(!groupChosen){
  document.body.classList.add('picking');
  $('group-picker').hidden=false;
  showGroup('Choose your group');
  $('group-list').replaceChildren(...groupChoices.map(choice=>{
    const link=document.createElement('a'),title=document.createElement('strong'),action=document.createElement('span');
    link.className='group-card';link.href=`?${pageQuery(choice.id)}`;
    title.textContent=choice.label;action.textContent='Open →';
    link.append(title,action);return link;
  }));
}
render();
if(groupChosen)loadQuestionSets();
if(!groupChosen){/* Nothing connects until a group is chosen. */}
else if(navigator.locks)navigator.locks.request(TAB_LOCK,{ifAvailable:true},async lock=>{
  if(!lock){notice('Close the other draw page, then reload this one.',true);return;}
  try{await activate();}catch(error){notice(`Could not connect: ${error.message}`,true);render();}
  await new Promise(()=>{});
}).catch(error=>notice(error.message,true));
else notice('Use a current browser to run the draw.',true);
window.addEventListener('beforeunload',event=>{if(pending||preview){event.preventDefault();event.returnValue='';}});
