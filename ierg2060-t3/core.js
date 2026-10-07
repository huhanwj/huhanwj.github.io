// State retains class numbers, optional names, completed turns and draw history.
// Student IDs and numeric scores are never retained.
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

export function fromSheet(text) {
  const rows = parseCSV(text);
  const heading = value => value.trim().replace(/\s+/g, '');
  const header = rows.findIndex(r => r.some(x => heading(x) === 'No.') && r.some(x => heading(x) === 'Question1'));
  if (header < 0) throw Error('未找到 No. / Question 1 表头，请导出 Tutorial 3 工作表为 CSV。');
  const columns = rows[header].map(heading);
  const col = name => {
    const i = columns.indexOf(name);
    if (i < 0 || columns.lastIndexOf(name) !== i) throw Error(`缺少或重复 ${name} 列。`);
    return i;
  };
  const noCol = col('No.'), classCol = col('TutorialClass'), qCols = [col('Question1'), col('Question2')];
  const nameColumns = rows[header].map((value, index) => value.trim() === 'Name' ? index : -1).filter(index => index >= 0);
  if (nameColumns.length > 1) throw Error('重复 Name 列。');
  const nameCol = nameColumns[0];
  const students = rows.slice(header + 1)
    .filter(r => /^\d+$/.test((r[noCol] || '').trim()) && r[classCol]?.trim() === 'Tutorial 3')
    .map(r => ({
      no: Number(r[noCol]),
      name: nameCol === undefined ? '' : r[nameCol] || '',
      q: qCols.map(i => {
        const cell = (r[i] || '').trim();
        if (!cell) return false;
        if (!Number.isFinite(Number(cell))) throw Error(`编号 ${r[noCol]} 的 Question 单元格必须是数字或空白。`);
        return true;
      })
    }));
  if (!students.length) throw Error('没有找到 Tutorial 3 学生记录。');
  return validateState({ version: 2, students, absent: [], batches: [], bonus: [] });
}

function knownNumbers(values, known, message, allowEmpty = true) {
  if (!Array.isArray(values) || (!allowEmpty && !values.length) || values.length > 500 ||
      [...values].some(n => !Number.isSafeInteger(n) || !known.has(n)) || new Set(values).size !== values.length) throw Error(message);
  return [...values];
}

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) throw Error('抽签时间无效。');
  return new Date(value).toISOString();
}

function token(value, message) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error(message);
  return value;
}

function studentName(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u0008\u000e-\u001f\u007f]/.test(value)) throw Error('学生姓名无效。');
  return value.trim().replace(/\s+/g, ' ');
}

export function validateState(s) {
  if (!s || s.version !== 2 || !Array.isArray(s.students) || !s.students.length || s.students.length > 500) throw Error('备份格式无效。');
  const students = s.students.map(p => {
    if (!p || !Number.isSafeInteger(p.no) || p.no < 1 || !Array.isArray(p.q) || p.q.length !== 2 || [...p.q].some(q => typeof q !== 'boolean')) throw Error('编号或抽签进度无效。');
    return { no: p.no, name: studentName(p.name), q: [...p.q] };
  }).sort((a, b) => a.no - b.no);
  const known = new Set(students.map(p => p.no));
  if (known.size !== students.length) throw Error('编号重复。');
  const absent = knownNumbers(s.absent, known, '缺席名单无效或重复。').sort((a, b) => a - b);
  if (!Array.isArray(s.batches) || s.batches.length > 500 || !Array.isArray(s.bonus) || s.bonus.length > 500) throw Error('抽签记录格式无效。');
  const ids = new Set(), drawn = new Set();
  const byNo = new Map(students.map(p => [p.no, p]));
  const batches = s.batches.map(entry => {
    if (!entry || ![0, 1].includes(entry.q)) throw Error('正式轮次记录无效。');
    const id = token(entry.id, '批次编号无效。');
    if (ids.has(id)) throw Error('批次编号重复。');
    ids.add(id);
    const numbers = knownNumbers(entry.numbers, known, '批次包含未知或重复编号。', false);
    for (const no of numbers) {
      const key = `${entry.q}:${no}`;
      if (drawn.has(key) || !byNo.get(no).q[entry.q]) throw Error('批次与抽签进度不一致。');
      drawn.add(key);
    }
    return { id, q: entry.q, numbers, at: timestamp(entry.at) };
  });
  // Reconstruct imported progress, then verify every retained batch was in its round.
  const replay = { students: students.map(p => ({ no: p.no, q: [...p.q] })) };
  const replayByNo = new Map(replay.students.map(p => [p.no, p]));
  for (const entry of batches) for (const no of entry.numbers) replayByNo.get(no).q[entry.q] = false;
  for (const entry of batches) {
    if (round(replay) !== entry.q) throw Error('必须全班都轮过一次，才能开始第二轮抽签。');
    for (const no of entry.numbers) replayByNo.get(no).q[entry.q] = true;
  }
  const rounds = new Set();
  const bonus = s.bonus.map(entry => {
    if (!entry || !known.has(entry.no)) throw Error('Bonus 记录包含未知编号。');
    const id = token(entry.round, 'Bonus 轮次编号无效。');
    const entrants = knownNumbers(entry.entrants, known, 'Bonus 报名名单无效或重复。', false);
    if (rounds.has(id) || !entrants.includes(entry.no)) throw Error('Bonus 结果无效或重复。');
    rounds.add(id);
    return { round: id, no: entry.no, entrants, drawnAt: timestamp(entry.drawnAt) };
  });
  return { version: 2, students, absent, batches, bonus };
}

