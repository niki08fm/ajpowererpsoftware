'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { parseWorkOrder } = require('../src/lib/woImport');

const UOMS = ["No's", 'Mtrs', 'Set', 'Ltr'];
const book = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'WO');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

test("a client's own sheet imports untouched", () => {
  const buf = book([
    ['AJ POWER SOLUTIONS'],
    ['Work Order Annexure - Block C'],
    ['S.No', 'Description of Work', 'UOM', 'Qty', 'Supply Rate', 'Erection Rate'],
    [1, 'XLPE Armoured Cable 3.5C x 240 sqmm', 'Mtr', 2400, '1,310.00', 120],
    [2, 'MCB 32A Double Pole C-Curve', "No's", 180, 690, 60],
    ['', 'TOTAL', '', '', '', ''],
  ]);
  const out = parseWorkOrder(buf, { uomCodes: UOMS });
  assert.equal(out.lines.length, 2, 'the TOTAL row is not a line');
  assert.equal(out.lines[0].qty, 2400);
  assert.equal(out.lines[0].supplyRate, 1310, 'thousands separators are stripped');
  assert.equal(out.lines[0].instRate, 120, '"Erection Rate" is the installation column');
  assert.equal(out.lines[1].sno, 2, 'serial numbers are ours, not theirs');
});

test('units are matched to ours where they are close', () => {
  const out = parseWorkOrder(book([
    ['Description', 'Unit', 'Qty', 'Supply rate'],
    ['Cable', 'Mtr', 10, 100],
    ['Light', 'nos', 5, 50],
  ]), { uomCodes: UOMS });
  assert.equal(out.lines[0].uom, 'Mtrs');
  assert.equal(out.lines[1].uom, "No's");
});

test('a sheet with no header we know falls back to column order', () => {
  const out = parseWorkOrder(book([
    [1, 'Cable tray 300mm GI', 'Mtrs', 500, 680, 40],
    [2, 'Earth plate 600x600', "No's", 12, 9200, 300],
  ]), { uomCodes: UOMS });
  assert.equal(out.headerRow, null);
  assert.equal(out.lines.length, 2);
  assert.equal(out.lines[1].supplyRate, 9200);
});

test('currency decoration in a rate is ignored', () => {
  const out = parseWorkOrder(book([
    ['Particulars', 'Unit', 'Quantity', 'Material Rate'],
    ['Panel', 'Set', '2', '₹ 4,20,000/-'],
  ]), { uomCodes: UOMS });
  assert.equal(out.lines[0].qty, 2);
  assert.equal(out.lines[0].supplyRate, 420000);
});

test('an empty sheet yields nothing rather than throwing', () => {
  const out = parseWorkOrder(book([[]]), { uomCodes: UOMS });
  assert.equal(out.lines.length, 0);
});
