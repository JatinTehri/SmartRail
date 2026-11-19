/**
 * migrate.js — SmartRail database migration runner
 *
 * PURPOSE:
 *   Applies pending SQL migration files from src/db/migrations/ to the
 *   PostgreSQL database, in filename order.  Already-applied migrations
 *   are skipped — they are tracked in a schema_migrations table.
 *
 * USAGE:
 *   node src/db/migrate.js
 *
 * RULES:
 *   - This is a standalone script, not Express middleware.
 *   - Run it manually before starting the server when new migrations exist.
 *   - It never drops tables or deletes data.
 *   - It never runs a migration file more than once.
 *   - Each migration file runs inside a transaction: if any statement in
 *     the file fails, the entire file is rolled back and nothing is recorded.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// 1. Load environment variables FIRST.
//    migrate.js lives at  backend/src/db/migrate.js
//    The .env file lives at  backend/.env
//    Going up two directories: src/db → src → backend → .env
// ---------------------------------------------------------------------------
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// ---------------------------------------------------------------------------
// 2. Import the shared connection pool.
//    This is the same pool db.js exports — one pool for the whole backend.
//    By importing AFTER dotenv.config(), DATABASE_URL is already set.
// ---------------------------------------------------------------------------
const pool = require('../config/db');

// ---------------------------------------------------------------------------
// 3. Path to the migrations folder (next to this file, in src/db/migrations/).
// ---------------------------------------------------------------------------
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ---------------------------------------------------------------------------
// Main function — async so we can use await for every database call.
// ---------------------------------------------------------------------------
async function runMigrations() {
  console.log('SmartRail — Migration Runner');
  console.log('─'.repeat(50));

  // -------------------------------------------------------------------------
  // 4. Ensure the schema_migrations tracking table exists.
  //    IF NOT EXISTS means this is completely safe to run every time.
  //    If the table already exists, PostgreSQL does nothing.
  //
  //    schema_migrations has two columns:
  //      filename   — the name of the migration file (e.g. "001_reference_tables.sql")
  //                   PRIMARY KEY ensures a file can only be recorded once.
  //      applied_at — when the migration was applied (automatic via DEFAULT NOW()).
  // -------------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // -------------------------------------------------------------------------
  // 5. Read all files from the migrations directory.
  //    Filter to only .sql files (ignore hidden files, README, etc.)
  //    Sort alphabetically — because filenames start with 001_, 002_, etc.,
  //    alphabetical order is the same as numerical order.
  // -------------------------------------------------------------------------
  const allFiles = fs.readdirSync(MIGRATIONS_DIR);

  const sqlFiles = allFiles
    .filter(f => f.endsWith('.sql'))
    .sort();                          // '001_...' < '002_...' < '003_...'

  if (sqlFiles.length === 0) {
    console.log('No migration files found in', MIGRATIONS_DIR);
    return;
  }

  // -------------------------------------------------------------------------
  // 6. Process each migration file in order.
  // -------------------------------------------------------------------------
  let applied = 0;
  let skipped = 0;

  for (const filename of sqlFiles) {
    // -----------------------------------------------------------------------
    // 6a. Check whether this file has already been applied.
    //     We query schema_migrations by filename (the PRIMARY KEY).
    //     $1 is a parameterized placeholder — pg sends the value separately
    //     from the SQL text, which prevents SQL injection.
    // -----------------------------------------------------------------------
    const check = await pool.query(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      [filename]
    );

    if (check.rows.length > 0) {
      // Already applied — skip without touching the database.
      console.log(`  [skipped]  ${filename}`);
      skipped++;
      continue;
    }

    // -----------------------------------------------------------------------
    // 6b. This file has NOT been applied yet.  Read its contents from disk.
    // -----------------------------------------------------------------------
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql      = fs.readFileSync(filePath, 'utf8');

    // -----------------------------------------------------------------------
    // 6c. Acquire a dedicated client from the pool for this migration.
    //     We need a client (not pool.query) so we can control the transaction
    //     manually: BEGIN → run SQL → record in schema_migrations → COMMIT.
    //
    //     Why a transaction?
    //     If a migration file has 3 CREATE TABLE statements and the 3rd one
    //     fails, without a transaction the first two tables would be created
    //     but not recorded in schema_migrations.  The next run would try the
    //     file again and fail on the already-created tables.
    //     A transaction means: all-or-nothing.  Either everything succeeds
    //     and gets committed, or nothing happens and the database is unchanged.
    // -----------------------------------------------------------------------
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Execute the full SQL of the migration file.
      await client.query(sql);

      // Record the migration as successfully applied.
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );

      await client.query('COMMIT');

      console.log(`  [applied]  ${filename}`);
      applied++;

    } catch (err) {
      // If anything fails, roll back the entire migration.
      // The schema_migrations table will NOT have a record for this file,
      // so the next run will try it again after you fix the problem.
      await client.query('ROLLBACK');
      console.error(`  [FAILED]   ${filename}`);
      console.error(`             ${err.message}`);

      // Release the client back to the pool, then exit with a non-zero code
      // so CI/CD pipelines and shell scripts know something went wrong.
      client.release();
      await pool.end();
      process.exit(1);

    } finally {
      // Always release the client back to the pool, even on success.
      // If we don't, the pool runs out of clients and the process hangs.
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // 7. Print a summary.
  // -------------------------------------------------------------------------
  console.log('─'.repeat(50));
  console.log(`  Applied : ${applied}`);
  console.log(`  Skipped : ${skipped}`);
  console.log(`  Total   : ${sqlFiles.length}`);
  console.log('─'.repeat(50));

  // -------------------------------------------------------------------------
  // 8. Close the pool and exit cleanly.
  //    pool.end() waits for all in-flight queries to finish, then closes
  //    every connection.  Without this, the Node.js process would hang
  //    waiting for the pool's idle connections to time out.
  // -------------------------------------------------------------------------
  await pool.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Run the main function and catch any unexpected top-level errors.
// ---------------------------------------------------------------------------
runMigrations().catch((err) => {
  console.error('[migrate] Fatal error:', err.message);
  process.exit(1);
});
