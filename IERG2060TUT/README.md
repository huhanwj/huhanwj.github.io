# The Draw — IERG2060 tutorials

The page serves Tutorial 1–4; the start page asks for the group, then Google sign-in. Each group is a fixed teaching group, not a class date or a participation round.

A student-facing random draw at `/IERG2060TUT/` (formerly `/ierg2060-t3/`, which now redirects). It is unlinked from the homepage and marked noindex. There is no grading, score display, or SID display. Attendance and participation reports live in the private Google spreadsheet.

## Round 2 · voluntary Bonus

Round 1 is finished, and round 2 is entirely voluntary Bonus; the site no longer takes attendance. Each question runs like this:

1. Check **Class date** and **Question**. The question number defaults to the next unused one for that date.
2. Click **Open volunteer sign-up**. A large QR code appears. Students enter their **SID**; the server maps it to their roster No. and the phone confirms with the No. and a masked name (for example `C*** T** M**`). The instructor page lists volunteers live, marked *first time* or *presented before*. **Add by roster No.** covers anyone whose phone fails; × removes an entry.
3. Click **Close & draw a volunteer**. The server draws one volunteer, choosing among those who have **not presented in round 2** whenever there are any, and otherwise among all volunteers. The result is saved before it is shown, and retrying returns the same student.
4. If nobody volunteered, click **Lottery (no volunteers)**. It previews a random student who has not presented in round 2. **Not here · draw again** skips that student for this question only; they keep their priority. **Confirm** saves the lottery result. Once every remaining student who has not presented is skipped, the lottery falls back to everyone else.
5. **Next question** moves on. To give the same question to someone else, use **Another volunteer** (draws again from the same sign-up, skipping anyone already drawn) or **Lottery**. Every student who presents keeps their record.

**Question set** shows the question being asked next to the QR code and the selected student. Question sets live in `questions/`; each question is one image cropped from the student (question-only) PDF by `tools/question_images.py`, for example:

```
python3 tools/question_images.py ~/Documents/lec_prepare/tutorial7/Tutorial_7_Questions.pdf questions/tutorial7 "Tutorial 7"
```

Never add the TA version. The repository is public; only question handouts belong here.

### Tutorial groups

One backend serves every group. The **Groups** tab in the Tutorial 3 storage spreadsheet has one row per group: Group ID (lowercase, for example `t1`), Label, Tutorial Class, the answer-sheet tab's gid, and TA Gmail addresses. The owner can open every group; a TA sees only their own. The page for a group is `?group=<id>` (Tutorial 3 needs none), and its QR codes carry the same group. A group's private storage, roster and SID index are created on its first sign-in from its answer-sheet tab. "Sign in with Google" for TAs needs an OAuth Web client ID in `cloud-config.js` and `Code.gs`; until then the original owner-only sign-in window remains.

The **teaching sheet** (the original Tutorial 3 sheet) is the record of who has answered. A student has presented in round 2 when their **Question 2** cell is filled there, or when this site has drawn them for a round 2 Bonus (the mark may not be entered yet). The backend re-reads Question 2 on sign-in, before every draw and lottery, and via Settings → **Re-read answer sheet**. It never writes to the teaching sheet and never reads its SID cells for this. If the sheet cannot be read, the page shows a warning and uses the last synchronized list. **Round 2 record** lists the selected date's records and the roster numbers who have not presented yet. **Cancel sign-up** discards an open sign-up without drawing.

Every change sends a stable `requestId`. If Google does not confirm, the page keeps the same request and shows **Retry the same request**; reloading resends it automatically after sign-in.

### Concurrency

Earlier, each signup waited at most 2 s for the shared script lock, while the instructor page's status poll held that lock to read the spreadsheet every 5 s. A burst of 20 phones therefore produced *busy* replies. Now:

- The SID lookup reads one Script Property and takes no lock.
- The lock covers one `getProperties` read and one property write per signup. Signups wait up to 20 s in that queue instead of failing after 2 s.
- The instructor page polls the volunteer list every 2 s with `bonusLive`, which reads Script Properties without the lock or the spreadsheet.
- The phone retries the same request up to 4 times with jittered backoff; duplicates count once.

