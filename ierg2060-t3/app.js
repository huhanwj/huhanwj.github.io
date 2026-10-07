import {fromSheet, validateState, migrateState, mergeRoster, round, eligible, parseAbsent, drawBatch} from './core.js?v=6';
import {setupBonus} from './bonus.js?v=6';
import {setupCloudBonus} from './cloud-bonus.js?v=8';
import {createCloudClient, cloudEndpoint} from './cloud.js?v=7';
import {cloudDefaults} from './cloud-config.js?v=7';

const KEY='ierg2060-t3-v2', OLD_KEY='ierg2060-t3-v1', CLOUD='ierg2060-t3-cloud', LEGACY_SECRET='ierg2060-t3-cloud-key', PENDING='ierg2060-t3-pending';
const $=id=>document.getElementById(id);
let state=null,incoming=null,bonus=null,writable=false,busy=false,cooldown=false,cloud=null,endpoint='',studentEndpoint='',revision=0,connected=false,pending=null,initial=null,sourceInitial=null;
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);$('notice').hidden=!text;if($('settings-dialog').open)$('settings-status').textContent=text;}
function handle(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){notice(error.message,true);}finally{controls();}};}
function cache(next){const clean=validateState(next);localStorage.setItem(KEY,JSON.stringify(clean));state=clean;}
function studentName(no){return state?.students.find(p=>p.no===no)?.name||'';}
function cloudState(result){if(result.revision<revision)return;cache(result.state);revision=result.revision;render();$('cloud-status').textContent='Saved in Google Sheets.';}
async function call(action,payload={}){if(!cloud||!connected)throw Error('Connect Google Sheets in Draw settings.');return cloud.call(action,payload);}
async function flushPending(){
  if(!pending)return;
  let result;try{result=await call(pending.action||'save',pending);}catch(error){if(error.serverConfirmed&&/Cloud progress changed|already initialized/.test(error.message)){const latest=await call('load');if(latest.state){cloudState(latest);localStorage.removeItem(PENDING);pending=null;}throw Error('Cloud progress changed. The latest saved results are now loaded; this new draw was not saved.');}throw error;}
  cloudState(result);localStorage.removeItem(PENDING);pending=null;
}
async function save(next,action='save'){
  if(!writable)throw Error('Close the other draw page, then reload this one.');
  if(pending)throw Error('Retry the pending save in Draw settings before continuing.');
  const clean=validateState(next);
  if(!endpoint){cache(clean);return;}
  if(!connected||initial)throw Error('Finish connecting Google Sheets in Draw settings.');
  pending={action,state:clean,revision,requestId:crypto.randomUUID()};
  localStorage.setItem(PENDING,JSON.stringify(pending));
  try{await flushPending();}catch(error){$('cloud-status').textContent='Save not confirmed. Retry saving before continuing.';throw error;}
}
function count(){const n=Number($('count').value);if(!Number.isInteger(n)||n<1||n>(state?.students.length||35))throw Error('Choose a whole number from 1 to the class size.');return n;}
function previewResults(numbers=[]){
  const results=$('results');results.replaceChildren();if(!numbers.length)return;
  const list=document.createElement('ol');list.className='draw-results';
  numbers.forEach((no,i)=>{const item=document.createElement('li'),q=document.createElement('span'),n=document.createElement('strong'),name=document.createElement('span');q.className='result-q';q.textContent=`QUESTION ${i+1}`;n.className='result-no';n.textContent=String(no).padStart(2,'0');name.className='result-name';name.textContent=studentName(no);item.append(q,n);if(name.textContent)item.append(name);list.append(item);});results.append(list);
}
function absentInput(){try{const absent=parseAbsent($('absent').value,state?.students||[]);$('absence-form').classList.remove('invalid');$('absent').removeAttribute('aria-invalid');$('absence-help').textContent='No. separated by commas · no spaces · leave empty if none';return absent;}catch(error){$('absence-form').classList.add('invalid');$('absent').setAttribute('aria-invalid','true');$('absence-help').textContent=error.message;return null;}}
function controls(){
  const absent=absentInput(),q=state?round(state):0,pool=state&&absent?eligible({...state,absent}):[];
  let n=0;try{n=count();}catch{}
  const locked=busy||!!pending||!!initial||!!endpoint&&!connected||!writable;
  $('draw').disabled=locked||cooldown||!state||!pool.length||!n||absent===null;
  $('draw-label').textContent=busy?'Saving…':`Draw ${Math.min(n||6,pool.length||n||6)} students`;
  $('pool-count').replaceChildren(document.createTextNode(`${pool.length} `));const small=document.createElement('small');small.textContent='available';$('pool-count').append(small);
  $('next-round').textContent=q===2?'BOTH ROUNDS DRAWN':'ELIGIBLE STUDENTS';
  document.querySelectorAll('[data-count]').forEach(button=>{const active=Number(button.dataset.count)===n;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.disabled=locked;});
  $('count').disabled=locked;$('absent').disabled=locked;$('backup').disabled=!state;$('bonus-open').disabled=locked||!state||absent===null||!!endpoint&&!studentEndpoint;
  $('choose-file').disabled=locked||!!endpoint;$('confirm-import').disabled=locked||!!endpoint;
  $('cloud-form').querySelector('button').disabled=busy||!writable;
  $('cloud-refresh').hidden=!connected;$('cloud-refresh').disabled=busy;
  $('cloud-names').hidden=!connected;$('cloud-names').disabled=locked;
  $('cloud-retry').hidden=!pending;$('cloud-retry').disabled=busy||!connected;
  $('cloud-initialize').hidden=!initial;$('cloud-initialize').disabled=busy||!connected;
  $('cloud-source-initialize').hidden=!initial;$('cloud-source-initialize').disabled=busy||!connected;
}
function render(){const batch=state?.batches.at(-1);$('count').max=state?.students.length||35;$('absent').value=(state?.absent||[]).join(',');$('round-label').textContent='THIS DRAW';$('deck-caption').textContent=batch?`${batch.numbers.length} students selected`:'';previewResults(batch?.numbers);controls();if(!state)notice('Import your class records or connect Google Sheets in Draw settings.');else if(round(state)===2)notice('Both participation rounds are complete.');else if(!eligible(state).length)notice('The remaining students in this round are absent. This round stays open.');}
async function exclusive(fn){if(busy)return;busy=true;controls();try{return await fn();}finally{busy=false;controls();}}
$('draw').onclick=handle(async()=>{
  if(busy||cooldown||pending||$('draw').disabled)return;
  cooldown=true;setTimeout(()=>{cooldown=false;controls();},1500);
  await exclusive(async()=>{const absent=absentInput();if(absent===null)return;await save(drawBatch({...state,absent},count()));notice('');render();const batch=state.batches.at(-1);$('announcement').textContent=batch.numbers.map((no,i)=>`Question ${i+1}: No. ${no} ${studentName(no)}`).join('. ');});
});
document.querySelectorAll('[data-count]').forEach(button=>button.onclick=()=>{$('count').value=button.dataset.count;controls();});$('count').oninput=controls;$('absent').oninput=controls;
const saveAbsence=()=>exclusive(async()=>{const absent=absentInput();if(absent!==null&&state&&JSON.stringify(absent)!==JSON.stringify(state.absent))await save({...state,absent});});
$('absent').onchange=handle(saveAbsence);$('absence-form').onsubmit=handle(saveAbsence);
$('settings-open').onclick=()=>$('settings-dialog').showModal();$('bonus-open').onclick=handle(async()=>{$('bonus-dialog').showModal();await bonus?.refresh?.();});
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
function preview(next){if(endpoint)throw Error('Cloud progress is active. Use Refresh names to update the roster without replacing turns.');if(bonus?.isOpen()||bonus?.hasUnsavedResult()||bonus?.getEntrants().length)throw Error('Finish the Bonus round before importing.');incoming=migrateState(next);$('import-summary').textContent=`${incoming.students.length} students, including names when available. This replaces the draw progress in this browser.`;$('import-preview').hidden=false;}
$('choose-file').onclick=()=>$('import-file').click();$('import-file').onchange=handle(async event=>{const file=event.target.files[0];if(!file)return;try{const text=await file.text();preview(file.name.toLowerCase().endsWith('.json')?JSON.parse(text):fromSheet(text));}finally{event.target.value='';}});
$('cancel-import').onclick=()=>{incoming=null;$('import-preview').hidden=true;};
$('confirm-import').onclick=handle(()=>exclusive(async()=>{if(!incoming)return;if(bonus&&!await bonus.reset())throw Error('Save the Bonus result first.');await save(incoming);incoming=null;$('import-preview').hidden=true;$('settings-dialog').close();notice('');render();}));
$('backup').onclick=handle(()=>{if(!state)return;const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`IERG2060-T3-draw-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});

function installBonus(){
  bonus?.destroy?.();
  if(endpoint&&connected)bonus=setupCloudBonus({container:$('bonus-container'),call,endpoint:studentEndpoint,getAbsent:()=>{const absent=absentInput();if(absent===null)throw Error('Check the absent numbers first.');return absent;},getStudentName:studentName,onState:cloudState,publicBaseUrl:new URL('./',location.href).href});
  else if(!endpoint)bonus=setupBonus({container:$('bonus-container'),getStudentName:studentName,getEligibleNumbers:()=>state?state.students.filter(p=>!state.absent.includes(p.no)).map(p=>p.no):[],onWinner:result=>exclusive(()=>!state.bonus.some(b=>b.round===result.round)?save({...state,bonus:[...state.bonus,result]}):undefined),publicBaseUrl:new URL('./',location.href).href});
}
async function loadCloud(){
  const result=await call('load');if(result.revision<revision)return;
  if(result.state){initial=null;sourceInitial=null;cloudState(result);if(pending){const ids=new Set(state.batches.map(b=>b.id));if(pending.state.batches.every(b=>ids.has(b.id))&&JSON.stringify(pending.state.absent)===JSON.stringify(state.absent)){localStorage.removeItem(PENDING);pending=null;}}}
  else{revision=result.revision;sourceInitial=validateState({version:2,students:result.roster,absent:[],batches:[],bonus:[]});initial=state?mergeRoster(state,result.roster):sourceInitial;$('cloud-status').textContent=`Cloud has no records yet. Start with ${initial.students.length} students and ${initial.batches.length} saved batches from this browser${state?'':' / the source sheet'}.`;}
}
function updateLoginLink(){
  try{$('cloud-login').href=cloudEndpoint($('cloud-url').value.trim());$('cloud-login').hidden=false;}
  catch{$('cloud-login').removeAttribute('href');$('cloud-login').hidden=true;}
}
$('cloud-url').oninput=updateLoginLink;
$('cloud-form').onsubmit=handle(()=>exclusive(async()=>{
  if(bonus?.isOpen()||bonus?.hasUnsavedResult()||(!endpoint&&bonus?.getEntrants().length))throw Error('Finish the Bonus round before connecting.');
  const adminUrl=cloudEndpoint($('cloud-url').value.trim()),publicUrl=cloudEndpoint($('student-url').value.trim());
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
$('cloud-retry').onclick=handle(()=>exclusive(async()=>{await flushPending();notice('');render();}));
$('cloud-refresh').onclick=handle(()=>exclusive(async()=>{await loadCloud();await bonus?.refresh?.();notice(pending?'A save still needs confirmation. Use Retry saving.':'');}));
$('cloud-names').onclick=handle(()=>exclusive(async()=>{const result=await call('names');await save(mergeRoster(state,result.roster));notice('Names updated.');render();}));
async function activate(){
  writable=true;
  try{
    sessionStorage.removeItem(LEGACY_SECRET);
    const saved=localStorage.getItem(KEY),legacy=localStorage.getItem(OLD_KEY);
    if(saved||legacy){cache(migrateState(JSON.parse(saved||legacy)));localStorage.removeItem(OLD_KEY);}
    const config=localStorage.getItem(CLOUD)||JSON.stringify(cloudDefaults);
    if(config){if(config.startsWith('https://'))endpoint=cloudEndpoint(config);else{const parsed=JSON.parse(config);endpoint=cloudEndpoint(parsed.admin);studentEndpoint=cloudEndpoint(parsed.student);}}
    pending=JSON.parse(localStorage.getItem(PENDING)||'null');if(pending)pending.state=validateState(pending.state);
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
window.addEventListener('beforeunload',event=>{if(pending||(!endpoint&&(bonus?.isOpen()||bonus?.hasUnsavedResult()||bonus?.getEntrants().length))){event.preventDefault();event.returnValue='';}});
