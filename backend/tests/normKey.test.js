'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normKey, sortKey } = require('../src/lib/normKey');

test('the same name typed differently is one item', () => {
  const k = normKey('MCB 32A');
  assert.equal(normKey('mcb  32 a'), k);
  assert.equal(normKey('M.C.B-32A'), k);
  assert.equal(normKey('  MCB   32 A  '), k);
});

test('dotted abbreviations fold', () => {
  assert.equal(normKey('cable tray perforated 300mm G.I.'),
               normKey('Cable Tray Perforated 300 MM GI'));
});

test('2.5 sqmm and 25 sqmm are NOT the same cable', () => {
  assert.notEqual(normKey('SINGLE CORE 2.5SQMM COPPER WIRE-BLACK'),
                  normKey('SINGLE CORE 25SQMM COPPER WIRE-BLACK'));
});

test('the order the numbers appear in is kept', () => {
  assert.notEqual(normKey('4MM NUMBER FURRULES -6'), normKey('6MM NUMBER FURRULES -4'));
  assert.notEqual(normKey('TERMINALS(XT3 250) 4POLE'), normKey('TERMINALS(XT4 250) 3POLE'));
});

test('a different word order is a warning, not a block', () => {
  assert.notEqual(normKey('32A MCB'), normKey('MCB 32A'));      // saves
  assert.equal(sortKey('32A MCB'), sortKey('MCB 32A'));         // but warns
});

test('the sort key still separates genuinely different items', () => {
  assert.notEqual(sortKey('1.5 SQMM WIRE RED'), sortKey('15 SQMM WIRE RED'));
});

test('empty and junk input do not explode', () => {
  assert.equal(normKey(''), '');
  assert.equal(normKey(null), '');
  assert.equal(normKey('---'), '');
});
