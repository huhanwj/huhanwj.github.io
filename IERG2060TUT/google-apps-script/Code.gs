/* Private, owner-executed persistence for every tutorial group. */
// The owner hosts all groups. Each group's TAs sign in with Google and see only
// their own group; the owner sees every group. Groups are configured in the
// "Groups" tab of the Tutorial 3 storage spreadsheet.
const OWNER_EMAIL_ = 'huhanwj@gmail.com';
// The public OAuth Web client ID used by "Sign in with Google" on the site.
const OAUTH_CLIENT_ID_ = '640283797508-j4moo4ih67u53nhpfp88mqeu47ctn3if.apps.googleusercontent.com';
const GROUP_ID_ = /^[a-z0-9]{1,16}$/;
const GROUPS_SHEET_ = 'Groups';
const GROUP_HEADERS_ = ['Group ID','Label','Tutorial Class','Answer sheet gid','TA emails'];
const DEFAULT_GROUPS_ = {t3:{id:'t3',label:'Tutorial 3',tutorialClass:'Tutorial 3',sourceGid:521726463,admins:[]}};
// The group whose storage this execution uses. Tutorial 3 keeps the original
// unprefixed Script Properties; other groups use a G_<id>_ prefix.
let GROUP_ = 't3';
let GROUPS_ = null;
function groupContext_(group, fn) {
  if (typeof group !== 'string' || !GROUP_ID_.test(group)) throw Error('Unknown tutorial group.');
  const previous = GROUP_;
  GROUP_ = group;SOURCE_RECORDS_ = null;
  try {return fn();} finally {GROUP_ = previous;SOURCE_RECORDS_ = null;}
}
// Reads the Groups tab once per execution. Without the tab only Tutorial 3 exists.
function groupsConfig_() {
  if (GROUPS_) return GROUPS_;
  const id = PropertiesService.getScriptProperties().getProperty('STORE_ID');
  const sheet = id ? SpreadsheetApp.openById(id).getSheetByName(GROUPS_SHEET_) : null;
  if (!sheet) return GROUPS_ = DEFAULT_GROUPS_;
  const groups = {};
  sheet.getDataRange().getDisplayValues().slice(1).filter(row => row[0].trim()).forEach(row => {
    const groupId = row[0].trim().toLowerCase();
    if (!GROUP_ID_.test(groupId) || groups[groupId]) throw Error('Groups tab: invalid or duplicate group ID "' + row[0] + '".');
    const gid = Number(row[3].trim());
    if (!Number.isSafeInteger(gid) || gid < 0) throw Error('Groups tab: group ' + groupId + ' needs the answer sheet gid.');
    groups[groupId] = {id:groupId,label:row[1].trim() || groupId,tutorialClass:row[2].trim(),sourceGid:gid,
      admins:row[4].split(/[,;\s]+/).map(email => email.trim().toLowerCase()).filter(Boolean)};
  });
  if (!groups.t3) groups.t3 = DEFAULT_GROUPS_.t3;
  return GROUPS_ = groups;
}
function config_() {
  const group = groupsConfig_()[GROUP_];
  if (!group) throw Error('Unknown tutorial group.');
  return group;
}
function groupList_(ids) {
  const groups = groupsConfig_();
  return Object.keys(groups).filter(id => ids === '*' || ids.includes(id)).map(id => ({id:id,label:groups[id].label}));
}
// Run by the owner (or created on the owner's first Google sign-in).
function ensureGroupsSheet_() {
  const book = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('STORE_ID'));
  if (book.getSheetByName(GROUPS_SHEET_)) return;
  const sheet = book.insertSheet(GROUPS_SHEET_);
  sheet.getRange(1,1,2,5).setValues([GROUP_HEADERS_,['t3','Tutorial 3','Tutorial 3','521726463','']]);
  sheet.getRange(1,1,1,5).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1,7).setValue('One row per group. TA emails: Gmail addresses separated by commas. The owner can open every group. Students sign up at the QR shown on that group\'s page.');
}
const BONUS_META_ = 'BONUS_ACTIVE_V1';
const BONUS_PENDING_ = 'BONUS_SYNC_V1';
const BONUS_SLOT_ = 'BONUS_SLOT_V1:';
// Salted SID hashes map a student's SID to a roster No.; raw SIDs are never stored.
const SID_INDEX_ = 'SID_INDEX_V1';
const SID_SALT_ = 'SID_SALT_V1';
// Signups queue on the script lock for one tiny property write; wait long
// enough that a whole class scanning together is served, not rejected as busy.
const SIGNUP_WAIT_MS_ = 20000;
// A dedicated test deployment sets this true in its deployed version only.
// Even legacy rpc callers on that deployment are then confined to test data.
const TEST_DEPLOYMENT_ONLY_ = false;
// Apps Script globals belong to one execution; the flag is restored even on
// failure. Test requests never change the production STORE_ID or journal.
let TEST_CONTEXT_ = TEST_DEPLOYMENT_ONLY_;

function testContext_(fn) {
  const previous = TEST_CONTEXT_;
  TEST_CONTEXT_ = true;
  try {return fn();} finally {TEST_CONTEXT_ = previous;}
}
function scopedProperty_(key) {
  return key === 'STORE_ID' || key === BONUS_META_ || key === BONUS_PENDING_ || key === SID_INDEX_ || key === SID_SALT_ || key.startsWith(BONUS_SLOT_);
}
function storagePrefix_() {
  return TEST_CONTEXT_ ? 'TEST_' : GROUP_ === 't3' ? '' : 'G_' + GROUP_ + '_';
}
function storageProperties_() {
  const properties = PropertiesService.getScriptProperties();
  const prefix = storagePrefix_();
  if (!prefix) return properties;
  const key_ = key => {
    if (!scopedProperty_(key)) throw Error('Invalid scoped storage property.');
    return prefix + key;
  };
  return {
    getProperty:key => properties.getProperty(key_(key)),
    setProperty:(key,value) => properties.setProperty(key_(key),value),
    deleteProperty:key => properties.deleteProperty(key_(key)),
    getProperties:() => {
      const values = properties.getProperties(), scoped = {};
      Object.keys(values).filter(key => key.startsWith(prefix) && scopedProperty_(key.slice(prefix.length))).forEach(key => {scoped[key.slice(prefix.length)]=values[key];});
      return scoped;
    },
    setProperties:values => {
      const scoped = {};
      Object.keys(values).forEach(key => {scoped[key_(key)]=values[key];});
      properties.setProperties(scoped);
    }
  };
}
function storeId_() {
  const id = storageProperties_().getProperty('STORE_ID');
  if (!id) throw Error(TEST_CONTEXT_ ? 'Test setup is incomplete. The owner must run setupTest.' : 'Cloud setup is incomplete. The owner must run setup.');
  if (storagePrefix_() && id === PropertiesService.getScriptProperties().getProperty('STORE_ID')) throw Error('Group and test storage must be separate from Tutorial 3.');
  return id;
}

// Run only as the signed-in owner from the editor. Re-running keeps test draws.
function setupTest() {
  authenticate_();
  return testContext_(function () {return locked_(setupTest_);});
}
function setupTest_() {
  const properties = storageProperties_();
  let id = properties.getProperty('STORE_ID');
  if (!id) {
    const book = SpreadsheetApp.create('IERG2060 Tutorial 3 — TEST — 35 fictional students');
    const roster = Array.from({length:35},(_,i) => ({no:i+1,name:'Test Student ' + String(i+1).padStart(2,'0'),q:[false,false]}));
    const document = {revision:0,state:{version:2,students:roster,absent:[],batches:[],bonus:[]},room:null,requests:[],attendance:[],batchDates:{}};
    book.getSheets()[0].setName('State');
    book.getSheetByName('State').getRange('A1').setValue(JSON.stringify(document));
    book.insertSheet('Draw log');
    const sheet = book.insertSheet('Roster');
    sheet.getRange(2,2,35,1).setNumberFormat('@');
    sheet.getRange(1,1,36,4).setValues([['No.','Name','Turn1','Turn2']].concat(roster.map(p => [p.no,"'" + p.name,false,false])));
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();
    id = book.getId();
    properties.setProperty('STORE_ID',id);
  }
  // A manually misconfigured test pointer cannot read or modify live storage.
  const book = book_(), roster = roster_();
  if (roster.length !== 35 || roster.some((p,i) => p.no !== i+1 || p.name !== 'Test Student ' + String(i+1).padStart(2,'0') || p.q.some(Boolean))) throw Error('The test roster must contain exactly the 35 fictional students.');
  const document = read_();
  if (!document.state) throw Error('The test state is missing. Recover the test spreadsheet without resetting production.');
  refreshNames_(document.state,roster);
  // Fictional SIDs 1155000001-1155000035 match Test Student 01-35.
  saveSidIndex_(roster, new Map(roster.map(p => [p.no,testSid_(p.no)])));
  const reportsWarning = refreshReports_(book,document);
  console.log('Test storage: ' + storageUrl_());
  return Object.assign(ownerMetadata_(document),reportsWarning ? {reportsWarning:reportsWarning} : {});
}

