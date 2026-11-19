/**
 * pnr.js — PNR Generation Utility
 *
 * Generates a 10-character uppercase alphanumeric PNR for SmartRail confirmed bookings.
 *
 * Requirements:
 *   - Uses Node.js built-in crypto (crypto.randomInt) for secure random generation.
 *   - No external dependencies.
 *   - Format: 'SR' prefix (2 characters) followed by 8 uppercase alphanumeric characters.
 *   - Total length: exactly 10 characters.
 *
 * Architectural Note:
 *   Uniqueness is enforced at the database level by the UNIQUE constraint on bookings.pnr.
 *   Transaction-level SAVEPOINT retry handling is implemented in the payment service layer.
 */

'use strict';

const crypto = require('crypto');

const PNR_PREFIX = 'SR';
const PNR_SUFFIX_LENGTH = 8;
const PNR_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PNR_TOTAL_LENGTH = PNR_PREFIX.length + PNR_SUFFIX_LENGTH;

/**
 * Generates a cryptographically secure 10-character uppercase alphanumeric PNR string.
 *
 * @returns {string} 10-character PNR starting with 'SR' (e.g. 'SR8F42A1B2')
 */
function generatePnr() {
  let suffix = '';
  for (let i = 0; i < PNR_SUFFIX_LENGTH; i++) {
    const randomIndex = crypto.randomInt(0, PNR_ALPHABET.length);
    suffix += PNR_ALPHABET[randomIndex];
  }
  return `${PNR_PREFIX}${suffix}`;
}

module.exports = {
  generatePnr,
  PNR_PREFIX,
  PNR_SUFFIX_LENGTH,
  PNR_TOTAL_LENGTH,
  PNR_ALPHABET,
};
