# Private Google Sheets persistence

This backend runs as the instructor and stores draws in a separate private Google spreadsheet. It reads the original Tutorial 3 roster, using only roster No., Name, Tutorial Class, and two participation flags. Student ID cells are never read. Question values become booleans immediately; scores never enter saved state or browser responses. The original worksheet is not edited.

## One-time setup

1. Sign in to the Google account that can read the original worksheet. Open [Apps Script](https://script.google.com/home) and create a standalone project.
2. Replace `Code.gs` with this directory's `Code.gs`. Add an HTML file named `Bridge` and paste `Bridge.html` into it.
3. In **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace that manifest with this directory's `appsscript.json`.
4. Select `setup` in the editor's function menu, click **Run**, and authorize the spreadsheet access as the owner. This creates the separate private storage spreadsheet. Running setup again reuses the same spreadsheet and admin key. The setup entry point rejects anonymous callers and signed-in users who are not the script owner.
5. Open the execution log and privately copy the generated admin key and storage spreadsheet link. Keep the key out of the repository, URLs, QR codes, screenshots, and student messages. Leave the storage spreadsheet private. Only the owner needs access to it.
6. Choose **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone**. Deploy and copy the final URL ending in `/exec`. If the organization disables anonymous web apps, this account cannot provide sign-in-free student registration; use an account whose policy permits it.
7. In the draw page's cloud settings, enter that `/exec` URL and private admin key, then connect. An empty cloud returns roster names and participation flags. Review the local migration or initial roster progress, then explicitly initialize the cloud once. Existing cloud progress takes precedence on later connections.
8. Verify a complete Bonus round from a phone's private browser window. The student should see the registration form without a Google sign-in or authorization prompt. Close registration on the instructor page before drawing. Reload the instructor page to confirm the saved result remains.

For code updates, use **Deploy → Manage deployments → Edit → Version → New version → Deploy**. This preserves the `/exec` URL. The deployment owner performs these steps; this repository does not deploy or contain the secret key.

## Transport and actions

The public page embeds `/exec?channel=<random UUID>` in an iframe. Apps Script wraps the bridge in a Google iframe, so its ready message comes from the inner `*.googleusercontent.com` frame. The parent validates the expected channel and Google origin, then pins the source window. The bridge accepts messages only from its top window at `https://huhanwj.github.io` or HTTP localhost/127.0.0.1 development origins.

Request envelope: `{type:'ierg-rpc',channel,id,action,payload}`. Response: `{type:'ierg-rpc-result',channel,id,result,error}`. Ready: `{type:'ierg-ready',channel}`. Browser requests go through `google.script.run`; no cross-origin fetch or public CORS proxy is needed. RPC authentication still protects every administrative action even when someone opens the bridge directly.

Every admin payload includes `adminKey`. Every mutation except public signup includes a unique, stable `requestId`; retries reuse the exact payload and ID.

| Action | Additional payload | Result |
| --- | --- | --- |
| `auth` | — | `{ok:true}` |
| `load` | — | `{state,revision,roster}`; state is `null` until initialized |
| `names` | — | `{roster}` |
| `initialize` | `state,revision,requestId` | `{state,revision}`; cloud must be empty |
| `save` | `state,revision,requestId` | `{state,revision}` |
| `bonusOpen` | `absent,requestId` | `{room}` |
| `bonusStatus` | — | `{room}`; room may be `null` |
| `bonusClose` | `room,requestId` | `{room}` |
| `bonusRemove` | `room,no,requestId` | `{room}` |
| `bonusDraw` | `room,requestId` | `{state,revision,room}` |
| `bonusReset` | `room,requestId` | `{room:null}` |
| `bonusJoin` (public) | `room,no` | `{status:'joined',no,duplicate}` |
| `bonusInfo` (public) | `room` | `{id,open,winner}` |

`roster` contains `{no,name,q:[boolean,boolean]}`. Version 2 state contains `{version,students,absent,batches,bonus}`; student names are resolved from the source by the server. An admin room contains `{id,open,entrants:[number],winner:null|{no,name},absent:[number],drawnAt:null|ISO}`. The student endpoints never return the roster or registration list. Students self-report a roster number; this does not authenticate their identity. Duplicate numbers count once, and the instructor can remove an erroneous entry before drawing.

## Persistence and recovery

The private `State!A1` JSON is authoritative. A script lock serializes updates and signups; formal saves compare revisions, forbid participation rollback, and preserve Bonus results committed by the server. Server draws choose a single winner with Apps Script's `Math.random`, then store the winner and increment the state revision before responding. Retrying a draw returns the saved result. Registration survives closing or reloading the instructor's browser.

The last 30 admin mutation request IDs are retained. Reusing an ID with a different payload is rejected. Once an older ID leaves the window, revision checks still reject an old formal save, and the persisted room prevents a second draw. A result from an expired Bonus room fails rather than drawing again.

The `Draw log` tab is derived from canonical state and contains only numbers, names, rounds, and timestamps. If this readable log fails to refresh, canonical progress remains committed. Reload or the next successful mutation refreshes displayed cloud state; the next mutation regenerates the log. Do not edit `State!A1` manually. Export the browser's JSON backup before administrative recovery. The backend refuses a canonical cell larger than 45,000 characters instead of truncating history.

To rotate a compromised admin key, change the `ADMIN_KEY` value in Apps Script **Project Settings → Script properties** to a new long random secret, then reconnect the instructor page. No redeployment is needed. Do not publish the key or make the private storage spreadsheet public.
