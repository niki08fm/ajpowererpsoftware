'use strict';
/**
 * Emptying the transactional tables between suites.
 *
 * One list, in one place, in dependency order — a suite that keeps its
 * own copy falls behind the schema and fails on a foreign key the next
 * time a table is added.
 *
 * Masters (items, users, branches, uoms, makes) are left alone; they are
 * seeded, not written by tests.
 */
const TABLES = [
  // the store, newest first
  'dc_acknowledgement_lines', 'dc_acknowledgements',
  'dc_line_indents', 'dc_line_trs', 'delivery_challan_lines', 'delivery_challans',
  // procurement
  'stock_movements',
  'goods_receipt_lines', 'goods_receipts',
  'po_line_indents', 'purchase_order_lines', 'purchase_order_indents',
  'po_events', 'purchase_orders',
  'comparison_quotes', 'comparison_suppliers', 'comparison_items',
  'comparison_indents', 'comparisons',
  'supplier_makes', 'suppliers',
  // billing
  'bill_lines', 'bills',
  // transfer between sites, sourced by the store
  'tr_events', 'transfer_request_lines', 'transfer_requests',
  // site
  'site_expense_events', 'site_expenses',
  'stock_return_lines', 'stock_returns',
  'consumption_lines', 'consumptions',
  'indent_events', 'indent_lines', 'indents',
  // planning
  'boq_amendment_lines', 'boq_amendments',
  'boq_lines', 'boq_wo_lines', 'boqs',
  'work_order_lines', 'work_orders',
  'site_team', 'sites',
];

async function resetTransactional(pool) {
  for (const t of TABLES) await pool.query(`DELETE FROM ${t}`);
  await pool.query('DELETE FROM doc_counters');
  await pool.query(`DELETE FROM item_code_counters WHERE category_code IN ('ST','GD','SUP')`);
}

module.exports = { TABLES, resetTransactional };
