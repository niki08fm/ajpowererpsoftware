/**
 * Getting a table out of the browser and into a spreadsheet.
 *
 * Everything here happens client-side against data the screen already
 * has — no endpoint, no round trip, and what downloads is exactly what
 * was on screen including whatever filter produced it.
 */
const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\n');

export function download(filename, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/* ---------------------------------------------------------------- */

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * A slip somebody can hand over.
 *
 * A CSV is for a spreadsheet; a receipt is for a person — the driver
 * wanting a signature, the storekeeper filing what came in. So this
 * renders one document as a plain printable page and opens the print
 * dialog. If the browser blocks the window it falls back to saving the
 * page, which is a worse outcome but not a lost one.
 */
export function printDoc({ title, docNo, sub, meta = [], columns = [], rows = [],
  totals = null, note = '', footer = '' }) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(docNo || title)}</title>
<style>
  @page { margin: 16mm; }
  body { font: 13px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  .sub { color: #666; font-size: 12px; margin: 0 0 16px; }
  .no { float: right; font: 600 15px/1.2 ui-monospace, Menlo, monospace; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .meta td { padding: 3px 0; vertical-align: top; font-size: 12.5px; }
  .meta td:first-child { color: #666; width: 150px; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.lines th { text-align: left; border-bottom: 1.5px solid #111; padding: 6px 8px 5px;
    font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #444; }
  table.lines td { border-bottom: 1px solid #e3e3e3; padding: 6px 8px; }
  table.lines tfoot td { border-top: 1.5px solid #111; border-bottom: 0; font-weight: 600; }
  .rt { text-align: right; }
  .mono { font-family: ui-monospace, Menlo, monospace; }
  .note { margin-top: 14px; font-size: 12.5px; color: #444; }
  .sign { margin-top: 46px; display: flex; gap: 40px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 5px; font-size: 11.5px; color: #555; }
  .foot { margin-top: 26px; font-size: 11px; color: #888; }
</style></head><body>
  ${docNo ? `<div class="no">${esc(docNo)}</div>` : ''}
  <h1>${esc(title)}</h1>
  ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
  <table class="meta"><tbody>
    ${meta.filter(Boolean).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
  </tbody></table>
  <table class="lines">
    <thead><tr>${columns.map((c) => `<th class="${c.rt ? 'rt' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v, i) =>
      `<td class="${columns[i]?.rt ? 'rt mono' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${totals ? `<tfoot><tr>${totals.map((v, i) =>
      `<td class="${columns[i]?.rt ? 'rt mono' : ''}">${esc(v)}</td>`).join('')}</tr></tfoot>` : ''}
  </table>
  ${note ? `<p class="note">${esc(note)}</p>` : ''}
  <div class="sign"><div>Received by</div><div>Issued by</div></div>
  ${footer ? `<p class="foot">${esc(footer)}</p>` : ''}
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    // popups blocked — saving it is worse than printing it, but it is
    // better than the button doing nothing
    download(`${(docNo || title).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.html`,
      html, 'text/html');
    return;
  }
  w.document.write(html);
  w.document.close();
}

/** A filename nobody has to rename: what it is, and when it was taken. */
export const stamp = (name) =>
  `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-${
    new Date().toISOString().slice(0, 10)}.csv`;

export const downloadCsv = (name, rows) => download(stamp(name), toCsv(rows));
