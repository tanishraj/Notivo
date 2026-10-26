---
name: Notivo
description: A private operating desk for NMC notices and monitor activity.
colors:
  primary: "#06285d"
  foreground: "#0b1d38"
  background: "#f7f9fc"
  surface: "#ffffff"
  secondary: "#eef3f8"
  accent: "#eaf0f7"
  sidebar-accent: "#eaf0f8"
  muted: "#f2f5f9"
  muted-foreground: "#5b6a7e"
  metadata: "#657388"
  border: "#dfe7ef"
  divider: "#e7edf4"
  input: "#d7e0eb"
  ring: "#4878aa"
  brand-green: "#5b9565"
  brand-signal: "#8fd19a"
  success-bg: "#e4f1e8"
  success-text: "#376747"
  info-bg: "#eaf0fa"
  info-text: "#254e82"
  warning-bg: "#f7edd4"
  warning-text: "#79571a"
  error-bg: "#fce9e7"
  error-text: "#a1362c"
  destructive: "#b42318"
  healthy-bg: "#f0f7f2"
  healthy-border: "#d7e7db"
  healthy-text: "#526d59"
  warning-banner: "#fffdf6"
  warning-border: "#e5decb"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.75px"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "-0.2px"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 400
  metric:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "32px"
    fontWeight: 550
    lineHeight: 1
    letterSpacing: "-1px"
  source-title:
    fontFamily: "Georgia, serif"
    fontSize: "23px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "-0.4px"
rounded:
  badge: "4px"
  sm: "5px"
  md: "7px"
  lg: "10px"
  panel: "12px"
  xl: "14px"
  popover: "8px"
spacing:
  sm: "8px"
  control: "12px"
  md: "16px"
  inset: "20px"
  panel: "22px"
  lg: "24px"
  page: "35px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "35px"
    padding: "0 12px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "35px"
    padding: "0 12px"
  button-ghost:
    rounded: "{rounded.md}"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "4px 12px"
  input-form:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "39px"
  recipient-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "7px 9px"
  recipient-chip:
    backgroundColor: "{colors.secondary}"
    rounded: "6px"
    padding: "2px 3px 2px 5px"
  select-settings:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "39px"
    padding: "0 12px"
  checkbox-checked:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.badge}"
    size: "14px"
  login-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    width: "100%"
    padding: "42px"
  nav-active:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "10px 12px"
  badge-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-text}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  source-panel:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "24px"
---
# Design System: Notivo

## Overview

**Creative North Star: "The Operating Desk"**

An operating desk for public notices: calm, compact, and explicit about the monitor’s actual state. Navy carries brand, navigation, and the main action; white and pale blue separate the working surfaces. Restrained green marks source continuity and healthy outcomes.

The user-pinned navy-and-white theme and shadcnblocks sidebar foundation define the visual world. System sans-serif typography handles operational content; Georgia lends the source identity and sign-in heading a modest institutional character. Notivo owns the identity: NMC is identified as the source, without institute or official NMC logos.

**Key Characteristics:**
- Compact operational hierarchy with readable notice titles.
- Flat white panels on a pale blue workspace.
- Navy actions, restrained semantic status color, and thin dividers.
- A persistent desktop sidebar that becomes a mobile sheet.

## Colors

A deep navy anchor sits among cool, quiet working surfaces; green, blue, amber, and red communicate state.

### Primary
- **Notivo Navy** (`primary`): the primary action, wordmark, active navigation text, and source panel.
- **Signal Green** (`brand-green`, `brand-signal`): the wordmark punctuation and small identity signal.

### Neutral
- **Ink** (`foreground`): headings and principal content.
- **Workspace Mist** (`background`): the page canvas; **White** (`surface`) is reserved for sidebar, topbar, and panels.
- **Cool Wash** (`secondary`, `accent`, `sidebar-accent`, `muted`): quiet controls and interaction states.
- **Slate** (`muted-foreground`, `metadata`): supporting copy, dates, breadcrumbs, and provenance.
- **Hairline** (`border`, `divider`, `input`): panel boundaries, row separators, and field strokes. **Focus Blue** (`ring`) identifies keyboard focus.

