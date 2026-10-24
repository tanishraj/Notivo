# Notivo

**Important updates, delivered.**

The repository’s default development branch is `develop`.

Notivo monitors public notices and delivers email updates with links to their original documents. Its first source is the [National Medical Commission’s What’s New listing](https://nmc.org.in/whats-new).

The current implementation is a TypeScript Cloudflare Worker with Cloudflare D1 for notice tracking and Resend for email. Emails link directly to the original NMC documents. The application never downloads, copies, or serves PDFs.

## What is included

- Checks every 15 minutes through a Cloudflare Cron Trigger.
- Resumable baseline of the complete archive, without sending historical notices.
- Checks the newest three pages on subsequent runs.
- A rolling scan of older pages to find backdated additions and changes.
- Notices identified by their download ID, rather than dates, numeric ordering, or the website’s “New” badge.
- Emails for new notices and changes to titles, publication dates, or document URLs.
- A transactional outbox, separate messages per recipient, bounded retries, and Resend idempotency keys.
- A database lease to prevent overlapping scans and sends.
- Authenticated JSON status, manual run, send, and email preview endpoints.
- A public health endpoint and structured Worker logs.
- Tests running in the actual local Workers runtime with D1.

There is no dashboard in this first version. If we add one, use React and shadcnblocks as agreed.

## Architecture

```text
Cron → fetch NMC HTML → HTMLRewriter → compare with D1
                                         ↓
                            save notice/version + outbox
                                         ↓
                               Resend → original NMC link
```

Cloudflare hosts the application and all persistent application data. D1 contains notice metadata, versions, recipient delivery records, and scan progress. API keys and the admin token are Worker secrets. No R2 bucket is needed.

The only runtime dependency is `entities`, which decodes HTML punctuation in notice titles. HTTP requests use the Workers Fetch API, including Resend’s email API.

## Local setup

Use Node.js 22 or later and npm.

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`: replace `ADMIN_TOKEN` with a random value of at least 24 characters, set `EMAIL_TO`, and leave `EMAIL_ENABLED=false`. A local token can be generated with:

```sh
openssl rand -hex 32
```

Then initialize local D1:

```sh
npm run db:migrate:local
```

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

To send one real email, set `EMAIL_ENABLED=true`, then explicitly run:

```sh
npm run admin -- test-email
```

The subject starts with `[TEST]`. This command does not scan NMC or send pending notice alerts. A successful response includes Resend’s email ID and means the API accepted the request. Each invocation is a new test; if a timeout leaves the outcome unknown, check the Resend dashboard before trying again.

The shared sender `onboarding@resend.dev` can send to the address associated with your Resend account. To email other recipients, use a sender on your own verified domain. [Resend testing restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

If an admin command reports that it cannot connect when `MONITOR_URL` is set, check that server is running at the configured address. For temporary Worker startup errors, run `npm run dev` to inspect Wrangler’s startup logs. Stopping a local Worker does not delete the local D1 database or its baseline progress.

## Baseline and pagination

The first run starts baseline mode automatically. A run imports at most three pages; progress is saved in D1. The `baseline` admin command calls the Worker repeatedly until it finishes. At the inspected archive size of 51 pages, this takes 17 successful calls. Requests are sequential, with a one-second pause between listing pages.

No historical notifications are created. After completion, the next run starts monitoring and requires a valid `EMAIL_TO` setting. The baseline command stops immediately if the baseline is already complete.

Automatic cron initialization also works, but importing the archive at 15-minute intervals takes several hours. Run the baseline command for a faster initial setup. If interrupted, run it again to resume.

After baseline, every run reads the latest three pages. When an archive audit is due, it also reads up to two older pages, saving a cursor between runs. At 51 pages, that audit takes about six hours while recent pages continue to be checked. Another audit becomes due 24 hours after completion. Backdated notices can therefore have a longer detection delay than notices on recent pages.

## Cloudflare deployment

1. Sign in and create the D1 database:

   ```sh
   npx wrangler login
   npx wrangler d1 create nmc-notices
   ```

2. Replace the all-zero `database_id` in `wrangler.jsonc` with the returned ID. Keep `EMAIL_ENABLED` set to `"false"`.

3. Initialize the remote database and deploy:

   ```sh
   npm run db:migrate:remote
   npm run deploy
   ```

4. Configure Worker secrets using the interactive prompts:

   ```sh
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put EMAIL_TO
   npx wrangler secret put EMAIL_FROM
   npx wrangler secret put RESEND_API_KEY
   ```

   Use a long random admin token. `EMAIL_TO` is a comma-separated list of up to 20 addresses. `EMAIL_FROM` can be `NMC Notices <notices@your-domain.com>`; its domain must be verified in Resend. The Resend key needs permission to send email.

5. Set `MONITOR_URL` to the deployed Worker HTTPS URL and `ADMIN_TOKEN` to its token in your terminal environment. Run:

   ```sh
   npm run admin -- baseline
   npm run admin -- status
   npm run admin -- preview
   ```

6. After reviewing the preview and recipient list, change `EMAIL_ENABLED` to `"true"` in `wrangler.jsonc` and deploy again. Pending notifications accumulated after baseline will then be sent. This enables live email; the committed configuration leaves it disabled.

Cron runs every 15 minutes. The schedule is defined in UTC, although `*/15 * * * *` has the same interval in every timezone. Store dates and timestamps in UTC.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `EMAIL_ENABLED` | `false` | Only the exact string `true` permits Resend requests |
| `EMAIL_TO` | unset | Comma-separated recipients; required after baseline |
| `EMAIL_FROM` | unset | Verified Resend sender; required to send |
| `RESEND_API_KEY` | unset | Required to send; configure as a secret |
| `ADMIN_TOKEN` | unset | At least 24 characters; configure as a secret |
| `RECENT_PAGES` | `3` | Recent pages per run, maximum 3 |
| `BASELINE_PAGES_PER_RUN` | `3` | Baseline pages per run, maximum 3 |
| `AUDIT_PAGES_PER_RUN` | `2` | Older audit pages per run, maximum 2 |
| `EMAILS_PER_RUN` | `5` | Maximum sends per cycle, maximum 5 |

These limits bound requests and D1 operations per invocation. The outbox is intended for a small fixed recipient list. For large subscriber volumes, add Cloudflare Queues and a subscription management flow.

## Endpoints

All `/admin/*` routes require `Authorization: Bearer <ADMIN_TOKEN>`. Responses are not cached. Do not put tokens in URLs.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | 200 after a recent successful scan, otherwise 503 |
| GET | `/admin/status` | Baseline/audit progress, counts, last scans, and failed emails |
| GET | `/admin/preview` | HTML email preview from a real stored notice |
| GET | `/admin/preview?format=json` | Preview payload as JSON |
| GET | `/admin/test-email` | Dry-run test payload using configured sender and recipient |
| POST | `/admin/test-email` | Send one test email; requires a UUID `Idempotency-Key` header |
| POST | `/admin/run` | Baseline/monitor cycle plus enabled email sends |
| POST | `/admin/send` | Retry eligible pending email without scanning |

An overlapping mutation returns 409. A scan or sender configuration failure returns 502 and is recorded in the logs. Failed parsing never advances the scan cursor or commits a partial scan. The latest 1,000 run summaries are retained.

## Email reliability and limitations

- Notice changes and outbox records are committed together in a D1 batch transaction.
- Each recipient gets a separate message. Retries use an immutable payload and a deterministic idempotency key.
- Temporary failures remain pending with exponential backoff, up to one hour between attempts. The 15-minute cron interval determines the actual retry timing.
- Resend keeps idempotency keys for 24 hours. Automatic retries stop after 23 hours from the first attempt and mark the record `uncertain`. Inspect the Resend dashboard before manually resending; this prevents automatic duplicates after key expiry.
- Permanent provider failures become `failed`. Inspect `/admin/status` and Worker logs, fix configuration, and reconcile the record with Resend before manually changing its state. There is deliberately no blind “resend everything” endpoint.
- `accepted` means Resend accepted the request. Inbox delivery and bounce tracking would require Resend webhooks, which are not included yet.
- A changed PDF served at the same URL cannot be detected from listing metadata alone. This version does not fetch PDFs or compute document checksums.
- Entries without a document link use a derived identity based on their title and date and link to the listing. Changes to such entries appear as new notices because NMC exposes no stable ID for them.
- Malformed source dates are stored as unavailable. The parser does not guess corrected years.
- Documents remain hosted by NMC. Their availability and content can change at the source.

Use an external uptime monitor against `/health` for scan failure alerts. The detailed delivery counters and problem records are available through authenticated status and Worker logs.

## Validation

```sh
npm run typecheck
npm test
npm run build
```

Tests use local D1 and mocked outbound requests; they never send email. HTML fixtures were captured from the public first and last NMC listing pages, including real archive edge cases. `build` performs a dry run and creates `dist/` without deploying.

Development dependency overrides keep `undici` and `zod` on compatible patched releases. The lockfile records the tested versions.

## References

- [Workers HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)
- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Resend email API and idempotency keys](https://resend.com/docs/api-reference/emails/send-email)