function rpcTest(action, payload, sessionToken) {
  return testContext_(function () {return rpc(action,payload,sessionToken);});
}

function setup() {
  authenticate_();
  if (TEST_DEPLOYMENT_ONLY_) throw Error('This deployment is test-only. Run setupTest.');
  return locked_(setup_);
}

// Creates this group's private storage, roster snapshot and SID index from the
// teaching sheet. Tutorial 3 runs it from the editor; other groups run it on
// their first sign-in. Re-running preserves existing storage and progress.
function setup_() {
  if (GROUP_ === 't3') PropertiesService.getScriptProperties().deleteProperty('ADMIN_KEY');
  const properties = storageProperties_();
  let id = properties.getProperty('STORE_ID');
  if (!id) {
    const book = SpreadsheetApp.create('IERG2060 ' + config_().label + ' — private draw progress');
    book.getSheets()[0].setName('State');
    book.getSheetByName('State').getRange('A1').setValue(JSON.stringify({revision:0,state:null,room:null,requests:[],attendance:[],batchDates:{}}));
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
  if (GROUP_ === 't3') ensureGroupsSheet_();
  const roster = roster_();
  const document = read_();
  // A new group starts directly from its roster; there is no browser import.
  if (!document.state) {
    document.state = {version:2,students:roster.map(p => ({no:p.no,name:p.name,q:p.q.slice()})),absent:[],batches:[],bonus:[],r2Source:[]};
    document.revision++;
    write_(document, false);
  }
  if (!properties.getProperty(SID_INDEX_)) {
    try {saveSidIndex_(roster, sourceSids_());}
    catch (error) {console.warn('SID index not created: ' + (error && error.message));}
  }
  const reportsWarning = refreshReports_(book, document);
  console.log('Private storage: ' + storageUrl_());
  return Object.assign(ownerMetadata_(document), reportsWarning ? {reportsWarning:reportsWarning} : {});
}

function doGet(e) {
  if (e && e.parameter && Object.prototype.hasOwnProperty.call(e.parameter, 'login')) {
    authenticate_();
    const state = loginState_(e.parameter.login);
    const code = loginSecret_();
    const grant = {state:state,email:OWNER_EMAIL_,expiresAt:Date.now()+300000};
    CacheService.getScriptCache().put(loginCacheKey_('grant', code), JSON.stringify(grant), 300);
    const template = HtmlService.createTemplateFromFile('SignIn');
    template.continueUrl = 'https://huhanwj.github.io/IERG2060TUT/auth-callback.html#code=' + code + '&state=' + state;
    return template.evaluate().setTitle('IERG2060 sign in').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  if (!e || !e.parameter || !e.parameter.channel) {
    authenticate_();
    return HtmlService.createHtmlOutput('<p>Google account confirmed. Return to the draw page and click Connect Google Sheets.</p>').setTitle('IERG2060 administrator');
  }
  const template = HtmlService.createTemplateFromFile('Bridge');
  const channel = e && e.parameter && e.parameter.channel;
  template.channel = typeof channel === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(channel) ? channel : '';
  template.testMode = TEST_DEPLOYMENT_ONLY_ || e.parameter.test === '1';
  const group = e.parameter.group;
  template.group = !template.testMode && typeof group === 'string' && GROUP_ID_.test(group) ? group : 't3';
  return template.evaluate().setTitle('IERG2060 cloud connection').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Bridges for groups other than Tutorial 3 call this with their group ID.
function rpcGroup(group, action, payload, sessionToken) {
  if (TEST_DEPLOYMENT_ONLY_) throw Error('This deployment is test-only.');
  return groupContext_(group, function () {return rpc(action,payload,sessionToken);});
}
function rpc(action, payload, sessionToken) {
  if (payload === undefined || payload === null) payload = {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid cloud request.');
  const publicAction = action === 'bonusJoin' || action === 'bonusInfo';
  if (publicAction) return publicRpc_(action, payload);
  if (action === 'exchangeLogin') return exchangeLogin_(payload);
  if (action === 'googleLogin') return googleLogin_(payload);
  const session = sessionToken === undefined ? {email:authenticate_(),groups:'*'} : authenticateSession_(sessionToken);
  // TAs reach only their own groups; test data belongs to the owner.
  if ((TEST_CONTEXT_ && session.groups !== '*') || (session.groups !== '*' && !session.groups.includes(GROUP_))) throw Error('This Google account cannot open this tutorial group.');
  const email = session.email;
  if (Object.prototype.hasOwnProperty.call(payload, 'adminKey') || Object.prototype.hasOwnProperty.call(payload, 'email')) throw Error('Account credentials must not be supplied in a cloud request.');
  if (action === 'auth') return {ok:true,email:email,environment:TEST_CONTEXT_ ? 'test' : 'production',group:GROUP_,groups:TEST_CONTEXT_ ? [] : groupList_(session.groups)};
  if (action === 'names') return locked_(function () {return Object.assign({roster:roster_()}, ownerMetadata_(read_()));});
  if (action === 'load') {
    return locked_(function () {
      if (!TEST_CONTEXT_ && !storageProperties_().getProperty('STORE_ID')) setup_();
      const document = read_(), roster = roster_();
      if (document.state) refreshNames_(document.state, roster);
      const sync = syncSourceAnswers_(document);
      if (sync.changed) {document.revision++;write_(document, false);}
      return Object.assign({state:document.state,revision:document.revision,roster:roster}, ownerMetadata_(document), sync.warning ? {sourceWarning:sync.warning} : {});
    });
  }
  if (action === 'recordsRefresh') return locked_(refreshRecords_);
  if (action === 'bonusStatus') return locked_(function () {const document=read_();return Object.assign({room:document.room}, ownerMetadata_(document));});
  if (action === 'bonusLive') return bonusLive_();
  if (!['initialize','save','attendanceSave','bonusOpen','bonusClose','bonusDraw','bonusReset','bonusRemove','bonusAdd','bonusRedraw','round2Lottery'].includes(action)) throw Error('Unknown cloud action.');
  return locked_(function () {
    const document = read_();
    const requestId = token_(payload.requestId, 'A requestId is required.');
    const fingerprint = digest_({action:action,payload:Object.keys(payload).sort().reduce((o,k) => {o[k]=payload[k];return o;}, {})});
    const prior = document.requests.find(r => r.id === requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Error('This requestId was already used for a different operation.');
      return result_(document, action, prior.room);
    }
    // Draws use the latest answer records. If the source sheet cannot be read,
    // the last synchronized list is used. Exact retries above keep their receipt.
    if (['bonusDraw','bonusRedraw','round2Lottery'].includes(action)) syncSourceAnswers_(document);
    let roomReceipt;
    if (action === 'save' || action === 'initialize') {
      if (payload.revision !== document.revision) throw Error('Cloud progress changed. Reload before saving.');
      if (action === 'initialize' && document.state) throw Error('Cloud progress is already initialized. Reload it.');
      if (action === 'save' && !document.state) throw Error('Initialize cloud progress first.');
      const roster = roster_();
      const next = cleanState_(payload.state, roster);
      if (document.state) {
        // Bonus results and answer-sheet records are committed by the server.
        next.bonus = document.state.bonus;
        next.r2Source = document.state.r2Source || [];
        forwardOnly_(document.state, next);
      }
      if (action === 'save') {
        const added = next.batches.slice(document.state.batches.length);
        const date = added.length || Object.prototype.hasOwnProperty.call(payload, 'sessionDate') ? date_(payload.sessionDate) : null;
        if (added.length) {
          const attendance = document.attendance.find(row => row.date === date);
          if (!attendance) throw Error('Save attendance for this class date before drawing.');
          const absent = attendance.absent.slice().sort((a,b) => a-b);
          if (JSON.stringify(absent) !== JSON.stringify(next.absent)) throw Error('Attendance changed. Save attendance for this class date before drawing.');
          // Only attendanceSave can create/correct attendance. Drawing uses its
          // already committed exclusion list and dates only the new batches.
          added.forEach(b => {Object.defineProperty(document.batchDates,b.id,{value:date,enumerable:true,configurable:true,writable:true});});
        }
      }
      document.state = next;
      document.revision++;
    } else if (action === 'attendanceSave') {
      if (!document.state) throw Error('Initialize cloud progress first.');
      if (payload.revision !== document.revision) throw Error('Cloud progress changed. Reload before saving.');
      const absent = numbers_(payload.absent, new Set(document.state.students.map(p => p.no)), true).sort((a,b) => a-b);
      saveAttendance_(document, date_(payload.date), absent);
      document.state.absent = absent;
      document.revision++;
    } else if (action === 'bonusOpen') {
      if (!document.state) throw Error('Initialize cloud progress first.');
      if (document.room && (document.room.open || (!document.room.winner && document.room.entrants.length))) throw Error('Close and finish or reset the current Bonus round first.');
      const absent = numbers_(payload.absent, new Set(document.state.students.map(p => p.no)), true);
      document.room = {id:Utilities.getUuid(),open:true,entrants:[],winner:null,absent:absent,drawnAt:null};
      roomReceipt = document.room;
    } else if (action === 'round2Lottery') {
      // Fallback when nobody volunteers: the browser previews a student (and can
      // skip someone who is not in class); the server records only the confirmed one.
      if (!document.state) throw Error('Initialize cloud progress first.');
      if (document.room && document.room.open) throw Error('Close volunteer registration before the lottery.');
      const question = question_(payload.question), date = date_(payload.date);
      if (!document.state.students.some(p => p.no === payload.no)) throw Error('Unknown roster number.');
      // Skipped students were not in class for this question; they keep priority.
      const skipped = numbers_(payload.skipped, new Set(document.state.students.map(p => p.no)), true);
      const presented = round2Presented_(document.state);
      if (skipped.includes(payload.no)) throw Error('This student was skipped for this question.');
      if (presented.has(payload.no) && document.state.students.some(p => !presented.has(p.no) && !skipped.includes(p.no))) throw Error('This student already presented in round 2. Draw again.');
      document.state.bonus.push({round:Utilities.getUuid(),no:payload.no,entrants:[],drawnAt:new Date().toISOString(),stage:2,source:'lottery',question:question,date:date});
      document.revision++;
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
      if (action === 'bonusAdd') {
        if (room.winner) throw Error('This Bonus result is already saved.');
        if (!document.state.students.some(p => p.no === payload.no)) throw Error('Unknown roster number.');
        if (!room.entrants.includes(payload.no)) room.entrants = room.entrants.concat(payload.no).sort((a,b) => a-b);
      }
      if (action === 'bonusDraw' || action === 'bonusRedraw') {
        if (action === 'bonusDraw' && room.winner) {roomReceipt = room;}
        else {
          if (room.open) throw Error('Close Bonus registration before drawing.');
          // A redraw gives the same question to another volunteer from the same
          // sign-up; earlier winners of this sign-up are not drawn again.
          if (action === 'bonusRedraw' && !room.winner) throw Error('Draw a volunteer first.');
          const drawn = room.winner ? (room.drawn || [room.winner.no]) : [];
          const question = question_(payload.question), date = date_(payload.date);
          const roster = roster_();
          refreshNames_(document.state, roster);
          const absent = new Set(room.absent);
          const eligible = new Set(document.state.students.filter(p => !absent.has(p.no)).map(p => p.no));
          room.entrants = room.entrants.filter(no => eligible.has(no)).sort((a,b) => a-b);
          const remaining = room.entrants.filter(no => !drawn.includes(no));
          if (!remaining.length) throw Error(drawn.length ? 'Every volunteer in this sign-up has been drawn.' : 'There are no eligible Bonus entries.');
          // Volunteers who have not presented in round 2 go first.
          const presented = round2Presented_(document.state);
          const fresh = remaining.filter(no => !presented.has(no));
          const pool = fresh.length ? fresh : remaining;
          const no = pool[Math.floor(Math.random() * pool.length)];
          const student = document.state.students.find(p => p.no === no);
          room.drawn = drawn.concat(no);
          const round = room.drawn.length === 1 ? room.id : room.id + ':' + room.drawn.length;
          room.winner = {no:no,name:student.name,fresh:fresh.length > 0,pool:pool.length,round:round};
          room.drawnAt = new Date().toISOString();
          document.state.bonus.push({round:round,no:no,entrants:room.entrants.slice(),drawnAt:room.drawnAt,stage:2,source:'volunteer',question:question,date:date});
          document.revision++;
          roomReceipt = room;
        }
      }
      if (action !== 'bonusDraw' && action !== 'bonusRedraw') roomReceipt = room;
    }
    document.requests.push({id:requestId,fingerprint:fingerprint,room:roomReceipt || null});
    document.requests = document.requests.slice(-30);
    const reportsWarning = write_(document, ['initialize','save','attendanceSave','bonusDraw','bonusRedraw','round2Lottery'].includes(action));
    const result = result_(document, action, roomReceipt);
    if (reportsWarning) result.reportsWarning=reportsWarning;
    return result;
  });
}

function loginState_(state) {
  if (typeof state !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(state)) throw Error('Invalid sign-in request.');
  return state;
}
function loginSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}
function loginCacheKey_(kind, secret) {
  // Raw grants and session tokens never appear in cache keys or stored draws.
  return 'login:' + kind + ':' + digest_({kind:kind,secret:secret});
}
function exchangeLogin_(payload) {
  const invalid = () => {throw Error('Invalid sign-in grant. Sign in again.');};
  if (Object.keys(payload).length !== 2 || Object.keys(payload).some(key => !['code','state'].includes(key)) || typeof payload.code !== 'string' || !/^[a-f0-9]{64}$/.test(payload.code)) invalid();
  try {loginState_(payload.state);} catch (error) {invalid();}
  return locked_(function () {
    const cache = CacheService.getScriptCache(), key = loginCacheKey_('grant', payload.code);
    let grant;
    try {grant=JSON.parse(cache.get(key) || 'null');} catch (error) {invalid();}
    const now = Date.now();
    if (!grant || grant.email !== OWNER_EMAIL_ || grant.state !== payload.state || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now) invalid();
    // Bind each grant to one session. Repeating the exact exchange recovers its
    // receipt during the original five-minute grant window without extending it.
    if (!grant.token) {
      grant.token=loginSecret_();
      grant.sessionExpiresAt=now+7200000;
      cache.put(key, JSON.stringify(grant), Math.max(1, Math.ceil((grant.expiresAt-now)/1000)));
    }
    if (!/^[a-f0-9]{64}$/.test(grant.token) || !Number.isFinite(grant.sessionExpiresAt) || grant.sessionExpiresAt <= now) invalid();
    cache.put(loginCacheKey_('session', grant.token), JSON.stringify({email:OWNER_EMAIL_,groups:'*',expiresAt:grant.sessionExpiresAt}), Math.max(1, Math.ceil((grant.sessionExpiresAt-now)/1000)));
    return {token:grant.token,expiresAt:grant.sessionExpiresAt,email:OWNER_EMAIL_};
  });
}
function authenticateSession_(sessionToken) {
  const denied = () => {throw Error('Your sign-in session expired. Sign in again.');};
  if (typeof sessionToken !== 'string' || !/^[a-f0-9]{64}$/.test(sessionToken)) denied();
  let session;
  try {session=JSON.parse(CacheService.getScriptCache().get(loginCacheKey_('session', sessionToken)) || 'null');} catch (error) {denied();}
  if (!session || typeof session.email !== 'string' || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) denied();
  // Sessions from the original owner-only sign-in carry no group list.
  const groups = session.email === OWNER_EMAIL_ ? '*' : session.groups;
  if (groups !== '*' && !Array.isArray(groups)) denied();
  return {email:session.email,groups:groups};
}
// "Sign in with Google" on the site sends a Google ID token. Google verifies
// its signature; the token must be for this site's client ID and a verified
// email that the Groups tab assigns to at least one group.
function googleLogin_(payload) {
  const invalid = message => {throw Error(message || 'Google sign-in failed. Sign in again.');};
  if (!OAUTH_CLIENT_ID_) invalid('Google sign-in is not configured yet.');
  if (Object.keys(payload).length !== 1 || typeof payload.credential !== 'string' || payload.credential.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(payload.credential)) invalid();
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(payload.credential), {muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) invalid();
  const claims = JSON.parse(response.getContentText());
  const email = String(claims.email || '').toLowerCase();
  if (claims.aud !== OAUTH_CLIENT_ID_ || !['accounts.google.com','https://accounts.google.com'].includes(claims.iss) ||
      String(claims.email_verified) !== 'true' || !(Number(claims.exp) * 1000 > Date.now()) || !email) invalid();
  if (email === OWNER_EMAIL_) ensureGroupsSheet_();
  GROUPS_ = null;
  const groups = email === OWNER_EMAIL_ ? '*' : Object.keys(groupsConfig_()).filter(id => groupsConfig_()[id].admins.includes(email));
  if (groups !== '*' && !groups.length) invalid('This Google account (' + email + ') is not assigned to a tutorial group. Ask the course owner to add it.');
  const token = loginSecret_(), expiresAt = Date.now() + 7200000;
  CacheService.getScriptCache().put(loginCacheKey_('session', token), JSON.stringify({email:email,groups:groups,expiresAt:expiresAt}), 7200);
  return {token:token,expiresAt:expiresAt,email:email,groups:groupList_(groups)};
}

function publicRpc_(action, payload) {
  // Reject malformed requests before touching the shared lock or spreadsheet.
  const request = publicPayload_(action, payload);
  try {
    // The SID lookup reads one property and needs no lock. Only the slot write
    // is serialized, so queued signups each hold the lock for milliseconds.
    const student = action === 'bonusJoin' ? sidStudent_(request.sid) : null;
    return locked_(function () {
      if (action === 'bonusJoin') return join_(student, request.room);
      const store = bonusStore_();
      if (!store.meta || store.meta.id !== request.room) throw Error('This Bonus link has expired. Ask for the latest QR code.');
      return {id:store.meta.id,open:store.meta.open};
    }, action === 'bonusJoin' ? SIGNUP_WAIT_MS_ : 2000);
  } catch (error) {
    const expected = [
      'This Bonus link has expired. Ask for the latest QR code.',
      'Bonus registration is closed.',
      'This roster No. cannot join. Check with the instructor.',
      'This SID is not on the class list. Check it, or ask the instructor to add you.',
      'SID sign-up is not set up. Ask the instructor to add you.',
      'The cloud service is busy. Retry the same request.'
    ];
    if (error && expected.includes(error.message)) throw Error(error.message);
    console.error('Public registration failed: ' + (error && error.stack || String(error)));
    throw Error('Registration service unavailable. Retry or check with the instructor.');
  }
}
function publicPayload_(action, payload) {
  const invalid = () => {throw Error('Invalid registration request.');};
  const allowed = action === 'bonusJoin' ? ['room','sid','requestId'] : ['room'];
  if (Object.keys(payload).some(key => !allowed.includes(key))) invalid();
  if (typeof payload.room !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.room)) invalid();
  if (action === 'bonusInfo') return {room:payload.room};
  if (typeof payload.sid !== 'string' || !/^\d{8,12}$/.test(payload.sid)) invalid();
  if (Object.prototype.hasOwnProperty.call(payload, 'requestId') && (typeof payload.requestId !== 'string' || !payload.requestId.trim() || payload.requestId.length > 200)) invalid();
  return {room:payload.room,sid:payload.sid};
}
function authenticate_() {
  // An owner-executed public deployment has the owner's effective identity even
  // for anonymous callers. Only the server's active user identifies the caller.
  let active, effective;
  try {
    active = Session.getActiveUser().getEmail();
    effective = Session.getEffectiveUser().getEmail();
  } catch (error) {
    console.error('Administrator identity check failed: ' + (error && error.stack || String(error)));
    throw Error('Administrator access denied. Use the authorized Google account.');
  }
  if (active !== OWNER_EMAIL_ || effective !== OWNER_EMAIL_) throw Error('Administrator access denied. Use the authorized Google account.');
  return active;
}
function locked_(fn, waitMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs === undefined ? 20000 : waitMs)) throw Error('The cloud service is busy. Retry the same request.');
  try {return fn();} finally {lock.releaseLock();}
}
function book_() {
  return SpreadsheetApp.openById(storeId_());
}
function read_() {
  const text = book_().getSheetByName('State').getRange('A1').getValue();
  const document = JSON.parse(text);
  if (!document || !Number.isSafeInteger(document.revision) || !Array.isArray(document.requests)) throw Error('Private cloud state is invalid. Ask the instructor to recover it.');
  // Older documents have no dated attendance. Never derive it from draw history.
  if (document.attendance === undefined) document.attendance=[];
  if (document.batchDates === undefined) document.batchDates={};
  validateRecords_(document);
  hydrateBonus_(document);
  return document;
}
function write_(document, reports) {
  const serialized = JSON.stringify(document);
  if (serialized.length > 45000) throw Error('Cloud history is full. Export a backup and ask the owner to archive it.');
  const book = book_();
  const properties = storageProperties_();
  // Journal changes occur only after the sheet commit. If execution stops at
  // either boundary, the next locked caller checks this exact durable receipt.
  const request = document.requests[document.requests.length-1];
  properties.setProperty(BONUS_PENDING_, JSON.stringify({requestId:request && request.id}));
  book.getSheetByName('State').getRange('A1').setValue(serialized);
  SpreadsheetApp.flush();
  syncBonus_(document, properties);
  properties.deleteProperty(BONUS_PENDING_);
  // Display failures happen after the canonical commit, and must never trigger a redraw.
  return reports ? refreshReports_(book, document) : null;
}
function result_(document, action, roomReceipt) {
  const metadata = ownerMetadata_(document);
  if (action === 'initialize' || action === 'save' || action === 'attendanceSave' || action === 'round2Lottery') return Object.assign({state:document.state,revision:document.revision}, metadata);
  if (action === 'bonusDraw' || action === 'bonusRedraw') return Object.assign({state:document.state,revision:document.revision,room:roomReceipt || document.room}, metadata);
  return Object.assign({room:roomReceipt || document.room}, metadata);
}
function requireRoom_(document, id) {
  if (!document.room || document.room.id !== id) throw Error('This Bonus link has expired. Ask for the latest QR code.');
  return document.room;
}
// Called only with ScriptLock held. Properties persist independently of cache
// eviction and browser lifetime; no successful signup depends on a later drain.
function bonusStore_() {
  const properties = storageProperties_();
  if (properties.getProperty(BONUS_PENDING_) || !properties.getProperty(BONUS_META_)) read_();
  const meta = JSON.parse(properties.getProperty(BONUS_META_));
  return {properties:properties,meta:meta};
}
function bonusSlotKey_(room, no) {return BONUS_SLOT_ + room + ':' + no;}
function hydrateBonus_(document) {
  const properties = storageProperties_();
  const pendingText = properties.getProperty(BONUS_PENDING_);
  const metaText = properties.getProperty(BONUS_META_);
  if (pendingText) {
    const pending = JSON.parse(pendingText);
    if (pending.bootstrap || document.requests.some(r => r.id === pending.requestId)) {
      // The sheet has the committed receipt. Rebuild from its exact snapshot,
      // including removals, closure, reset and the persisted draw winner.
      syncBonus_(document, properties);
    }
    // An uncommitted write left the previous journal intact. Keep its entries.
    properties.deleteProperty(BONUS_PENDING_);
  }
  if (!metaText && !properties.getProperty(BONUS_META_)) {
    // Existing deployments migrate their current room once, preserving entries.
    properties.setProperty(BONUS_PENDING_, JSON.stringify({bootstrap:true}));
    syncBonus_(document, properties);
    properties.deleteProperty(BONUS_PENDING_);
  }
  const meta = JSON.parse(properties.getProperty(BONUS_META_));
  if (!document.room || !meta || meta.id !== document.room.id) {
    if (!!document.room !== !!meta || (document.room && meta.id !== document.room.id)) throw Error('Private Bonus journal is inconsistent. Ask the instructor to recover it.');
    return;
  }
  if (meta.open !== document.room.open) throw Error('Private Bonus journal is inconsistent. Ask the instructor to recover it.');
  const values = properties.getProperties(), prefix = BONUS_SLOT_ + meta.id + ':';
  // Validate the persistent journal before allowing it to affect a draw.
  const known = new Set(document.state.students.map(p => p.no));
  const entrants = [];
  Object.keys(values).filter(key => key.startsWith(prefix)).forEach(key => {
    const no = Number(key.slice(prefix.length)), value = values[key];
    if (!Number.isSafeInteger(no) || !known.has(no) || !['0','1'].includes(value)) throw Error('Private Bonus journal is invalid. Ask the instructor to recover it.');
    if (value === '1') entrants.push(no);
  });
  const absent = new Set(document.room.absent);
  if (document.state.students.some(p => !absent.has(p.no) && !Object.prototype.hasOwnProperty.call(values,bonusSlotKey_(meta.id,p.no))) || document.room.entrants.some(no => values[bonusSlotKey_(meta.id,no)] !== '1')) throw Error('Private Bonus journal is incomplete. Ask the instructor to recover it.');
  document.room.entrants = entrants.sort((a,b) => a-b);
}
function syncBonus_(document, properties) {
  const values = properties.getProperties(), next = {};
  const room = document.room;
  if (room) {
    const absent = new Set(room.absent), entrants = new Set(room.entrants);
    document.state.students.forEach(p => {
      if (!absent.has(p.no) || entrants.has(p.no)) next[bonusSlotKey_(room.id, p.no)] = entrants.has(p.no) ? '1' : '0';
    });
  }
  // While synchronization is partial, BONUS_PENDING_ prevents public reads.
  Object.keys(values).filter(key => key.startsWith(BONUS_SLOT_) && !Object.prototype.hasOwnProperty.call(next,key)).forEach(key => properties.deleteProperty(key));
  const changed = {};
  Object.keys(next).forEach(key => {if (values[key] !== next[key]) changed[key]=next[key];});
  if (Object.keys(changed).length) properties.setProperties(changed);
  properties.setProperty(BONUS_META_, JSON.stringify(room ? {id:room.id,open:room.open,drawn:!!room.winner} : null));
}
function join_(student, room) {
  // Normally one read and at most one write under the lock, so each queued
  // signup holds it only for two short Properties calls. A pending journal
  // sync or a missing journal takes the slower recovery path.
  const properties = storageProperties_();
  const values = properties.getProperties();
  const recovering = values[BONUS_PENDING_] || !values[BONUS_META_];
  const meta = recovering ? bonusStore_().meta : JSON.parse(values[BONUS_META_]);
  if (!meta || meta.id !== room) throw Error('This Bonus link has expired. Ask for the latest QR code.');
  const key = bonusSlotKey_(meta.id, student.no);
  const value = recovering ? properties.getProperty(key) : values[key];
  const receipt = {status:'joined',no:student.no,name:student.name};
  // Recover accepted receipts after closure or a lost response, without a write.
  if (value === '1') return receipt;
  if (!meta.open || meta.drawn) throw Error('Bonus registration is closed.');
  if (value !== '0') throw Error('This roster No. cannot join. Check with the instructor.');
  properties.setProperty(key, '1');
  return receipt;
}
// Owner polling while registration is open. Reads only the journal, without the
// script lock or the spreadsheet, so it never delays queued student signups.
function bonusLive_() {
  const values = storageProperties_().getProperties();
  const meta = values[BONUS_META_] ? JSON.parse(values[BONUS_META_]) : null;
  if (!meta || values[BONUS_PENDING_]) return {live:null};
  const prefix = BONUS_SLOT_ + meta.id + ':';
  const entrants = Object.keys(values).filter(key => key.startsWith(prefix) && values[key] === '1').map(key => Number(key.slice(prefix.length))).sort((a,b) => a-b);
  return {live:{id:meta.id,open:meta.open,drawn:meta.drawn,entrants:entrants}};
}

