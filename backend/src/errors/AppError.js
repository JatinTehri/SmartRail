/**
 * Custom application error class.
 *
 * Provides a structured error with HTTP status code and a
 * machine-readable error code, matching the API.md standard
 * error response format:
 *
 *   { error: { code: "...", message: "..." } }
 */
class AppError extends Error {
  /**
   * @param {string} message  - Human-readable error description
   * @param {number} statusCode - HTTP status code (e.g. 400, 404, 500)
   * @param {string} code     - Machine-readable error code (e.g. 'VALIDATION_ERROR')
   */
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
