# Grouped email example

This concept shows three NMC notices in a single email using the selected Minimal Letter style. Each notice keeps its full title, publication date, record ID, and original NMC document link. The source header and footer appear once for the entire email.

Run the generation command below, then open `preview.html` in a browser. `preview.json` includes the example subject and plain-text alternative. These generated files and screenshots are kept out of Git.

Regenerate with `npm run email:preview:grouped`.

The notices come from the existing NMC HTML fixture. They illustrate notices found together; this is not a live scan. This preview makes no network requests, sends no email, and does not change the active per-notice notification queue.
