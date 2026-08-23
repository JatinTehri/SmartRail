/**
 * Centralized error-handling middleware.
 *
 * Catches all errors forwarded by next(err) and returns a
 * consistent JSON response matching docs/API.md:
 *
 *   { error: { code: "...", message: "..." } }
 *
 * - Operational errors (AppError) expose their message to clients.
 * - Unexpected errors return a generic message to avoid leaking internals.
 * - Stack traces are logged only in development.
 */
const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.isOperational
    ? err.message
    : 'An unexpected error occurred';

  if (process.env.NODE_ENV === 'development') {
    console.error('[Error]', err);
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
    },
  });
};

module.exports = errorHandler;
