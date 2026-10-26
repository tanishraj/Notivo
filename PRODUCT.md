# Notivo

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Monitor every entry on the National Medical Commission's What's New page. Import existing entries as a silent starting baseline, then email genuinely new entries with links to their original documents. Existing-entry changes remain in history without new-notice emails. Publication date is informational, not an eligibility cutoff.

## Operating Context

A Cloudflare Worker wakes every minute after deployment. NMC scans follow the dashboard minimum interval (15 minutes by default); due queued email is processed independently on scheduler wakes. D1 holds notice metadata and email history. Resend sends emails. Local development uses Wrangler and local D1.

## Capabilities and Constraints

The portal reads the existing archive, email queue, and run history. Administrators can edit recipients, sender, encrypted Resend key, sending/monitoring toggles, minimum check interval, and per-cycle limits. D1 settings override environment defaults for subsequent runs. A manual portal check scans and queues notices without sending mail. Email activity defaults to a pending-only Queue, with separate Needs attention and retained History views. Dismiss/restore clears reviewed issues without deleting delivery history. A later acceptance resolves older failures for the same notice and recipient. Retry creates a fresh audited attempt using current sender credentials and the original recipient/content, preventing duplicate pending or accepted copies. Email activity also offers a bounded manual send of due pending alerts. The archive can share a selected notice after reviewing its sender, recipients, and existing delivery outcomes. Manual shares retain separate immutable snapshots and audit records, without creating notice versions or changing baseline classification. Pending copies are not duplicated; accepted or uncertain deliveries require explicit acknowledgment. Configuration offers a single-recipient test email using saved settings; failed or ambiguous test outcomes require provider review before another attempt. Documents stay on NMC's website. Accepted means Resend accepted the email, not verified inbox delivery. Baseline imports do not trigger emails. Grouped email sending is not implemented.

## Brand Commitments

Notivo is the project name. Use shadcnblocks for page design and the navy-and-white theme previously selected from snmih.in. NMC is the source; do not use the SNMIH logo or imply this is an official NMC service.

## Access

The user confirmed a private admin dashboard and requested a conventional login. Better Auth manages email/password login and eight-hour HttpOnly database sessions. The first admin is created once using the installation's admin token; public registration is closed. The token remains for CLI access and explicit owner recovery. Multi-user accounts and a public notice portal are outside this version.
