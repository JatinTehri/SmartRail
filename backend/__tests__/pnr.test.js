/**
 * pnr.test.js — Unit Tests for PNR Generation Utility
 *
 * Verifies:
 *   1. PNR length is exactly 10 characters
 *   2. PNR begins with the 'SR' prefix
 *   3. PNR contains only uppercase alphanumeric characters (0-9, A-Z)
 *   4. The suffix contains exactly 8 characters
 *   5. Successive calls produce distinct, varied values
 *   6. 1,000-generation randomness smoke test
 */

'use strict';

const {
  generatePnr,
  PNR_PREFIX,
  PNR_SUFFIX_LENGTH,
  PNR_TOTAL_LENGTH,
} = require('../src/utils/pnr');

describe('PNR Generation Utility (src/utils/pnr.js)', () => {
  // 1. Output string length
  test('1. should generate a PNR of exactly 10 characters', () => {
    const pnr = generatePnr();
    expect(typeof pnr).toBe('string');
    expect(pnr).toHaveLength(10);
    expect(pnr).toHaveLength(PNR_TOTAL_LENGTH);
  });

  // 2. Prefix validation
  test('2. should always start with the "SR" prefix', () => {
    for (let i = 0; i < 50; i++) {
      const pnr = generatePnr();
      expect(pnr.startsWith('SR')).toBe(true);
      expect(pnr.slice(0, 2)).toBe(PNR_PREFIX);
    }
  });

  // 3. Character set validation
  test('3. should contain only uppercase alphanumeric characters (0-9, A-Z)', () => {
    const alphanumericPattern = /^SR[0-9A-Z]{8}$/;
    for (let i = 0; i < 50; i++) {
      const pnr = generatePnr();
      expect(pnr).toMatch(alphanumericPattern);
    }
  });

  // 4. Suffix length validation
  test('4. should have an 8-character random suffix after the SR prefix', () => {
    const pnr = generatePnr();
    const suffix = pnr.slice(2);
    expect(suffix).toHaveLength(8);
    expect(suffix).toHaveLength(PNR_SUFFIX_LENGTH);
    expect(/^[0-9A-Z]{8}$/.test(suffix)).toBe(true);
  });

  // 5. Variation across successive calls
  test('5. should produce varied, non-identical values across successive calls', () => {
    const sample = new Set();
    for (let i = 0; i < 20; i++) {
      sample.add(generatePnr());
    }
    // All 20 calls should produce unique PNRs
    expect(sample.size).toBe(20);
  });

  // 6. 1,000-generation randomness smoke test
  test('6. 1,000 generations smoke test produces high entropy without collisions', () => {
    // Note: This is a randomness distribution smoke test. The true uniqueness guarantee
    // is enforced at the database layer by the UNIQUE constraint on bookings(pnr).
    const generated = new Set();
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      generated.add(generatePnr());
    }

    expect(generated.size).toBe(iterations);
  });
});
