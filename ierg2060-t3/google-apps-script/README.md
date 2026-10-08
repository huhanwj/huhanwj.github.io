# Private Google Sheets persistence

This backend runs as the instructor and stores draws and a roster snapshot in a separate private Google spreadsheet. For an initial snapshot only, set `SOURCE_ID` in Script Properties. Owner setup copies that Tutorial 3 roster once, using only roster No., Name, Tutorial Class, and two participation flags. Student ID cells are never read. Question values become booleans immediately; numeric grades never enter the private snapshot, saved state, or browser responses. Future requests use only the private snapshot, so later edits to the shared source cannot change names or initial participation. The original worksheet, its sharing settings, and its collaborators are not changed.

## One-time setup

1. Sign in as **huhanwj@gmail.com**, with access to the original worksheet. Open [Apps Script](https://script.google.com/home) and create a standalone project owned by this account.
2. Replace `Code.gs` with this directory's `Code.gs`. Add an HTML file named `Bridge` and paste `Bridge.html` into it.
3. In **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace that manifest with this directory's `appsscript.json`.
4. Select `setup` in the editor's function menu, click **Run**, and authorize spreadsheet and email access. This creates the separate private storage spreadsheet, or reuses the existing `STORE_ID`. If its `Roster` tab is missing, setup copies the permitted source fields into that private tab; later setup runs preserve the existing snapshot and never read or overwrite it from the source. It also deletes an obsolete `ADMIN_KEY` property. Setup requires both the active and effective Google identities to be exactly `huhanwj@gmail.com`; an empty identity fails. Its log and return value contain only the private storage link.
5. Keep that storage spreadsheet private. Do not clear `STORE_ID` when upgrading an existing project: it points to the saved progress used by both deployments.
6. Choose **Deploy → New deployment → Web app** for the **admin deployment**. Set **Execute as** to **Me (huhanwj@gmail.com)** and **Who has access** to **Only myself**. Deploy and copy its final `/exec` URL. Open it once in the browser while signed in as this account to complete any Google authorization or access prompts.
7. Create a second Web app deployment in **the same Apps Script project** for **student registration**. Set **Execute as** to **Me (huhanwj@gmail.com)** and **Who has access** to **Anyone**. Copy its different `/exec` URL. These deployments share script properties, private storage, and the script lock. Do not create a second project or share the storage sheet. If account policy disables anonymous web apps, sign-in-free registration is unavailable under that policy.
8. Configure the private **admin URL** and public **student URL** in `cloud-config.js`, then open the page while signed in as `huhanwj@gmail.com`. Reconnect in settings retries this fixed class connection. The student URL is used for Bonus signup and QR links. No password, email field, Google token, or credential URL parameter is required. An empty cloud returns roster names and participation flags to the authenticated instructor. Review initial progress, then explicitly initialize the cloud once. Existing cloud progress takes precedence on later connections.
9. Verify that the admin connection succeeds for `huhanwj@gmail.com` and fails in an anonymous browser or with another account. Verify a complete Bonus round from a phone's private browser window using the student QR code. Students should see the registration form without a Google sign-in or authorization prompt. Close registration on the instructor page before drawing, then reload it to confirm the saved result remains.

For code updates, create a new version and update **both** deployments through **Deploy → Manage deployments → Edit → Version → Deploy**. Each deployment keeps its own `/exec` URL and access setting. Upgrading an old password-based deployment requires updating its code too; an older deployed version keeps its old authentication until replaced or archived. Run `setup` as the owner after updating to remove the obsolete key property. The deployment owner performs these steps; this repository does not deploy the project.

Google documents that [`Session.getActiveUser().getEmail()`](https://developers.google.com/apps-script/reference/base/session#getActiveUser()) may be blank in owner-executed web apps, with restrictions generally lifted when the developer runs the script themselves. The backend rejects a blank identity and never substitutes `getEffectiveUser()` alone: that method identifies the execution owner even for anonymous student callers. If the private iframe cannot establish the signed-in owner because of browser cookie restrictions or account policy, open the private admin URL directly, complete Google access, and retry. A remaining blank identity is an access failure; verify the live deployment in that browser before using it for class.

Only `huhanwj@gmail.com` is allowed for administrative RPC. Script-editor collaborators can change code and properties, so project editing access is trusted access; a collaborator's Google account is not automatically admitted by the application allowlist.

## Transport and actions

The draw page embeds the admin deployment's `/exec?channel=<random UUID>`; the student page embeds the public deployment's URL with its own channel. Apps Script wraps the bridge in a Google iframe, so its ready message comes from the inner `*.googleusercontent.com` frame. The parent validates the expected channel and Google origin, then pins the source window. The bridge accepts messages only from its top window at `https://huhanwj.github.io` only. Production bridges reject localhost and other origins; use synthetic tests for local logic checks.

Request envelope: `{type:'ierg-rpc',channel,id,action,payload}`. Response: `{type:'ierg-rpc-result',channel,id,result,error}`. Ready: `{type:'ierg-ready',channel}`. Browser requests go through `google.script.run`; no cross-origin fetch or public CORS proxy is needed. RPC authentication still protects every administrative action even when someone opens the bridge directly.

Every action except `bonusJoin` and `bonusInfo` checks the server-provided active and effective email before reading private data or mutating state. The `auth` result confirms the authenticated account. Payloads containing `email` or the retired `adminKey` are rejected; client-supplied identity is never authentication. Every mutation except public signup includes a unique, stable `requestId`; retries reuse the exact payload and ID.

| Action | Additional payload | Result |
| --- | --- | --- |
| `auth` | — | `{ok:true,email:'huhanwj@gmail.com'}` |
| `load` | — | `{state,revision,roster}`; state is `null` until initialized |
| `names` | — | `{roster}` |
| `initialize` | `state,revision,requestId` | `{state,revision}`; cloud must be empty |
| `save` | `state,revision,requestId`; `sessionDate` required for new batches | `{state,revision}` and owner metadata; new draws require that date's saved attendance |
| `attendanceSave` | `date,absent,revision,requestId` | Saves/corrects attendance for the date; participation unchanged |
| `recordsRefresh` | — | Rebuilds private report tabs; canonical revision unchanged |
| `bonusOpen` | `absent,requestId` | `{room}` |
| `bonusStatus` | — | `{room}`; room may be `null` |
| `bonusClose` | `room,requestId` | `{room}` |
| `bonusRemove` | `room,no,requestId` | `{room}` |
| `bonusDraw` | `room,requestId` | `{state,revision,room}` |
| `bonusReset` | `room,requestId` | `{room:null}` |
| `bonusJoin` (public) | `room,no` | `{status:'joined',no}` |
| `bonusInfo` (public) | `room` | `{id,open}` |

`roster` contains `{no,name,q:[boolean,boolean]}`. Each new single-student batch may carry `questionStart` (1–500, including its final question); legacy batches omit it and retain their original numbering. Saved question assignments cannot be rewritten. Version 2 state contains `{version,students,absent,batches,bonus}`; student names are resolved from the private snapshot by the server. An admin room contains `{id,open,entrants:[number],winner:null|{no,name},absent:[number],drawnAt:null|ISO}`. The student endpoints never return the roster or registration list. Students self-report a roster number; this does not authenticate their identity. Duplicate numbers count once, and the instructor can remove an erroneous entry before drawing.

## Persistence and recovery

The private `Roster` tab contains exactly `No.`, `Name`, `Turn1`, and `Turn2`: positive unique safe-integer roster numbers, literal text names of at most 200 characters, and actual boolean participation flags. Names are escaped as text when copied, so a leading `=` cannot become a formula. No Student ID or numeric grade column is copied. Setup validates source data before creating this tab and removes the new tab if its write fails. The existing tab is preserved on later setup runs; owner corrections belong in the private snapshot after reviewing saved progress. Keep the two participation columns as actual boolean values, not text or numeric grades.

The private `State!A1` JSON is authoritative. A script lock serializes updates and signups; formal saves compare revisions, forbid participation rollback, and preserve Bonus results committed by the server. Server draws choose a single winner with Apps Script's `Math.random`, then store the winner and increment the state revision before responding. Retrying a draw returns the saved result. Registration survives closing or reloading the instructor's browser.

The last 30 admin mutation request IDs are retained. Reusing an ID with a different payload is rejected. Once an older ID leaves the window, revision checks still reject an old formal save, and the persisted room prevents a second draw. A result from an expired Bonus room fails rather than drawing again.

Attendance is stored alongside state as `attendance:[{date,absent,savedAt}]`; `batchDates` maps new batch IDs to explicitly supplied class dates. Existing documents default to empty metadata. `attendanceSave` validates a real `YYYY-MM-DD` date and known unique roster numbers, upserts that date, updates the current exclusion list, and increments revision without changing participation or batches. Save attendance for the selected class date before drawing. A formal `save` that appends batches requires a valid `sessionDate`, an existing attendance record for that date, and an exclusion list exactly matching its saved absences. New batches cannot contain an absent student. It dates only new batches and never creates, corrects, or refreshes attendance. Initialization and saves that append no batches remain available without a class date and also leave attendance unchanged. Owner load/mutation responses include these records, the private `storageUrl`, and recent `requestIds` for exact receipt recovery. None are returned by public actions.

Exact request receipts are checked before the attendance gate. A pending draw already committed by an older deployment can recover its original receipt without modifying attendance again. A pending draw that was never committed must satisfy the current date and attendance requirements; a rejected request makes no canonical write and records no receipt. The browser can discard a request after a confirmed rejection, reload cloud progress, save the selected date's attendance, and create a fresh draw request. A timeout is uncertain and still requires retrying the exact original request or checking its saved receipt before creating a new draw.

Run owner-only `refreshRecords()` in the editor after upgrading, or use **Refresh record sheets** on the website. The private **出勤记录** view has one student per row and one saved date per column; **讲题记录** lists question positions, class dates and historical participation; **学生名单** summarizes participation. Headers and student identity columns are frozen. Historical dates and attendance are left unknown. The original `State`, `Roster`, and compatibility `Draw log` sheets are preserved but hidden. Attendance corrections belong in the website; generated report cells are overwritten by the next refresh. Bonus uses its own attendance snapshot and does not inherit an earlier class’s saved exclusion list.

Report refresh follows a successful canonical commit. If it fails, the response includes `reportsWarning`; the save remains committed and its request receipt retained. Retry **Refresh record sheets** to rebuild the views. Public signup does not regenerate reports. Do not edit `State!A1` manually. Export the browser’s JSON backup (including attendance and batch dates) before administrative recovery. The backend refuses a canonical cell larger than 45,000 characters instead of truncating history.

Keep the admin deployment set to **Only myself**, the student deployment set to **Anyone**, and both set to execute as `huhanwj@gmail.com`. Google account access controls protect the instructor session. Never make the private storage spreadsheet public.

Public registration responses contain no winner/name or duplicate flag. Public payloads use a UUID room identifier and only `room`, `no`, and optional `requestId`; malformed inputs are rejected before acquiring the spreadsheet lock. Unexpected registration errors are logged on the server and replaced with a generic public message. Admin identity failures do not disclose the allowlisted address. Keep setup and management access restricted; do not publish Script Properties. An existing private Roster needs no SOURCE_ID property and setup never replaces it.
