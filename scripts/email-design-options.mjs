import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeHTML } from 'entities';

// Review-only email concepts. These do not change the active sending template.
// Palette sampled from https://snmih.in's snmih-blue theme on 2026-10-24.
const c = { navy: '#06285D', ink: '#0B1D38', muted: '#5B6A7E', pale: '#F2F7FB',
  blue: '#DBE8F7', green: '#8FD19A', line: '#DFE7EF', white: '#FFFFFF' };
const out = resolve('designs/email-options');
mkdirSync(out, { recursive: true });
const source = readFileSync('test/fixtures/nmc-first.html', 'utf8');
const match = source.match(/href="https:\/\/nmc.org.in\/whats-new\/download\/1877" class="wn-title-link"[^>]*>([\s\S]*?)<\/a>/);
if (!match) throw new Error('The source fixture no longer contains notice 1877');
const title = decodeHTML(match[1]).replace(/\s+/g, ' ').trim().replace(/^12\/10\/2026\s*[-–—]\s*/, '');
const safe = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const notice = { title: safe(title), date: '12 Oct 2026', id: '1877', url: 'https://nmc.org.in/whats-new/download/1877' };
const listing = 'https://nmc.org.in/whats-new';
const font = 'Arial,Helvetica,sans-serif';
const serif = "Georgia,'Times New Roman',serif";
const row = (content, style = '') => `<tr><td style="${style}">${content}</td></tr>`;
const table = (content, extra = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${extra}>${content}</table>`;
const brand = (compact = false) => `<p style="margin:0;font-family:${serif};font-size:${compact ? 24 : 26}px;line-height:1.35;color:${c.navy};">NMC Notice Updates</p><p style="margin:7px 0 0;font-size:12px;line-height:19px;color:${c.muted};">National Medical Commission</p>`;
const pill = `<span style="display:inline-block;padding:6px 9px;background:#E8EEF7;color:${c.navy};font-size:10px;font-weight:bold;line-height:14px;letter-spacing:1px;border-radius:3px;">NEW NOTICE</span>`;
const button = (full = false) => `<a href="${notice.url}" style="display:${full ? 'block' : 'inline-block'};padding:15px 18px;background:${c.navy};border:1px solid ${c.navy};border-radius:5px;font-size:13px;font-weight:bold;line-height:20px;text-align:center;color:${c.white};text-decoration:none;">View original NMC notice</a>`;
const sourceNote = `<p style="margin:14px 0 0;font-size:11px;line-height:18px;color:${c.muted};">The document opens on nmc.org.in.</p>`;
const footer = `Automated notice update &nbsp;&middot;&nbsp; Source: <a href="${listing}" style="color:${c.muted};text-decoration:underline;">nmc.org.in</a>`;

function shell(name, content, background = c.pale) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${name} — NMC notice updates</title><style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table{border-collapse:collapse}table,td{mso-table-lspace:0;mso-table-rspace:0}a:focus-visible{outline:3px solid ${c.green};outline-offset:4px}@media(max-width:620px){.outside{padding:20px 12px!important}.pad{padding:26px 24px!important}.title{font-size:24px!important;line-height:33px!important}.letter-title{font-size:22px!important;line-height:32px!important}}@media(max-width:360px){.pad{padding:24px 20px!important}.title{font-size:22px!important;line-height:31px!important}}
</style></head><body style="margin:0;padding:0;background:${background};font-family:${font};color:${c.ink};"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">New NMC notice · ${notice.date} · ${notice.title}</div>
${table(row(`<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">${content}</table><!--[if mso]></td></tr></table>`, `padding:32px 16px;`), `bgcolor="${background}" class="outside-table"`)}</body></html>`;
}