### Semantic states
- **Healthy** (`success-bg`, `success-text`; banner uses `healthy-bg`, `healthy-border`, `healthy-text`): confirmed healthy or successful states.
- **Informational** (`info-bg`, `info-text`): source and informational labels.
- **Attention** (`warning-bg`, `warning-text`; banner uses `warning-banner`, `warning-border`): incomplete initialization or pending attention.
- **Failure** (`error-bg`, `error-text`, `destructive`): failure and invalid input. Status names remain visible in text.

**The State Before Decoration Rule.** Semantic colors explain actual state; they are not a second brand palette.

## Typography

**Body and interface font:** the native system sans-serif stack in the frontmatter. The root size is (14px); most working copy is smaller and intentionally compact.

**Source accent font:** Georgia with a serif fallback. It appears in the NMC monogram, source panel title, configuration explanation heading, and sign-in heading.

### Hierarchy
- **Headline:** page headings use the headline token; mobile uses (27px).
- **Title:** panel titles use the title token. Notice titles are (13px, weight 500, line-height 1.65), or (12px) in compact and mobile rows.
- **Body:** page descriptions use the body token. Supporting copy commonly uses (10–11px) with generous line-height.
- **Label:** action labels, metadata, and navigation are compact; sidebar navigation is (12px), badges (9px, weight 600).
- **Metric:** large values use the metric token with tabular numerals; responsive values are (29–30px).
- **Source title:** use the source-title token. The sign-in serif headline is (31px), reducing to (29px) on mobile.

## Layout

The desktop shell has a white left sidebar (16rem; 224px at the root size), white topbar (66px), and a centered main region capped at (1600px). Main padding is (37px 35px 0); at viewport widths from (1600px), it becomes (45px 50px 0).

The overview combines a fluid notice column and a (260px) source/check column with a (24px) gap. At (1200px) and below the aside narrows to (230px), the gap becomes (18px), and the heading/actions stack. At (1000px) and below, the overview becomes one column, the aside temporarily uses two columns, metrics change from four columns to two.

Below (768px), navigation opens in an (18rem) sheet. The topbar becomes (57px), main padding becomes (27px 22px 0), and the aside becomes one column. Notice dates move below titles; notices retain a document icon and outgoing-link action. Controls wrap, table regions scroll horizontally, and footer copy stacks. The body supports widths from (320px).

Panels use roughly (20–24px) inner spacing, reducing to (17–19px) in mobile lists. Dividers maintain row rhythm without wrapping each item in another card.

Editable settings use a fluid form column and a (250px) explanation column with a (32px) gap. At (1100px) and below these stack; advanced limits and paired new-password fields stay in two columns until mobile. Settings fieldsets use (24px) padding and gaps, becoming (20px 17px) padding and (22px) gaps below (768px). The save status wraps above two equally growing actions on mobile.

Private access uses a centered, single-column panel capped at (460px), with (42px) inner padding. On mobile the page starts from the top, the panel uses (30px 24px) padding, and form fields remain full width. First-admin setup extends the same panel vertically rather than changing the visual identity.

## Elevation & Depth

The workspace is flat at rest. White surfaces, navy source identity, thin cool borders, and pale state fills create depth. Outline buttons and inputs use the primitive’s subtle extra-small shadow. The document preview is the deliberately lifted surface, above a translucent ink overlay. Select menus use modest elevation to separate a temporary choice list from the form.

### Shadow Vocabulary
- **Control:** (0 1px 2px 0 rgb(0 0 0 / 5%)); outline buttons and inputs.
- **Select menu:** (0 8px 24px rgb(11 29 56 / 12%)); portaled choice list.
- **Document preview:** (0 18px 70px rgb(11 29 56 / 20%)); preview dialog only.

**The Flat Workspace Rule.** Separate ordinary content with tone, spacing, and borders; reserve pronounced elevation for overlays.

## Shapes

Controls use the medium corner token; badges are compact rounded rectangles. Content panels and source panels share the panel radius, health banners use the large radius, and the sign-in panel uses the extra-large radius. Borders are thin (1px). Source/run dots and the owner avatar are circular. Line icons remain small and restrained; the custom Notivo mark is the identity asset.

## Components

### Buttons

Compact, precise controls with icon support. The page’s primary action is navy on white type; outline controls use the workspace fill and cool stroke, and ghost controls reveal a pale accent on hover. Page actions are (35px) high with (12px) horizontal padding and (11px) type. The sign-in button is full width and (42px) high. Library size variants remain available for pagination and icon controls.

