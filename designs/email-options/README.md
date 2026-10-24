# NMC notice email concepts

Run `node scripts/email-design-options.mjs` from the project root to generate the previews. Open the resulting `index.html` to compare the three concepts, or open an individual HTML file for a responsive full-size preview. Generated HTML and screenshots are kept out of Git.

1. **Classic card**: text-only NMC masthead, serif headline, navy document button.
2. **Minimal letter**: open white layout, a thin navy rule, and one direct document link.
3. **Compact bulletin**: navy masthead, structured metadata, and a full-width document button.

Colours follow the public `snmih-blue` theme on https://snmih.in as inspected on 2026-10-24: navy `#06285D`, ink `#0B1D38`, muted `#5B6A7E`, pale blue `#F2F7FB`, border `#DFE7EF`, and green `#8FD19A`. The site uses Playfair Display, Inter, and IBM Plex Mono; these email concepts use Georgia and Arial fallbacks for broad availability.

All three use a text-only “NMC Notice Updates” header and explicitly name the National Medical Commission as the notice source. They use no SNMIH logo or NMC emblem. The footer identifies the message as an automated update and links to the original NMC listing. SNMIH provides the visual theme only. These are automated update concepts, rather than an official NMC mailing design.

These are review concepts. They do not change the active email template or send any messages. All three use the same real NMC notice from the project fixture and link to its original document.

Regenerate the HTML with `node scripts/email-design-options.mjs`. No image assets are required.