// Round 2 counts a student as presented once the answer sheet has a Question 2
// mark, or after any round 2 Bonus drawn here (marks are entered later).
function round2Presented_(state) {
  const presented = new Set(state.r2Source || []);
  state.bonus.forEach(b => {if (b.stage === 2) presented.add(b.no);});
  return presented;
}
function question_(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) throw Error('Choose a question number from 1 to 500.');
  return value;
}

function testSid_(no) {return '1155' + String(no).padStart(6,'0');}
function sidHash_(salt, sid) {return digest_({salt:salt,sid:sid}).slice(0,24);}
function maskName_(name) {
  return name.trim().split(/\s+/).map(word => {
    const letters = Array.from(word);
    return letters[0] + '*'.repeat(Math.min(4, Math.max(1, letters.length-1)));
  }).join(' ');
}
function sidStudent_(sid) {
  const text = storageProperties_().getProperty(SID_INDEX_);
  if (!text) throw Error('SID sign-up is not set up. Ask the instructor to add you.');
  const index = JSON.parse(text);
  const entry = index.entries[sidHash_(index.salt, sid)];
  if (!entry) throw Error('This SID is not on the class list. Check it, or ask the instructor to add you.');
  return {no:entry[0],name:entry[1]};
}
// sidByNo: Map of roster No. to SID text. Stores only salted hashes and masked names.
function saveSidIndex_(roster, sidByNo) {
  const properties = storageProperties_();
  let salt = properties.getProperty(SID_SALT_);
  if (!salt) {salt = loginSecret_();properties.setProperty(SID_SALT_, salt);}
  const entries = {}, missing = [];
  roster.forEach(p => {
    const sid = sidByNo.has(p.no) ? String(sidByNo.get(p.no)).trim() : '';
    if (!sid) {missing.push(p.no);return;}
    if (!/^\d{8,12}$/.test(sid)) throw Error('The SID for No. ' + p.no + ' must be 8 to 12 digits.');
    const hash = sidHash_(salt, sid);
    if (entries[hash]) throw Error('Two roster numbers share the same SID: No. ' + entries[hash][0] + ' and No. ' + p.no + '.');
    entries[hash] = [p.no, maskName_(p.name)];
  });
  const text = JSON.stringify({version:1,salt:salt,entries:entries});
  if (text.length > 9000) throw Error('The SID index is too large for one Script Property.');
  properties.setProperty(SID_INDEX_, text);
  return {sids:Object.keys(entries).length,missing:missing};
}
// Owner-only, run once from the editor. Reads No. and SID from a private tab
// named 'SID import' (two columns: No., SID) if present, then deletes that tab;
// otherwise reads the SID column of the original source sheet.
function importSids() {
  authenticate_();
  if (TEST_DEPLOYMENT_ONLY_) throw Error('Test SIDs are created by setupTest.');
  return locked_(function () {
    const book = book_(), roster = roster_(), sheet = book.getSheetByName('SID import');
    let sidByNo;
    if (sheet) {
      const rows = sheet.getDataRange().getDisplayValues().slice(1).filter(row => row[0].trim());
      sidByNo = new Map(rows.map(row => [Number(row[0].trim()), row[1].trim()]));
    } else sidByNo = sourceSids_();
    const known = new Set(roster.map(p => p.no));
    sidByNo.forEach((sid,no) => {if (!known.has(no)) throw Error('No. ' + no + ' is not on the private roster.');});
    const result = saveSidIndex_(roster, sidByNo);
    if (sheet) book.deleteSheet(sheet);
    console.log('SID sign-up ready: ' + result.sids + ' students' + (result.missing.length ? '; missing No. ' + result.missing.join(',') : ''));
    return result;
  });
}
// Reads this group's rows of the teaching sheet once per execution: No.,
// SID, Name, and whether Question 1 / Question 2 are filled. Marks themselves
// are never kept.
let SOURCE_RECORDS_ = null;
function sourceRecords_() {
  if (SOURCE_RECORDS_) return SOURCE_RECORDS_;
  const sourceId = PropertiesService.getScriptProperties().getProperty('SOURCE_ID');
  if (!sourceId) throw Error('Set the SOURCE_ID script property to the teaching sheet.');
  const sheet = SpreadsheetApp.openById(sourceId).getSheets().find(s => s.getSheetId() === config_().sourceGid);
  if (!sheet) throw Error('The teaching worksheet (SOURCE_GID) was not found.');
  const firstColumn = sheet.getRange(1,1,Math.min(10,sheet.getLastRow()),1).getDisplayValues();
  const headerRow = firstColumn.findIndex(row => row[0].trim() === 'No.');
  if (headerRow < 0) throw Error('The source roster headers were not found.');
  const header = sheet.getRange(headerRow+1,1,1,sheet.getLastColumn()).getDisplayValues()[0].map(v => v.trim().replace(/\s+/g,''));
  const column = names => {
    const index = header.findIndex(value => names.includes(value));
    if (index < 0) throw Error('No source column named ' + names.join(' / ') + '.');
    return index + 1;
  };
  const count = sheet.getLastRow() - headerRow - 1;
  if (count < 1) throw Error('The source roster is empty.');
  const read = names => sheet.getRange(headerRow+2,column(names),count,1).getDisplayValues().map(r => r[0].trim());
  const nos = read(['No.']), names = read(['Name']), classes = read(['TutorialClass']), q1 = read(['Question1']), q2 = read(['Question2']);
  const sids = read(['StudentID','SID','StudentNo.','學號','学号']);
  SOURCE_RECORDS_ = nos.map((no,i) => ({no:/^\d+$/.test(no) ? Number(no) : 0,sid:sids[i],name:names[i],q:[!!q1[i],!!q2[i]],className:classes[i]}))
    .filter(p => p.no > 0 && p.className === config_().tutorialClass).map(p => ({no:p.no,sid:p.sid,name:p.name,q:p.q}));
  return SOURCE_RECORDS_;
}
function sourceSids_() {
  return new Map(sourceRecords_().filter(p => p.sid).map(p => [p.no,p.sid]));
}