Primary hover uses navy at (90%) opacity; outline/ghost hover uses the accent wash. Buttons and fields receive the primitive’s (3px) focus ring at half-opacity Focus Blue. Disabled controls reduce opacity to (50%). The shared global focus outline is (2px), offset by (3px).

### Chips

Status badges use the badge radius and semantic pairs from Colors, (3px 7px) padding, (9px) semibold type, and capitalized text. They are status labels, not filters. The health banner’s extra badge is hidden on mobile while the status heading remains visible. Recipient chips use the separate editable treatment below.

### Cards / Containers

Panels have a white background, panel radius, thin border, clipped corners, and no ambient shadow. Headings and footers are divided from contents; rows use thin separators. The navy source panel has a Georgia title, light supporting copy, a small source badge, and a separated external link.

### Inputs / Fields

Search fields are white, cool-stroked, medium-rounded, and (36px) high. Settings inputs are (39px) high with (12px) type, increasing to (13px) on mobile; login fields are (42px) high. Visible labels sit above fields with a (9px) separation; helper copy uses (10px) type. The primitive provides focus-ring, invalid, placeholder, and disabled treatments.

**Recipients:** use official shadcn Badge chips inside a wrapping white combobox field with a (45px) minimum height, medium corners, and (7px) gaps. Chips use the recipient-chip token, (11px) regular type, a (20px) circular initials avatar, and an individually labeled (24px) remove action. Long email addresses wrap inside their chip. The inline input grows from a (170px) preferred width and retains a (120px) minimum; on mobile chips and input naturally wrap into more rows. Focus highlights the whole field with a (2px) Focus Blue outline, offset by (2px). Invalid fields use Failure, disabled fields reduce opacity to (65%), and the helper/count row stays below the field with tabular selected/max numerals.

Suggestions come only from the signed-in account and saved recipient addresses, exclude selected addresses, and filter by name or email. The white listbox overlays the following field with popover corners, cool borders, and the Select menu shadow; it scrolls beyond (240px). Options have a (43px) minimum height, circular initials or mail icons, wrapping account details, and pale accent hover/keyboard selection. Arrow keys navigate, Enter selects the active suggestion, and Escape dismisses it. Enter, comma, semicolon, or Tab commit typed addresses; bulk paste accepts comma-, semicolon-, or whitespace-separated lists. Backspace in an empty input removes the last chip. Normalize case, deduplicate, validate, and enforce the (20) recipient limit before adding. Show errors next to the field and announce additions/removals politely. Blur closes suggestions without committing or shifting the form; Save settings includes a pending typed address, so the save action remains stable.

**Select:** use the official shadcn/Radix Select, with a full-width white settings trigger matching the form-input height. Its chevron is (16px), vertically centered, and held against the right by automatic margin; the verified right inset is (13px) with (0px) vertical-center offset. The portaled menu uses the popover radius, cool stroke, and Select menu shadow; items have a (34px) minimum height, accent-filled keyboard focus, and a check for the selected choice. Archive filter triggers remain (36px) high. Preserve the component’s keyboard navigation and disabled behavior.

**Checkbox:** use the official shadcn/Radix Checkbox for removing the saved key. The rendered control is (14px) square at the app’s root size with the badge radius, a cool input border, and navy fill plus a white check when selected. Keep the label and checkbox in one flex row with the verified (9px) gap; the row has a (28px) minimum height and (4px) vertical padding. Focus uses the shared ring; disabled controls reduce opacity. This checkbox remains visually distinct from the (36px × 21px) pill switches for email sending and automatic monitoring, whose white thumb moves onto a navy track when enabled.

### Private access

Routine sign-in presents labeled email and password fields, a full-width navy “Sign in” action, the eight-hour session note, and quiet owner-recovery guidance. First-admin setup uses the same visual panel with name, email, new password, confirmation, and a separated one-time setup-token field. The setup token does not appear in routine sign-in. Password help specifies at least 12 characters.

Auth discovery has a compact loading state and a retry action on failure. Setup-readiness errors and submission failures use an icon and readable alert text. While submitting, fields and the action disable and the action reads “Please wait…” with the loading indicator. Preserve normal autocomplete and visible labels.

