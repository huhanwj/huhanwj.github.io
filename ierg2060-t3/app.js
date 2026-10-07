import {fromSheet, validateState, round, eligible, pick, scoreValue} from './core.js';
import {setupBonus} from './bonus.js';

const KEY = 'ierg2060-t3-v1';
const $ = id => document.getElementById(id);
let state = null, incoming = null, bonus = null, writable = false;
function message(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); $('notice').hidden = false; }
function safely(fn) { return async event => { event?.preventDefault(); try { await fn(event); } catch (error) { message(error.message, true); } }; }
function load() {
  try { const saved = localStorage.getItem(KEY); if (saved) state = validateState(JSON.parse(saved)); }
  catch { message('本机记录无法读取。请导入最近的 JSON 备份；原存储尚未改动。', true); }
}
function save(next) {
  if (!writable) throw Error('此浏览器已有另一个管理页面打开。请关闭它并刷新本页。');
  validateState(next);
  next.updatedAt = new Date().toISOString();
  // Persist before updating the display: a failed write must not consume a turn.
  localStorage.setItem(KEY, JSON.stringify(next)); state = next; render();
}
function change(fn) { if (!state) throw Error('请先导入名单。'); const next = structuredClone(state); fn(next); save(next); }
function log(s, type, details) { s.history.push({type, at: new Date().toISOString(), session: s.session, ...details}); }
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function preview(next) {
  if (state?.pending) throw Error('请先处理待确认的人选，再导入。');
  if (bonus?.isOpen()) throw Error('请先关闭 Bonus 报名，再导入。');
  if (bonus?.hasUnsavedResult()) throw Error('请先保存待确认的 Bonus 结果。');
  incoming = validateState(next);
  $('import-summary').textContent = `${next.students.length} 人 · Q1 已完成 ${next.students.filter(p=>p.q[0]!==null).length} 人 · Q2 已完成 ${next.students.filter(p=>p.q[1]!==null).length} 人。将打开 Tutorial ${next.session}。`;
  $('import-dialog').showModal();
}
async function importFile(event) {
  const file = event.target.files[0]; if (!file) return;
  try { const text = await file.text(); preview(file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : fromSheet(text)); }
  finally { event.target.value = ''; }
}
function render() {
  $('setup').hidden = Boolean(state); $('dashboard').hidden = !state; $('backup').disabled = !state;
  if (!state) return;
  const q = round(state), pool = eligible(state), total = state.students.length;
  $('total').textContent = total;
  for (let i=0;i<2;i++) $(`q${i+1}-progress`).textContent = `${state.students.filter(p=>p.q[i]!==null).length} / ${total}`;
  $('pool-count').textContent = pool.length; $('round-label').textContent = q===2 ? 'TWO ROUNDS COMPLETE' : `QUESTION ${q+1}`;
  $('winner').textContent = state.pending ? String(state.pending.no).padStart(2,'0') : q===2 ? '✓' : '?';
  $('stage-label').textContent = state.pending ? `NO. · QUESTION ${state.pending.q+1}` : q===2 ? 'EVERYONE HAD A TURN. TWICE.' : "WHO'S NEXT?";
  $('pool-description').textContent = state.pending ? '请这位同学上台，讲讲你的思路。' : q===2 ? '全班已完成两轮，仍可开启 Bonus。' : pool.length ? `${pool.length} 位同学在候选池中，每人机会相同。` : '本轮尚未完成的同学均缺席，等待补齐后继续。';
  $('draw').hidden = Boolean(state.pending); $('draw').disabled = !writable || !pool.length;
  $('confirm-form').hidden = !state.pending;
  $('session').value = state.session; $('session').disabled = Boolean(state.pending);
  $('attendance-note').textContent = `Tutorial ${state.session} · 到场 ${total-state.absent.length} 人 / 缺席 ${state.absent.length} 人。请按今天实际出勤调整。`;
  $('absent-list').value = [...state.absent].sort((a,b)=>a-b).join(', ');
  $('roster').replaceChildren(); $('records').replaceChildren();
  for (const student of state.students) {
    const label = document.createElement('label'); label.className = `student${state.absent.includes(student.no) ? ' absent' : ''}`;
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !state.absent.includes(student.no); check.setAttribute('aria-label',`${student.no} 号到场`); check.disabled = !writable || state.pending?.no === student.no;
    check.addEventListener('change', safely(() => change(s => { s.absent = check.checked ? s.absent.filter(n=>n!==student.no) : [...s.absent,student.no]; log(s,'attendance',{no:student.no,present:check.checked}); })));
    const number = document.createElement('span'); number.className='no'; number.textContent=String(student.no).padStart(2,'0');
    const status = document.createElement('small'); status.textContent=`${student.q.filter(x=>x!==null).length}/2 完成`; number.append(status); label.append(check,number); $('roster').append(label);
    const tr = document.createElement('tr');
    [student.no,...student.q.map(x=>x===null?'—':x.score),`${student.q.filter(x=>x!==null).length} / 2`,state.history.filter(e=>e.type==='bonus'&&e.no===student.no).length].forEach(value=>{ const td=document.createElement('td');td.textContent=value;tr.append(td); }); $('records').append(tr);
  }
  $('history').replaceChildren();
  const kinds={draw:'正式抽签',complete:'讲题完成',absence:'抽中后缺席',attendance:'调整出勤',session:'切换课堂',bonus:'Bonus 抽签',correction:'成绩更正'};
  for (const item of state.history.slice().reverse()) {
    const li=document.createElement('li');li.textContent=`${new Date(item.at).toLocaleString()} · T${item.session} · ${kinds[item.type]||item.type}${item.no ? ` · ${item.no} 号` : ''}${item.q!==undefined?` · Q${item.q+1}`:''}${item.score!==undefined?` · ${item.score} 分`:''}${item.reason?` · ${item.reason}`:''}`; $('history').append(li);
  }
}

