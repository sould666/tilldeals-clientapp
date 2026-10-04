# TillDeals Hardware

Local hardware overview built with Electron. It reads CPU, memory, graphics, storage, mainboard, BIOS, network, temperatures, and other permitted local system details.

The app detects its operating environment. A native Windows build reads Windows hardware directly. When the development app runs inside WSL2, it queries the Windows host through PowerShell/CIM so the result is not limited to the WSL virtual machine. A native Linux build uses the local Linux data exposed by `systeminformation`.

## Download for Windows

[Download the latest Windows installer](https://github.com/sould666/tilldeals-clientapp/releases/latest/download/TillDeals-Hardware-Setup-latest-win-x64.exe) or [view all releases](https://github.com/sould666/tilldeals-clientapp/releases). The installer checksum is available [here](https://github.com/sould666/tilldeals-clientapp/releases/latest/download/TillDeals-Hardware-Setup-latest-win-x64.exe.sha256).

### Automatic desktop updates

Windows x64 builds installed with the NSIS installer check GitHub for a newer stable release once at launch. The always-visible update bar also supports manual checks. **Update desktop app** downloads the update using `electron-updater`, verifies the installer against the SHA-512 in release metadata, and shows progress. **Install and restart** then starts the installer and restarts the app. Downloads and installation require these explicit actions; closing the app does not silently install an update. Network/download/checksum errors are shown, with manual retry. Updates do not change local profile/items/BYOK or enable business APIs.

Development, Linux/WSL, unsupported architectures, ZIP, and portable builds show an explicit unsupported status; use the Windows installer to enable automatic updates. Older builds without the updater need one manual installation of the first updater-enabled release.

The Windows workflow now publishes immutable stable `v<package.json version>` releases with the versioned NSIS `.exe`, `.blockmap`, `latest.yml`, SHA-256 checksum, and compatibility download aliases. It preserves older releases for differential downloads, skips already-published stable versions, rejects unfinished/draft versions, and verifies the published installer filename/checksum and metadata after upload. Bump the package version before publishing a new release; pushing the same version does not replace an existing release. The old mutable `latest` prerelease is not an updater feed and is no longer overwritten.

The installer remains unsigned. Checksums verify consistency with GitHub-hosted metadata, not publisher identity; Windows may display a security prompt. Release signing should be configured before relying on publisher-signature verification.

Run updater state/IPC and release-format tests with `npm run test:updates`. Actual Windows installer update/restart requires two published updater-enabled versions and is not verified by mock tests.

## Build a Windows package

Prerequisites: Git, Node.js 20 or later, and npm.

```bash
git clone https://github.com/sould666/tilldeals-clientapp.git
cd tilldeals-clientapp
npm ci --no-audit --no-fund
npm run deploy:win
```

To test CPU and GPU sensor APIs in the current environment:

```bash
npm run test:sensors
```

The deploy script creates an unsigned, self-contained Windows x64 ZIP archive in `dist/`. It includes Electron and all application dependencies, so the target Windows PC does not need Node.js or npm.

Extract the archive to a normal Windows folder such as `C:\Users\<user>\Downloads\TillDeals Hardware` and run `TillDeals Hardware.exe`.

When building from WSL, do not run the packaged executable from `/home/...`. Copy the ZIP to a Windows path, extract it there, and launch it from Windows Explorer.

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

## Passwordless sign-in (v1 deployed; live email smoke pending)

The desktop implements the approved email-code contract against `https://deals.tillgreen.eu`. The backend reported deployment on 2026-10-04, release `20261004T085317Z-3870a9d`, on Passenger Node 24.15.0. SMTP TLS/mailbox authentication and backend route validation were reported verified, but actual inbox delivery and full real desktop sign-in have not yet been validated. Client validation so far uses contract mocks, not a live email/code/token flow. A missing route is shown explicitly, without automatic retries or fake remote success. Existing local onboarding remains available; after saving a local profile, Settings offers separate email-code sign-in. Local profile email, display name, and consent do not prove authentication and are not recorded as server consent.

- `POST /api/v1/auth/request-code`: only normalized email and a persistent random UUID `installationId`. HTTP 202 returns a challenge ID, expiry, and 60-second resend cooldown.
- `POST /api/v1/auth/verify-code`: only the main-process challenge ID, installation ID, and six ASCII digits (including leading zeros). The backend owns the 10-minute expiry, five-attempt limit, single-use enforcement, and resend invalidation. HTTP 200 returns the opaque token and verified account/session.
- `GET /api/v1/account`: bearer token from the main process only. Restored sessions remain **unconfirmed** until the server confirms them. Absolute expiry is enforced locally as well; there is no refresh-token flow.
- `POST /api/v1/auth/logout`: bearer token, no body. The app requests server revocation before deleting its token. Network failure never claims revocation and retains the session for retry. A separately labelled **local-only sign-out** deletes the local token without claiming server revocation.

Tokens never cross the preload bridge or appear in logs. They are stored only with Electron `safeStorage` when secure encryption is available; Linux `basic_text`/unknown backends are rejected. Otherwise the session is memory-only with an explicit notice. Storage failure is also surfaced. A `401 SESSION_INVALID` clears authentication only, preserving local profile/items/BYOK. Legacy device tokens are not used. Hardware fingerprints are metadata, not identity; the auth installation ID is independent of hardware.

Authentication IPC accepts only the current window's exact local main frame. Navigation away from the renderer, redirects, new renderer windows, and webview attachment are blocked. Requests use fixed main-process routes, no cookies, no redirects, and a 15-second timeout; browser CORS is unnecessary. Structured v1 errors and integer `Retry-After` values are handled without exposing server-provided error text.

Sign-in does not enable unapproved business APIs, sync the local profile, or grant entitlements. Existing local feature behavior is retained; cached entitlements are not server authorization. Installation-list sync is a separate approved milestone below.

For one user-driven live smoke, use the updated desktop app's Settings sign-in form to request one code for an inbox you control. Check for mail from `hello@deals.tillgreen.eu` (including spam), and enter the code only in the app, never chat. Confirm verified session status, use **Check session**, then **Sign out and revoke session**. Report only delivery success/failure and non-sensitive UI/error codes, never codes or tokens. Do not automatically resend: production limits include a 60-second email cooldown, five email requests/hour, 20 requests/server peer IP/hour, and 100 requests globally/hour. A successful health check is not proof of inbox delivery or authentication.

## Installation product lists and browser spaces (deployed; live acceptance pending)

The backend is deployed as of 2026-10-04, release `20261004T103955Z-f658b26`, including installation-scoped tracked GET/PUT and owner-only browser spaces. The desktop adaptation is implemented locally, not yet committed, pushed or released. The client contract matches the backend documentation. Client validation remains mock-based; live end-to-end acceptance is pending, including production email verification, authenticated product upload, browser owner/admin inspection, and logout.

After successful code verification or startup account validation, and after local additions/removals, the desktop sends a full atomic snapshot to `PUT /api/v1/tracked-items`. The body is only `{items:[{clientId,name,category,source,addedAt}]}`; account and installation ownership come solely from the bearer session. Each desktop installation has a separate list. An empty snapshot intentionally clears only that installation's server list. No legacy tracked-item PUT/DELETE endpoint is called.

The UI discloses uploads before sign-in and in MyDeals: product names/categories/sources/added dates, never hardware. The local list remains authoritative and is never replaced by `GET /api/v1/tracked-items` data. Legacy non-UUID local item IDs are migrated once to persisted UUIDs without removing items. Invalid local fields, duplicate IDs, more than 100 items or a UTF-8 body exceeding 65536 bytes produce explicit errors without sending a partial list. Existing local plan limits remain unchanged.

Snapshots are serialized/coalesced while edits occur, so a newer list cannot be overwritten by an older in-flight snapshot. Session-context checks reject stale account results; failures keep local edits and are displayed in MyDeals, with manual retry and no automatic retry loop. Authentication is checked before every request. Deal retrieval, billing, entitlements and consultations remain gated; there is no heartbeat or online-presence inference.

**Open your space** opens only the fixed HTTPS origin `https://deals.tillgreen.eu/space/{verifiedAccountId}`, derived from a validated account ID for compatibility with older auth responses. The browser independently requires email sign-in and exact-owner authorization. No token appears in the URL or is transferred to the browser. Desktop IPC is restricted to the trusted local main frame. Admin authorization and browser space ownership are enforced by the backend, not local profile email.

Automated validation uses contract mocks and sends no live account/email/sync requests. For user-driven acceptance, verify the email code in the updated desktop, check the account/session, and confirm MyDeals reports a successful authorized installation snapshot. Add/remove a test product and confirm the corresponding snapshot, then explicitly open your space and sign in separately in the browser. Inspect the owner space and, only with the authorized administrator account, the admin view. Finally revoke the desktop session with its logout control. Report only sanitized success/failure outcomes and error codes: no codes, tokens, email addresses or product contents in chat or agent handoffs. Valid connections represent unexpired/unrevoked sessions and last authenticated activity, never online presence.