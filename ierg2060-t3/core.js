// No identities or source records are bundled with this public page.
export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (!field || quoted) quoted = !quoted;
      else throw Error('CSV 引号格式不正确。');
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw Error('CSV 引号未闭合。');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function scoreValue(value) {
  if (String(value).trim() === '') throw Error('请输入分数；0 分也算完成本轮。');
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0) throw Error('分数必须是大于或等于 0 的数字。');
  return score;
}

export function fromSheet(text) {
  const rows = parseCSV(text);
  const header = rows.findIndex(r => r[0]?.trim() === 'No.' && r.some(x => x.trim() === 'Question 1'));
  if (header < 0) throw Error('未找到 No. / Question 1 表头，请导出 Tutorial 3 工作表为 CSV。');
  const columns = rows[header].map(x => x.trim());
  const col = name => { const i = columns.indexOf(name); if (i < 0) throw Error(`缺少 ${name} 列。`); return i; };
  const classCol = col('Tutorial Class'), q1 = col('Question 1'), q2 = col('Question 2');
  const attendanceCols = Array.from({length: 10}, (_, i) => col(`Tutorial ${i + 1}`));
  const now = new Date().toISOString();
  const students = rows.slice(header + 1).filter(r => /^\d+$/.test(r[0]?.trim()) && r[classCol]?.trim() === 'Tutorial 3').map(r => ({
    no: Number(r[0]),
    q: [q1, q2].map(i => r[i]?.trim() ? {score: scoreValue(r[i]), at: now, source: 'sheet'} : null),
    attendance: attendanceCols.map(i => { const a = (r[i] || '').trim().toUpperCase(); if (!['', 'P', 'A'].includes(a)) throw Error(`编号 ${r[0]} 的考勤值无效。`); return a; })
  })).sort((a,b) => a.no-b.no);
  if (!students.length) throw Error('没有找到 Tutorial 3 学生记录。');
  let latest = 0;
  for (let i = 0; i < 10; i++) if (students.some(s => s.attendance[i])) latest = i + 1;
  const session = Math.min(latest + 1, 10);
  return validateState({version: 1, students, session, absent: students.filter(p=>p.attendance[session-1]==='A').map(p=>p.no), pending: null, history: [], importedAt: now, updatedAt: now});
}

export function validateState(s) {
  if (!s || s.version !== 1 || !Array.isArray(s.students) || !s.students.length || s.students.length > 500) throw Error('备份格式无效。');
  const numbers = s.students.map(p => p.no);
  if (numbers.some(n => !Number.isSafeInteger(n) || n < 1) || new Set(numbers).size !== numbers.length) throw Error('编号无效或重复。');
  for (const p of s.students) {
    if (!Array.isArray(p.q) || p.q.length !== 2 || !Array.isArray(p.attendance) || p.attendance.length !== 10 || p.attendance.some(a => !['P','A',''].includes(a))) throw Error('学生记录格式无效。');
    for (const q of p.q) if (q !== null && (!q || typeof q.score !== 'number' || !Number.isFinite(q.score) || q.score < 0)) throw Error('分数记录无效。');
  }
  if (!Number.isInteger(s.session) || s.session < 1 || s.session > 10 || !Array.isArray(s.absent) || s.absent.some(n => !numbers.includes(n)) || new Set(s.absent).size !== s.absent.length || !Array.isArray(s.history)) throw Error('课堂记录无效。');
  const bonusRounds = new Set();
  for (const entry of s.history) {
    if (!entry || !['draw','complete','absence','attendance','session','bonus','correction'].includes(entry.type) || !Number.isFinite(Date.parse(entry.at)) || !Number.isInteger(entry.session) || entry.session < 1 || entry.session > 10) throw Error('操作记录无效。');
    if (entry.no !== undefined && !numbers.includes(entry.no)) throw Error('操作记录包含未知编号。');
    if (['draw','complete','absence','correction'].includes(entry.type) && (!numbers.includes(entry.no) || ![0,1].includes(entry.q))) throw Error('正式轮次记录无效。');
    if (['complete','correction'].includes(entry.type) && (typeof entry.score !== 'number' || !Number.isFinite(entry.score) || entry.score < 0)) throw Error('历史分数无效。');
    if (entry.type === 'bonus') {
      if (!numbers.includes(entry.no) || typeof entry.round !== 'string' || !entry.round || bonusRounds.has(entry.round) || !Array.isArray(entry.entrants) || !entry.entrants.includes(entry.no) || entry.entrants.some(n=>!numbers.includes(n)) || new Set(entry.entrants).size !== entry.entrants.length) throw Error('Bonus 记录无效或重复。');
      bonusRounds.add(entry.round);
    }
  }
  if (s.pending && (!numbers.includes(s.pending.no) || ![0,1].includes(s.pending.q) || s.students.find(p=>p.no===s.pending.no).q[s.pending.q] !== null || s.absent.includes(s.pending.no) || s.pending.q !== round(s))) throw Error('待确认抽签记录无效。');
  return s;
}

export function round(s) {
  return [0,1].find(q => s.students.some(p => p.q[q] === null)) ?? 2;
}

export function eligible(s) {
  const q = round(s);
  return q === 2 ? [] : s.students.filter(p => p.q[q] === null && !s.absent.includes(p.no));
}

export function pick(items) {
  if (!items.length) throw Error('当前没有可抽取的人。');
  const max = 0x100000000, limit = max - max % items.length, value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return items[value[0] % items.length];
}
