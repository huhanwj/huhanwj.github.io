/* Private, owner-executed persistence. Setup requires the signed-in owner. */
const SOURCE_ID_ = '1_i5yaOroKaS4I0wgp5NYtLNmpHnwMHYdwUjviUnwUIs';
const SOURCE_GID_ = 521726463;
const ADMIN_EMAIL_ = 'huhanwj@gmail.com';

function setup() {
  authenticate_();
  return locked_(setup_);
}

function setup_() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty('ADMIN_KEY');
  let id = properties.getProperty('STORE_ID');
  if (!id) {
    const book = SpreadsheetApp.create('IERG2060 Tutorial 3 — private draw progress');
    book.getSheets()[0].setName('State');
    book.getSheetByName('State').getRange('A1').setValue(JSON.stringify({revision:0,state:null,room:null,requests:[]}));
    book.insertSheet('Draw log');
    id = book.getId();
    properties.setProperty('STORE_ID', id);
  }
  const book = SpreadsheetApp.openById(id);
  if (!book.getSheetByName('Roster')) {
    // Validate the permitted source fields before creating the private snapshot.
    const roster = sourceRoster_();
    const sheet = book.insertSheet('Roster');
    try {
      sheet.getRange(2,2,roster.length,1).setNumberFormat('@');
      // Leading apostrophes store names as literal text, even if they start '='.
      const rows = [['No.','Name','Turn1','Turn2']].concat(roster.map(p => [p.no,"'" + p.name,p.q[0],p.q[1]]));
      sheet.getRange(1,1,rows.length,4).setValues(rows);
      sheet.setFrozenRows(1);
      SpreadsheetApp.flush();
    } catch (error) {
      book.deleteSheet(sheet);
      throw error;
    }
  }
  roster_();
  const storageUrl = 'https://docs.google.com/spreadsheets/d/' + id;
  console.log('Private storage: ' + storageUrl);
  return {storageUrl:storageUrl};
}

