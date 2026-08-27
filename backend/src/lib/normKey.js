'use strict';
/**
 * The duplicate guard.
 *
 * Two keys, doing two different jobs.
 *
 *   normKey(s)  – order preserving. UNIQUE in the database. Catches the
 *                 same name typed differently: case, spacing, punctuation,
 *                 dotted abbreviations.
 *                     "MCB 32A" = "mcb  32 a" = "M.C.B-32A"
 *
 *   sortKey(s)  – tokens sorted. NOT unique, only indexed. Catches the
 *                 same name written in a different word order, which is
 *                 a likely duplicate but not a certain one, so it warns
 *                 rather than blocks.
 *                     "32A MCB" ~ "MCB 32A"
 *
 * Why both: the first version of this sorted the tokens and used that as
 * the unique key. Run against the real 2,600-item master it folded three
 * pairs of genuinely different items into one:
 *
 *     4MM NUMBER FURRULES -6      vs  6MM NUMBER FURRULES -4
 *     TERMINALS(XT3 250) 4POLE    vs  TERMINALS(XT4 250) 3POLE
 *     SINGLE CORE 2.5SQMM WIRE    vs  SINGLE CORE 25SQMM WIRE
 *
 * The first two are the sort losing the order the numbers appear in. The
 * third was single-character folding gluing "2" and "5" back into "25",
 * so a 2.5 sqmm cable and a 25 sqmm cable became the same item — which in
 * an electrical contracting business is not a naming problem, it is a
 * wrong-cable-on-site problem. Folding now applies to letters only.
 */

/** Split a name into normalised tokens. */
function tokens(s) {
  const raw = String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    // a digit against a letter is a boundary: "32a" -> "32 a", "4mm" -> "4 mm"
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .trim();
  if (!raw) return [];

  const out = [];
  let run = [];
  // fold runs of single LETTERS only: m.c.b -> mcb. Never digits, so
  // "2 5" stays two tokens and cannot become "25".
  const flush = () => {
    if (run.length > 1) out.push(run.join(''));
    else if (run.length) out.push(run[0]);
    run = [];
  };
  for (const w of raw.split(' ')) {
    if (w.length === 1 && w >= 'a' && w <= 'z') run.push(w);
    else { flush(); out.push(w); }
  }
  flush();
  return out;
}

/** Order-preserving key. Unique in the database. */
function normKey(s) {
  return tokens(s).join(' ');
}

/** Order-insensitive key. Indexed, not unique — used to warn. */
function sortKey(s) {
  return tokens(s).slice().sort().join(' ');
}

module.exports = { tokens, normKey, sortKey };