function sourceRoster_() {
  const sourceId = PropertiesService.getScriptProperties().getProperty('SOURCE_ID');
  if (!sourceId || !/^[A-Za-z0-9_-]{10,200}$/.test(sourceId)) throw Error('Set the SOURCE_ID script property before creating the roster snapshot.');
  const sheet = SpreadsheetApp.openById(sourceId).getSheets().find(s => s.getSheetId() === config_().sourceGid);
  if (!sheet) throw Error('The teaching worksheet (SOURCE_GID) was not found.');
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
    .filter(p => p.no > 0 && p.className === config_().tutorialClass).map(p => ({no:p.no,name:p.name,q:p.q})).sort((a,b) => a.no-b.no);
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
  if (!roster.length || roster.length > 500 || roster.some(p => !Number.isSafeInteger(p.no) || p.no < 1) || new Set(roster.map(p => p.no)).size !== roster.length) throw Error('The roster has invalid or duplicate numbers.');
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
  if (!input || input.version !== 2 || !Array.isArray(input.students) || input.students.length !== roster.length) throw Error('The cloud state must match the roster.');
  const known = new Set(roster.map(p => p.no)), names = new Map(roster.map(p => [p.no,p.name]));
  const students = input.students.map(p => {
    if (!p || !known.has(p.no) || !Array.isArray(p.q) || p.q.length !== 2 || p.q.some(q => typeof q !== 'boolean') || (p.q[1] && !p.q[0])) throw Error('Invalid participation progress.');
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
    const batch = {id:id,q:b.q,numbers:numbers,at:time_(b.at)};
    if (Object.prototype.hasOwnProperty.call(b,'questionStart')) {
      if (!Number.isSafeInteger(b.questionStart) || b.questionStart < 1 || b.questionStart > 500 || b.questionStart + numbers.length - 1 > 500) throw Error('Question numbers must be integers from 1 to 500.');
      batch.questionStart=b.questionStart;
    }
    return batch;
  });
  const replay = new Map(students.map(p => [p.no,p.q.slice()]));
  batches.forEach(b => b.numbers.forEach(no => {replay.get(no)[b.q]=false;}));
  batches.forEach(b => {
    // Old batches have no attendance snapshot. Validate each student's order
    // without applying today's absences to saved history.
    if (b.q === 1 && b.numbers.some(no => !replay.get(no)[0])) throw Error('A student must complete Q1 before Q2.');
    b.numbers.forEach(no => {replay.get(no)[b.q]=true;});
  });
  const rounds = new Set();
  const bonus = input.bonus.map(b => {
    if (!b || !known.has(b.no)) throw Error('Invalid Bonus result.');
    const id = token_(b.round,'Invalid Bonus round.');
    const lottery = b.source === 'lottery';
    const entrants = numbers_(b.entrants,known,lottery);
    if (rounds.has(id) || (lottery ? entrants.length : !entrants.includes(b.no))) throw Error('Duplicate or inconsistent Bonus result.');
    rounds.add(id);
    const record = {round:id,no:b.no,entrants:entrants,drawnAt:time_(b.drawnAt)};
    if (b.stage !== undefined || lottery) {
      if (b.stage !== 2 || !['volunteer','lottery'].includes(b.source)) throw Error('Invalid round 2 Bonus result.');
      Object.assign(record,{stage:2,source:b.source,question:question_(b.question),date:date_(b.date)});
    }
    return record;
  });
  const r2Source = input.r2Source === undefined ? [] : numbers_(input.r2Source,known,true).sort((a,b) => a-b);
  return {version:2,students:students,absent:absent,batches:batches,bonus:bonus,r2Source:r2Source};
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
  // For new draws, the save action verifies this exclusion list against the
  // class date's saved attendance before committing. Replay sequential batches
  // so Q2 can start once all present students have completed Q1, and a returning
  // student's unfinished Q1 takes priority on a later date.
  const replay = new Map(old.students.map(p => [p.no,p.q.slice()]));
  const present = old.students.filter(p => !next.absent.includes(p.no));
  added.forEach(b => {
    const active = [0,1].find(q => present.some(p => !replay.get(p.no)[q]));
    if (active !== b.q) throw Error('Finish Q1 for present students before drawing Q2.');
    b.numbers.forEach(no => {replay.get(no)[b.q]=true;});
  });
}
function digest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value),Utilities.Charset.UTF_8).map(n => (n+256).toString(16).slice(-2)).join('');
}
function log_(book,state) {
  if (!state) return;
  const names = new Map(state.students.map(p => [p.no,p.name]));
  const rows = [['Kind','Round / batch','Participation round','Question','Roster No.','Name','Saved at']];
  state.batches.forEach(b => b.numbers.forEach((no,i) => rows.push(['Participation',b.id,b.q+1,(b.questionStart || 1)+i,no,names.get(no),b.at])));
  state.bonus.forEach(b => rows.push(['Bonus',b.round,'','',b.no,names.get(b.no),b.drawnAt]));
  const sheet = book.getSheetByName('Draw log');
  sheet.clearContents();
  sheet.getRange(1,1,rows.length,7).setValues(rows.map(row => row.map(v => typeof v === 'string' && /^[=+\-@]/.test(v) ? "'"+v : v)));
  sheet.setFrozenRows(1);
}

