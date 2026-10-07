# The Draw — IERG2060 Tutorial 3

A student-facing random draw at `/ierg2060-t3/`. It is unlinked from the homepage and marked noindex. There is no grading, score display, attendance table, or SID display.

Choose **6**, **7**, or a custom number, then draw. Draw order assigns this batch's question numbers: the first selected student presents Question 1, the second Question 2, and so on through Question n. These question numbers restart at 1 for each batch and are independent of participation rounds. Each drawn entry shows its question number, roster No. and name when available.

The results list appears after the save is confirmed. A short click guard prevents a double click from drawing two batches. The entire batch is saved before it is shown and counts as drawn immediately. Reload restores both the same students and question assignments from the saved order. Students cannot repeat in a participation round; everyone must be drawn once before anyone is drawn twice. A batch never spans participation rounds. If fewer eligible students remain than requested, it draws only those students. Missing students keep their unfinished turn; if all remaining students are absent, drawing pauses.

**Absent today** accepts an empty string or positive roster numbers separated by ASCII commas, for example `10,21,26`. Spaces, Chinese commas, leading zeros, duplicate numbers, and unknown numbers are rejected. Clear the field for a class with no absences. This is an exclusion list only, not an attendance record.

**Google Sheets sync** is configured under Draw settings with an Apps Script Web app URL and private TA access key. The endpoint is remembered in this browser; the access key lasts for the tab session and never goes in a QR code. [Backend and setup instructions](google-apps-script/README.md). The Google owner must authorize and deploy the script before cloud sync works.

The first connection previews initialization from existing browser progress (with refreshed names), or the source sheet if no local progress exists. Initialize explicitly. Later connections restore canonical cloud state. Formal batches save before display; uncertain saves retain the same request ID and exact result for retry. Another device's newer revision is loaded on conflict. Cloud mode disables replacement CSV imports; Refresh names updates names without changing turns. Save draw progress downloads a JSON backup.

**Bonus round** in cloud mode stores signups and its winner in Google Sheets. Students scan the QR and enter only their roster No.; the service deduplicates that number. Close registration before drawing. Reloading preserves entries and results. Students self-report their No.; this is not identity verification. In local-only mode, the existing PeerJS connection remains available; keep the host tab open, and use manual entry if the classroom network blocks it. Bonus does not change formal participation rounds.

CSV import retains only roster No., optional Name, and whether Question 1 / Question 2 have numeric entries. Zero also means a previous turn. Scores, SID and other columns are discarded. The Apps Script backend reads selected source columns and never reads SID data cells. No class roster is shipped in this public repository. Previous browser backups still load; missing names can be refreshed when connecting Google Sheets. Local CSV/JSON import replaces browser progress, so use a backup before importing.

Serve locally with `python3 -m http.server`. There is no build step. Check layout in a browser, and selection/import invariants with Node. AGENTS.MD requests Python unittest discovery; this static repository has no tests directory.

Vendored MIT libraries: PeerJS 1.5.5 and qrcode-generator 1.4.4. Their licenses are included in `vendor/`.
