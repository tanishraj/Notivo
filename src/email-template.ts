import { SOURCE_URL, type Version } from './types';

// Use system fonts and inline styles for the baseline layout. Media queries
// progressively improve narrow screens; Outlook gets a fixed-width wrapper.
const colors = {
  paper: '#FFFFFF', navy: '#06285D', ink: '#0B1D38',
  muted: '#5B6A7E', line: '#DFE7EF', focus: '#8FD19A',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function readableDate(value: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function headline(version: Version): string {
  // A source title often repeats the publication date. Remove only the exact
  // matching prefix for display; preserve the original in the subject and text.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(version.published_on ?? '');
  if (!parts) return version.title;
  const prefix = new RegExp(`^${parts[3]}/${parts[2]}/${parts[1]}\\s*[-–—:]?\\s*`);
  return version.title.replace(prefix, '').trim() || version.title;
}

export function renderNoticeHtml(version: Version, options: { test?: boolean } = {}): string {
  const c = colors;
  const label = version.kind === 'updated' ? 'Updated NMC notice' : 'New NMC notice';
  const title = escapeHtml(headline(version));
  const date = escapeHtml(readableDate(version.published_on));
  const url = escapeHtml(version.document_url ?? SOURCE_URL);
  const action = version.document_url ? 'Read original NMC notice' : 'View NMC notice listing';
  const reference = /^\d+$/.test(version.notice_id) ? `Notice ${escapeHtml(version.notice_id)} &nbsp;&middot;&nbsp; ` : '';
  const summary = !version.document_url
    ? 'This entry has no linked document. You can review it in the NMC notice listing.'
    : version.kind === 'updated'
      ? 'This notice from the National Medical Commission has been updated. Review the original notice for the latest information.'
      : 'A new notice from the National Medical Commission is available for your review.';
  return `<!doctype html>
<html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(label)} | NMC Notice Updates</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    table { border-collapse:collapse; }
    a:focus-visible { outline:3px solid ${c.focus}; outline-offset:4px; }
    @media only screen and (max-width:620px) {
      .outer { padding:24px 12px !important; }
      .content { padding:28px 24px 30px !important; }
      .masthead { padding:4px 24px 22px !important; }
      .footer { padding:22px 24px !important; }
      .headline { font-size:22px !important; line-height:32px !important; }
    }
    @media only screen and (max-width:380px) {
      .content { padding:26px 20px 28px !important; }
      .masthead { padding:4px 20px 22px !important; }
      .footer { padding:22px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${c.paper};color:${c.ink};font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(`${label} from the National Medical Commission. Published ${readableDate(version.published_on)}. ${headline(version)}`)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.paper}">
    <tr><td class="outer" align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
        <tr><td class="masthead" style="padding:4px 28px 22px;border-bottom:2px solid ${c.navy};">
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:33px;color:${c.navy};">NMC Notice Updates</p>
          <p style="margin:7px 0 0;font-size:12px;line-height:19px;color:${c.muted};">National Medical Commission</p>
        </td></tr>
        ${options.test ? `<tr><td style="padding:18px 28px 0;font-size:12px;line-height:19px;color:${c.muted};"><strong>Test email</strong> &middot; A preview of your notice updates.</td></tr>` : ''}
        <tr><td class="content" style="padding:30px 28px 32px;">
          <p style="margin:0 0 22px;font-size:10px;line-height:16px;letter-spacing:1.5px;font-weight:bold;color:${c.muted};">${version.kind === 'updated' ? 'UPDATED NMC NOTICE' : 'NMC NOTICE'} &nbsp;&middot;&nbsp; ${date.toUpperCase()}</p>
          <h1 class="headline" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:27px;font-weight:normal;line-height:37px;color:${c.navy};overflow-wrap:anywhere;word-wrap:break-word;">${title}</h1>
          <p style="margin:20px 0 0;font-size:14px;line-height:24px;color:${c.muted};">${summary}</p>
          <p style="margin:26px 0 0;font-size:14px;line-height:24px;"><a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 0;color:${c.navy};font-weight:bold;text-decoration:underline;text-underline-offset:4px;">${action} &nbsp;<span aria-hidden="true">&#8594;</span></a></p>
          <p style="margin:24px 0 0;font-size:11px;line-height:19px;color:${c.muted};">${reference}Published ${date}</p>
        </td></tr>
        <tr><td class="footer" style="padding:22px 28px;border-top:1px solid ${c.line};">
          <p style="margin:0;font-size:11px;line-height:19px;color:${c.muted};">Automated notice update &nbsp;&middot;&nbsp; Source: <a href="${SOURCE_URL}" style="color:${c.muted};text-decoration:underline;">nmc.org.in</a></p>
          <p style="margin:14px 0 0;font-size:11px;line-height:19px;"><a href="${SOURCE_URL}" target="_blank" rel="noopener" style="color:${c.muted};text-decoration:underline;">All NMC notices</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}