function date_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Choose a valid class date (YYYY-MM-DD).');
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw Error('Choose a valid class date (YYYY-MM-DD).');
  return value;
}
function saveAttendance_(document, date, absent) {
  const index = document.attendance.findIndex(row => row.date === date);
  if (index < 0 && document.attendance.length >= 500) throw Error('Attendance history is full. Export a backup and ask the owner to archive it.');
  const row = {date:date,absent:absent.slice(),savedAt:new Date().toISOString()};
  if (index < 0) document.attendance.push(row);
  else document.attendance[index]=row;
  document.attendance.sort((a,b) => a.date.localeCompare(b.date));
}
function validateRecords_(document) {
  const invalid = () => {throw Error('Private attendance metadata is invalid. Ask the instructor to recover it.');};
  if (!Array.isArray(document.attendance) || document.attendance.length > 500 || !document.batchDates || typeof document.batchDates !== 'object' || Array.isArray(document.batchDates)) invalid();
  const known = new Set((document.state ? document.state.students : []).map(p => p.no));
  const dates = new Set();
  document.attendance.forEach(row => {
    if (!row || dates.has(row.date)) invalid();
    date_(row.date);
    dates.add(row.date);
    numbers_(row.absent, known, true);
    time_(row.savedAt);
  });
  const batches = new Set((document.state ? document.state.batches : []).map(b => b.id));
  Object.keys(document.batchDates).forEach(id => {
    if (!batches.has(id)) invalid();
    date_(document.batchDates[id]);
  });
}
function storageUrl_() {
  return 'https://docs.google.com/spreadsheets/d/' + storeId_();
}
function ownerMetadata_(document) {
  return {environment:TEST_CONTEXT_ ? 'test' : 'production',rosterCount:document.state ? document.state.students.length : roster_().length,attendance:document.attendance,batchDates:document.batchDates,storageUrl:storageUrl_(),requestIds:document.requests.map(row => row.id)};
}
// Run once in the Apps Script editor after updating an existing deployment.
function refreshRecords() {
  authenticate_();
  return locked_(refreshRecords_);
}
function refreshRecords_() {
  const document = read_();
  const sync = syncSourceAnswers_(document);
  let reportsWarning;
  if (sync.changed) {document.revision++;reportsWarning=write_(document, true);}
  else reportsWarning=refreshReports_(book_(), document);
  const warning = [sync.warning, reportsWarning].filter(Boolean).join(' ');
  return Object.assign({state:document.state,revision:document.revision}, ownerMetadata_(document), warning ? {sourceWarning:warning} : {});
}
// The teaching sheet is the record of who has answered: a filled Question 2
// means the student has presented in round 2. Only flags are kept, never marks.
// Test storage has no source sheet and keeps its fictional answer list.
function syncSourceAnswers_(document) {
  if (TEST_CONTEXT_ || !document.state) return {changed:false,warning:null};
  let answered;
  try {
    answered = sourceRecords_().filter(p => p.q[1]).map(p => p.no);
  } catch (error) {
    console.warn('Answer sheet read failed: ' + (error && error.stack || String(error)));
    return {changed:false,warning:'Could not read the answer sheet; using the last synchronized answers. ' + (error && error.message || '')};
  }
  const known = new Set(document.state.students.map(p => p.no));
  const next = answered.filter(no => known.has(no)).sort((a,b) => a-b);
  if (JSON.stringify(next) === JSON.stringify(document.state.r2Source || [])) return {changed:false,warning:null};
  document.state.r2Source = next;
  return {changed:true,warning:null};
}

