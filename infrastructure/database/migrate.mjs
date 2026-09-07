// Minimal forward-only migration runner. Applies init.sql then migrations/*.sql
// in order, recording applied files in schema_migrations. Idempotent re-runs.
//
//   DATABASE_URL=postgres://... node infrastructure/database/migrate.mjs
//
// `pg` is an OPTIONAL dependency — install it before running. Not executed in
// CI/demo (no DB); the memory store is the tested path.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  let pg;
  try { pg = await import('pg'); }
  catch { console.error("Install 'pg' first: npm i pg"); process.exit(1); }
  const { Client } = pg.default ?? pg;
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://fusion:fusion@localhost:5432/fusion' });
  await client.connect();

  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));

  const files = ['../init.sql', ...readdirSync(join(here, 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)];
  for (const rel of files) {
    const name = rel.replace('../', '').replace('migrations/', '');
    if (applied.has(name)) { console.log(`skip  ${name}`); continue; }
    const sql = readFileSync(join(here, rel), 'utf8');
    process.stdout.write(`apply ${name} ... `);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log('ok');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('FAILED:', e.message);
      process.exit(1);
    }
  }
  await client.end();
  console.log('migrations complete');
}

main().catch((e) => { console.error(e); process.exit(1); });