function doGet(e) {
  if (!e || !e.parameter || !e.parameter.channel) {
    authenticate_();
    return HtmlService.createHtmlOutput('<p>Google account confirmed. Return to the draw page and click Connect Google Sheets.</p>').setTitle('IERG2060 administrator');
  }
  const template = HtmlService.createTemplateFromFile('Bridge');
  const channel = e && e.parameter && e.parameter.channel;
  template.channel = typeof channel === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(channel) ? channel : '';
  return template.evaluate().setTitle('IERG2060 cloud connection').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function rpc(action, payload) {
  payload = payload || {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid cloud request.');
  const publicAction = action === 'bonusJoin' || action === 'bonusInfo';
  const email = publicAction ? null : authenticate_();
  if (Object.prototype.hasOwnProperty.call(payload, 'adminKey') || Object.prototype.hasOwnProperty.call(payload, 'email')) throw Error('Account credentials must not be supplied in a cloud request.');
  if (action === 'auth') return {ok:true,email:email};
  if (action === 'names') return {roster:roster_()};
  if (action === 'load') {
    return locked_(function () {
      const document = read_(), roster = roster_();
      if (document.state) refreshNames_(document.state, roster);
      return {state:document.state,revision:document.revision,roster:roster};
    });
  }
  if (action === 'bonusInfo') return locked_(function () {
    const room = requireRoom_(read_(), payload.room);
    return {id:room.id,open:room.open,winner:room.winner};
  });
  if (action === 'bonusStatus') return locked_(function () {return {room:read_().room};});
  if (!['initialize','save','bonusOpen','bonusClose','bonusDraw','bonusReset','bonusJoin','bonusRemove'].includes(action)) throw Error('Unknown cloud action.');
  return locked_(function () {
    const document = read_();
    if (action === 'bonusJoin') return join_(document, payload);
    const requestId = token_(payload.requestId, 'A requestId is required.');
    const fingerprint = digest_({action:action,payload:Object.keys(payload).sort().reduce((o,k) => {o[k]=payload[k];return o;}, {})});
    const prior = document.requests.find(r => r.id === requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Error('This requestId was already used for a different operation.');
      return result_(document, action, prior.room);
    }
    let roomReceipt;
    if (action === 'save' || action === 'initialize') {
      if (payload.revision !== document.revision) throw Error('Cloud progress changed. Reload before saving.');
      if (action === 'initialize' && document.state) throw Error('Cloud progress is already initialized. Reload it.');
      if (action === 'save' && !document.state) throw Error('Initialize cloud progress first.');
      const roster = roster_();
      const next = cleanState_(payload.state, roster);
      if (document.state) {
        // Bonus results are committed by the server, independently of host polling.
        next.bonus = document.state.bonus;
        forwardOnly_(document.state, next);
      }
      document.state = next;
      document.revision++;
    } else if (action === 'bonusOpen') {
      if (!document.state) throw Error('Initialize cloud progress first.');
      if (document.room && (document.room.open || (!document.room.winner && document.room.entrants.length))) throw Error('Close and finish or reset the current Bonus round first.');
      const absent = numbers_(payload.absent, new Set(document.state.students.map(p => p.no)), true);
      document.room = {id:Utilities.getUuid(),open:true,entrants:[],winner:null,absent:absent,drawnAt:null};
      roomReceipt = document.room;
    } else if (action === 'bonusReset') {
      if (document.room) requireRoom_(document, payload.room);
      else if (payload.room) throw Error('This Bonus link has expired. Ask for the latest QR code.');
      document.room = null;
    } else {
      const room = requireRoom_(document, payload.room);
      if (action === 'bonusClose') room.open = false;
      if (action === 'bonusRemove') {
        if (room.winner) throw Error('This Bonus result is already saved.');
        room.entrants = room.entrants.filter(no => no !== payload.no);
      }
      if (action === 'bonusDraw') {
        if (room.winner) {roomReceipt = room;}
        else {
          if (room.open) throw Error('Close Bonus registration before drawing.');
          const roster = roster_();
          refreshNames_(document.state, roster);
          const absent = new Set(room.absent.concat(document.state.absent));
          const eligible = new Set(document.state.students.filter(p => !absent.has(p.no)).map(p => p.no));
          room.entrants = room.entrants.filter(no => eligible.has(no)).sort((a,b) => a-b);
          if (!room.entrants.length) throw Error('There are no eligible Bonus entries.');
          const no = room.entrants[Math.floor(Math.random() * room.entrants.length)];
          const student = document.state.students.find(p => p.no === no);
          room.winner = {no:no,name:student.name};
          room.drawnAt = new Date().toISOString();
          document.state.bonus.push({round:room.id,no:no,entrants:room.entrants.slice(),drawnAt:room.drawnAt});
          document.revision++;
          roomReceipt = room;
        }
      }
      if (action !== 'bonusDraw') roomReceipt = room;
    }
    document.requests.push({id:requestId,fingerprint:fingerprint,room:roomReceipt || null});
    document.requests = document.requests.slice(-30);
    write_(document);
    return result_(document, action, roomReceipt);
  });
}

function authenticate_() {
  // An owner-executed public deployment has the owner's effective identity even
  // for anonymous callers. Only the server's active user identifies the caller.
  const active = Session.getActiveUser().getEmail();
  const effective = Session.getEffectiveUser().getEmail();
  if (active !== ADMIN_EMAIL_ || effective !== ADMIN_EMAIL_) throw Error('Sign in to Google as ' + ADMIN_EMAIL_ + ' and open the private admin connection.');
  return active;
}
function locked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw Error('The cloud service is busy. Retry the same request.');
  try {return fn();} finally {lock.releaseLock();}
}
function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('STORE_ID');
  if (!id) throw Error('Cloud setup is incomplete. The owner must run setup.');
  return SpreadsheetApp.openById(id);
}
function read_() {
  const text = book_().getSheetByName('State').getRange('A1').getValue();
  const document = JSON.parse(text);
  if (!document || !Number.isSafeInteger(document.revision) || !Array.isArray(document.requests)) throw Error('Private cloud state is invalid. Ask the instructor to recover it.');
  return document;
}
function write_(document) {
  const serialized = JSON.stringify(document);
  if (serialized.length > 45000) throw Error('Cloud history is full. Export a backup and ask the owner to archive it.');
  const book = book_();
  book.getSheetByName('State').getRange('A1').setValue(serialized);
  SpreadsheetApp.flush();
  // A display-log failure must not turn a committed result into a redraw.
  try {log_(book, document.state);} catch (error) {console.warn('Draw log refresh failed: ' + error.message);}
}
function result_(document, action, roomReceipt) {
  if (action === 'initialize' || action === 'save') return {state:document.state,revision:document.revision};
  if (action === 'bonusDraw') return {state:document.state,revision:document.revision,room:roomReceipt || document.room};
  return {room:roomReceipt || document.room};
}
function requireRoom_(document, id) {
  if (!document.room || document.room.id !== id) throw Error('This Bonus link has expired. Ask for the latest QR code.');
  return document.room;
}
function join_(document, payload) {
  const room = requireRoom_(document, payload.room);
  const no = typeof payload.no === 'string' && /^\d+$/.test(payload.no) ? Number(payload.no) : payload.no;
  // A retry can recover an accepted receipt even after registration closes.
  if (room.entrants.includes(no)) return {status:'joined',no:no,duplicate:true};
  if (!room.open || room.winner) throw Error('Bonus registration is closed.');
  if (!Number.isSafeInteger(no) || !document.state.students.some(p => p.no === no) || room.absent.includes(no) || document.state.absent.includes(no)) throw Error('This roster No. cannot join. Check with the instructor.');
  const duplicate = room.entrants.includes(no);
  if (!duplicate) {room.entrants.push(no);room.entrants.sort((a,b) => a-b);write_(document);}
  return {status:'joined',no:no,duplicate:duplicate};
}