export function mergeRoster(s, roster) {
  const state = validateState(s);
  const entries = Array.isArray(roster) ? roster : roster?.students;
  if (!Array.isArray(entries) || entries.length !== state.students.length) throw Error('导入名单的编号必须与当前名单完全一致。');
  const names = new Map();
  for (const entry of entries) {
    if (!entry || !Number.isSafeInteger(entry.no) || entry.no < 1 || names.has(entry.no)) throw Error('导入名单包含无效或重复编号。');
    names.set(entry.no, studentName(entry.name));
  }
  if (state.students.some(student => !names.has(student.no))) throw Error('导入名单的编号必须与当前名单完全一致。');
  state.students = state.students.map(student => ({ ...student, name: names.get(student.no) }));
  return validateState(state);
}

export function migrateState(old) {
  if (old?.version === 2) return validateState(old);
  if (!old || old.version !== 1 || !Array.isArray(old.students)) throw Error('备份格式无效。');
  const students = old.students.map(p => {
    if (!p || !Array.isArray(p.q) || p.q.length !== 2 || [...p.q].some(q => q !== null && (typeof q !== 'object' || Array.isArray(q)))) throw Error('旧版学生记录无效。');
    return { no: p.no, name: studentName(p.name), q: p.q.map(q => q !== null) };
  });
  const state = validateState({ version: 2, students, absent: old.absent, batches: [], bonus: [] });
  if (old.pending != null) {
    const pending = old.pending;
    const student = state.students.find(p => p.no === pending.no);
    if (!student || ![0, 1].includes(pending.q) || pending.q !== round(state) || student.q[pending.q] || state.absent.includes(pending.no)) throw Error('旧版待确认抽签记录无效。');
    student.q[pending.q] = true;
    state.batches.push({ id: crypto.randomUUID(), q: pending.q, numbers: [pending.no], at: timestamp(pending.at) });
  }
  return validateState(state);
}

export function round(s) {
  return [0, 1].find(q => s.students.some(p => !p.q[q])) ?? 2;
}

export function eligible(s) {
  const q = round(s);
  return q === 2 ? [] : s.students.filter(p => !p.q[q] && !s.absent.includes(p.no));
}

export function parseAbsent(text, students) {
  if (typeof text !== 'string' || (text !== '' && !/^[1-9]\d*(,[1-9]\d*)*$/.test(text))) throw Error('请只用英文逗号分隔正整数编号，不要添加空格。');
  const known = new Set(students.map(p => p.no));
  return knownNumbers(text === '' ? [] : text.split(',').map(Number), known, '缺席名单包含未知或重复编号。').sort((a, b) => a - b);
}

export function pick(items) {
  if (!Array.isArray(items) || !items.length || items.length > 0x100000000) throw Error('当前没有可抽取的人。');
  const max = 0x100000000, limit = max - max % items.length, value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return items[value[0] % items.length];
}

export function drawBatch(s, n) {
  const state = validateState(s);
  if (!Number.isSafeInteger(n) || n < 1 || n > 500) throw Error('每批人数必须是 1 到 500 的整数。');
  const q = round(state), pool = eligible(state).map(p => p.no), numbers = [];
  if (!pool.length) throw Error(q === 2 ? '全班已完成两轮。' : '本轮剩余同学均缺席，等待补齐后继续。');
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const no = pick(pool);
    numbers.push(no);
    pool.splice(pool.indexOf(no), 1);
  }
  for (const student of state.students) if (numbers.includes(student.no)) student.q[q] = true;
  state.batches.push({ id: crypto.randomUUID(), q, numbers, at: new Date().toISOString() });
  state.batches = state.batches.slice(-500);
  return validateState(state);
}
