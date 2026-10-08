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
      else throw Error('Invalid CSV quoting.');
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw Error('Unclosed CSV quote.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function fromSheet(text) {
  const rows = parseCSV(text);
  const heading = value => value.trim().replace(/\s+/g, '');
  const header = rows.findIndex(r => r.some(x => heading(x) === 'No.') && r.some(x => heading(x) === 'Question1'));
  if (header < 0) throw Error('No. / Question 1 headers not found. Export the Tutorial 3 sheet as CSV.');
  const columns = rows[header].map(heading);
  const col = name => {
    const i = columns.indexOf(name);
    if (i < 0 || columns.lastIndexOf(name) !== i) throw Error(`Missing or duplicate ${name} column.`);
    return i;
  };
  const noCol = col('No.'), classCol = col('TutorialClass'), qCols = [col('Question1'), col('Question2')];
  const nameColumns = rows[header].map((value, index) => value.trim() === 'Name' ? index : -1).filter(index => index >= 0);
  if (nameColumns.length > 1) throw Error('Duplicate Name column.');
  const nameCol = nameColumns[0];
  const students = rows.slice(header + 1)
    .filter(r => /^\d+$/.test((r[noCol] || '').trim()) && r[classCol]?.trim() === 'Tutorial 3')
    .map(r => ({
      no: Number(r[noCol]),
      name: nameCol === undefined ? '' : r[nameCol] || '',
      q: qCols.map(i => {
        const cell = (r[i] || '').trim();
        if (!cell) return false;
        if (!Number.isFinite(Number(cell))) throw Error(`Question cells for No. ${r[noCol]} must be numeric or blank.`);
        return true;
      })
    }));
  if (!students.length) throw Error('No Tutorial 3 student records found.');
  return validateState({ version: 2, students, absent: [], batches: [], bonus: [] });
}

function knownNumbers(values, known, message, allowEmpty = true) {
  if (!Array.isArray(values) || (!allowEmpty && !values.length) || values.length > 500 ||
      [...values].some(n => !Number.isSafeInteger(n) || !known.has(n)) || new Set(values).size !== values.length) throw Error(message);
  return [...values];
}

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) throw Error('Invalid draw timestamp.');
  return new Date(value).toISOString();
}

function token(value, message) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error(message);
  return value;
}

function studentName(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u0008\u000e-\u001f\u007f]/.test(value)) throw Error('Invalid student name.');
  return value.trim().replace(/\s+/g, ' ');
}

function checkedQuestionStart(value, count) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500 || value + count - 1 > 500) throw Error('Question numbers must be integers from 1 to 500, including the final question.');
  return value;
}

export function validateState(s) {
  if (!s || s.version !== 2 || !Array.isArray(s.students) || !s.students.length || s.students.length > 500) throw Error('Invalid backup format.');
  const students = s.students.map(p => {
    if (!p || !Number.isSafeInteger(p.no) || p.no < 1 || !Array.isArray(p.q) || p.q.length !== 2 || [...p.q].some(q => typeof q !== 'boolean')) throw Error('Invalid roster number or participation progress.');
    return { no: p.no, name: studentName(p.name), q: [...p.q] };
  }).sort((a, b) => a.no - b.no);
  const known = new Set(students.map(p => p.no));
  if (known.size !== students.length) throw Error('Duplicate roster number.');
  const absent = knownNumbers(s.absent, known, 'Invalid or duplicate absent numbers.').sort((a, b) => a - b);
  if (!Array.isArray(s.batches) || s.batches.length > 500 || !Array.isArray(s.bonus) || s.bonus.length > 500) throw Error('Invalid draw history format.');
  const ids = new Set(), drawn = new Set();
  const byNo = new Map(students.map(p => [p.no, p]));
  const batches = s.batches.map(entry => {
    if (!entry || ![0, 1].includes(entry.q)) throw Error('Invalid participation round.');
    const id = token(entry.id, 'Invalid batch ID.');
    if (ids.has(id)) throw Error('Duplicate batch ID.');
    ids.add(id);
    const numbers = knownNumbers(entry.numbers, known, 'Batch contains unknown or duplicate roster numbers.', false);
    for (const no of numbers) {
      const key = `${entry.q}:${no}`;
      if (drawn.has(key) || !byNo.get(no).q[entry.q]) throw Error('Draw history does not match participation progress.');
      drawn.add(key);
    }
    const batch = { id, q: entry.q, numbers, at: timestamp(entry.at) };
    if (Object.prototype.hasOwnProperty.call(entry, 'questionStart')) batch.questionStart = checkedQuestionStart(entry.questionStart, numbers.length);
    return batch;
  });
  // Reconstruct imported progress, then verify every retained batch was in its round.
  const replay = { students: students.map(p => ({ no: p.no, q: [...p.q] })) };
  const replayByNo = new Map(replay.students.map(p => [p.no, p]));
  for (const entry of batches) for (const no of entry.numbers) replayByNo.get(no).q[entry.q] = false;
  for (const entry of batches) {
    if (round(replay) !== entry.q) throw Error('Everyone must complete the first round before the second round begins.');
    for (const no of entry.numbers) replayByNo.get(no).q[entry.q] = true;
  }
  const rounds = new Set();
  const bonus = s.bonus.map(entry => {
    if (!entry || !known.has(entry.no)) throw Error('Bonus record contains an unknown roster number.');
    const id = token(entry.round, 'Invalid Bonus round ID.');
    const entrants = knownNumbers(entry.entrants, known, 'Invalid or duplicate Bonus entries.', false);
    if (rounds.has(id) || !entrants.includes(entry.no)) throw Error('Invalid or duplicate Bonus result.');
    rounds.add(id);
    return { round: id, no: entry.no, entrants, drawnAt: timestamp(entry.drawnAt) };
  });
  return { version: 2, students, absent, batches, bonus };
}