for (let i=1;i<=10;i++) { const option=document.createElement('option');option.value=i;option.textContent=`Tutorial ${i}`;$('session').append(option); }
$('initial-file').addEventListener('change',safely(importFile)); $('import-file').addEventListener('change',safely(importFile));
$('cancel-import').onclick=()=>{ incoming=null;$('import-dialog').close(); };
$('confirm-import').onclick=safely(()=>{ if(!incoming) return; if(bonus && !bonus.reset())throw Error('请先保存 Bonus 结果。');save(incoming);incoming=null;$('import-dialog').close();message('已导入。请先核对当堂出勤，再开始抽签。'); });
$('draw').onclick=safely(()=>change(s=>{ if(s.pending) throw Error('请先确认当前人选。');const student=pick(eligible(s));s.pending={no:student.no,q:round(s),at:new Date().toISOString()};log(s,'draw',{...s.pending,pool:eligible(s).map(p=>p.no)}); }));
$('confirm-form').onsubmit=safely(()=>{const score=scoreValue($('score').value);change(s=>{if(!s.pending)throw Error('没有待确认人选。'); const {no,q}=s.pending; s.students.find(p=>p.no===no).q[q]={score,at:new Date().toISOString(),source:'draw'};log(s,'complete',{no,q,score});s.pending=null;});$('score').value='';message('已保存讲题结果。');});
$('pending-absent').onclick=safely(()=>change(s=>{if(!s.pending)return;const {no,q}=s.pending;s.absent=[...new Set([...s.absent,no])];log(s,'absence',{no,q});s.pending=null;}));
$('session').onchange=safely(()=>{const session=Number($('session').value);if(bonus?.isOpen() || bonus?.hasUnsavedResult()){render();throw Error('请先保存 Bonus 结果并关闭报名，再切换课堂。');}change(s=>{if(s.pending)throw Error('请先处理当前人选。');s.students.forEach(p=>p.attendance[s.session-1]=s.absent.includes(p.no)?'A':'P');s.session=session;s.absent=s.students.filter(p=>p.attendance[session-1]==='A').map(p=>p.no);log(s,'session',{});});bonus?.reset();message('已切换课堂。空白考勤默认到场，请核对缺席名单。');});
$('absent-form').onsubmit=safely(()=>{const text=$('absent-list').value.trim();const tokens=text?text.split(/[\s,，;；]+/).filter(Boolean):[];if(tokens.some(n=>!/^\d+$/.test(n)))throw Error('请用逗号或空格分隔编号。');const numbers=[...new Set(tokens.map(Number))];change(s=>{if(numbers.some(n=>!s.students.some(p=>p.no===n)))throw Error('缺席名单包含不在本班的编号。');if(s.pending&&numbers.includes(s.pending.no))throw Error('请使用「这位同学未到场」处理当前人选。');s.absent=numbers;log(s,'attendance',{absent:numbers});});});
$('all-present').onclick=safely(()=>change(s=>{s.absent=[];log(s,'attendance',{absent:[]});}));
$('backup').onclick=safely(()=>{if(!state)throw Error('请先导入名单。');download(`IERG2060-T3-T${state.session}-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2),'application/json');message('备份已导出，包含本机当前轮次与历史记录。');});
$('export-csv').onclick=safely(()=>{const lines=[['No.','Tutorial Class',...Array.from({length:10},(_,i)=>`Tutorial ${i+1}`),'Question 1','Question 2','Formal turns','Bonus selections'],...state.students.map(p=>[p.no,'Tutorial 3',...p.attendance.map((a,i)=>i===state.session-1?(state.absent.includes(p.no)?'A':'P'):a),...p.q.map(x=>x===null?'':x.score),p.q.filter(x=>x!==null).length,state.history.filter(e=>e.type==='bonus'&&e.no===p.no).length])];download(`IERG2060-T3-scores.csv`,'\uFEFF'+lines.map(r=>r.join(',')).join('\r\n'),'text/csv;charset=utf-8');});
$('correction-form').onsubmit=safely(()=>{const no=Number($('correct-no').value),q=Number($('correct-q').value),score=scoreValue($('correct-score').value),reason=$('correct-reason').value.trim();if(!reason)throw Error('请填写更正原因。');change(s=>{const p=s.students.find(p=>p.no===no);if(!p?.q[q])throw Error('只能更正已经完成的分数。');const before=p.q[q].score;p.q[q]={...p.q[q],score};log(s,'correction',{no,q,score,before,reason});});message('分数已更正，原分数保留在备份操作记录中。');});
$('project').onclick=()=>{const active=document.body.classList.toggle('projecting');$('project').textContent=active?'退出投屏':'投屏模式';};
$('sheet-form').onsubmit=safely(async()=>{const url=new URL($('sheet-url').value);if(url.hostname!=='docs.google.com')throw Error('请输入 Google Sheets 链接。');const match=url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);if(!match)throw Error('表格链接格式无效。');const gid=url.searchParams.get('gid')||new URLSearchParams(url.hash.slice(1)).get('gid');if(!gid||!/^\d+$/.test(gid))throw Error('请复制包含 gid 的 Tutorial 3 工作表链接。');message('正在读取表格…');const response=await fetch(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`,{credentials:'omit',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('无法读取表格，请下载 CSV 后导入。');preview(fromSheet(await response.text()));});

load();render();
// One writer per browser origin prevents two management tabs from overwriting turns.
async function activate() {
  writable=true;render();
  bonus=setupBonus({container:$('bonus-container'),getEligibleNumbers:()=>state?state.students.filter(p=>!state.absent.includes(p.no)).map(p=>p.no):[],onWinner:result=>change(s=>{if(!s.history.some(e=>e.type==='bonus'&&e.round===result.round))log(s,'bonus',result);}),publicBaseUrl:new URL('./',location.href).href});
}
if(navigator.locks){navigator.locks.request(KEY,{ifAvailable:true},async lock=>{if(!lock){message('另一个管理页面正在使用本机记录。请关闭那个页面，再刷新这里。',true);return;}await activate();await new Promise(()=>{});}).catch(e=>message(e.message,true));}
else message('此浏览器不支持安全保存课堂进度，请使用新版 Chrome、Safari 或 Firefox。',true);
window.addEventListener('beforeunload',event=>{if(bonus?.isOpen() || bonus?.hasUnsavedResult()){event.preventDefault();event.returnValue='';}});
