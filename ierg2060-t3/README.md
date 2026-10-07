# The Draw — IERG2060 Tutorial 3

A student-facing card draw at `/ierg2060-t3/`. It is unlinked from the homepage and marked noindex. There is no grading, score display, attendance table, or identity roster.

Choose **6**, **7**, or a custom number, then draw. Cards reveal in sequence. The entire batch is saved before the animation and counts as drawn immediately. Reload restores that same batch. Numbers cannot repeat in a round; the whole class must pass Q1 before Q2 starts. A batch never spans rounds. If fewer eligible numbers remain than requested, it draws only those numbers. Missing students keep their unfinished turn; if all remaining students are absent, drawing pauses.

**Absent today** accepts an empty string or positive roster numbers separated by ASCII commas, for example `10,21,26`. Spaces, Chinese commas, leading zeros, duplicate numbers, and unknown numbers are rejected. Clear the field for a class with no absences. This is an exclusion list only, not an attendance record.

**Bonus round** opens a QR registration window. Students enter their roster No. Only registered, present numbers join that independent draw. Entries are deduplicated; the TA must keep the host tab open. Public PeerJS signaling and WebRTC connect the pages; campus networking can block connections, so manual entry remains available under a collapsed help section. Closing the dialog keeps registration running; use Close registration to stop it. A new round gets a new QR code. Bonus does not change formal rounds.

Use the settings gear to import a CSV from the Tutorial 3 Google Sheet or paste its worksheet URL (including gid). Only roster No. and whether Question 1 / Question 2 have a numeric entry are retained. Zero also means a previous turn. Numeric values, names, student IDs, and attendance columns are discarded. No class data is shipped in this public repository.

The previous version's browser data automatically migrates to boolean turn flags. The old grade-bearing localStorage entry is removed after the new state saves successfully. New JSON backups contain only draw data. Importing replaces current browser progress. Use Save draw progress to move between devices; there is no cloud synchronization or writeback to Google Sheets. One host tab per browser is enforced using Web Locks.

Serve locally with `python3 -m http.server`. There is no build step. Check layout in a browser, and selection/import invariants with Node. AGENTS.MD requests Python unittest discovery; this static repository has no tests directory.

Vendored MIT libraries: PeerJS 1.5.5 and qrcode-generator 1.4.4. Their licenses are included in `vendor/`.
