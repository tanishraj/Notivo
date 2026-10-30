# Notivo

**Important updates, delivered.**

The repository’s default development branch is `develop`. Changes for the self-hosted installation go to `stage`: Coolify deploys every push to `stage` to [notivo.snmih.in](https://notivo.snmih.in).

Notivo monitors public notices and delivers email updates with links to their original documents. Its first source is the [National Medical Commission’s What’s New listing](https://nmc.org.in/whats-new).

The current implementation is a TypeScript Node.js server, run as one Docker container and deployed with Coolify. It stores notices in SQLite (Node's built-in `node:sqlite`) and sends email with Resend. Emails link directly to the original NMC documents. The application never downloads, copies, or serves PDFs.

## What is included

- The server wakes every minute; NMC scans follow the configured minimum interval (15 minutes by default), while due emails can send on every wake.
- Resumable baseline of the complete archive, without sending historical notices.
- Checks the newest three pages on subsequent runs.
- A rolling scan of older pages to find backdated additions and changes.
- Notices identified by their download ID. New IDs are emailed, recorded quietly or held for review using the NEW badge and published date (see [What counts as a new notice](#what-counts-as-a-new-notice)). Existing-entry metadata changes remain in history without notification emails.
- A transactional outbox, separate messages per recipient, bounded retries, and Resend idempotency keys.
- A database lease to prevent overlapping scans and sends.
- Authenticated JSON status, manual run, send, and email preview endpoints.
- A private React portal with searchable notice history, email activity, check history, previews, and scan-only manual checks.
- A public health endpoint and structured JSON logs.
- Tests against a real SQLite database, using captured NMC pages.

The portal uses the free [shadcnblocks Sidebar 1](https://www.shadcnblocks.com/block/sidebar1) foundation and editable shadcn/ui components, customized to the approved navy-and-white theme. It is served by the same server as the API.

## Architecture

```text
1-minute timer → fetch NMC HTML → HTMLRewriter → compare with SQLite
                                         ↓
                            save notice/version + outbox
                                         ↓
                               Resend → original NMC link
```

All persistent data lives in one SQLite file (`/data/notivo.db` in the container): notice metadata, versions, recipient delivery records, scan progress, admin accounts/sessions, and dashboard settings. Passwords are hashed by Better Auth. Dashboard Resend keys are encrypted with AES-GCM; the encryption key, authentication secret, and bootstrap/CLI token are environment variables.

```text
src/       the application: routes, scanning, email, auth, database access
server/    the Node.js entry point: HTTP server, portal files, migrations, timer
portal/    the React portal (built to portal/dist/)
migrations/  SQL migrations, applied automatically on start
```

HTML is parsed with `html-rewriter-wasm` (the lol-html engine) and `entities` decodes HTML punctuation in notice titles. HTTP requests, including to Resend, use the built-in `fetch`. The portal uses React, Vite, Tailwind CSS, shadcn/ui, and Lucide icons.

## Local setup

Use Node.js 24 and npm.

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`: replace `ADMIN_TOKEN` with a random value of at least 24 characters. It protects first-time account creation, CLI access, and account recovery. Initial email settings are optional here because you can configure them in the dashboard. Leave `EMAIL_ENABLED=false` until you are ready to send. Generate a local token with:

```sh
openssl rand -hex 32
```

### Open the private portal

```sh
npm run dev
```

`npm run dev` builds the portal and server, then serves them at **http://localhost:3000** with a local database in `data/notivo.db`. Database migrations apply automatically. Open the address. On your first visit, create the admin account with your name, email, a password of 12–128 characters, and the `ADMIN_TOKEN` from `.dev.vars` as a one-time setup token. Future visits use email and password. Public registration is disabled, and the database permits one admin account.

`npm run dev` automatically initializes missing local `BETTER_AUTH_SECRET` and `SETTINGS_ENCRYPTION_KEY` values in the ignored `.dev.vars` file, without printing them. Existing values are preserved. Keep this terminal running while using the portal; after changing code, stop it and run `npm run dev` again.

- **Overview:** monitor health, notice counts, queue status, recent publications, and checks.
- **Notice archive:** search by title or notice ID, filter new/updated/imported notices, and browse pages of 20.
- **Email activity:** opens on **Queue**, which contains only pending emails. Accepted and completed attempts remain in **History**. **Needs attention** contains unresolved failed/uncertain attempts. Dismiss reviewed issues and restore them from History without deleting records or sending mail. A later acceptance resolves only earlier attempts for the same notice and recipient. Accepted means accepted by Resend, not confirmed inbox delivery.
- **Retry** on an unresolved failed attempt: creates a separate audited send using the original recipient/content and current sender/API key. The previous attempt remains immutable in History. Pending copies, superseded attempts, and later accepted copies block duplicate retries. Uncertain outcomes require provider review. A temporary failure remains queued with the existing backoff rules.
- **Check history:** browse the most recent 1,000 checks.
- **Configuration:** edit recipients, sender, Resend key, email sending, automatic monitoring, minimum check interval, and per-cycle limits. Update your password here as well.
- **Account details:** the sidebar shows the signed-in admin's name, initials, and email from the authenticated session.
- **Recipient badges:** add addresses with Enter, comma, or Tab, paste an address list, and remove individual badges. Suggestions include your account and saved recipients. Addresses are validated, deduplicated, and limited to 20; Save also includes a valid address still being typed.
- **Check for notices:** scan NMC and queue changes without sending email during this action. Scheduled deployed cycles send eligible mail when enabled.
- **Email preview:** view the latest stored notice in the selected template without sending anything.
- **Email notice** (Notice archive): review a selected notice, sender, recipients, and existing delivery states before sending. Imported notices can be shared without changing their archive identity. Pending copies are preserved; accepted or uncertain copies require explicit acknowledgment. Each manual share has its own immutable snapshot and appears in Email activity.
- **Send pending emails** (Email activity): run one send cycle immediately, using the saved email limit and retry times. It does not scan NMC or retry failed/uncertain deliveries.
- **Send test email** (Configuration): send one clearly labelled `[TEST]` email to the single saved recipient. Save any changes first; email sending and a Resend key must be enabled. The action does not drain the queue. If the outcome is unknown, inspect Resend before reloading to send another test.

Better Auth manages password hashing and eight-hour database sessions. Cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS; session refresh is disabled so eight hours is the maximum lifetime. Sign out revokes the session on the server. Credentials are not stored in localStorage or sessionStorage. Browser mutations require a matching Origin. Sign-in attempts are rate-limited with counters stored in the database. Serve deployed portals over HTTPS.

Settings are saved in the database and override their environment defaults after the first save. They apply to subsequent scans/sends and do not require redeployment. Saving settings does not send email. Enabling sending allows future cycles to drain queued messages; existing queued messages retain their original recipients and immutable retry payloads. Pausing automatic monitoring pauses both scheduled checks and sends, while manual checks remain available.

The scheduler wakes every minute. NMC scans follow the configured minimum interval (15 minutes through 24 hours), measured from the last successful scan. On other wakes, due pending emails are sent without scanning. A manual scan can postpone the next automatic scan, but cannot postpone queued email processing. The per-cycle email limit still applies; additional recipients are processed on subsequent wakes, and retry backoff is respected. No due mail means no send cycle is recorded. The local development server runs the same schedule. The Resend key field is write-only: blank keeps the current key; the remove checkbox explicitly removes it, including an inherited environment key. Preserve `SETTINGS_ENCRYPTION_KEY` when restarting or redeploying. If it is lost, restore it or save a replacement Resend key with a new encryption key.

If you lose the password, the installation owner can run `npm run admin -- reset-login` with `ADMIN_TOKEN`. This explicitly deletes the admin account and revokes all its sessions; notices, settings, and email history remain. Then create a new account through the portal. Password recovery by email and multiple admin accounts are not included.

### Command-line administration

Run commands directly in the same terminal:

```sh
npm run admin -- baseline
npm run admin -- status
npm run admin -- preview
npm run admin -- run
```

The admin script reads `.dev.vars`; exported environment variables take precedence. It uses `http://localhost:3000` unless `MONITOR_URL` is set. `preview` prints the HTML and plain-text email as JSON. It does not send anything. `run` scans and also drains eligible mail if email sending has been enabled. `send` only drains the outbox.

To view the designed email in a browser instead of JSON, run:

```sh
npm run email:preview
```

Open the generated `build/email-preview.html` file in your browser. This is a local preview and does not send email. The selected **Minimal Letter (Option 2)** template uses a white background, navy text, a text-only “NMC Notice Updates” masthead, readable publication dates, and a direct link to the original NMC notice. The National Medical Commission is identified as the source; no institute logo or official emblem is used. Table-based markup, system fonts, inline baseline styles, and a narrow-screen layout support email rendering. New notices, updated notices, entries without a document, and explicitly labeled test emails share the same template.

Admin commands need the server running: start `npm run dev` in another terminal first. If it uses another port, set `MONITOR_URL` to that address.

### Send a single test email

Configure `EMAIL_TO` with one recipient, `EMAIL_FROM` with your sender, and `RESEND_API_KEY` in `.dev.vars`. Check the actual test payload without sending:

```sh
npm run admin -- test-email --dry-run
```

To send one real email, enable email sending in Configuration (or set `EMAIL_ENABLED=true` if dashboard settings have not been saved), then explicitly run:

```sh
npm run admin -- test-email
```

The subject starts with `[TEST]`. This command does not scan NMC or send pending notice alerts. A successful response includes Resend’s email ID and means the API accepted the request. Each invocation is a new test; if a timeout leaves the outcome unknown, check the Resend dashboard before trying again.

The shared sender `onboarding@resend.dev` can send to the address associated with your Resend account. To email other recipients, use a sender on your own verified domain. [Resend testing restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

If an admin command reports that it cannot connect, check that the server is running at the configured address. Stopping the server does not delete the local database or its baseline progress.

## Baseline and pagination

The first run starts baseline mode automatically. A run imports at most three pages; progress is saved in the database. The `baseline` admin command calls the server repeatedly until it finishes. At the inspected archive size of 51 pages, this takes 17 successful calls. Requests are sequential, with a one-second pause between listing pages.

No historical notifications are created. After completion, the next run starts monitoring and requires a valid `EMAIL_TO` setting. The baseline command stops immediately if the baseline is already complete.

Automatic initialization by the scheduler also works, but importing the archive at the default 15-minute scan interval takes several hours. Run the baseline command for a faster initial setup. If interrupted, run it again to resume.

After baseline, every run reads the latest three pages. When an archive audit is due, it also reads up to two older pages, saving a cursor between runs. At 51 pages, that audit takes about six hours while recent pages continue to be checked. Another audit becomes due 24 hours after completion. Backdated notices can therefore have a longer detection delay than notices on recent pages.

## Deployment (Coolify)

Production runs at [notivo.snmih.in](https://notivo.snmih.in). Coolify builds the `Dockerfile` and redeploys on every push to `stage`. The container needs about 40 MB of memory and 250 MB of disk.

| Coolify setting | Value |
| --- | --- |
| Source | this repository, branch `stage`, through a GitHub App |
| Build pack | Dockerfile |
| Port | `3000` |
| Domain | `https://notivo.snmih.in` |
| Persistent storage | a volume mounted at `/data` (the database is `/data/notivo.db`) |
| Health check | Dockerfile `HEALTHCHECK` (checks the portal responds) |
| Replicas | exactly 1: two copies would scan and email twice |

Set these environment variables in Coolify: `ADMIN_TOKEN`, `BETTER_AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY` and `PORTAL_URL`, plus optional defaults for `EMAIL_TO`, `EMAIL_FROM`, `RESEND_API_KEY` and the settings under [Configuration](#configuration). Generate each server secret with `openssl rand -hex 32`; `SETTINGS_ENCRYPTION_KEY` must be exactly 64 hex characters and `BETTER_AUTH_SECRET` at least 32. For this installation, the values are kept in the ignored `.dev.vars.production` file with owner-only permissions. Preserve `SETTINGS_ENCRYPTION_KEY`: the Resend key saved in the portal can only be decrypted with it.

Back up the `/data` volume (in Coolify: Persistent Storage → Backup), ideally to storage off the server. Point an external uptime monitor at `/health`; it reports scan failures, so it is not the container health check. Logs are under **Runtime Logs** in Coolify.

To run admin commands against production, load its credentials and set its address:

```sh
export MONITOR_URL=https://notivo.snmih.in
node --env-file=.dev.vars.production scripts/admin.mjs status
```

To run the container elsewhere: `docker build -t notivo . && docker run -p 3000:3000 -v notivo-data:/data --env-file .env notivo`.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `EMAIL_ENABLED` | `false` | Only the exact string `true` permits Resend requests |
| `EMAIL_TO` | unset | Comma-separated recipients; required after baseline |
| `EMAIL_FROM` | unset | Verified Resend sender; required to send |
| `RESEND_API_KEY` | unset | Required to send; configure as a secret |
| `ADMIN_TOKEN` | unset | At least 24 characters; first-time setup, recovery, and CLI access |
| `BETTER_AUTH_SECRET` | unset | 32+ characters; signs login cookies; generated locally by `predev` |
| `SETTINGS_ENCRYPTION_KEY` | unset | 64 hex characters; encrypts dashboard Resend keys; generated locally by `predev` |
| `MONITOR_ENABLED` | `true` | Enables scheduled scans and sends; manual scans remain available when paused |
| `CHECK_INTERVAL_MINUTES` | `15` | Minimum interval: 15, 30, 60, 120, 360, 720, or 1440 minutes |
| `RECENT_PAGES` | `3` | Recent pages per run, maximum 3 |
| `BASELINE_PAGES_PER_RUN` | `3` | Baseline pages per run, maximum 3 |
| `AUDIT_PAGES_PER_RUN` | `2` | Older audit pages per run, maximum 2 |
| `EMAILS_PER_RUN` | `5` | Maximum sends per cycle, maximum 5 |
| `NOTIFY_MAX_AGE_DAYS` | `30` | A new document ID without the NEW badge, published longer ago than this, is recorded as an archive entry with no email |
| `NEW_ENTRIES_PER_CHECK_LIMIT` | `5` | More recent new entries than this in one check are all held for review, maximum 100 |
| `PORTAL_URL` | unset | Portal address linked from admin alert emails |

### What counts as a new notice

Notivo decides each new NMC document ID from its NEW badge and its published date, measured in India time:

| New entry | What happens |
| --- | --- |
| Shows the NEW badge, or was published within `NOTIFY_MAX_AGE_DAYS` | Emailed to recipients straight away |
| No NEW badge, and a valid date older than `NOTIFY_MAX_AGE_DAYS` | Recorded in notice history as an archive entry. Never emailed |
| Anything unsure | Held on the Overview page until the admin chooses **Send** or **Dismiss** |

An entry is unsure when its published date is missing or unreadable, such as NMC's `10 Aug 0202`, when the date is in the future, when NMC marks an old-dated entry New, or when more than `NEW_ENTRIES_PER_CHECK_LIMIT` new entries that would be emailed arrive in one check, which can mean NMC renumbered its notices. Changes to a notice Notivo already tracks only update its history. Titles are never used to block an email, so a repeat upload of a recent notice can be sent twice.

Old-dated entries are not new postings. When several notices share a published date across a page boundary, NMC's listing shows one of them twice and hides another until the list shifts, and the rolling audit finds the hidden row later. NMC also re-uploads old notices under new IDs and renumbered every notice when it moved sites.

### Admin alerts

When sending is enabled, the admin account's email address gets a short message, never sent to recipients, when:

- a new entry is held for review, with a daily reminder while anything waits,
- NMC checks have failed for more than 2 hours. The Overview health banner shows the same failure and its error.

These limits bound requests and database work per cycle. The outbox is intended for a small fixed recipient list. For large subscriber volumes, add a job queue and a subscription management flow.

## Endpoints

Tracking and configuration routes require `Authorization: Bearer <ADMIN_TOKEN>` or a valid Better Auth session. Authentication info and sign-in are public; setup additionally requires the bootstrap bearer token and permits only the first account. Browser auth requests and cookie-authenticated mutations require a matching `Origin`. Responses are not cached. Do not put credentials in URLs.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | 200 after a recent successful scan, otherwise 503 |
| GET | `/` | Private portal sign-in and application shell; tracking data requires authentication |
| GET | `/admin/auth/info` | Reports whether first-time setup is complete; exposes no account details |
| POST | `/admin/auth/setup` | Create the first admin; requires bootstrap token and same Origin |
| POST | `/admin/auth/sign-in/email` | Email/password sign-in with persistent rate limiting |
| POST | `/admin/auth/sign-out` | Revoke the current session |
| GET | `/admin/auth/get-session` | Better Auth session state |
| POST | `/admin/auth/change-password` | Verify current password and update it |
| GET | `/admin/session` | Check authentication |
| DELETE | `/admin/account` | Explicit owner recovery; requires bearer token; deletes admin and sessions |
| GET | `/admin/settings` | Current settings, revision, and key readiness; never returns the API key |
| PUT | `/admin/settings` | Validated, versioned settings update; encrypts replacement API keys |
| GET | `/admin/status` | Baseline/audit progress, counts, last scans, and failed emails |
| GET | `/admin/notices` | Paginated archive; `page`, `q`, and `kind=all\|new\|updated\|baseline` |
| GET | `/admin/emails` | Paginated email history; `page`, `q`, and `status=non_cancelled\|all\|pending\|accepted\|failed\|uncertain\|cancelled`; defaults to `non_cancelled` |
| GET | `/admin/runs` | Paginated check history; `page` |
| GET | `/admin/preview` | HTML email preview from a real stored notice |
| GET | `/admin/preview?format=json` | Preview payload as JSON |
| GET | `/admin/test-email` | Dry-run test payload using configured sender and recipient |
| POST | `/admin/test-email` | Send one test email; requires a UUID `Idempotency-Key` header |
| POST | `/admin/run` | Baseline/monitor cycle plus enabled email sends |
| POST | `/admin/check` | Scan and queue changes without sending emails |
| POST | `/admin/send` | Retry eligible pending email without scanning |
| POST | `/admin/emails/:source/:id/dismiss` | Dismiss a failed/uncertain attempt without deleting history or sending |
| POST | `/admin/emails/:source/:id/restore` | Restore a dismissed review marker without sending |
| POST | `/admin/emails/:source/:id/retry` | Retry one failed attempt using a UUID `Idempotency-Key`, current sender, and original recipient |
| GET | `/admin/notices/:id/email` | Review selected notice, saved recipients, sender, and delivery history without sending |
| POST | `/admin/notices/:id/email` | Manually share the selected notice; requires a UUID `Idempotency-Key`, matching review revision/fingerprint, and acknowledgment for accepted/uncertain copies |

An overlapping mutation returns 409. A scan or sender configuration failure returns 502 and is recorded in the logs. Failed parsing never advances the scan cursor or commits a partial scan. The latest 1,000 run summaries are retained.

## Email reliability and limitations

- Notice changes and outbox records are committed together in one database transaction.
- Each recipient gets a separate message. Retries use an immutable payload and a deterministic idempotency key.
- Temporary failures remain pending with exponential backoff, up to one hour between attempts. Each one-minute scheduler wake can attempt a due retry independently of the NMC scan interval.
- Resend keeps idempotency keys for 24 hours. Automatic retries stop after 23 hours from the first attempt and mark the record `uncertain`. Inspect the Resend dashboard before manually resending; this prevents automatic duplicates after key expiry.
- Permanent provider failures become `failed`. Inspect `/admin/status` and the server logs, fix configuration, and reconcile the record with Resend before manually changing its state. There is deliberately no blind “resend everything” endpoint.
- `accepted` means Resend accepted the request. Inbox delivery and bounce tracking would require Resend webhooks, which are not included yet.
- A changed PDF served at the same URL cannot be detected from listing metadata alone. This version does not fetch PDFs or compute document checksums.
- Entries without a document link use title/date identity and link to the listing. When an unambiguous matching entry gains a download link, Notivo promotes its identity while preserving the original first-seen time and history. Distinct linked download IDs are preserved when matching is ambiguous. Changes to both title/date while no stable ID exists cannot be reliably distinguished from a new entry.
- Listing totals count NMC's rows; the dashboard separately counts deduplicated tracked identities. These numbers can differ. A new “New” badge or a change in the raw total is not enough to trigger an alert.
- Malformed source dates are stored as unavailable. The parser does not guess corrected years.
- Documents remain hosted by NMC. Their availability and content can change at the source.

Use an external uptime monitor against `/health` for scan failure alerts. The detailed delivery counters and problem records are available through authenticated status and the server logs.

## Security checks

The **Checks** GitHub workflow runs on every push and pull request to `stage`, and weekly:

- **Typecheck and test**: the full test suite.
- **CodeQL**: GitHub code scanning with the `security-extended` queries, for the TypeScript code and the workflows themselves. Findings appear under the repository's **Security → Code scanning** tab.
- **Trivy**: dependency vulnerabilities, committed secrets and Dockerfile misconfigurations in the source, then vulnerabilities and secrets in the built Docker image. HIGH or CRITICAL findings that have a fix fail the check.

Run the Trivy scans locally with Docker (no install needed):

```sh
npm run scan:trivy   # source: package-lock.json, secrets, Dockerfile
npm run scan:image   # builds the image, then scans it
```

Both use the official Trivy image pinned by digest and the settings in `trivy.yaml`. Trivy's GitHub Action and some release tags were compromised in March 2026, so the workflow runs this pinned image instead, and every action is pinned to a commit. The runtime image leaves out npm, which the server does not use, because npm's bundled packages were the only image findings.

## Validation

```sh
npm run typecheck
npm test
npm run build
```

The server applies pending migrations on start. Migrations never rewrite notice history or delivery records.

`npm test` runs against an in-memory SQLite database. Tests use mocked outbound requests; they never send email. Tests cover password setup/login, closed registration, password changes, session revocation, owner recovery, rate limiting, cross-origin protection, encrypted settings, stale-save conflicts, runtime scheduling settings, pagination, search, filters, and scan-only behavior. HTML fixtures were captured from the public first and last NMC listing pages, including real archive edge cases. A query-plan test checks that the per-scan notice lookup uses indexes rather than reading the whole table. `build` compiles the portal to `portal/dist/` and bundles the server to `build/server.mjs`.

A dependency override keeps `zod` on a compatible patched release. The lockfile records the tested versions.

## References

- [Better Auth database support](https://better-auth.com/docs/concepts/database)
- [Better Auth email and password authentication](https://better-auth.com/docs/authentication/email-password)
- [Node.js `node:sqlite`](https://nodejs.org/api/sqlite.html)
- [html-rewriter-wasm (lol-html)](https://github.com/cloudflare/html-rewriter-wasm)
- [Coolify applications](https://coolify.io/docs/applications/)
- [Resend email API and idempotency keys](https://resend.com/docs/api-reference/emails/send-email)