export function mergeRoster(s, roster) {
  const state = validateState(s);
  const entries = Array.isArray(roster) ? roster : roster?.students;
  if (!Array.isArray(entries) || entries.length !== state.students.length) throw Error('Imported roster numbers must exactly match the current roster.');
  const names = new Map();
  for (const entry of entries) {
    if (!entry || !Number.isSafeInteger(entry.no) || entry.no < 1 || names.has(entry.no)) throw Error('Imported roster contains invalid or duplicate numbers.');
    names.set(entry.no, studentName(entry.name));
  }
  if (state.students.some(student => !names.has(student.no))) throw Error('Imported roster numbers must exactly match the current roster.');
  state.students = state.students.map(student => ({ ...student, name: names.get(student.no) }));
  return validateState(state);
}

export function migrateState(old) {
  if (old?.version === 2) return validateState(old);
  if (!old || old.version !== 1 || !Array.isArray(old.students)) throw Error('Invalid backup format.');
  const students = old.students.map(p => {
    if (!p || !Array.isArray(p.q) || p.q.length !== 2 || [...p.q].some(q => q !== null && (typeof q !== 'object' || Array.isArray(q)))) throw Error('Invalid legacy student record.');
    return { no: p.no, name: studentName(p.name), q: p.q.map(q => q !== null) };
  });
  const state = validateState({ version: 2, students, absent: old.absent, batches: [], bonus: [] });
  if (old.pending != null) {
    const pending = old.pending;
    const student = state.students.find(p => p.no === pending.no);
    if (!student || ![0, 1].includes(pending.q) || pending.q !== round(state) || student.q[pending.q] || state.absent.includes(pending.no)) throw Error('Invalid legacy pending draw.');
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
  if (typeof text !== 'string' || (text !== '' && !/^[1-9]\d*(,[1-9]\d*)*$/.test(text))) throw Error('Use positive roster numbers separated by commas, with no spaces.');
  const known = new Set(students.map(p => p.no));
  return knownNumbers(text === '' ? [] : text.split(',').map(Number), known, 'Absent list contains unknown or duplicate roster numbers.').sort((a, b) => a - b);
}

export function pick(items) {
  if (!Array.isArray(items) || !items.length || items.length > 0x100000000) throw Error('No students are available to draw.');
  const max = 0x100000000, limit = max - max % items.length, value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return items[value[0] % items.length];
}

export function drawBatch(s, n, questionStart) {
  const state = validateState(s);
  if (!Number.isSafeInteger(n) || n < 1 || n > 500) throw Error('Draw count must be an integer from 1 to 500.');
  const q = round(state), pool = eligible(state).map(p => p.no), numbers = [];
  if (!pool.length) throw Error(q === 2 ? 'Everyone has completed both rounds.' : 'The remaining students in this round are absent. This round stays open.');
  const count = Math.min(n, pool.length);
  if (questionStart !== undefined) checkedQuestionStart(questionStart, count);
  for (let i = 0; i < count; i++) {
    const no = pick(pool);
    numbers.push(no);
    pool.splice(pool.indexOf(no), 1);
  }
  for (const student of state.students) if (numbers.includes(student.no)) student.q[q] = true;
  const batch = { id: crypto.randomUUID(), q, numbers, at: new Date().toISOString() };
  if (questionStart !== undefined) batch.questionStart = questionStart;
  state.batches.push(batch);
  state.batches = state.batches.slice(-500);
  return validateState(state);
}