const classic = shell('01 · Classic', row(table(
  row(brand(), `padding:28px 32px;border-bottom:1px solid ${c.line};`) +
  row(table(`<tr><td>${pill}</td><td align="right" style="font-size:11px;color:${c.muted};">${notice.date}</td></tr>`) +
    `<p style="margin:26px 0 10px;font-size:11px;color:${c.muted};line-height:19px;">LATEST PUBLIC NOTICE</p>
    <h1 class="title" style="margin:0;font-family:${serif};font-size:27px;font-weight:normal;line-height:37px;color:${c.navy};">${notice.title}</h1>
    <p style="margin:18px 0 28px;font-size:12px;color:${c.muted};line-height:20px;">Notice ${notice.id}</p>
    ${button()}${sourceNote}
    <p style="margin:22px 0 0;font-size:12px;line-height:20px;"><a href="${listing}" style="color:${c.navy};text-decoration:underline;">View all NMC notices</a></p>`, `padding:30px 32px 34px;`) +
  row('Published by the National Medical Commission', `padding:18px 32px;background:${c.pale};border-top:1px solid ${c.line};font-size:11px;line-height:18px;color:${c.muted};`)
), `background:${c.white};border:1px solid ${c.line};border-top:4px solid ${c.navy};border-radius:8px;`) +
  row(footer, `padding:20px;text-align:center;font-size:11px;line-height:18px;color:${c.muted};`));

const letter = shell('02 · Minimal letter',
  row(brand(true), `padding:4px 28px 22px;border-bottom:2px solid ${c.navy};`) +
  row(`<p style="margin:0 0 22px;font-size:10px;line-height:16px;letter-spacing:1.5px;font-weight:bold;color:${c.muted};">NMC NOTICE &nbsp;&middot;&nbsp; ${notice.date.toUpperCase()}</p>
    <h1 class="letter-title" style="margin:0;font-family:${serif};font-size:27px;font-weight:normal;line-height:37px;color:${c.navy};">${notice.title}</h1>
    <p style="margin:20px 0 0;font-size:14px;line-height:24px;color:${c.muted};">A new notice from the National Medical Commission is available for your review.</p>
    <p style="margin:26px 0 0;font-size:14px;line-height:24px;"><a href="${notice.url}" style="display:inline-block;padding:9px 0;color:${c.navy};font-weight:bold;text-decoration:underline;text-underline-offset:4px;">Read original NMC notice &nbsp;&#8594;</a></p>
    <p style="margin:24px 0 0;font-size:11px;line-height:19px;color:${c.muted};">Notice ${notice.id} &nbsp;&middot;&nbsp; Published ${notice.date}</p>`, 'padding:30px 28px 32px;') +
  row(`<p style="margin:0;font-size:11px;line-height:19px;color:${c.muted};">${footer}</p><p style="margin:14px 0 0;font-size:11px;"><a href="${listing}" style="color:${c.muted};text-decoration:underline;">All NMC notices</a></p>`, `padding:22px 28px;border-top:1px solid ${c.line};`), c.white);

const compact = shell('03 · Compact bulletin', row(table(
  row(`<p style="margin:0;font-family:${serif};font-size:25px;line-height:33px;color:white;">NMC Notice Updates</p><p style="margin:7px 0 0;font-size:12px;line-height:19px;color:#D6E4F5;">National Medical Commission</p>`, `padding:25px 28px;background:${c.navy};border-bottom:3px solid ${c.blue};`) +
  row(`<p style="margin:0 0 16px;font-size:10px;line-height:16px;font-weight:bold;letter-spacing:1.1px;color:${c.navy};">NEW NOTICE</p>
    <h1 class="letter-title" style="margin:0;font-family:${font};font-size:22px;font-weight:bold;line-height:32px;color:${c.ink};">${notice.title}</h1>
    ${table(`<tr><td style="padding:22px 0 10px;width:84px;font-size:12px;color:${c.muted};">Published</td><td style="padding:22px 0 10px;font-size:12px;color:${c.ink};">${notice.date}</td></tr>
    <tr><td style="padding:10px 0;border-top:1px solid ${c.line};font-size:12px;color:${c.muted};">Source</td><td style="padding:10px 0;border-top:1px solid ${c.line};font-size:12px;line-height:19px;color:${c.ink};">National Medical Commission</td></tr>
    <tr><td style="padding:10px 0 24px;border-top:1px solid ${c.line};font-size:12px;color:${c.muted};">Notice ID</td><td style="padding:10px 0 24px;border-top:1px solid ${c.line};font-size:12px;color:${c.ink};">${notice.id}</td></tr>`)}
    ${button(true)}${sourceNote}`, 'padding:28px;') +
  row(`<a href="${listing}" style="color:${c.navy};font-size:12px;text-decoration:underline;">View all NMC notices</a>`, `padding:18px 28px;background:${c.pale};border-top:1px solid ${c.line};text-align:center;`)
), `background:white;border:1px solid ${c.line};border-radius:8px;overflow:hidden;`) +
  row(footer, `padding:20px;text-align:center;font-size:11px;line-height:19px;color:${c.muted};`));

