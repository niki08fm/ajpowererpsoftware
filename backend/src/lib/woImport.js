'use strict';
const XLSX = require('xlsx');

/**
 * Read a client's work order out of their own spreadsheet.
 *
 * Clients send the work order as a sheet and retyping it is where the
 * mistakes come from. Headers are matched on wording rather than
 * position, so most client formats import untouched, and a sheet with
 * no header we recognise falls back to column order.
 */
const COLUMNS = [
  ['description', ['line name', 'description', 'particular', 'item', 'scope', 'work', 'nature']],
  ['uom',         ['unit', 'uom', 'u o m', 'units']],
  ['qty',         ['qty', 'quantity', 'nos', 'no.of', 'number']],
  ['supplyRate',  ['supply rate', 'supply', 'material rate', 'rate supply', 'basic rate', 'sup rate']],
  ['instRate',    ['installation', 'inst rate', 'inst.', 'erection', 'labour rate', 'labor rate', 'fixing']],
];

const TOTAL_ROW = /^(total|grand total|sub ?total|g\.?total)/i;

function toNumber(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  // clients format quantities as "1,310.00" and rates as "₹ 1,310/-"
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** @returns {{lines: Array, headerRow: number|null, sheet: string}} */
function parseWorkOrder(buffer, { uomCodes = [] } = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const grid = XLSX.utils
    .sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: '' })
    .filter((r) => r.some((c) => clean(c) !== ''));

  // find the header: the first row that matches a description column and
  // either a quantity or a rate
  let headerRow = -1;
  let map = {};
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const m = {};
    const cells = grid[r].map((c) => clean(c).toLowerCase());
    for (const [key, words] of COLUMNS) {
      cells.forEach((c, ci) => {
        if (m[key] === undefined && c && words.some((w) => c.includes(w))) m[key] = ci;
      });
    }
    if (m.description !== undefined && (m.qty !== undefined || m.supplyRate !== undefined)) {
      headerRow = r; map = m; break;
    }
  }

  // "nos", "NO'S" and "No.s" are all our "No's"; "Mtr" is our "Mtrs".
  // Compare on letters and digits only, or the apostrophe defeats it.
  const bare = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchUom = (raw) => {
    const u = clean(raw);
    if (!u) return uomCodes[0] || null;
    const b = bare(u);
    if (!b) return uomCodes[0] || null;
    const exact = uomCodes.find((c) => bare(c) === b);
    if (exact) return exact;
    const near = uomCodes.find((c) => bare(c).startsWith(b) || b.startsWith(bare(c)));
    return near || u;
  };

  const rows = [];
  if (headerRow >= 0) {
    for (let r = headerRow + 1; r < grid.length; r++) {
      const g = grid[r];
      const pick = (k) => (map[k] === undefined ? '' : g[map[k]]);
      const description = clean(pick('description'));
      if (!description || TOTAL_ROW.test(description)) continue;
      rows.push({
        description,
        uom: matchUom(pick('uom')),
        qty: toNumber(pick('qty')),
        supplyRate: toNumber(pick('supplyRate')),
        instRate: toNumber(pick('instRate')),
      });
    }
  } else {
    // no header we recognise: assume column order, skipping a leading
    // serial-number column if every row starts with one
    const off = grid.every((g) => /^\d+\.?$/.test(clean(g[0]))) ? 1 : 0;
    for (const g of grid) {
      const description = clean(g[off]);
      if (!description || /^(s\.?no|sr|description|particular)/i.test(description) || TOTAL_ROW.test(description)) continue;
      rows.push({
        description,
        uom: matchUom(g[off + 1]),
        qty: toNumber(g[off + 2]),
        supplyRate: toNumber(g[off + 3]),
        instRate: toNumber(g[off + 4]),
      });
    }
  }

  return {
    sheet: sheetName,
    headerRow: headerRow >= 0 ? headerRow + 1 : null,
    lines: rows.map((r, i) => ({ sno: i + 1, ...r })),
  };
}

module.exports = { parseWorkOrder, toNumber, COLUMNS };