function sourceRoster_() {
  const sheet = SpreadsheetApp.openById(SOURCE_ID_).getSheets().find(s => s.getSheetId() === SOURCE_GID_);
  if (!sheet) throw Error('Tutorial 3 source worksheet was not found.');
  // Header cells only; the Student ID column is never read below the header.
  const firstColumn = sheet.getRange(1,1,Math.min(10,sheet.getLastRow()),1).getDisplayValues();
  const headerRow = firstColumn.findIndex(row => row[0].trim() === 'No.');
  if (headerRow < 0) throw Error('The source roster headers were not found.');
  const headings = sheet.getRange(headerRow+1,1,1,sheet.getLastColumn()).getDisplayValues()[0];
  const header = headings.map(v => v.trim().replace(/\s+/g,''));
  const column = name => {
    const index = header.indexOf(name);
    if (index < 0 || header.lastIndexOf(name) !== index) throw Error('Missing or duplicate source column: ' + name);
    return index + 1;
  };
  const count = sheet.getLastRow() - headerRow - 1;
  if (count < 1) throw Error('The source roster is empty.');
  const read = name => sheet.getRange(headerRow+2,column(name),count,1).getDisplayValues().map(r => r[0]);
  const nos = read('No.'), names = read('Name'), classes = read('TutorialClass');
  // Scores are converted to participation flags immediately, and never stored or returned.
  const completed = v => {
    const cell = v.trim();
    if (cell && !Number.isFinite(Number(cell))) throw Error('A Question cell must be a number or blank.');
    return !!cell;
  };
  const q1 = read('Question1').map(completed), q2 = read('Question2').map(completed);
  const roster = nos.map((v,i) => ({no:/^\d+$/.test(v.trim()) ? Number(v) : null,name:names[i].trim(),q:[q1[i],q2[i]],className:classes[i].trim()}))
    .filter(p => p.no > 0 && p.className === 'Tutorial 3').map(p => ({no:p.no,name:p.name,q:p.q})).sort((a,b) => a.no-b.no);
  return validateRoster_(roster);
}
function roster_() {
  const sheet = book_().getSheetByName('Roster');
  if (!sheet) throw Error('The private roster is missing. The owner must run setup.');
  const count = sheet.getLastRow() - 1;
  if (count < 1 || count > 500) throw Error('The private roster must contain 1 to 500 students.');
  const rows = sheet.getRange(1,1,count+1,4).getValues();
  if (JSON.stringify(rows[0]) !== JSON.stringify(['No.','Name','Turn1','Turn2'])) throw Error('The private roster headers are invalid.');
  return validateRoster_(rows.slice(1).map(row => ({no:row[0],name:row[1],q:[row[2],row[3]]}))).sort((a,b) => a.no-b.no);
}
function validateRoster_(roster) {
  if (!roster.length || roster.length > 500 || roster.some(p => !Number.isSafeInteger(p.no) || p.no < 1) || new Set(roster.map(p => p.no)).size !== roster.length) throw Error('The Tutorial 3 roster has invalid or duplicate numbers.');
  if (roster.some(p => typeof p.name !== 'string' || !p.name.trim() || p.name.length > 200 || !Array.isArray(p.q) || p.q.length !== 2 || p.q.some(q => typeof q !== 'boolean'))) throw Error('The private roster requires names up to 200 characters and boolean participation flags.');
  return roster;
}
function refreshNames_(state, roster) {
  const byNo = new Map(roster.map(p => [p.no,p.name]));
  if (state.students.length !== roster.length || state.students.some(p => !byNo.has(p.no))) throw Error('The private roster changed. Ask the instructor to review cloud progress.');
  state.students.forEach(p => {p.name=byNo.get(p.no) || '';});
}
function token_(value, message) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error(message);
  return value;
}
function time_(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw Error('Invalid draw timestamp.');
  return new Date(value).toISOString();
}
function numbers_(values, known, empty) {
  if (!Array.isArray(values) || values.length > 500 || (!empty && !values.length) || values.some(n => !Number.isSafeInteger(n) || !known.has(n)) || new Set(values).size !== values.length) throw Error('Unknown or duplicate roster numbers.');
  return values.slice();
}
function cleanState_(input, roster) {
  if (!input || input.version !== 2 || !Array.isArray(input.students) || input.students.length !== roster.length) throw Error('The cloud state must match the Tutorial 3 roster.');
  const known = new Set(roster.map(p => p.no)), names = new Map(roster.map(p => [p.no,p.name]));
  const students = input.students.map(p => {
    if (!p || !known.has(p.no) || !Array.isArray(p.q) || p.q.length !== 2 || p.q.some(q => typeof q !== 'boolean')) throw Error('Invalid participation progress.');
    return {no:p.no,name:names.get(p.no),q:p.q.slice()};
  }).sort((a,b) => a.no-b.no);
  if (new Set(students.map(p => p.no)).size !== roster.length) throw Error('Duplicate roster numbers.');
  const absent = numbers_(input.absent,known,true).sort((a,b) => a-b);
  if (!Array.isArray(input.batches) || input.batches.length > 500 || !Array.isArray(input.bonus) || input.bonus.length > 500) throw Error('Invalid draw history.');
  const ids = new Set(), drawn = new Set(), byNo = new Map(students.map(p => [p.no,p]));
  const batches = input.batches.map(b => {
    if (!b || ![0,1].includes(b.q)) throw Error('Invalid participation round.');
    const id = token_(b.id,'Invalid batch ID.');
    if (ids.has(id)) throw Error('Duplicate batch ID.');
    ids.add(id);
    const numbers = numbers_(b.numbers,known,false);
    numbers.forEach(no => {
      const key = b.q + ':' + no;
      if (drawn.has(key) || !byNo.get(no).q[b.q]) throw Error('A student was repeated or the history disagrees with progress.');
      drawn.add(key);
    });
    return {id:id,q:b.q,numbers:numbers,at:time_(b.at)};
  });
  const replay = new Map(students.map(p => [p.no,p.q.slice()]));
  batches.forEach(b => b.numbers.forEach(no => {replay.get(no)[b.q]=false;}));
  batches.forEach(b => {
    const active = [0,1].find(q => students.some(p => !replay.get(p.no)[q]));
    if (active !== b.q) throw Error('Finish the first class round before starting the second.');
    b.numbers.forEach(no => {replay.get(no)[b.q]=true;});
  });
  const rounds = new Set();
  const bonus = input.bonus.map(b => {
    if (!b || !known.has(b.no)) throw Error('Invalid Bonus result.');
    const id = token_(b.round,'Invalid Bonus round.');
    const entrants = numbers_(b.entrants,known,false);
    if (rounds.has(id) || !entrants.includes(b.no)) throw Error('Duplicate or inconsistent Bonus result.');
    rounds.add(id);
    return {round:id,no:b.no,entrants:entrants,drawnAt:time_(b.drawnAt)};
  });
  return {version:2,students:students,absent:absent,batches:batches,bonus:bonus};
}
function forwardOnly_(old, next) {
  const previous = new Map(old.students.map(p => [p.no,p]));
  next.students.forEach(p => {
    const before = previous.get(p.no);
    if (!before || before.q.some((q,i) => q && !p.q[i])) throw Error('Saved participation cannot be rolled back.');
  });
  if (old.students.length !== next.students.length || next.batches.length < old.batches.length || old.batches.some((b,i) => JSON.stringify(b) !== JSON.stringify(next.batches[i]))) throw Error('Saved batches cannot be removed or changed.');
  const added = next.batches.slice(old.batches.length);
  const changes = new Set(added.flatMap(b => b.numbers.map(no => b.q+':'+no)));
  next.students.forEach(p => p.q.forEach((q,i) => {
    if (q !== previous.get(p.no).q[i] && !changes.has(i+':'+p.no)) throw Error('New participation must have a saved batch.');
  }));
  added.forEach(b => b.numbers.forEach(no => {
    if (previous.get(no).q[b.q] || next.absent.includes(no)) throw Error('A new batch contains a previously drawn or absent student.');
  }));
}
function digest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value),Utilities.Charset.UTF_8).map(n => (n+256).toString(16).slice(-2)).join('');
}
function log_(book,state) {
  if (!state) return;
  const names = new Map(state.students.map(p => [p.no,p.name]));
  const rows = [['Kind','Round / batch','Participation round','Question in batch','Roster No.','Name','Saved at']];
  state.batches.forEach(b => b.numbers.forEach((no,i) => rows.push(['Participation',b.id,b.q+1,i+1,no,names.get(no),b.at])));
  state.bonus.forEach(b => rows.push(['Bonus',b.round,'','',b.no,names.get(b.no),b.drawnAt]));
  const sheet = book.getSheetByName('Draw log');
  sheet.clearContents();
  sheet.getRange(1,1,rows.length,7).setValues(rows.map(row => row.map(v => typeof v === 'string' && /^[=+\-@]/.test(v) ? "'"+v : v)));
  sheet.setFrozenRows(1);
}
