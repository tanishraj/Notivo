import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeHTML } from 'entities';

// Design example only. No network requests, outbox mutations, or email sending.
const directory = resolve('designs/grouped-email');
mkdirSync(directory, { recursive: true });
const source = readFileSync('test/fixtures/nmc-first.html', 'utf8');
const escape = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const ids = ['1880', '1878', '1877'];
const notices = ids.map((id) => {
  const row = source.match(new RegExp(`<tr class="wn-tr">(?:(?!<tr)[\\s\\S])*?href="https://nmc.org.in/whats-new/download/${id}"(?:(?!</tr>)[\\s\\S])*?</tr>`))?.[0];
  if (!row) throw new Error(`Notice ${id} is missing from the fixture`);
  const titleMatch = row.match(/class="wn-title-link"[^>]*>([\s\S]*?)<\/a>/);
  const title = decodeHTML(titleMatch[1]).replace(/\s+/g, ' ').trim().replace(/^\d{2}\/\d{2}\/\d{4}\s*[-–—:]?\s*/, '');
  const part = (name) => row.match(new RegExp(`class="wn-date-${name}"[^>]*>([^<]+)`))?.[1]?.trim();
  return { id, title, date: `${part('day')} ${part('mon')} ${part('yr')}`, url: `https://nmc.org.in/whats-new/download/${id}` };
});
const subject = `${notices.length} new NMC notices`;
const listing = 'https://nmc.org.in/whats-new';
const navy = '#06285D';
const muted = '#5B6A7E';
const line = '#DFE7EF';
const items = notices.map((notice, index) => `<tr><td class="item" style="padding:${index ? '26px' : '28px'} 28px 28px;${index ? `border-top:1px solid ${line};` : ''}">
  <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:${muted};">${escape(notice.date)} &nbsp;&middot;&nbsp; Notice ${notice.id}</p>
  <h2 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:normal;line-height:31px;color:${navy};overflow-wrap:anywhere;word-wrap:break-word;">${escape(notice.title)}</h2>
  <p style="margin:15px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:24px;"><a href="${notice.url}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 0;font-weight:bold;color:${navy};text-decoration:underline;text-underline-offset:4px;">Read original NMC notice &nbsp;<span aria-hidden="true">&#8594;</span></a></p>
</td></tr>`).join('\n');
const html = `<!doctype html>
<html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light">
<title>${subject} · Grouped email example</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table{border-collapse:collapse}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}a:focus-visible{outline:3px solid #8FD19A;outline-offset:4px}@media only screen and (max-width:620px){.outer{padding:24px 12px!important}.masthead{padding:4px 24px 22px!important}.intro{padding:28px 24px 24px!important}.item{padding:24px!important}.footer{padding:22px 24px!important}.summary-title{font-size:26px!important;line-height:35px!important}h2{font-size:21px!important;line-height:30px!important}}@media only screen and (max-width:380px){.masthead{padding:4px 20px 22px!important}.intro{padding:26px 20px 22px!important}.item{padding:24px 20px!important}.footer{padding:22px 20px!important}h2{font-size:20px!important;line-height:29px!important}}</style>
</head><body style="margin:0;padding:0;width:100%;background:#FFFFFF;color:#0B1D38;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${subject}. Sanitation and hygiene activities, electronic signatures, and patient safety committees.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF"><tr><td class="outer" align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
  <tr><td class="masthead" style="padding:4px 28px 22px;border-bottom:2px solid ${navy};"><p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:33px;color:${navy};">NMC Notice Updates</p><p style="margin:7px 0 0;font-size:12px;line-height:19px;color:${muted};">National Medical Commission</p></td></tr>
  <tr><td class="intro" style="padding:30px 28px 26px;border-bottom:1px solid ${line};"><p style="margin:0 0 12px;font-size:10px;font-weight:bold;line-height:16px;letter-spacing:1.5px;color:${muted};">NOTICE DIGEST</p><h1 class="summary-title" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:29px;font-weight:normal;line-height:39px;color:${navy};">${subject}</h1><p style="margin:13px 0 0;font-size:14px;line-height:24px;color:${muted};">Review the notices below. Each link opens the original NMC document.</p></td></tr>
  ${items}
  <tr><td class="footer" style="padding:22px 28px;border-top:1px solid ${line};"><p style="margin:0;font-size:11px;line-height:19px;color:${muted};">Automated notice update &nbsp;&middot;&nbsp; Source: <a href="${listing}" style="color:${muted};text-decoration:underline;">nmc.org.in</a></p><p style="margin:14px 0 0;font-size:11px;line-height:19px;"><a href="${listing}" target="_blank" rel="noopener" style="color:${muted};text-decoration:underline;">All NMC notices</a></p></td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
const text = ['NMC Notice Updates', 'National Medical Commission', '', subject, '',
  ...notices.flatMap((notice) => [notice.title, `Published: ${notice.date} | Notice ${notice.id}`, `Read original NMC notice: ${notice.url}`, '']),
  `All NMC notices: ${listing}`].join('\n');
writeFileSync(`${directory}/preview.html`, html);
writeFileSync(`${directory}/preview.json`, JSON.stringify({ subject, text, html }, null, 2) + '\n');
console.log(`Grouped example saved to ${directory}/preview.html\nSubject: ${subject}\nPreview only. No email was sent and alert delivery is unchanged.`);
