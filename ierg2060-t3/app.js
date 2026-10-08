import {fromSheet, validateState, migrateState, mergeRoster, round, eligible, parseAbsent, drawBatch} from './core.js?v=8';
import {setupBonus} from './bonus.js?v=6';
import {setupCloudBonus} from './cloud-bonus.js?v=9';
import {createCloudClient, cloudEndpoint} from './cloud.js?v=7';
import {cloudDefaults} from './cloud-config.js?v=7';

const KEY='ierg2060-t3-v2', OLD_KEY='ierg2060-t3-v1', CLOUD='ierg2060-t3-cloud', LEGACY_SECRET='ierg2060-t3-cloud-key', PENDING='ierg2060-t3-pending';
const $=id=>document.getElementById(id);
let state=null,incoming=null,bonus=null,writable=false,busy=false,cloud=null,endpoint='',studentEndpoint='',revision=0,connected=false,pending=null,initial=null,sourceInitial=null,draft=null,absenceText=null,attendance=[],batchDates={},sessionDate=today(),recordsWarning="",revealing=false,questionText=null;
function today(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(key=>parts.find(p=>p.type===key).value).join('-');}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function selectedAttendance(){return attendance.find(row=>row.date===sessionDate);}
function dateInput(){const value=$('session-date').value;if(!validDate(value))throw Error('Choose a valid class date.');return value;}
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);$('notice').hidden=!text;if($('settings-dialog').open)$('settings-status').textContent=text;}
function handle(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){notice(error.message,true);}finally{controls();}};}
function cache(next){const clean=validateState(next);localStorage.setItem(KEY,JSON.stringify(clean));state=clean;}
function studentName(no){return state?.students.find(p=>p.no===no)?.name||'';}
function cloudState(result){
  if(result.revision<revision)return;
  cache(result.state);revision=result.revision;
  if(Array.isArray(result.attendance))attendance=result.attendance;
  if(result.batchDates&&typeof result.batchDates==='object')batchDates=result.batchDates;
  if(typeof result.storageUrl==='string'&&/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(?:[/?#]|$)/.test(result.storageUrl)){$('records-link').href=result.storageUrl;$('records-link').hidden=false;}
  recordsWarning=result.reportsWarning||'';
  $('records-warning').textContent=recordsWarning;$('records-warning').hidden=!recordsWarning;
  render();$('cloud-status').textContent=recordsWarning||'Saved in Google Sheets.';
}
async function call(action,payload={}){if(!cloud||!connected)throw Error('Connect Google Sheets in Draw settings.');return cloud.call(action,payload);}
async function flushPending(){
  if(!pending)return;
  let result;try{result=await call(pending.action||'save',pending);}catch(error){if(error.serverConfirmed&&/Cloud progress changed|already initialized/.test(error.message)){const latest=await call('load');if(latest.state){cloudState(latest);localStorage.removeItem(PENDING);pending=null;}throw Error('Cloud progress changed. The latest saved results are now loaded; the new draw or attendance change was not saved.');}throw error;}
  cloudState(result);localStorage.removeItem(PENDING);pending=null;
}
async function save(next,action='save',classDate){
  if(!writable)throw Error('Close the other draw page, then reload this one.');
  if(pending)throw Error('Retry the pending save before continuing.');
  if(draft)throw Error('Save or cancel the preview first.');
  const clean=validateState(next);
  if(!endpoint){cache(clean);return;}
  if(!connected||initial)throw Error('Finish connecting Google Sheets in Draw settings.');
  pending={action,state:clean,revision,requestId:crypto.randomUUID(),...(classDate?{sessionDate:classDate}:{})};
  localStorage.setItem(PENDING,JSON.stringify(pending));
  try{await flushPending();}catch(error){$('cloud-status').textContent='Save not confirmed. Retry saving before continuing.';throw error;}
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
  const locked=revealing||busy||!!pending||!!initial||!!endpoint&&!connected||!writable;
  $('draw').disabled=locked||!!draft||!state||!pool.length||!n||absent===null||!validDate($('session-date').value);
  $('draw-label').textContent=revealing?'Drawing…':busy?'Saving…':'Draw one student';
  $('pool-count').replaceChildren(document.createTextNode(`${pool.length} `));const small=document.createElement('small');small.textContent='available';$('pool-count').append(small);
  $('next-round').textContent=q===2?'BOTH ROUNDS DRAWN':'ELIGIBLE STUDENTS';
  $('session-date').disabled=locked||!!draft;$('question').disabled=locked||!!draft;$('absent').disabled=locked||!!draft;$('backup').disabled=!state;$('bonus-open').disabled=locked||!!draft||!state||absent===null||!!endpoint&&!studentEndpoint;
  $('choose-file').disabled=locked||!!endpoint;$('confirm-import').disabled=locked||!!endpoint;
  $('cloud-form').querySelector('button').disabled=busy||!!draft||!!pending||!writable;
  $('cloud-refresh').hidden=!connected;$('cloud-refresh').disabled=busy||revealing;
  $('cloud-names').hidden=!connected;$('cloud-names').disabled=locked||!!draft;
  $('cloud-retry').hidden=!pending;$('cloud-retry').disabled=busy||!connected;
  $('cloud-initialize').hidden=!initial;$('cloud-initialize').disabled=busy||!connected;
  $('cloud-source-initialize').hidden=!initial;$('cloud-source-initialize').disabled=busy||!connected;
  const drawPending=pending&&pending.action!=='attendanceSave';
  $('draw-review').hidden=revealing||(!draft&&!drawPending);
  $('draw-save').textContent=drawPending?'Retry saving':busy?'Saving…':'Save draw';
  $('draw-save').disabled=revealing||busy||!writable||!!endpoint&&!connected||(!draft&&!drawPending);
  $('draw-cancel').disabled=revealing||busy||!!pending||!draft;
  $('draw-save-status').textContent=drawPending?'Save not yet confirmed. Retry to confirm this same draw.':draft?'Preview only — Save draw records this draw and attendance.':'';
  const attendancePending=pending?.action==='attendanceSave';
  $('attendance-save').textContent=attendancePending?'Retry attendance save':'Save attendance';
  $('attendance-save').disabled=attendancePending?(busy||!connected):locked||!!draft||!state||!connected||absent===null||!validDate($('session-date').value);
  $('records-refresh').disabled=locked||!!draft;$('records-refresh').hidden=!connected;
  const record=selectedAttendance(),same=record&&JSON.stringify(record.absent)===JSON.stringify(absent);
  $('attendance-status').textContent=attendancePending?'Save not confirmed. Retry the same attendance record.':!validDate(sessionDate)?'Choose a valid class date.':record?(same?`${sessionDate}: saved · ${state.students.length-record.absent.length} present · ${record.absent.length} absent`:`${sessionDate}: unsaved attendance changes`):`${sessionDate}: attendance not saved. Blank absent list means everyone is present.`;

}
function render(){
  const shown=draft?.state||pending?.state||state,batch=shown?.batches.at(-1);
  $('question').value=(draft||pending?.state)?(batch?.questionStart||1):(questionText??nextQuestion());
  $('session-date').value=sessionDate;
  $('absent').value=draft?draft.state.absent.join(','):absenceText??(selectedAttendance()?.absent||[]).join(',');
  $('round-label').textContent='THIS DRAW';
  $('deck-caption').textContent=revealing?'Drawing…':batch?`${batch.numbers.length} ${batch.numbers.length===1?'student':'students'} selected${draft?' · Preview':pending?' · Save not confirmed':''}`:'';
  previewResults(batch?.numbers,batch?.questionStart||1);controls();
  if(!state)notice('Connecting to Google Sheets…');
  else if(!draft&&!pending&&round(state)===2)notice('Both participation rounds are complete.');
  else if(!draft&&!pending&&!eligible({...state,absent:absentInput()||[]}).length)notice('The remaining students in this round are absent. This round stays open.');
}
async function exclusive(fn){if(busy)return;busy=true;controls();try{return await fn();}finally{busy=false;controls();}}
$('draw').onclick=handle(async()=>{
  if(revealing||busy||pending||draft||$('draw').disabled)return;
  const absent=absentInput();if(absent===null)return;
  draft={state:drawBatch({...state,absent},1,questionNumber()),revision,sessionDate:dateInput()};
  revealing=true;$('announcement').textContent='Drawing one student.';notice('');render();
  try{if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,1100));}
  finally{revealing=false;render();}
  const batch=draft.state.batches.at(-1);
  $('announcement').textContent=`Question ${batch.questionStart}: No. ${batch.numbers[0]} ${studentName(batch.numbers[0])}`;
});
$('draw-save').onclick=handle(()=>revealing?undefined:exclusive(async()=>{
  if(pending){try{await flushPending();absenceText=null;questionText=null;notice('Draw saved.');}finally{render();}return;}
  if(!draft)return;
  if(draft.revision!==revision){draft=null;render();throw Error('Cloud progress changed. This preview was not saved. Draw again using the latest records.');}
  const next=draft.state,classDate=draft.sessionDate;draft=null;
  try{await save(next,'save',classDate);absenceText=null;questionText=null;notice('Draw saved.');}finally{render();}
}));
$('draw-cancel').onclick=handle(()=>{
  if(revealing||busy||pending||!draft)return;
  draft=null;notice('Preview cancelled. No draw was saved.');render();
});
$('question').oninput=()=>{questionText=$('question').value;controls();};
$('absent').oninput=()=>{absenceText=$('absent').value;controls();};
$('session-date').onchange=handle(()=>{if(draft||pending||busy)return;sessionDate=$('session-date').value;absenceText=null;questionText=null;notice('');render();});
$('attendance-save').onclick=handle(()=>{
  if($('attendance-save').disabled)return;
  return exclusive(async()=>{
    if(pending?.action==='attendanceSave'){try{await flushPending();absenceText=null;notice('Attendance saved.');}finally{render();}return;}
    if(draft||pending||!connected||!writable||initial)return;
    const date=dateInput(),absent=absentInput();if(absent===null)return;
    pending={action:'attendanceSave',date,absent,revision,requestId:crypto.randomUUID()};
    localStorage.setItem(PENDING,JSON.stringify(pending));
    try{await flushPending();absenceText=null;notice('Attendance saved.');}finally{render();}
  });
});
$('records-refresh').onclick=handle(()=>exclusive(async()=>{cloudState(await call('recordsRefresh'));notice(recordsWarning||'Records updated.');}));
$('absence-form').onsubmit=event=>{event.preventDefault();absenceText=$('absent').value;controls();};
$('settings-open').onclick=()=>$('settings-dialog').showModal();$('bonus-open').onclick=handle(async()=>{$('bonus-dialog').showModal();await bonus?.refresh?.();});
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
async function loadCloud(){
  const result=await call('load');if(result.revision<revision)return;
  if(result.state){
    initial=null;sourceInitial=null;cloudState(result);
    if(pending){
      const received=Array.isArray(result.requestIds)?result.requestIds.includes(pending.requestId):pending.action!=='attendanceSave'&&pending.state&&pending.state.batches.every(b=>state.batches.some(saved=>saved.id===b.id))&&JSON.stringify(pending.state.absent)===JSON.stringify(state.absent);
      if(received){localStorage.removeItem(PENDING);pending=null;absenceText=null;questionText=null;render();}
    }
  }
  else{revision=result.revision;sourceInitial=validateState({version:2,students:result.roster,absent:[],batches:[],bonus:[]});initial=state?mergeRoster(state,result.roster):sourceInitial;$('cloud-status').textContent=`Cloud has no records yet. Start with ${initial.students.length} students and ${initial.batches.length} saved batches from this browser${state?'':' / the source sheet'}.`;}
}
function updateLoginLink(){
  try{$('cloud-login').href=cloudEndpoint($('cloud-url').value.trim());$('cloud-login').hidden=false;}
  catch{$('cloud-login').removeAttribute('href');$('cloud-login').hidden=true;}
}
$('cloud-url').oninput=updateLoginLink;
$('cloud-form').onsubmit=handle(()=>exclusive(async()=>{
  if(draft||pending)throw Error('Save or cancel the current preview before changing the connection.');
  if(bonus?.isOpen()||bonus?.hasUnsavedResult()||(!endpoint&&bonus?.getEntrants().length))throw Error('Finish the Bonus round before connecting.');
  const adminUrl=cloudEndpoint($('cloud-url').value.trim()),publicUrl=cloudEndpoint($('student-url').value.trim());
  if(cloudDefaults && (adminUrl!==cloudDefaults.admin || publicUrl!==cloudDefaults.student))throw Error('Use the configured class connection.');
  if(adminUrl===publicUrl)throw Error('Use separate administrator and student deployments.');
  if(endpoint&&adminUrl!==endpoint)throw Error('This browser is already linked to a different cloud. Use a separate browser profile for another class.');
  const proposed=createCloudClient(adminUrl);
  let account;
  try{account=await proposed.call('auth');await proposed.call('load');}catch(error){proposed.destroy();throw error;}
  cloud?.destroy();cloud=proposed;endpoint=adminUrl;studentEndpoint=publicUrl;connected=true;
  localStorage.setItem(CLOUD,JSON.stringify({admin:endpoint,student:studentEndpoint}));sessionStorage.removeItem(LEGACY_SECRET);
  $('cloud-account').textContent=`Google account: ${account.email}`;
  await loadCloud();installBonus();await bonus?.refresh?.();notice('');
}));
$('cloud-initialize').onclick=handle(()=>exclusive(async()=>{if(!initial)return;const next=initial;initial=null;try{await save(next,'initialize');}catch(error){throw error;}installBonus();notice('');render();}));
$('cloud-source-initialize').onclick=handle(()=>exclusive(async()=>{if(!sourceInitial)return;const next=sourceInitial;initial=null;sourceInitial=null;await save(next,'initialize');installBonus();notice('');render();}));
$('cloud-retry').onclick=handle(()=>exclusive(async()=>{const drawPending=pending?.action==='save';await flushPending();if(drawPending)questionText=null;absenceText=null;notice('');render();}));
$('cloud-refresh').onclick=handle(()=>exclusive(async()=>{await loadCloud();await bonus?.refresh?.();notice(pending?'A save still needs confirmation. Use Retry saving.':'');}));
$('cloud-names').onclick=handle(()=>exclusive(async()=>{const result=await call('names');await save(mergeRoster(state,result.roster));notice('Names updated.');render();}));
async function activate(){
  writable=true;
  try{
    sessionStorage.removeItem(LEGACY_SECRET);
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
    $('cloud-url').value=endpoint;$('student-url').value=studentEndpoint;updateLoginLink();
    if(endpoint){
      $('cloud-status').textContent='Sign in with the authorized Google account to resume.';
      if(studentEndpoint){cloud=createCloudClient(endpoint);const account=await cloud.call('auth');connected=true;$('cloud-account').textContent=`Google account: ${account.email}`;await loadCloud();installBonus();await bonus?.refresh?.();}
      else notice('Set the separate administrator and student URLs in Draw settings.');
    }else installBonus();
    if(state&&!initial&&(!endpoint||connected))notice('');render();
  }catch(error){if(endpoint)connected=false;notice(`Could not connect: ${error.message}`,true);controls();}
}
render();
if(navigator.locks)navigator.locks.request(OLD_KEY,{ifAvailable:true},async lock=>{if(!lock){notice('Close the other draw page, then reload this one.',true);return;}await activate();await new Promise(()=>{});}).catch(error=>notice(error.message,true));else notice('Use a current browser to save your draw.',true);
window.addEventListener('beforeunload',event=>{if(draft||pending||(!endpoint&&(bonus?.isOpen()||bonus?.hasUnsavedResult()||bonus?.getEntrants().length))){event.preventDefault();event.returnValue='';}});