// Explicit, owner-only upgrade: existing human edits have no rendered baseline.
// Back up both inputs before accepting this one-time grid as attendance truth.
function setupAttendanceEditing() {
  authenticate_();
  if (TEST_DEPLOYMENT_ONLY_) throw Error('Use setupTestAttendanceEditing for test storage.');
  return locked_(setupAttendanceEditing_);
}
function setupTestAttendanceEditing() {
  authenticate_();
  return testContext_(function () {return locked_(setupAttendanceEditing_);});
}
function setupAttendanceEditing_() {
  const book = book_(), document = read_();
  const baseline = attendanceBaseline_(book, document);
  if (!baseline && book.getSheetByName('出勤记录')) {
    const grid = attendanceGrid_(book, document, attendanceSnapshot_(document));
    const stamp = Utilities.getUuid().slice(0,8);
    book.getSheetByName('出勤记录').copyTo(book).setName('Attendance backup ' + stamp).hideSheet();
    book.getSheetByName('State').copyTo(book).setName('State backup ' + stamp).hideSheet();
    SpreadsheetApp.flush();
    // Validate everything before changing any canonical date. No participation,
    // current draw exclusion list, request receipt, or Bonus snapshot is edited.
    let changed = false;
    grid.attendance.forEach(row => {
      const current = document.attendance.find(item => item.date === row.date);
      if (!sameNumbers_(current.absent, row.absent)) {
        saveAttendance_(document, row.date, row.absent);
        changed = true;
      }
    });
    if (changed) {document.revision++;write_(document, false);}
    saveAttendanceBaseline_(book, grid);
  } else syncAttendanceSheet_(book, document);
  const reportsWarning = refreshReports_(book, document);
  return Object.assign({state:document.state,revision:document.revision}, ownerMetadata_(document), reportsWarning ? {reportsWarning:reportsWarning} : {});
}
function sameNumbers_(left, right) {
  return JSON.stringify(left.slice().sort((a,b) => a-b)) === JSON.stringify(right.slice().sort((a,b) => a-b));
}
function attendanceSnapshot_(document) {
  return {version:1,numbers:(document.state ? document.state.students : roster_()).map(p => p.no).sort((a,b) => a-b),
    attendance:document.attendance.map(row => ({date:row.date,absent:row.absent.slice().sort((a,b) => a-b)})).sort((a,b) => a.date.localeCompare(b.date))};
}
function attendanceBaseline_(book, document) {
  const sheet = book.getSheetByName('Attendance sync');
  if (!sheet) return null;
  const invalid = () => {throw Error('Attendance sync baseline is invalid. Recover it from the private backup before refreshing.');};
  let baseline;
  try {baseline=JSON.parse(sheet.getRange('A1').getValue());} catch (error) {invalid();}
  const snapshot = attendanceSnapshot_(document), known = new Set(snapshot.numbers), dates = new Set();
  if (!baseline || baseline.version !== 1 || !Array.isArray(baseline.numbers) || !sameNumbers_(baseline.numbers,snapshot.numbers) || !Array.isArray(baseline.attendance)) invalid();
  baseline.attendance.forEach(row => {
    if (!row || dates.has(row.date) || !snapshot.attendance.some(item => item.date === row.date)) invalid();
    date_(row.date);numbers_(row.absent,known,true);dates.add(row.date);
  });
  return baseline;
}
function saveAttendanceBaseline_(book, snapshot) {
  const text = JSON.stringify({version:1,numbers:snapshot.numbers,attendance:snapshot.attendance});
  if (text.length > 45000) throw Error('Attendance sync baseline is full. Export a private backup before archiving dates.');
  const sheet = book.getSheetByName('Attendance sync') || book.insertSheet('Attendance sync');
  sheet.getRange('A1').setValue(text);
  sheet.hideSheet();
  // A following website revision check can intentionally reject its stale
  // payload; make the preceding Sheet import's baseline durable first.
  SpreadsheetApp.flush();
}
function attendanceGrid_(book, document, baseline) {
  const sheet = book.getSheetByName('出勤记录');
  const invalid = () => {throw Error('Attendance sheet must keep every roster No., saved date, and exact 到场/缺席 value. Restore missing or invalid cells before refreshing.');};
  if (!sheet) invalid();
  const width = sheet.getLastColumn(), height = sheet.getLastRow();
  const snapshot = attendanceSnapshot_(document), known = new Set(snapshot.numbers);
  if (width < 4 || height !== snapshot.numbers.length+4) invalid();
  const headers = sheet.getRange(4,1,1,width).getDisplayValues()[0];
  if (headers.slice(0,4).join('|') !== 'No.|Name|到场次数|缺席次数') invalid();
  const dates = headers.slice(4), seenDates = new Set();
  dates.forEach(date => {
    if (seenDates.has(date) || !snapshot.attendance.some(row => row.date === date)) invalid();
    date_(date);seenDates.add(date);
  });
  if (baseline.attendance.some(row => !seenDates.has(row.date))) invalid();
  const values = snapshot.numbers.length ? sheet.getRange(5,1,snapshot.numbers.length,width).getValues() : [];
  const formulas = dates.length && values.length ? sheet.getRange(5,5,values.length,dates.length).getFormulas() : [];
  const numbers = [], seen = new Set(), attendance = dates.map(date => ({date:date,absent:[]}));
  values.forEach((row,index) => {
    const no = row[0];
    if (!Number.isSafeInteger(no) || !known.has(no) || seen.has(no)) invalid();
    seen.add(no);numbers.push(no);
    row.slice(4).forEach((value,column) => {
      if (formulas[index][column] || (value !== '到场' && value !== '缺席')) invalid();
      if (value === '缺席') attendance[column].absent.push(no);
    });
  });
  attendance.forEach(row => row.absent.sort((a,b) => a-b));
  return {version:1,numbers:numbers,names:values.map(row => row[1]),attendance:attendance};
}
function attendanceSheetChanges_(document, baseline, grid) {
  const changes = [];
  grid.attendance.forEach(row => {
    const current = document.attendance.find(item => item.date === row.date);
    const before = baseline.attendance.find(item => item.date === row.date);
    // A previous refresh can fail after adding a new date but before saving its
    // baseline. Such a column must match canonical data before it can be trusted.
    if (!before) {
      if (!sameNumbers_(current.absent,row.absent)) throw Error('An incomplete attendance refresh needs recovery; the new date column differs from saved attendance.');
      return;
    }
    const old = new Set(before.absent), sheet = new Set(row.absent), merged = new Set(current.absent);
    grid.numbers.forEach(no => {
      if (old.has(no) === sheet.has(no)) return;
      if (merged.has(no) !== old.has(no) && merged.has(no) !== sheet.has(no)) throw Error('Attendance changed in both editors. Reload before correcting it.');
      if (sheet.has(no)) merged.add(no);else merged.delete(no);
    });
    const absent = Array.from(merged).sort((a,b) => a-b);
    if (!sameNumbers_(current.absent,absent)) changes.push({date:row.date,absent:absent});
  });
  return changes;
}
function syncAttendanceSheet_(book, document) {
  const baseline = attendanceBaseline_(book, document);
  if (!baseline) {
    if (book.getSheetByName('出勤记录')) throw Error('Run owner-only setupAttendanceEditing() once to preserve the existing attendance sheet before refreshing.');
    return;
  }
  const grid = attendanceGrid_(book,document,baseline);
  const changes = attendanceSheetChanges_(document,baseline,grid);
  if (changes.length) {
    changes.forEach(row => saveAttendance_(document,row.date,row.absent));
    document.revision++;
    write_(document,false);
  }
  // Remember the observed grid after a successful import, even when canonical
  // data already matched. Otherwise toggling a cell back before a report refresh
  // would look unchanged against the older baseline and lose the correction.
  if (baseline.attendance.length !== grid.attendance.length || grid.attendance.some(row => {
    const before = baseline.attendance.find(item => item.date === row.date);
    return !before || !sameNumbers_(before.absent,row.absent);
  })) saveAttendanceBaseline_(book,grid);
}
function refreshReports_(book, document) {
  try {
    reports_(book, document);
    log_(book, document.state);
    SpreadsheetApp.flush();
    return null;
  } catch (error) {
    console.warn('Private record display refresh failed: ' + (error && error.stack || String(error)));
    return 'Saved. The 学生名单 sheet could not refresh; use Re-read answer sheet to retry.';
  }
}
function reportTime_(value) {
  return value ? Utilities.formatDate(new Date(value), 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm:ss') : '';
}
function reportSheet_(book, name, title, note, headers, rows) {
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet=book.insertSheet(name);
  const height = Math.max(5, rows.length+4), width = headers.length;
  if (sheet.getMaxRows() < height) sheet.insertRowsAfter(sheet.getMaxRows(), height-sheet.getMaxRows());
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width-sheet.getMaxColumns());
  // All cells are generated views; the website is the supported editor.
  sheet.getRange(1,1,sheet.getMaxRows(),sheet.getMaxColumns()).breakApart();
  sheet.clear();
  const literal = value => typeof value === 'string' && /^[=+\-@]/.test(value) ? "'"+value : value;
  sheet.getRange(1,1).setValue(title).setFontSize(18).setFontWeight('bold').setFontColor('#173d45');
  sheet.getRange(2,1).setValue(note).setFontSize(10).setFontColor('#536b70');
  sheet.getRange(4,1,1,width).setValues([headers]).setFontWeight('bold').setBackground('#173d45').setFontColor('#ffffff').setWrap(true);
  if (rows.length) sheet.getRange(5,1,rows.length,width).setValues(rows.map(row => row.map(literal))).setFontColor('#173d45').setWrap(true);
  sheet.getRange(4,1,height-3,width).setVerticalAlignment('middle');
  sheet.setFrozenRows(4);
  sheet.setFrozenColumns(2);
  sheet.setColumnWidth(1,70);
  sheet.setColumnWidth(2,240);
  if (width > 2) sheet.setColumnWidths(3,width-2,115);
  sheet.setRowHeight(1,32);
  sheet.setRowHeight(2,36);
  sheet.setRowHeight(4,40);
  if (rows.length) {
    sheet.setRowHeights(5,rows.length,42);
    sheet.autoResizeRows(5,rows.length);
  }
  sheet.showSheet();
  return sheet;
}
function attendanceColumn_(column) {
  let name = '';
  while (column) {column--;name=String.fromCharCode(65+column%26)+name;column=Math.floor(column/26);}
  return name;
}
// The private spreadsheet keeps one readable tab, 学生名单: SID and name from
// the teaching sheet, whether Question 1 / Question 2 are filled there, and
// the round 2 Bonus draws made on the website. Attendance and the per-question
// log are retired; their data stays in State.
function reports_(book, document) {
  const roster = roster_();
  const students = document.state ? document.state.students : roster;
  if (document.state) refreshNames_(document.state, roster);
  let source = new Map();
  if (TEST_CONTEXT_) students.forEach(p => source.set(p.no,{sid:testSid_(p.no),q:p.q}));
  else source = new Map(sourceRecords_().map(p => [p.no,p]));
  const bonus = new Map();
  (document.state ? document.state.bonus : []).filter(b => b.stage === 2).forEach(b => {
    bonus.set(b.no,(bonus.get(b.no) || []).concat(b.date + ' Q' + b.question + ' ' + (b.source === 'volunteer' ? '志愿' : '抽签')));
  });
  const presented = document.state ? round2Presented_(document.state) : new Set();
  const rows = students.map(p => {
    const answer = source.get(p.no) || {sid:'',q:[false,false]};
    const draws = bonus.get(p.no) || [];
    return [p.no,answer.sid,p.name,answer.q[0] ? '已讲' : '未讲',answer.q[1] ? '已录分' : '',draws.length,draws.join('；'),presented.has(p.no) ? '已讲' : '未讲'];
  });
  const sheet = reportSheet_(book, '学生名单', config_().tutorialClass + ' · 学生名单',
    '第一轮/第二轮（答题表）来自答题表 Question 1 / Question 2 是否有分数。网站抽中记录为第二轮 Bonus 的抽中日期、题号和方式。第二轮状态：答题表已录分或网站已抽中即为已讲。本表由网站生成，改动会被覆盖。',
    ['No.','SID','Name','第一轮（Question 1）','第二轮（Question 2）','网站抽中次数','网站抽中记录','第二轮状态'], rows);
  sheet.setFrozenColumns(3);
  sheet.setColumnWidth(2,120);
  sheet.setColumnWidth(3,220);
  sheet.setColumnWidth(7,300);
  book.setActiveSheet(sheet);
  book.moveActiveSheet(1);
  ['出勤记录','讲题记录'].forEach(name => {
    const old = book.getSheetByName(name);
    if (old) book.deleteSheet(old);
  });
  ['State','Roster','Draw log','Attendance sync'].forEach(name => {
    const hidden = book.getSheetByName(name);
    if (hidden) hidden.hideSheet();
  });
}