### Editable settings and password

Email notifications and Monitoring remain separate divided panels. Editable fields, key-configuration badge, key-removal checkbox, switches, interval Select, and collapsed “Advanced limits” disclosure communicate the available actions. The saved key is never displayed: its field is blank with keep-current guidance; unavailable encrypted storage disables that field with help. Enabling email sending reveals an amber consequence notice.

The save row distinguishes initial configuration, unsaved changes, and saved values; “Save settings” stays disabled until dirty and reads “Saving…” while busy. Form fields disable during saving. Loading can recover with “Try again”; errors use an alert, and success uses a green status with text explaining that saving sent no email. Keep these outcomes separate from the key-configuration badge.

The independent “Your password” panel contains current, new, and confirmation fields with a quiet outline action. New and confirmation fields share a desktop row and stack on mobile. Mismatch, request failure, busy, and success states stay within this form; success explains that other sessions have signed out. Settings changes and password changes retain separate feedback and busy states.

### Navigation

The shadcnblocks sidebar1 adaptation uses section labels, small line icons, and (40px) rows. Active rows use Sidebar Accent with navy text and semibold emphasis; hover retains the pale fill. The mobile sheet closes after navigation. Brand, source identity, configuration, source link, sign-out, and private-workspace identity remain distinct groups.

The footer identifies the authenticated administrator from `status.currentUser`: a (30px) circular initials avatar, (11px) semibold name, and (10px) email below. Long names and emails truncate with ellipses and preserve their full values in title attributes. Keep the avatar fixed while the text column shrinks. If account details are unavailable, use the explicit “Account” / “Account details unavailable” fallback rather than a fabricated identity. Preserve the same account group in the mobile sheet.

### Manual email actions

Archive rows include a compact outline “Email notice” action beside the original-document link. On mobile it moves below the notice metadata. The review dialog shows the selected title, saved sender, recipients, and existing delivery states before a real send. Pending copies are preserved; an already accepted or uncertain copy requires an explicit checkbox acknowledgment. Busy controls disable and prevent dismissal; completion and failures appear inside the dialog. Manual sends do not change archive classification.

Email activity places “Send pending emails” in the Email log toolbar immediately before the status filter, with the pending count and send-limit explanation under the panel title. Disable it when sending is off, no mail is pending, or a send is in progress. Report provider acceptance, failures, retries, and uncertain outcomes with text and semantic feedback. Configuration places the separate “Send test email” action below email settings, showing its saved recipient and sender. Unsaved settings, disabled sending, missing keys, or multiple recipients disable a test with a reason. Tests have their own busy/result states; ambiguous outcomes require provider review before another attempt.

### Notice rows and monitor state

Notice rows prioritize provenance, a wrapping document title, date, and the original-document action. Preserve that hierarchy across compact and mobile forms. Health banners, run icons, and queue labels carry both state text and semantic tone. Loading uses a rotating indicator (1.2s linear); sidebar width transitions use (200ms linear). Reduced-motion preference disables animation and transitions.

Operational copy distinguishes “Unique notices tracked” from the source’s “entries listed on NMC”; these are different counts. Notification copy promises new NMC announcements: baseline imports send no email and existing-entry changes remain in history. Cancelled email activity uses a neutral badge and muted reason text, preserving the visible status and explanation without the red failure treatment. “Accepted by Resend” describes provider acceptance.

## Do's and Don'ts

### Do:
- **Do** preserve the navy-and-white theme and shadcnblocks sidebar foundation.
- **Do** show semantic status with a text label as well as color.
- **Do** allow long notice titles, errors, and addresses to wrap.
- **Do** retain visible keyboard focus and reduced-motion support.
- **Do** keep Select chevrons vertically centered at the right and checkbox labels separated by the established (9px) gap.
- **Do** keep routine email/password sign-in distinct from one-time admin setup, and show form feedback next to the action it describes.
- **Do** identify Notivo as the private workspace and NMC as the document source.

### Don't:
- **Don’t** use the SNMIH logo or official NMC logos, or imply official NMC affiliation.
- **Don’t** turn status color into decorative page-wide emphasis.
- **Don’t** replace the flat panel hierarchy with pervasive shadows.
- **Don’t** truncate notice titles merely to equalize row height.
