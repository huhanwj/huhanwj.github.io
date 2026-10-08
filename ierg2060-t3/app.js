import {fromSheet, validateState, migrateState, mergeRoster, round, eligible, parseAbsent, drawBatch} from './core.js?v=8';
import {setupBonus} from './bonus.js?v=6';
import {setupCloudBonus} from './cloud-bonus.js?v=10';
import {createCloudClient, cloudEndpoint} from './cloud.js?v=9';
import {readSession, beginSignIn, cancelSignIn, clearSession} from './auth.js?v=1';
import {cloudDefaults} from './cloud-config.js?v=7';

const KEY='ierg2060-t3-v2', OLD_KEY='ierg2060-t3-v1', CLOUD='ierg2060-t3-cloud', LEGACY_SECRET='ierg2060-t3-cloud-key', PENDING='ierg2060-t3-pending', ANSWER='ierg2060-t3-answer', MINUTES='ierg2060-t3-minutes', LOCAL_ATTENDANCE='ierg2060-t3-attendance';
const FINISHED='ierg2060-t3-finished-sessions';
let finishedDates=[];
function sessionFinished(){return finishedDates.includes(sessionDate);}
const $=id=>document.getElementById(id);
let state=null,incoming=null,bonus=null,writable=false,busy=false,cloud=null,endpoint='',studentEndpoint='',revision=0,connected=false,connecting=false,signingIn=false,pending=null,initial=null,sourceInitial=null,draft=null,absenceText=null,attendance=[],batchDates={},sessionDate=today(),recordsWarning="",revealing=false,questionText=null,answer=null,timerInterval=null;
function today(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(key=>parts.find(p=>p.type===key).value).join('-');}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function selectedAttendance(){return attendance.find(row=>row.date===sessionDate);}
function attendanceReady(date,absent){const record=attendance.find(row=>row.date===date);return validDate(date)&&Array.isArray(absent)&&!!record&&record.absent.length===absent.length&&record.absent.every(no=>absent.includes(no));}
function requireAttendance(date,absent){if(!attendanceReady(date,absent))throw Error('Save attendance for this class date before drawing.');}
function dateInput(){const value=$('session-date').value;if(!validDate(value))throw Error('Choose a valid class date.');return value;}
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);$('notice').hidden=!text;if($('settings-dialog').open)$('settings-status').textContent=text;if($('finish-dialog').open)$('finish-status').textContent=text;}
function handle(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){notice(error.message,true);}finally{controls();}};}
function cache(next){const clean=validateState(next);localStorage.setItem(KEY,JSON.stringify(clean));state=clean;}
function studentName(no){return state?.students.find(p=>p.no===no)?.name||'';}
function cloudState(result){
  if(result.revision<revision)return;
  cache(result.state);revision=result.revision;
  if(Array.isArray(result.attendance))attendance=result.attendance;
  if(result.batchDates&&typeof result.batchDates==='object')batchDates=result.batchDates;
  if(typeof result.storageUrl==='string'&&/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(?:[/?#]|$)/.test(result.storageUrl)){$('records-link').href=result.storageUrl;$('records-link').hidden=false;}
  if(draft&&!attendanceReady(draft.sessionDate,draft.state.absent)){draft=null;clearAnswer();notice('Attendance changed. Check and save attendance before drawing again.',true);}
  recordsWarning=result.reportsWarning||'';
  $('records-warning').textContent=recordsWarning;$('records-warning').hidden=!recordsWarning;
  render();$('cloud-status').textContent=recordsWarning||'Saved in Google Sheets.';
}
function expireSession(error){
  if(error.serverConfirmed&&/Your sign-in session expired/.test(error.message)){clearSession();connected=false;$('cloud-account').textContent='Sign in again to continue.';controls();}
}
async function call(action,payload={}){
  if(!cloud||!connected)throw Error('Sign in with Google to continue.');
  try{return await cloud.call(action,payload);}catch(error){expireSession(error);throw error;}
}
async function flushPending(){
  if(!pending)return;
  let result;try{result=await call(pending.action||'save',pending);}catch(error){
    const attendanceRejected=error.serverConfirmed&&/Save attendance for this class date before drawing|Choose a valid class date \(YYYY-MM-DD\)/.test(error.message);
    if(attendanceRejected||(error.serverConfirmed&&/Cloud progress changed|already initialized/.test(error.message))){
      const latest=await call('load');
      if(latest.state){cloudState(latest);localStorage.removeItem(PENDING);pending=null;draft=null;if(answer&&!answerBatch())clearAnswer();absenceText=null;render();}
      const rejected=Error(attendanceRejected?'The draw was not saved. Check and save attendance for this class date, then draw again.':'Cloud progress changed. The latest saved results are now loaded; the new draw or attendance change was not saved.');
      rejected.saveRejected=true;throw rejected;
    }
    throw error;
  }
  cloudState(result);localStorage.removeItem(PENDING);pending=null;
}
async function save(next,action='save',classDate){
  if(!writable)throw Error('Close the other draw page, then reload this one.');
  if(pending)throw Error('Retry the pending save before continuing.');
  if(draft)throw Error('Save or cancel the preview first.');
  const clean=validateState(next);
  if(!endpoint){cache(clean);return;}
  if(!connected||initial)throw Error('Finish connecting Google Sheets in Draw settings.');
  const request={action,state:clean,revision,requestId:crypto.randomUUID(),...(classDate?{sessionDate:classDate}:{})};
  localStorage.setItem(PENDING,JSON.stringify(request));pending=request;
  try{await flushPending();}catch(error){$('cloud-status').textContent=error.saveRejected?'The change was not saved. Review the latest records before continuing.':'Save not confirmed. Retry saving before continuing.';throw error;}
}
function answerBatch(){return answer&&state?.batches.find(b=>b.id===answer.batchId);}
function durationMinutes(){const minutes=Number($('answer-minutes').value);if(!Number.isInteger(minutes)||minutes<1||minutes>180)throw Error('Enter a whole number of minutes from 1 to 180.');return minutes;}
function storeAnswer(){if(answer)localStorage.setItem(ANSWER,JSON.stringify(answer));else localStorage.removeItem(ANSWER);}
function clearAnswer(){answer=null;storeAnswer();clearInterval(timerInterval);timerInterval=null;}
function timerTick(){
  const remaining=answer?.phase==='bonus'?answer.remainingSeconds:answer?.deadline?Math.max(0,Math.ceil((answer.deadline-Date.now())/1000)):Number($('answer-minutes').value||0)*60;
  $('answer-clock').textContent=Number.isFinite(remaining)?`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`:'--:--';
  const expired=!!answer?.deadline&&remaining===0;
  $('answer-clock').classList.toggle('expired',expired);
  $('timer-status').textContent=answer?.phase==='bonus'?'Answer ended · Bonus round':answer?.deadline?(expired?'Time is up.':'Answer in progress.'):'Ready to start.';
  if(expired||answer?.phase==='bonus'){clearInterval(timerInterval);timerInterval=null;}
}
function startTimer(){
  if(!answerBatch())throw Error('Confirm the saved draw before starting the timer.');
  if(answer.phase==='bonus'){timerTick();return;}
  if(!answer.deadline){answer.deadline=Date.now()+answer.minutes*60000;try{storeAnswer();}catch{answer.deadline=null;throw Error('Draw saved, but the timer could not be stored. Retry Start.');}}
  clearInterval(timerInterval);timerInterval=setInterval(timerTick,250);timerTick();
}
function restoreAnswer(){
  try{const saved=JSON.parse(localStorage.getItem(ANSWER)||'null');
    if(saved&&typeof saved.batchId==='string'&&validDate(saved.date)&&Number.isInteger(saved.minutes)&&saved.minutes>=1&&saved.minutes<=180&&(saved.deadline===null||(Number.isFinite(saved.deadline)&&saved.deadline>0))){answer=saved;if(answer.phase==='bonus'&&(!Number.isFinite(answer.remainingSeconds)||answer.remainingSeconds<0))answer.remainingSeconds=0;sessionDate=saved.date;$('answer-minutes').value=saved.minutes;}
    else localStorage.removeItem(ANSWER);
  }catch{localStorage.removeItem(ANSWER);}
}
async function revealStudent({absent=absentInput(),question=questionNumber(),date=dateInput(),exclude=null}={}){
  if(absent===null)return;
  requireAttendance(date,absent);
  const drawAbsences=exclude===null?absent:[...new Set([...absent,exclude])];
  const next=drawBatch({...state,absent:drawAbsences},1,question);next.absent=absent.slice();
  draft={state:next,revision,sessionDate:date};
  revealing=true;$('announcement').textContent='Drawing one student.';notice('');render();
  try{if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,1100));}
  finally{revealing=false;render();}
  if(!draft)return;
  const batch=draft.state.batches.at(-1);
  $('announcement').textContent=`Question ${batch.questionStart}: No. ${batch.numbers[0]} ${studentName(batch.numbers[0])}`;
}
function questionNumber(){const n=Number($('question').value);if(!Number.isSafeInteger(n)||n<1||n>500)throw Error('Choose a question number from 1 to 500.');return n;}
function nextQuestion(){return Math.max(1,...(state?.batches||[]).filter(b=>batchDates[b.id]===sessionDate).map(b=>(b.questionStart||1)+b.numbers.length));}
function previewResults(numbers=[],questionStart=1){
  const results=$('results');results.replaceChildren();results.setAttribute('aria-busy',String(revealing));
  if(revealing||!numbers.length){const card=document.createElement('div');card.className='card-back'+(revealing?' shuffling':'');card.setAttribute('aria-hidden','true');const emblem=document.createElement('span');emblem.textContent='?';card.append(emblem);results.append(card);return;}
  const list=document.createElement('ol');list.className='draw-results'+(numbers.length===1?' single-result':'');
  numbers.forEach((no,i)=>{const item=document.createElement('li'),q=document.createElement('span'),n=document.createElement('strong'),name=document.createElement('span');q.className='result-q';q.textContent=`QUESTION ${questionStart+i}`;n.className='result-no';n.textContent=String(no).padStart(2,'0');name.className='result-name';name.textContent=studentName(no);item.append(q,n);if(name.textContent)item.append(name);list.append(item);});results.append(list);
}
function absentInput(){try{const absent=parseAbsent($('absent').value,state?.students||[]);$('absence-form').classList.remove('invalid');$('absent').removeAttribute('aria-invalid');$('absence-help').textContent='No. separated by commas · no spaces · leave empty if none';return absent;}catch(error){$('absence-form').classList.add('invalid');$('absent').setAttribute('aria-invalid','true');$('absence-help').textContent=error.message;return null;}}
function controls(){
  const absent=absentInput(),q=state?round(state):0,pool=state&&absent?eligible({...state,absent}):[];
  let n=0;try{n=questionNumber();}catch{}
  const attendanceSaved=attendanceReady($('session-date').value,absent);
  const locked=connecting||revealing||busy||!!pending||!!initial||!!endpoint&&!connected||!writable;
  $('draw').disabled=sessionFinished()||locked||!!answer||!!draft||!state||!pool.length||!n||absent===null||!attendanceSaved;
  $('draw-label').textContent=revealing?'Drawing…':busy?'Saving…':!attendanceSaved?'Save attendance first':'Draw one student';
  $('pool-count').replaceChildren(document.createTextNode(`${pool.length} `));const small=document.createElement('small');small.textContent='available';$('pool-count').append(small);
  $('next-round').textContent=q===2?'BOTH ROUNDS DRAWN':'ELIGIBLE STUDENTS';
  $('session-date').disabled=locked||!!draft||!!answer;$('question').disabled=locked||!!draft||!!answer;$('absent').disabled=locked||!!draft||!!answer;$('backup').disabled=!state;$('bonus-open').disabled=sessionFinished()||locked||!!draft||!state||absent===null||!!endpoint&&!studentEndpoint;
  $('answer-bonus').disabled=$('bonus-open').disabled||!answerBatch();
  $('session-finish').disabled=locked||!state||sessionFinished();
  $('session-finished').hidden=!sessionFinished();
  $('session-finished-text').textContent=`${sessionDate} · Session finished. Saved attendance and draws are kept.`;
  $('session-resume').disabled=locked;
  $('finish-confirm').disabled=busy||!!pending;
  $('draw-table').hidden=sessionFinished();
  $('choose-file').disabled=locked||!!endpoint;$('confirm-import').disabled=locked||!!endpoint;
  $('connection-panel').hidden=!endpoint||connected;
  $('connect-main').disabled=busy||connecting||revealing||!writable;
  $('connect-main').textContent=signingIn?'Waiting for Google…':connecting?'Connecting…':readSession()?'Reconnect':'Sign in with Google';
  $('sign-in-cancel').hidden=!signingIn;
  $('connection-status').textContent=signingIn?'Complete sign-in in the Google window and click Continue. This page will connect automatically.':connecting?'Loading class records…':'Sign in to load this class. The draw stays on this page.';
  $('cloud-form').querySelector('button').disabled=busy||connecting||revealing||!writable;
  $('cloud-form').querySelector('button').textContent=signingIn?'Waiting for Google…':connecting?'Connecting…':readSession()?'Reconnect':'Sign in with Google';
  $('cloud-refresh').hidden=!connected;$('cloud-refresh').disabled=busy||revealing;
  $('cloud-names').hidden=!connected;$('cloud-names').disabled=locked||!!draft;
  $('cloud-retry').hidden=!pending;$('cloud-retry').disabled=busy||!connected;
  $('cloud-initialize').hidden=!initial;$('cloud-initialize').disabled=busy||!connected;
  $('cloud-source-initialize').hidden=!initial;$('cloud-source-initialize').disabled=busy||!connected;
  const drawPending=pending&&pending.action==='save'&&pending.state;
  const answerMode=!!draft||!!drawPending||!!answer;
  $('draw-review').hidden=revealing||!answerMode;
  $('draw-controls').hidden=answerMode;
  $('absence-form').hidden=answerMode;$('attendance-status').hidden=answerMode;
  $('draw-table').classList.toggle('answer-mode',answerMode&&!revealing);
  let minutesValid=true;try{durationMinutes();}catch{minutesValid=false;}
  $('answer-minutes').disabled=busy||revealing||!!pending||!!answer;
  $('draw-save').textContent=busy?'Saving…':drawPending?'Retry Start':answer?.deadline?'Started':'Start';
  $('draw-save').disabled=answer?.phase==='bonus'||revealing||busy||!writable||!!endpoint&&!connected||!!initial||!minutesValid||!!answer?.deadline||(!draft&&!drawPending&&!answerBatch());
  $('draw-cancel').disabled=revealing||busy||!!pending||!draft||pool.length<2;
  $('answer-next').disabled=locked||sessionFinished()||!answerBatch();
  $('draw-save-status').textContent=answer?.phase==='bonus'?'The original draw is saved. Use Bonus round, Next student, or Finish session.':drawPending?'Save not confirmed. Retry Start to keep this same student.':draft?'Start saves this draw, then begins the timer.':answer?.deadline?'Draw saved. Next student ends this turn and draws the next student.':answer?'Draw saved. Click Start to begin the timer.':'';
  timerTick();
  const attendancePending=pending?.action==='attendanceSave';
  $('attendance-save').textContent=attendancePending?'Retry attendance save':'Save attendance';
  $('attendance-save').disabled=attendancePending?(busy||!connected):locked||!!draft||!!answer||!state||!!endpoint&&!connected||absent===null||!validDate($('session-date').value);
  $('records-refresh').disabled=locked||!!draft;$('records-refresh').hidden=!connected;
  const record=selectedAttendance(),same=attendanceSaved;
  $('attendance-status').textContent=attendancePending?'Save not confirmed. Retry the same attendance record.':!validDate(sessionDate)?'Choose a valid class date.':record?(same?`${sessionDate}: saved · ${state.students.length-record.absent.length} present · ${record.absent.length} absent`:`${sessionDate}: attendance changed. Save attendance before drawing.`):`${sessionDate}: save attendance before drawing. Leave Absent empty if everyone is present.`;

}
function render(){
  const shown=draft?.state||pending?.state||state,batch=draft||pending?.state?shown?.batches.at(-1):(answerBatch()||shown?.batches.at(-1));
  $('question').value=(draft||pending?.state||answer)?(batch?.questionStart||1):(questionText??nextQuestion());
  $('session-date').value=sessionDate;
  $('absent').value=draft?draft.state.absent.join(','):absenceText??(selectedAttendance()?.absent||[]).join(',');
  $('round-label').textContent=!revealing&&(draft||answer||pending?.action==='save')?'ANSWER TIME':'THIS DRAW';
  $('deck-caption').textContent=revealing?'Drawing…':batch?`${batch.numbers.length} ${batch.numbers.length===1?'student':'students'} selected${draft?' · Preview':pending?' · Save not confirmed':''}`:'';
  previewResults(batch?.numbers,batch?.questionStart||1);controls();
  if(!state)notice(connecting?'Connecting to Google Sheets…':endpoint?'Sign in with Google to load this class.':'Connecting to Google Sheets…');
  else if(!draft&&!pending&&round(state)===2)notice('Both participation rounds are complete.');
  else if(!draft&&!pending&&!eligible({...state,absent:absentInput()||[]}).length)notice('The remaining students in this round are absent. This round stays open.');
}
async function exclusive(fn){if(busy)return;busy=true;controls();try{return await fn();}finally{busy=false;controls();}}
$('draw').onclick=handle(async()=>{
  if(revealing||busy||pending||draft||answer||$('draw').disabled)return;
  await revealStudent();
});
$('draw-save').onclick=handle(()=>{
  if($('draw-save').disabled)return;
  return exclusive(async()=>{
    try{
      if(answerBatch()&&!pending&&!draft){startTimer();return;}
      const selected=draft?.state.batches.at(-1)||pending?.state?.batches.at(-1);
      if(!selected)return;
      if(!answer){answer={batchId:selected.id,date:draft?.sessionDate||pending.sessionDate||sessionDate,minutes:durationMinutes(),deadline:null};try{storeAnswer();}catch{answer=null;throw Error('The answer session could not be stored. Retry Start.');}try{localStorage.setItem(MINUTES,String(answer.minutes));}catch{}}
      if(pending)await flushPending();
      else{
        if(draft.revision!==revision){draft=null;clearAnswer();throw Error('Cloud progress changed. Draw again using the latest records.');}
        requireAttendance(draft.sessionDate,draft.state.absent);
        const preview=draft;draft=null;
        try{await save(preview.state,'save',preview.sessionDate);}catch(error){if(!error.saveRejected&&!pending&&revision===preview.revision&&!answerBatch())draft=preview;throw error;}
      }
      absenceText=null;questionText=null;startTimer();notice('');
    }catch(error){if(!pending&&!draft&&!answerBatch())clearAnswer();throw error;}
    finally{render();}
  });
});
$('draw-cancel').onclick=handle(()=>{
  if($('draw-cancel').disabled||revealing||busy||pending||!draft)return;
  return exclusive(async()=>{
    const batch=draft.state.batches.at(-1),options={absent:draft.state.absent.slice(),question:batch.questionStart||1,date:draft.sessionDate,exclude:batch.numbers[0]};
    clearAnswer();draft=null;await revealStudent(options);
  });
});
$('answer-next').onclick=handle(()=>{
  if($('answer-next').disabled||revealing||busy||pending||!answerBatch())return;
  return exclusive(async()=>{
    const batch=answerBatch(),question=Math.max(nextQuestion(),(batch.questionStart||1)+batch.numbers.length);
    clearAnswer();questionText=String(question);if(!endpoint)absenceText=state.absent.join(',');notice('');render();
    const absent=absentInput();
    if(absent&&eligible({...state,absent}).length)await revealStudent({absent,question:questionNumber(),date:dateInput()});
  });
});
$('answer-minutes').oninput=()=>{timerTick();controls();};
$('question').oninput=()=>{questionText=$('question').value;controls();};
$('absent').oninput=()=>{absenceText=$('absent').value;controls();};
$('session-date').onchange=handle(()=>{if(draft||pending||busy||answer)return;sessionDate=$('session-date').value;absenceText=null;questionText=null;notice('');render();});
$('attendance-save').onclick=handle(()=>{
  if($('attendance-save').disabled)return;
  return exclusive(async()=>{
    if(pending?.action==='attendanceSave'){try{await flushPending();absenceText=null;notice('Attendance saved.');}finally{render();}return;}
    if(draft||pending||answer||!!endpoint&&!connected||!writable||initial)return;
    const date=dateInput(),absent=absentInput();if(absent===null)return;
    if(!endpoint){
      const next=[...attendance.filter(row=>row.date!==date),{date,absent,savedAt:new Date().toISOString()}];
      localStorage.setItem(LOCAL_ATTENDANCE,JSON.stringify(next));attendance=next;absenceText=null;notice('Attendance saved in this browser.');render();return;
    }
    const request={action:'attendanceSave',date,absent,revision,requestId:crypto.randomUUID()};
    localStorage.setItem(PENDING,JSON.stringify(request));pending=request;
    try{await flushPending();absenceText=null;notice('Attendance saved.');}finally{render();}
  });
});
$('records-refresh').onclick=handle(()=>exclusive(async()=>{cloudState(await call('recordsRefresh'));notice(recordsWarning||'Records updated.');}));
$('absence-form').onsubmit=event=>{event.preventDefault();absenceText=$('absent').value;controls();};
$('settings-open').onclick=()=>$('settings-dialog').showModal();
async function openBonus(){
  if($('bonus-open').disabled)return;
  if(answerBatch()&&answer.phase!=='bonus'){
    const prior=answer;
    answer={...answer,phase:'bonus',remainingSeconds:answer.deadline?Math.max(0,Math.ceil((answer.deadline-Date.now())/1000)):answer.minutes*60};
    try{storeAnswer();}catch(error){answer=prior;throw error;}
    clearInterval(timerInterval);timerInterval=null;render();
  }
  $('bonus-dialog').showModal();await bonus?.refresh?.();
}
$('bonus-open').onclick=handle(openBonus);$('answer-bonus').onclick=handle(openBonus);
$('session-finish').onclick=()=>{
  if($('session-finish').disabled)return;
  $('finish-detail').textContent=draft?'The current preview has not been saved and will be discarded. Saved attendance and draws will be kept. Bonus registration will close.':'The timer will stop and Bonus registration will close. Saved attendance, draws, and Bonus entries will be kept.';
  $('finish-status').textContent='';$('finish-dialog').showModal();
};
$('finish-confirm').onclick=handle(()=>exclusive(async()=>{
  if(pending)throw Error('Confirm the pending save before finishing this session.');
  if(bonus?.hasUnsavedResult())throw Error('Confirm the pending Bonus change before finishing. Open Bonus round and retry it.');
  await bonus?.refresh?.();
  if(bonus?.hasUnsavedResult())throw Error('Confirm the pending Bonus change before finishing.');
  if(await bonus?.close?.()===false)throw Error('Bonus registration closure was not confirmed. Open Bonus round and retry before finishing.');
  const next=[...new Set([...finishedDates,sessionDate])];
  localStorage.setItem(FINISHED,JSON.stringify(next));
  clearAnswer();draft=null;finishedDates=next;questionText=null;absenceText=null;
  $('finish-dialog').close();$('bonus-dialog').close();notice('');render();
}));
$('session-resume').onclick=handle(()=>{
  if($('session-resume').disabled)return;
  const next=finishedDates.filter(date=>date!==sessionDate);localStorage.setItem(FINISHED,JSON.stringify(next));finishedDates=next;notice('');render();
});
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
function preview(next){if(endpoint)throw Error('Cloud progress is active. Use Refresh names to update the roster without replacing turns.');if(bonus?.isOpen()||bonus?.hasUnsavedResult()||bonus?.getEntrants().length)throw Error('Finish the Bonus round before importing.');incoming=migrateState(next);$('import-summary').textContent=`${incoming.students.length} students, including names when available. This replaces the draw progress in this browser.`;$('import-preview').hidden=false;}
$('choose-file').onclick=()=>$('import-file').click();$('import-file').onchange=handle(async event=>{const file=event.target.files[0];if(!file)return;try{const text=await file.text();preview(file.name.toLowerCase().endsWith('.json')?JSON.parse(text):fromSheet(text));}finally{event.target.value='';}});
$('cancel-import').onclick=()=>{incoming=null;$('import-preview').hidden=true;};
$('confirm-import').onclick=handle(()=>exclusive(async()=>{if(!incoming)return;if(bonus&&!await bonus.reset())throw Error('Save the Bonus result first.');await save(incoming);incoming=null;$('import-preview').hidden=true;$('settings-dialog').close();notice('');render();}));
$('backup').onclick=handle(()=>{if(!state)return;const url=URL.createObjectURL(new Blob([JSON.stringify({...state,attendance,batchDates},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`IERG2060-T3-draw-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});

function installBonus(){
  bonus?.destroy?.();
  if(endpoint&&connected)bonus=setupCloudBonus({container:$('bonus-container'),call,endpoint:studentEndpoint,getAbsent:()=>{const absent=absentInput();if(absent===null)throw Error('Check the absent numbers first.');return absent;},getStudentName:studentName,onState:cloudState,publicBaseUrl:new URL('./',location.href).href});
  else if(!endpoint)bonus=setupBonus({container:$('bonus-container'),getStudentName:studentName,getEligibleNumbers:()=>state?state.students.filter(p=>!state.absent.includes(p.no)).map(p=>p.no):[],onWinner:result=>exclusive(()=>!state.bonus.some(b=>b.round===result.round)?save({...state,bonus:[...state.bonus,result]}):undefined),publicBaseUrl:new URL('./',location.href).href});
}
async function loadCloud(loaded){
  const result=loaded||await call('load');if(result.revision<revision)return;
  if(result.state){
    initial=null;sourceInitial=null;cloudState(result);
    if(pending){
      const received=Array.isArray(result.requestIds)?result.requestIds.includes(pending.requestId):pending.action!=='attendanceSave'&&pending.state&&pending.state.batches.every(b=>state.batches.some(saved=>saved.id===b.id))&&JSON.stringify(pending.state.absent)===JSON.stringify(state.absent);
      if(received){localStorage.removeItem(PENDING);pending=null;absenceText=null;questionText=null;render();}
    }
    if(answer&&!pending&&!answerBatch())clearAnswer();
    if(answer?.deadline&&answerBatch())startTimer();
    render();
  }
  else{revision=result.revision;sourceInitial=validateState({version:2,students:result.roster,absent:[],batches:[],bonus:[]});initial=state?mergeRoster(state,result.roster):sourceInitial;$('cloud-status').textContent=`Cloud has no records yet. Start with ${initial.students.length} students and ${initial.batches.length} saved batches from this browser${state?'':' / the source sheet'}.`;}
}
async function connectOwner(signIn=false){
  if(connecting)return;
  const adminUrl=cloudEndpoint($('cloud-url').value.trim()),publicUrl=cloudEndpoint($('student-url').value.trim());
  if(cloudDefaults && (adminUrl!==cloudDefaults.admin || publicUrl!==cloudDefaults.student))throw Error('Use the configured class connection.');
  if(adminUrl===publicUrl)throw Error('Use separate administrator and student deployments.');
  if(endpoint&&adminUrl!==endpoint)throw Error('This browser is already linked to a different cloud. Use a separate browser profile for another class.');
  if(!endpoint&&(draft||pending||bonus?.isOpen()||bonus?.hasUnsavedResult()||bonus?.getEntrants().length))throw Error('Finish the local draw or Bonus round before connecting.');
  connecting=true;connected=false;cloud?.destroy();cloud=null;controls();
  let proposed;
  try{
    proposed=createCloudClient(publicUrl,{getSessionToken:()=>readSession()?.token??null});
    if(signIn){
      signingIn=true;controls();
      // Open synchronously in the button click, before the bridge is awaited.
      await beginSignIn(adminUrl,payload=>proposed.call('exchangeLogin',payload,{anonymous:true}));
      signingIn=false;controls();
    }
    if(!readSession())throw Error('Sign in with Google to load this class.');
    const account=await proposed.call('auth'),result=await proposed.call('load');
    cloud=proposed;endpoint=adminUrl;studentEndpoint=publicUrl;connected=true;
    $('cloud-account').textContent=`Google account: ${account.email}`;
    await loadCloud(result);
    localStorage.setItem(CLOUD,JSON.stringify({admin:endpoint,student:studentEndpoint}));sessionStorage.removeItem(LEGACY_SECRET);
    installBonus();await bonus?.refresh?.();notice('');
  }catch(error){proposed?.destroy();cloud=null;connected=false;expireSession(error);throw error;}
  finally{signingIn=false;connecting=false;controls();}
}
const connectFromButton=handle(()=>exclusive(()=>connectOwner(!readSession())));
$('cloud-form').onsubmit=connectFromButton;
$('connect-main').onclick=connectFromButton;
$('sign-in-cancel').onclick=()=>cancelSignIn();
$('cloud-initialize').onclick=handle(()=>exclusive(async()=>{if(!initial)return;const next=initial;initial=null;try{await save(next,'initialize');}catch(error){throw error;}installBonus();notice('');render();}));
$('cloud-source-initialize').onclick=handle(()=>exclusive(async()=>{if(!sourceInitial)return;const next=sourceInitial;initial=null;sourceInitial=null;await save(next,'initialize');installBonus();notice('');render();}));
$('cloud-retry').onclick=handle(()=>exclusive(async()=>{const drawPending=pending?.action==='save';await flushPending();if(drawPending){questionText=null;if(answerBatch()&&!answer.deadline)startTimer();}absenceText=null;notice('');render();}));
$('cloud-refresh').onclick=handle(()=>exclusive(async()=>{await loadCloud();await bonus?.refresh?.();notice(pending?'A save still needs confirmation. Use Retry saving.':'');}));
$('cloud-names').onclick=handle(()=>exclusive(async()=>{const result=await call('names');await save(mergeRoster(state,result.roster));notice('Names updated.');render();}));
async function activate(){
  writable=true;
  try{
    sessionStorage.removeItem(LEGACY_SECRET);
    try{const dates=JSON.parse(localStorage.getItem(FINISHED)||'[]');finishedDates=Array.isArray(dates)?dates.filter(validDate):[];}catch{finishedDates=[];}
    const saved=localStorage.getItem(KEY),legacy=localStorage.getItem(OLD_KEY);
    if(saved||legacy){cache(migrateState(JSON.parse(saved||legacy)));localStorage.removeItem(OLD_KEY);}
    const config=cloudDefaults?JSON.stringify(cloudDefaults):localStorage.getItem(CLOUD);
    if(config){if(config.startsWith('https://'))endpoint=cloudEndpoint(config);else{const parsed=JSON.parse(config);endpoint=cloudEndpoint(parsed.admin);studentEndpoint=cloudEndpoint(parsed.student);}}
    pending=JSON.parse(localStorage.getItem(PENDING)||'null');
    if(pending){
      if(pending.action==='attendanceSave'){
        if(!validDate(pending.date)||!Array.isArray(pending.absent))throw Error('The pending attendance record is invalid.');
        sessionDate=pending.date;absenceText=pending.absent.join(',');
      }else{pending.state=validateState(pending.state);if(validDate(pending.sessionDate)){sessionDate=pending.sessionDate;absenceText=pending.state.absent.join(',');}}
    }
    const lastMinutes=Number(localStorage.getItem(MINUTES));if(Number.isInteger(lastMinutes)&&lastMinutes>=1&&lastMinutes<=180)$('answer-minutes').value=lastMinutes;
    restoreAnswer();
    if(pending||answer)finishedDates=finishedDates.filter(date=>date!==sessionDate);
    $('cloud-url').value=endpoint;$('student-url').value=studentEndpoint;
    if(endpoint){
      $('cloud-status').textContent='Sign in with the authorized Google account to resume.';
      if(studentEndpoint){if(readSession())await connectOwner();else notice('Sign in with Google to load this class.');}
      else notice('Set the separate administrator and student URLs in Draw settings.');
    }else{attendance=JSON.parse(localStorage.getItem(LOCAL_ATTENDANCE)||'[]');installBonus();}
    if(answer&&!pending&&!answerBatch())clearAnswer();
    if(answer?.deadline&&answerBatch())startTimer();
    if(state&&!initial&&(!endpoint||connected))notice('');render();
  }catch(error){if(endpoint)connected=false;notice(`Could not connect: ${error.message}`,true);controls();}
}
render();
if(navigator.locks)navigator.locks.request(OLD_KEY,{ifAvailable:true},async lock=>{if(!lock){notice('Close the other draw page, then reload this one.',true);return;}await activate();await new Promise(()=>{});}).catch(error=>notice(error.message,true));else notice('Use a current browser to save your draw.',true);
window.addEventListener('beforeunload',event=>{if(draft||pending||(!endpoint&&(bonus?.isOpen()||bonus?.hasUnsavedResult()||bonus?.getEntrants().length))){event.preventDefault();event.returnValue='';}});

window.addEventListener('pageshow',timerTick);
document.addEventListener('visibilitychange',timerTick);