const designs = [
  { file: '01-classic.html', title: '01 · Classic card', subtitle: 'A clean card with a clear source header and button.', html: classic },
  { file: '02-minimal-letter.html', title: '02 · Minimal letter', subtitle: 'The lightest option. Clear, quiet, and direct.', html: letter },
  { file: '03-compact-bulletin.html', title: '03 · Compact bulletin', subtitle: 'A navy masthead and structured notice details.', html: compact },
];
for (const design of designs) writeFileSync(`${out}/${design.file}`, design.html);
writeFileSync(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NMC · Email design options</title><style>
*{box-sizing:border-box}body{margin:0;background:#E8EEF7;color:${c.ink};font-family:${font}}main{max-width:1540px;margin:0 auto;padding:44px 30px}header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:36px}.eyebrow{font-size:11px;letter-spacing:1.8px;font-weight:700;color:${c.muted};margin:0 0 13px}h1{font-family:${serif};font-size:36px;line-height:1.2;font-weight:400;margin:0 0 12px}header p{font-size:14px;line-height:24px;color:${c.muted};margin:0}header a{color:${c.navy}}.swatches{display:flex;gap:7px;margin-top:8px}.swatch{width:25px;height:25px;border-radius:50%;border:1px solid #D3DDE7}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}h2{font-size:17px;margin:0 0 9px;font-weight:600}article>p{font-size:12px;line-height:20px;color:${c.muted};margin:0 0 18px}iframe{border:0;width:100%;height:770px;background:white;border-radius:8px;box-shadow:0 4px 22px #06285d0b}.open{display:inline-block;font-size:12px;color:${c.navy};margin-top:18px;text-underline-offset:4px}@media(max-width:1000px){.grid{grid-template-columns:1fr;max-width:600px;margin:0 auto}article{margin-bottom:22px}header{display:block}main{padding:28px 16px}h1{font-size:29px}}@media print{main{padding:0}.grid{gap:12px}iframe{box-shadow:none}}
</style></head><body><main><header><div><p class="eyebrow">NMC / NOTICE EMAILS</p><h1>Clear source. Simple updates.</h1><p>Text-only NMC headers, with the navy-and-white theme inspired by <a href="https://snmih.in">snmih.in</a>.<br>Each design clearly identifies the National Medical Commission as the notice source.</p></div><div class="swatches" aria-label="Email colour palette">${[c.navy,c.ink,c.blue,c.pale,c.white].map(color=>`<span class="swatch" style="background:${color}"></span>`).join('')}</div></header><section class="grid">${designs.map(design=>`<article><h2>${design.title}</h2><p>${design.subtitle}</p><iframe title="${design.title} email preview" src="${design.file}"></iframe><a class="open" href="${design.file}" target="_blank">Open full-size preview &#8599;</a></article>`).join('')}</section></main></body></html>`);
console.log(`Saved three NMC-source email concepts and comparison preview to ${out}/index.html`);
