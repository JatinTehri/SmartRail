/**
 * db.js — PostgreSQL connection pool
 *
 * This module creates and exports a single, shared connection pool for the
 * entire backend. Every repository file imports this pool to run queries.
 *
 * NOTHING else should live here:
 *   - No SQL queries
 *   - No business logic
 *   - No route or controller code
 *   - No authentication or booking logic
 */

'use strict';

const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Create the pool
// ---------------------------------------------------------------------------
// `Pool` is imported from the `pg` package (the official PostgreSQL client for
// Node.js). A pool keeps a set of database connections open and ready so that
// every incoming request can borrow one immediately instead of paying the cost
// of opening a brand-new TCP connection each time.
//
// `connectionString` reads DATABASE_URL from the environment.
// The format is:  postgresql://user:password@host:port/database
// This value comes from the .env file at the project root, which is loaded by
// server.js via `dotenv.config()` before this module is ever required.
//
// Never hard-code credentials here.  The .env file is git-ignored.
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Maximum number of clients the pool will keep open at the same time.
  // Requests that arrive while all clients are busy will wait in a queue.
  max: 10,

  // How long (ms) a client is allowed to sit idle in the pool before being
  // closed and removed.  Frees server-side resources during quiet periods.
  idleTimeoutMillis: 30_000,

  // How long (ms) a request for a client will wait before timing out.
  // Throws an error if a connection cannot be obtained within this window,
  // which surfaces database problems early rather than hanging indefinitely.
  connectionTimeoutMillis: 2_000,
});

// ---------------------------------------------------------------------------
// Pool-level error handler
// ---------------------------------------------------------------------------
// If a client emits an error while sitting idle in the pool (e.g. PostgreSQL
// restarted and forcibly closed the connection), Node.js would otherwise crash
// with an unhandled 'error' event.  This handler logs it and keeps the
// process alive; the pool will create a replacement client automatically.
// ---------------------------------------------------------------------------

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err.message);
});

// ---------------------------------------------------------------------------
// Export the pool
// ---------------------------------------------------------------------------
// Repositories import this and call:
//   const result = await pool.query('SELECT ...', [param1, param2]);
//
// Parameterized queries ($1, $2, ...) prevent SQL injection because the
// `pg` library sends the SQL and the parameters separately to PostgreSQL —
// user-supplied values are never concatenated into the query string.
// ---------------------------------------------------------------------------

module.exports = pool;
