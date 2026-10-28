# Notivo

**Important updates, delivered.**

The repository’s default development branch is `develop`.

Notivo monitors public notices and delivers email updates with links to their original documents. Its first source is the [National Medical Commission’s What’s New listing](https://nmc.org.in/whats-new).

The current implementation is a TypeScript Cloudflare Worker with Cloudflare D1 for notice tracking and Resend for email. Emails link directly to the original NMC documents. The application never downloads, copies, or serves PDFs.

## What is included

- Cloudflare wakes every minute; NMC scans follow the configured minimum interval (15 minutes by default), while due emails can send on every wake.
- Resumable baseline of the complete archive, without sending historical notices.
- Checks the newest three pages on subsequent runs.
- A rolling scan of older pages to find backdated additions and changes.
- Notices identified by their download ID, rather than dates, numeric ordering, or the website’s “New” badge.
- Emails for genuinely new entries after the starting baseline, regardless of publication date. Existing-entry metadata changes remain in history without notification emails.
- A transactional outbox, separate messages per recipient, bounded retries, and Resend idempotency keys.
- A database lease to prevent overlapping scans and sends.
- Authenticated JSON status, manual run, send, and email preview endpoints.
- A private React portal with searchable notice history, email activity, check history, previews, and scan-only manual checks.
- A public health endpoint and structured Worker logs.
- Tests running in the actual local Workers runtime with D1.

The portal uses the free [shadcnblocks Sidebar 1](https://www.shadcnblocks.com/block/sidebar1) foundation and editable shadcn/ui components, customized to the approved navy-and-white theme. It is served by the same Worker as the API.

## Architecture

```text
Cron → fetch NMC HTML → HTMLRewriter → compare with D1
                                         ↓
                            save notice/version + outbox
                                         ↓
                               Resend → original NMC link
```

Cloudflare hosts the application and all persistent application data. D1 contains notice metadata, versions, recipient delivery records, scan progress, admin accounts/sessions, and dashboard settings. Passwords are hashed by Better Auth. Dashboard Resend keys are encrypted with AES-GCM; the encryption key, authentication secret, and bootstrap/CLI token remain Worker secrets. No R2 bucket is needed.

The Worker uses `entities` to decode HTML punctuation in notice titles and the Workers Fetch API for HTTP requests, including Resend. The portal uses React, Vite, Tailwind CSS, shadcn/ui, and Lucide icons. Its compiled assets are served through Cloudflare Workers Static Assets.

## Local setup

Use Node.js 22 or later and npm.

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`: replace `ADMIN_TOKEN` with a random value of at least 24 characters. It protects first-time account creation, CLI access, and account recovery. Initial email settings are optional here because you can configure them in the dashboard. Leave `EMAIL_ENABLED=false` until you are ready to send. Generate a local token with:

```sh
openssl rand -hex 32
```

Then initialize local D1:

```sh
npm run db:migrate:local
```

### Open the private portal

```sh
npm run dev
```

Open **http://localhost:8787** (or the URL Wrangler prints). On your first visit, create the admin account with your name, email, a password of 12–128 characters, and the `ADMIN_TOKEN` from `.dev.vars` as a one-time setup token. Future visits use email and password. Public registration is disabled, and the database permits one admin account.

`npm run dev` automatically initializes missing local `BETTER_AUTH_SECRET` and `SETTINGS_ENCRYPTION_KEY` values in the ignored `.dev.vars` file, without printing them. Existing values are preserved. Wrangler builds the portal automatically and rebuilds when `portal/src` changes. Keep this terminal running while using the portal.

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

Better Auth manages password hashing and eight-hour database sessions. Cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS; session refresh is disabled so eight hours is the maximum lifetime. Sign out revokes the session on the server. Credentials are not stored in localStorage or sessionStorage. Browser mutations require a matching Origin. Sign-in attempts are rate-limited with D1 counters. Serve deployed portals over HTTPS.

Settings are saved in D1 and override their environment defaults after the first save. They apply to subsequent scans/sends and do not require redeployment. Saving settings does not send email. Enabling sending allows future cycles to drain queued messages; existing queued messages retain their original recipients and immutable retry payloads. Pausing automatic monitoring pauses both scheduled checks and sends, while manual checks remain available.

The scheduler wakes every minute. NMC scans follow the configured minimum interval (15 minutes through 24 hours), measured from the last successful scan. On other wakes, due pending emails are sent without scanning. A manual scan can postpone the next automatic scan, but cannot postpone queued email processing. The per-cycle email limit still applies; additional recipients are processed on subsequent wakes, and retry backoff is respected. No due mail means no send cycle is recorded. Local development does not automatically execute this schedule. The Resend key field is write-only: blank keeps the current key; the remove checkbox explicitly removes it, including an inherited environment key. Preserve `SETTINGS_ENCRYPTION_KEY` when restarting or redeploying. If it is lost, restore it or save a replacement Resend key with a new encryption key.

If you lose the password, the installation owner can run `npm run admin -- reset-login` with `ADMIN_TOKEN`. This explicitly deletes the admin account and revokes all its sessions; notices, settings, and email history remain. Then create a new account through the portal. Password recovery by email and multiple admin accounts are not included.

For an existing deployment, apply `npm run db:migrate:remote` before deploying this update. For local databases, `npm run db:migrate:local` adds the authentication/settings tables while preserving the archive.

### Command-line administration

Run commands directly in the same terminal:

```sh
npm run admin -- baseline
npm run admin -- status
npm run admin -- preview
npm run admin -- run
```

The admin script reads `.dev.vars`; exported environment variables take precedence. It uses `http://localhost:8787` unless `MONITOR_URL` is set. `preview` prints the HTML and plain-text email as JSON. It does not send anything. `run` scans and also drains eligible mail if email sending has been enabled. `send` only drains the outbox.

To view the designed email in a browser instead of JSON, run:

```sh
npm run email:preview
```

Open the generated `.wrangler/email-preview.html` file in your browser. This is a local preview and does not send email. The selected **Minimal Letter (Option 2)** template uses a white background, navy text, a text-only “NMC Notice Updates” masthead, readable publication dates, and a direct link to the original NMC notice. The National Medical Commission is identified as the source; no institute logo or official emblem is used. Table-based markup, system fonts, inline baseline styles, and a narrow-screen layout support email rendering. New notices, updated notices, entries without a document, and explicitly labeled test emails share the same template.

When the default local server is not running, an admin command starts a temporary local Worker, uses the existing local D1 database, and shuts the Worker down when the command finishes. No second terminal is required. It does not create cloud resources. An explicit `MONITOR_URL` disables this fallback so commands always target the server you configured.

For a long-running development server with live reload, run `npm run dev` and leave it running. Admin commands in another terminal will reuse it. Wait for `Ready on http://localhost:8787`; if Wrangler selects another port, set `MONITOR_URL` to that address.

Local development does not execute cron automatically. Use the admin commands to exercise the same cycle that the deployed scheduler runs.

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

If an admin command reports that it cannot connect when `MONITOR_URL` is set, check that server is running at the configured address. For temporary Worker startup errors, run `npm run dev` to inspect Wrangler’s startup logs. Stopping a local Worker does not delete the local D1 database or its baseline progress.

## Baseline and pagination

The first run starts baseline mode automatically. A run imports at most three pages; progress is saved in D1. The `baseline` admin command calls the Worker repeatedly until it finishes. At the inspected archive size of 51 pages, this takes 17 successful calls. Requests are sequential, with a one-second pause between listing pages.

No historical notifications are created. After completion, the next run starts monitoring and requires a valid `EMAIL_TO` setting. The baseline command stops immediately if the baseline is already complete.

Automatic cron initialization also works, but importing the archive at the default 15-minute scan interval takes several hours. Run the baseline command for a faster initial setup. If interrupted, run it again to resume.

After baseline, every run reads the latest three pages. When an archive audit is due, it also reads up to two older pages, saving a cursor between runs. At 51 pages, that audit takes about six hours while recent pages continue to be checked. Another audit becomes due 24 hours after completion. Backdated notices can therefore have a longer detection delay than notices on recent pages.

## Cloudflare deployment

Production portal: [notivo.notivo.workers.dev](https://notivo.notivo.workers.dev).

Use the named `production` environment for the hosted application. The base configuration remains for local development, so production deployment does not replace the local database binding.

Production enables `keep_vars` to preserve dashboard-managed variables across deployments. Store credentials such as `RESEND_API_KEY` as Worker secrets. Deployment does not upload local `.dev.vars` files.

1. Sign in. Create a D1 database only when setting up a new installation; this installation already has `nmc-notices`:

   ```sh
   npx wrangler login
   npx wrangler d1 create nmc-notices
   ```

2. Confirm `env.production.account_id` and `env.production.d1_databases[].database_id` in `wrangler.jsonc` point to the intended account and database. If deploying a separate installation, replace those production IDs with your own. Keep `EMAIL_ENABLED` set to `"false"` while initializing.

3. Initialize the remote database and deploy:

   ```sh
   npm run db:migrate:production
   npm run deploy:production
   ```

4. Configure Worker secrets using the interactive prompts:

   ```sh
   npx wrangler secret put ADMIN_TOKEN --env production
   npx wrangler secret put BETTER_AUTH_SECRET --env production
   npx wrangler secret put SETTINGS_ENCRYPTION_KEY --env production
   npx wrangler secret put EMAIL_TO --env production
   npx wrangler secret put EMAIL_FROM --env production
   npx wrangler secret put RESEND_API_KEY --env production
   ```

   Generate independent random values with `openssl rand -hex 32` for each of these three server secrets. Keep them private. `SETTINGS_ENCRYPTION_KEY` must contain exactly 64 hex characters; `BETTER_AUTH_SECRET` requires at least 32 characters. Local `.dev.vars` secrets are not deployed automatically.

   For this installation, production credentials are stored locally in the ignored `.dev.vars.production` file with owner-only permissions. It contains independent production server secrets and the configured email credentials. To upload that file without printing its values:

   ```sh
   npx wrangler secret bulk .dev.vars.production --env production
   ```

   Keep this file out of Git and preserve the production encryption key: stored dashboard keys require it for decryption.

   Email environment secrets are optional defaults: you can configure recipients, sender, and an encrypted Resend key through the portal instead. The sender's domain must be verified in Resend, and the key needs permission to send email.

5. Set `MONITOR_URL` to the deployed Worker HTTPS URL. Load production credentials for each admin command, so it does not accidentally target the local account:

   ```sh
   export MONITOR_URL=https://your-worker.your-subdomain.workers.dev
   node --env-file=.dev.vars.production scripts/admin.mjs baseline
   node --env-file=.dev.vars.production scripts/admin.mjs status
   node --env-file=.dev.vars.production scripts/admin.mjs preview
   ```

6. Open the deployed portal and create the production admin account using the setup token (`ADMIN_TOKEN`) from `.dev.vars.production`. The local account and local email history are not copied to production. Review Configuration and the email preview. Enable email sending and save when ready. Pending notifications accumulated after baseline will then be sent by subsequent cycles. Dashboard values override environment defaults, including the committed `EMAIL_ENABLED=false`.

Cron runs every minute (`* * * * *`), independent of the dashboard scan interval. The schedule is defined in UTC. Store dates and timestamps in UTC.

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
| `NOTIFY_MAX_AGE_DAYS` | `30` | New entries published longer ago than this are recorded as cancelled, not emailed; NMC re-lists old notices under new document IDs |

These limits bound requests and D1 operations per invocation. The outbox is intended for a small fixed recipient list. For large subscriber volumes, add Cloudflare Queues and a subscription management flow.

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

- Notice changes and outbox records are committed together in a D1 batch transaction.
- Each recipient gets a separate message. Retries use an immutable payload and a deterministic idempotency key.
- Temporary failures remain pending with exponential backoff, up to one hour between attempts. Each one-minute scheduler wake can attempt a due retry independently of the NMC scan interval.
- Resend keeps idempotency keys for 24 hours. Automatic retries stop after 23 hours from the first attempt and mark the record `uncertain`. Inspect the Resend dashboard before manually resending; this prevents automatic duplicates after key expiry.
- Permanent provider failures become `failed`. Inspect `/admin/status` and Worker logs, fix configuration, and reconcile the record with Resend before manually changing its state. There is deliberately no blind “resend everything” endpoint.
- `accepted` means Resend accepted the request. Inbox delivery and bounce tracking would require Resend webhooks, which are not included yet.
- A changed PDF served at the same URL cannot be detected from listing metadata alone. This version does not fetch PDFs or compute document checksums.
- Entries without a document link use title/date identity and link to the listing. When an unambiguous matching entry gains a download link, Notivo promotes its identity while preserving the original first-seen time and history. Distinct linked download IDs are preserved when matching is ambiguous. Changes to both title/date while no stable ID exists cannot be reliably distinguished from a new entry.
- Listing totals count NMC's rows; the dashboard separately counts deduplicated tracked identities. These numbers can differ. A new “New” badge or a change in the raw total is not enough to trigger an alert.
- Malformed source dates are stored as unavailable. The parser does not guess corrected years.
- Documents remain hosted by NMC. Their availability and content can change at the source.

Use an external uptime monitor against `/health` for scan failure alerts. The detailed delivery counters and problem records are available through authenticated status and Worker logs.

## Validation

```sh
npm run typecheck
npm test
npm run build
```

Apply all pending migrations before running this version against an existing database. Migrations 0005–0007 add manual delivery auditing, reversible dismissal markers, retry links, and activity views without rewriting notice history or automatic delivery records.

Tests use local D1 and mocked outbound requests; they never send email. Tests cover password setup/login, closed registration, password changes, session revocation, owner recovery, rate limiting, cross-origin protection, encrypted settings, stale-save conflicts, runtime scheduling settings, pagination, search, filters, and scan-only behavior. HTML fixtures were captured from the public first and last NMC listing pages, including real archive edge cases. `build` compiles the portal to `portal/dist/`, then performs a Worker dry run into `dist/` without deploying.

Development dependency overrides keep `undici` and `zod` on compatible patched releases. The lockfile records the tested versions.

## References

- [Better Auth database and native D1 support](https://better-auth.com/docs/concepts/database)
- [Better Auth email and password authentication](https://better-auth.com/docs/authentication/email-password)
- [Workers HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)
- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Resend email API and idempotency keys](https://resend.com/docs/api-reference/emails/send-email)
