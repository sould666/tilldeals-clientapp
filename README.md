# TillDeals Hardware

Local hardware overview built with Electron. It reads CPU, memory, graphics, storage, mainboard, BIOS, network, temperatures, and other permitted local system details.

The app detects its operating environment. A native Windows build reads Windows hardware directly. When the development app runs inside WSL2, it queries the Windows host through PowerShell/CIM so the result is not limited to the WSL virtual machine. A native Linux build uses the local Linux data exposed by `systeminformation`.

## Download for Windows

[Download the latest Windows installer](https://github.com/sould666/tilldeals-clientapp/releases/latest/download/TillDeals-Hardware-Setup-latest-win-x64.exe) or [view all releases](https://github.com/sould666/tilldeals-clientapp/releases). The installer checksum is available [here](https://github.com/sould666/tilldeals-clientapp/releases/latest/download/TillDeals-Hardware-Setup-latest-win-x64.exe.sha256).

### Automatic desktop updates

Windows x64 builds installed with the NSIS installer check GitHub for a newer stable release once at launch. The always-visible update bar also supports manual checks. **Update desktop app** downloads the update using `electron-updater`, verifies the installer against the SHA-512 in release metadata, and shows progress. **Install and restart** then starts the installer and restarts the app. Downloads and installation require these explicit actions; closing the app does not silently install an update. Network/download/checksum errors are shown, with manual retry. Updates do not change local profile/items/BYOK or enable business APIs.

Development, Linux/WSL, unsupported architectures, ZIP, and portable builds show an explicit unsupported status; use the Windows installer to enable automatic updates. Older builds without the updater need one manual installation of the first updater-enabled release.

The single **Windows installer** workflow runs automatically on pushes to `main`, with the fixed run title **Windows release pipeline**. There are no manual workflow triggers or local release steps. It publishes immutable stable version tags with the NSIS `.exe`, `.blockmap`, `latest.yml`, SHA-256 checksum, and compatibility download aliases. Older releases remain available for differential downloads; the legacy mutable `latest` prerelease is no longer overwritten.

### Automatic CI versioning

The first release under this policy is **1.0.0**. Afterward, published stable release tags are the version authority. CI counts added plus deleted text lines in `src/**/*.js`, `src/**/*.css`, and `src/**/*.html` between the last published stable release commit and the triggering commit (renames count as deletion/addition):

- Below **500** changed source lines: patch.
- **500–1,999**: minor, resetting patch to zero.
- **2,000 or more**: major, resetting minor/patch to zero.

Tests, documentation, dependency lockfiles, assets and generated files do not count. Every new main push is release-eligible, even when the counted change is zero. These are code-volume thresholds, not a claim that a major version necessarily contains breaking API changes.

CI stamps the selected version into both manifests before dependency installation and packaging. No bot commits or local version bump are needed; the repository's `1.0.0` version is a development baseline, while the installed app and published tags carry the actual CI release version. A rerun of the latest already-published commit verifies the existing assets instead of creating another release. Non-descendant history and unfinished/conflicting releases fail explicitly. Runs are serialized without canceling an active release; GitHub may replace older pending runs with a newer push.

Artifacts are uploaded to a draft, downloaded back and verified (installer filename, SHA-256, SHA-512 metadata and blockmap presence) before becoming the latest stable release. Draft staging is transactional preparation, not a user-facing prerelease. A failed draft must be inspected/resolved before retrying; it is never silently deleted or replaced.

The installer remains unsigned. Checksums verify consistency with GitHub-hosted metadata, not publisher identity; Windows may display a security prompt. Release signing should be configured before relying on publisher-signature verification.

Run updater state/IPC and release-format tests with `npm run test:updates`. Actual Windows installer update/restart requires two published updater-enabled versions and is not verified by mock tests.

## Release a Windows build

Commit and push to `origin main`. GitHub Actions resolves the version, installs dependencies, tests, packages, verifies and publishes. Local builds are not part of the release pipeline. The previous local `deploy:win` version-bump/ZIP script has been removed.

For local development, use Node.js 24 and `npm ci`, then `npm start`. Packaging commands remain developer diagnostics only; they do not resolve release versions or publish releases.

To test CPU and GPU sensor APIs in the current environment:

```bash
npm run test:sensors
```

The published Windows installer includes Electron and all application dependencies, so the target PC does not need Node.js or npm.

## Development

```bash
npm start
```

Runtime diagnostics are written to `%APPDATA%\TillDeals Hardware\runtime.log` on Windows.

The Settings and Manual Diagnosis views show local collection behavior and identify sensors that are unavailable because a driver or firmware does not expose them. Temperature values are reported only when a supported sensor returns a valid reading; they are never inferred from unrelated values.

Manual Diagnosis starts with the observed symptom rather than a hardware area. The app assigns the likely problem area after the symptom is selected and provides two modes: `Początkujący` uses short, safe checks in plain language, while `Profesjonalny` provides more technical evidence-gathering steps.

## Backend integration (Phase 0)

Public, read-only `GET https://deals.tillgreen.eu/api/health` retains its Phase 0 contract alongside the deployed v1 authentication routes below. The desktop checks it on startup and through **Check TillDeals connection** in Settings, using main-process fetch with a 15-second timeout, no cookies, tokens, machine identifiers, or profile data. Redirects are rejected. A successful check requires HTTP 200 JSON with `status: "ok"`, a string `release`, Node runtime starting with `24.`, production mode, and `environment`, `pg`, `drizzle`, and `migration` checks all reporting `"ok"`. HTTP 503, malformed responses, network errors, and timeouts are displayed as failures.

A healthy backend does not imply authentication or business API availability. Legacy profile registration/sync, remote entitlements, deal polling, checkout, and consultation submission remain blocked in the main process. Installation-scoped tracked-item sync uses only the separately approved v1 contract below. Existing views remain visible; local profile editing and tracked-item management still work. Previously cached deals remain visible, explicitly labelled as local cached data without a next refresh. No web account is created by local onboarding.

Legacy business endpoint assumptions in the client are not approved API contracts. Do not enable them by changing the capability flag alone: agree versioned schemas, authentication, and server-owned authorization with the backend first. Existing locally encrypted tokens are not sent to the health endpoint. OpenAI requests and local hardware collection are unchanged.

Run the backend contract and offline-account regression tests with:

```bash
npm run test:backend
```

## Passwordless sign-in (Phase 1 complete; user-confirmed production acceptance)

The desktop implements the approved email-code contract against `https://deals.tillgreen.eu`. On 2026-10-04, the user confirmed real production logins and email confirmations and declared Phase 1 complete. The backend public process record reflects this user-confirmed acceptance in deployed release `20261004T111559Z-f735a99`. This is user evidence, not an agent-run inbox test; automated desktop validation uses contract mocks. It does not establish product sync, browser inspection or combined logout acceptance. A missing route is shown explicitly, without automatic retries or fake remote success. Existing local onboarding remains available; after saving a local profile, Settings offers separate email-code sign-in. Local profile email, display name, and consent do not prove authentication and are not recorded as server consent.

- `POST /api/v1/auth/request-code`: only normalized email and a persistent random UUID `installationId`. HTTP 202 returns a challenge ID, expiry, and 60-second resend cooldown.
- `POST /api/v1/auth/verify-code`: only the main-process challenge ID, installation ID, and six ASCII digits (including leading zeros). The backend owns the 10-minute expiry, five-attempt limit, single-use enforcement, and resend invalidation. HTTP 200 returns the opaque token and verified account/session.
- `GET /api/v1/account`: bearer token from the main process only. Restored sessions remain **unconfirmed** until the server confirms them. Absolute expiry is enforced locally as well; there is no refresh-token flow.
- `POST /api/v1/auth/logout`: bearer token, no body. The app requests server revocation before deleting its token. Network failure never claims revocation and retains the session for retry. A separately labelled **local-only sign-out** deletes the local token without claiming server revocation.

Tokens never cross the preload bridge or appear in logs. They are stored only with Electron `safeStorage` when secure encryption is available; Linux `basic_text`/unknown backends are rejected. Otherwise the session is memory-only with an explicit notice. Storage failure is also surfaced. A `401 SESSION_INVALID` clears authentication only, preserving local profile/items/BYOK. Legacy device tokens are not used. Hardware fingerprints are metadata, not identity; the auth installation ID is independent of hardware.

Authentication IPC accepts only the current window's exact local main frame. Navigation away from the renderer, redirects, new renderer windows, and webview attachment are blocked. Requests use fixed main-process routes, no cookies, no redirects, and a 15-second timeout; browser CORS is unnecessary. Structured v1 errors and integer `Retry-After` values are handled without exposing server-provided error text.

Sign-in does not enable unapproved business APIs, sync the local profile, or grant entitlements. Existing local feature behavior is retained; cached entitlements are not server authorization. Installation-list sync is a separate approved milestone below.

No further live login attempts are requested by this status update. For any separately approved acceptance testing, enter email codes only in the app, never chat, and report only sanitized outcomes or error codes. Do not automatically resend: production limits include a 60-second email cooldown, five email requests/hour, 20 requests/server peer IP/hour, and 100 requests globally/hour. A successful health check is not proof of inbox delivery or authentication.

## Installation product lists and browser spaces (Phase 2 current; live acceptance pending)

The backend deployed installation-scoped tracked GET/PUT and owner-only browser spaces on 2026-10-04 in release `20261004T103955Z-f658b26`; Phase 1 user-confirmed acceptance was recorded in release `20261004T111559Z-f735a99`, with the subsequent browser fix deployed in `20261004T114329Z-eef1de2`. The desktop adaptation is implemented and automated client contract validation uses mocks. Phase 2 remains the current/default phase. Production snapshot persistence is now server-confirmed as detailed below; full user acceptance of sync visibility, browser owner/admin inspection and the combined logout flow remains pending.

Subsequent backend read-only production aggregate evidence on 2026-10-04 confirms an existing account with one valid desktop session, one synced installation and three persisted products. No product contents, emails or tokens were fetched. Production snapshot persistence is therefore server-confirmed, not merely mock-tested; full user acceptance of sync visibility, browser owner/admin inspection and the combined logout flow remains pending. That account had no valid browser session at diagnosis, so desktop authentication did not establish browser access.

Backend release `20261004T114329Z-eef1de2` adds session-aware homepage **Admin/My space** links, existing-session sign-in redirects, an uncached personalized homepage, full-document navigation after browser auth/logout to avoid stale router authentication cache, and owner-mismatch guidance. Backend HTTP regression and real local browser session-preservation tests passed. This is backend deployment/local-test evidence, not user-confirmed production browser acceptance. No new production auth or upload attempts were performed for this diagnosis.

Release inspection on 2026-10-04 confirmed that stable desktop `v1.0.0` targets commit `c09c35ac622a146aaeef71d5aeb2bd0bb8845b8b`, which includes the snapshot-sync implementation introduced in `0316e77`. GitHub Actions run `37197717593` successfully built, checked and published `TillDeals-Hardware-Setup-1.0.0-win-x64.exe`. Its published SHA-256 is `192e8cce95458757b162926f93c512b49d2e20d392674f82481e2dd3f5612a03`. This is release/source and CI evidence, not proof of the version currently running on a user's computer or a production upload. The subsequent corrupt-local-list guard described below is a local fix until separately committed and released.

After successful code verification or startup account validation, and after local additions/removals, the desktop sends a full atomic snapshot to `PUT /api/v1/tracked-items`. The body is only `{items:[{clientId,name,category,source,addedAt}]}`; account and installation ownership come solely from the bearer session. Each desktop installation has a separate list. An empty snapshot intentionally clears only that installation's server list. No legacy tracked-item PUT/DELETE endpoint is called.

The UI discloses uploads before sign-in and in MyDeals: product names/categories/sources/added dates, never hardware. The local list remains authoritative and is never replaced by `GET /api/v1/tracked-items` data. Legacy non-UUID local item IDs are migrated once to persisted UUIDs without removing items. Invalid local fields, duplicate IDs, more than 100 items or a UTF-8 body exceeding 65536 bytes produce explicit errors without sending a partial list. Existing local plan limits remain unchanged.

Unreadable JSON, a non-list document or malformed local entries fail with `STORAGE_ERROR`; they must not be mistaken for an intentional empty list, uploaded as a server clear, or overwritten by a local edit.

Snapshots are serialized/coalesced while edits occur, so a newer list cannot be overwritten by an older in-flight snapshot. Session-context checks reject stale account results; failures keep local edits and are displayed in MyDeals, with manual retry and no automatic retry loop. Authentication is checked before every request. Deal retrieval, billing, entitlements and consultations remain gated; there is no heartbeat or online-presence inference.

**Open your space** opens only the fixed HTTPS origin `https://deals.tillgreen.eu/space/{verifiedAccountId}`, derived from a validated account ID for compatibility with older auth responses. The browser independently requires email sign-in and exact-owner authorization. No token appears in the URL or is transferred to the browser. Desktop IPC is restricted to the trusted local main frame. Admin authorization and browser space ownership are enforced by the backend, not local profile email.

Automated validation uses contract mocks and sends no live account/email/sync requests. For user-driven acceptance, verify the email code in the updated desktop, check the account/session, and confirm MyDeals reports a successful authorized installation snapshot. Add/remove a test product and confirm the corresponding snapshot, then explicitly open your space and sign in separately in the browser. Inspect the owner space and, only with the authorized administrator account, the admin view. Finally revoke the desktop session with its logout control. Report only sanitized success/failure outcomes and error codes: no codes, tokens, email addresses or product contents in chat or agent handoffs. Valid connections represent unexpired/unrevoked sessions and last authenticated activity, never online presence.

For an already signed-in user, install/update to `1.0.0` or newer and restart that installed client. In Settings, **Check session** validates the desktop account and triggers a snapshot; in MyDeals, **Sync local list** explicitly sends the current list. Confirm **This installation's list synced** with a timestamp, or report only the displayed error code. Use **Open your space** rather than a saved account URL, then sign into the browser with the same account independently. Desktop sign-in does not authenticate the browser, and a space URL alone is not evidence that any products were uploaded. Do not share email, product contents, codes or tokens.