Verify this with `load-test.html?mode=test` (20 or 25 simultaneous student pages) after deploying.

The private storage spreadsheet now has one readable tab, **学生名单**: No., SID, Name, whether Question 1 and Question 2 are filled in the teaching sheet, and the round 2 Bonus draws made on the website (date, question, volunteer or lottery). It is rebuilt after every draw and by Settings → **Re-read answer sheet**. The old **出勤记录** and **讲题记录** tabs are deleted on the first rebuild; their data remains in the hidden `State` tab. Attendance is no longer taken.

**Google Sheets sync** keeps the full draw UI at the homepage address. **Sign in with Google** opens the owner-only deployment in a temporary window; its Continue link returns a short-lived, nonce-bound grant to a same-origin callback. The original page exchanges that grant for a two-hour session, kept only in sessionStorage, and loads records automatically through the public bridge. No private Google iframe needs third-party sign-in cookies. Reloading reuses an unexpired session; expired or evicted sessions require sign-in again. Cancel sign-in ends the wait. Reconnecting resends an unconfirmed request with its original request ID; the server returns the saved receipt instead of applying it twice. Credentials travel separately from business payloads, so renewing a session does not change a pending request's fingerprint. The server checks the owner account before minting a grant and validates the session before every private action. Public endpoints in `cloud-config.js` are not credentials. The student QR contains only this site's signup address and the current room ID. The signup page always uses the configured student endpoint; a URL parameter cannot redirect submissions to another deployment. The endpoint remains visible in browser network requests because this is a static site. [Backend and setup instructions](google-apps-script/README.md). The Google owner must authorize and deploy both endpoints before cloud sync works. Existing key-based deployments must be archived or updated; changing source alone does not revoke old deployed versions. The private roster snapshot and storage spreadsheet remain Restricted. The original shared teaching sheet is not edited. The snapshot includes only Tutorial 3 numbers, names and participation flags, copied once by the owner; future cloud operations use the private copy.

The cloud must already be initialized (run `setup`, or `setupTest` for test mode). Later connections restore canonical cloud state. Another device's newer revision is loaded on conflict. Settings → **Download backup** downloads a JSON backup of confirmed progress.

Volunteer sign-ups are stored durably in a small server-side journal, then archived to Google Sheets when registration closes or a winner is drawn. Each signup avoids spreadsheet reads, writes, and flushes. Success is shown only after server confirmation. Knowing a classmate's SID would still let someone sign them up, so the instructor confirms the person in class. The PeerJS local-only mode has been removed. Round 2 Bonus records do not change the old Q1/Q2 participation flags.

The private roster snapshot holds only roster No., Name, and the two old participation flags; scores are never copied. SIDs enter the backend once, through owner-only `importSids()`, and are stored only as salted hashes (see the backend README). No class roster or SID is shipped in this public repository.

Serve locally with `python3 -m http.server`. There is no build step. Check layout in a browser, and selection/import invariants with Node. AGENTS.MD requests Python unittest discovery; this static repository has no tests directory.

Vendored MIT library: qrcode-generator 1.4.4 (PeerJS 1.5.5 remains in `vendor/` but is no longer loaded). Licenses are included in `vendor/`.

Security boundaries: both HTML pages use a Content Security Policy that allows scripts only from this site and restricts frames and other resource origins. The public API accepts only bounded registration fields, returns round availability and registration receipts, and does not return names, winners, roster lists, duplicate flags, or raw internal errors. Closed-round receipt retries still reveal whether a supplied number previously joined; self-reported registration is not identity verification and the TA checks numbers in person. Anonymous traffic can still consume Apps Script quotas; this architecture does not provide strong denial-of-service protection. A secret scan of committed application files is not a guarantee that no credential has ever been exposed.

The source spreadsheet ID is no longer embedded in backend source; optional first-time bootstrap reads a server-side SOURCE_ID property. Existing private roster snapshots do not read the source sheet. Already-published addresses remain in Git history; hiding or deleting current source cannot revoke Google access. The private STORE_ID stays in Script Properties, and the private spreadsheet must remain Restricted.
