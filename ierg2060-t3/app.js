import {fromSheet, validateState, migrateState, round, eligible, parseAbsent, drawBatch} from './core.js?v=2';
import {setupBonus} from './bonus.js?v=2';

const KEY = 'ierg2060-t3-v2', OLD_KEY = 'ierg2060-t3-v1';
const $ = id => document.getElementById(id);
let state = null, incoming = null, bonus = null, writable = false, animating = false;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
function notice(text, error = false) {
  $('notice').textContent = text; $('notice').classList.toggle('error', error); $('notice').hidden = !text;
  if ($('settings-dialog').open) $('settings-status').textContent = text;
}
function handle(fn) { return async event => {event?.preventDefault();try {await fn(event);}catch(error){notice(error.message,true);}}; }
function save(next) {
  if (!writable) throw Error('Close the other draw page, then reload this one.');
  const clean = validateState(next);
  localStorage.setItem(KEY, JSON.stringify(clean)); state = clean;
}
function count() {
  const n = Number($('count').value);
  if (!Number.isInteger(n) || n < 1 || n > (state?.students.length || 35)) throw Error('Choose a whole number from 1 to the class size.');
  return n;
}
function previewCards(numbers = [], animate = false) {
  const n = numbers.length || Math.max(1,Math.min(Number($('count').value) || 6,35));
  $('cards').style.setProperty('--columns', Math.min(n,7)); $('cards').replaceChildren();
  for(let i=0;i<n;i++) {
    const card=document.createElement('div');card.className=`draw-card${animate?' dealing':numbers.length?' revealed':''}`;
    card.style.setProperty('--delay',`${Math.min(i,12)*55}ms`);
    card.innerHTML=`<div class="card-inner"><div class="card-face card-back" aria-hidden="true"><div class="card-topline"><span>IERG2060</span><span>✧</span></div><span class="card-symbol">✦</span><span class="card-bottom">QUESTION ${i+1}</span></div><div class="card-face card-front" aria-hidden="${animate||!numbers.length}"><div class="card-topline"><span>TUTORIAL 03</span><span>✦</span></div><span class="number-label">STUDENT NO.</span><strong class="card-number"></strong><span class="card-bottom">QUESTION ${i+1}</span></div></div>`;
    card.querySelector('.card-number').textContent=numbers.length?String(numbers[i]).padStart(2,'0'):'';
    $('cards').append(card);
    if(animate)setTimeout(()=>{card.classList.add('revealed');card.querySelector('.card-front').setAttribute('aria-hidden','false');},motion.matches?0:450+Math.min(i,20)*130);
  }
}
function absentInput() {
  try {
    const absent=parseAbsent($('absent').value,state?.students||[]);
    $('absence-form').classList.remove('invalid');$('absent').removeAttribute('aria-invalid');
    $('absence-help').textContent='No. separated by commas · no spaces · leave empty if none';return absent;
  } catch(error) {
    $('absence-form').classList.add('invalid');$('absent').setAttribute('aria-invalid','true');$('absence-help').textContent=error.message;return null;
  }
}
function controls() {
  const absent=absentInput(),q=state?round(state):0,pool=state&&absent?eligible({...state,absent}):[];
  let n=0;try{n=count();}catch{/* Invalid input disables the draw. */}
  $('draw').disabled=!writable||!state||!pool.length||!n||absent===null||animating;
  $('draw-label').textContent=animating?'Revealing…':`Draw ${Math.min(n||6,pool.length||n||6)} cards`;
  $('pool-count').replaceChildren(document.createTextNode(`${pool.length} `));const small=document.createElement('small');small.textContent='available';$('pool-count').append(small);
  $('next-round').textContent=q===2?'BOTH ROUNDS DRAWN':'ELIGIBLE STUDENTS';
  document.querySelectorAll('[data-count]').forEach(button=>{const active=Number(button.dataset.count)===n;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.disabled=animating;});
  $('count').disabled=animating;$('absent').disabled=animating;$('backup').disabled=!state;
  $('bonus-open').disabled=!state||!writable||animating||absent===null;$('settings-open').disabled=animating;
}
function render() {
  const batch=state?.batches.at(-1);$('count').max=state?.students.length||35;$('absent').value=(state?.absent||[]).join(',');
  $('round-label').textContent='THIS DRAW';
  $('deck-caption').textContent=batch?`${batch.numbers.length} students selected`:'';
  previewCards(batch?.numbers);controls();
  if(!state)notice('Import your class records in Draw settings to begin.');
  else if(round(state)===2)notice('Both participation rounds are complete.');
  else if(!eligible(state).length)notice('The remaining students in this round are absent. This round stays open.');
}
$('draw').onclick=handle(async()=>{
  if(animating)return;const absent=absentInput();if(absent===null)return;
  // Persist the whole batch before revealing. Reload never triggers another draw.
  save(drawBatch({...state,absent},count()));const batch=state.batches.at(-1);
  notice('');animating=true;controls();$('round-label').textContent='THIS DRAW';$('deck-caption').textContent='Drawing…';
  previewCards(batch.numbers,true);
  await new Promise(resolve=>setTimeout(resolve,motion.matches?30:1400+Math.min(batch.numbers.length-1,20)*130));
  animating=false;$('deck-caption').textContent=`${batch.numbers.length} students selected`;$('announcement').textContent=batch.numbers.map((no,i)=>`Question ${i+1}: student ${no}`).join('. ');controls();
  if(round(state)===2)notice('Both participation rounds are complete.');
  else if(!eligible(state).length)notice('The remaining students in this round are absent. This round stays open.');
});
document.querySelectorAll('[data-count]').forEach(button=>button.onclick=()=>{$('count').value=button.dataset.count;if(!state?.batches.length)previewCards();controls();});
$('count').oninput=()=>{if(!state?.batches.length&&Number($('count').value)>0)previewCards();controls();};
$('absent').oninput=controls;
const saveAbsence=()=>{const absent=absentInput();if(absent!==null&&state)save({...state,absent});controls();};
$('absent').onchange=handle(saveAbsence);$('absence-form').onsubmit=handle(saveAbsence);
$('settings-open').onclick=()=>$('settings-dialog').showModal();$('bonus-open').onclick=()=>$('bonus-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
function preview(next) {
  if(bonus?.isOpen()||bonus?.hasUnsavedResult())throw Error('Close Bonus registration and save its result before importing.');
  incoming=migrateState(next);$('import-summary').textContent=`${incoming.students.length} roster numbers. Previous turns imported. This replaces the draw progress in this browser.`;$('import-preview').hidden=false;
}
$('choose-file').onclick=()=>$('import-file').click();
$('import-file').onchange=handle(async event=>{const file=event.target.files[0];if(!file)return;try{const text=await file.text();preview(file.name.toLowerCase().endsWith('.json')?JSON.parse(text):fromSheet(text));}finally{event.target.value='';}});
$('cancel-import').onclick=()=>{incoming=null;$('import-preview').hidden=true;};
$('confirm-import').onclick=handle(()=>{if(!incoming)return;if(bonus&&!bonus.reset())throw Error('Save the Bonus result first.');save(incoming);incoming=null;$('import-preview').hidden=true;$('settings-dialog').close();notice('');render();});
$('backup').onclick=handle(()=>{if(!state)return;const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`IERG2060-T3-draw-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('sheet-form').onsubmit=handle(async()=>{
  const url=new URL($('sheet-url').value),match=url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/),gid=url.searchParams.get('gid')||new URLSearchParams(url.hash.slice(1)).get('gid');
  if(url.hostname!=='docs.google.com'||!match||!gid||!/^\d+$/.test(gid))throw Error('Paste the Tutorial 3 worksheet link including its gid.');
  $('settings-status').textContent='Reading roster…';
  const response=await fetch(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`,{credentials:'omit',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Could not read the worksheet. Import its CSV instead.');preview(fromSheet(await response.text()));$('settings-status').textContent='Roster ready to import.';
});
async function activate() {
  writable=true;let restoreError='';
  try{const saved=localStorage.getItem(KEY),legacy=localStorage.getItem(OLD_KEY);if(saved||legacy){save(migrateState(JSON.parse(saved||legacy)));localStorage.removeItem(OLD_KEY);}}
  catch(error){restoreError=`Could not restore draw progress: ${error.message}`;}
  bonus=setupBonus({container:$('bonus-container'),getEligibleNumbers:()=>state?state.students.filter(p=>!state.absent.includes(p.no)).map(p=>p.no):[],onWinner:result=>{if(!state.bonus.some(b=>b.round===result.round))save({...state,bonus:[...state.bonus,result]});},publicBaseUrl:new URL('./',location.href).href});
  if(state)notice('');render();if(restoreError)notice(restoreError,true);
}
render();
if(navigator.locks)navigator.locks.request(OLD_KEY,{ifAvailable:true},async lock=>{if(!lock){notice('Close the other draw page, then reload this one.',true);return;}await activate();await new Promise(()=>{});}).catch(error=>notice(error.message,true));
else notice('Use a current version of Chrome, Safari or Firefox to save your draw.',true);
window.addEventListener('beforeunload',event=>{if(bonus?.isOpen()||bonus?.hasUnsavedResult()){event.preventDefault();event.returnValue='';}});
