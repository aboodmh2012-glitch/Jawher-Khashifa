// PostgreSQL/PostGIS + TimescaleDB repository seam (§D2).
//
// This is a SCAFFOLD, not a running implementation: the sync Repositories
// interface used by the MVP cannot be satisfied by SQL (which is async), so a
// DB backing evolves those interfaces to async variants — a tracked follow-up.
// What ships now is a guarded, lazy connection helper so no business service
// imports `pg` directly and the dev/test build never requires it or a database.
//
// Schema lives in infrastructure/database/init.sql; telemetry/observation/track
// history belong in TimescaleDB hypertables (see docs/DEPLOYMENT.md).

export interface PostgresOptions {
  url?: string; // postgres://user:pass@host:5432/db
}

interface PgPool { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>; end(): Promise<void> }
interface PgModule { Pool: new (cfg: { connectionString: string }) => PgPool; default?: PgModule }

/** Lazily connect a pooled Postgres client. Throws a clear error if `pg` is absent. */
export async function connectPostgres(opts: PostgresOptions = {}): Promise<PgPool> {
  let mod: PgModule;
  try {
    mod = (await import('pg' as string)) as unknown as PgModule;
  } catch {
    throw new Error("[repositories-postgres] the 'pg' package is not installed — run `npm i pg` to enable Postgres.");
  }
  const pg = (mod.default ?? mod) as PgModule;
  const url = opts.url ?? process.env.DATABASE_URL ?? 'postgres://fusion:fusion@localhost:5432/fusion';
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('SELECT 1'); // fail fast if the DB is unreachable
  return pool;
}
