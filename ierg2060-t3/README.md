# Tutorial 3 draw

Open `/ierg2060-t3/` directly. It is not linked from the homepage and carries `noindex`; this is not access control. No class records, names, student IDs, or Google Sheet link are included in the published files.

## First use

Import the Tutorial 3 CSV exported from Google Sheets, or paste the worksheet URL (including its `gid`) under 数据与备份. Review the import summary. Nonblank numeric Question 1 / Question 2 cells count as completed, including zero. Names and student IDs are discarded. An import replaces this browser's state; export a JSON backup first if it already holds work.

The classroom initially selects the first session after the last populated attendance column, capped at Tutorial 10. Blank attendance defaults to present. Check the classroom and absences before drawing. Past absences are not automatically copied into the next class.

## In class

1. Check attendance, individually or using the absence-number field.
2. Draw a number. Enter its score and confirm completion. If the student is absent, use the absence button instead; their turn remains unfinished.
3. Q1 must be completed by the entire roster before any Q2 draw. If all unfinished students are absent, formal draws pause. After Q2 is complete, formal draws stop.
4. Open a Bonus round to display a QR code. Volunteers enter their **No.**, not their student ID. Close enrollment and draw one number. Bonus selection does not change Q1/Q2. Verify the volunteer's identity in class; the number is self-reported.
5. Export a JSON backup after class. Export the score CSV to transfer scores and attendance manually to the original sheet. The app never writes to Google Sheets.

Regular pending draws survive reload. State is saved in localStorage on this browser/device; use one TA host. Web Locks prevent multiple tabs on the same origin from overwriting state, but separate devices do not synchronize. Clearing browser data removes the local record. Imports and score corrections are deliberate TA actions; original scores for corrections remain in the JSON history.

Bonus uses PeerJS 1.5.5 public signaling and a WebRTC data connection. The TA must keep the host page open and use its public HTTPS URL for phones to join. QR generation is local using qrcode-generator 1.4.4. No names or scores cross the bonus channel. Duplicate No. values count once and expired round links cannot join a new round. Campus firewalls / NAT or the signaling service can prevent phone connections: use manual enrollment when needed. Enrollment is transient; refreshing loses an un-drawn Bonus pool and requires a new QR code. A saved Bonus winner remains in history. Bonus counts are selections, not graded completions.

## Maintenance

No build step. Serve the repository with `python3 -m http.server` for local viewing. Keep vendored library notices. The homepage is unaffected.

The existing AGENTS.MD asks for Python unittest discovery, but this static-site repository has no tests directory. Validate the selection and import invariants with Node and check the pages in a browser. Do not add layout/wording tests or a new test suite solely for this page.

Third-party sources: [PeerJS](https://peerjs.com/docs/) and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator). Both are MIT licensed; notices are retained in vendor files.
