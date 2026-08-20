import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export type Db = pg.Pool;

// Postgres identifiers cannot be parameterised, so the schema name is checked
// against the shape a schema name may have rather than escaped. A name that
// fails this is a misconfiguration, and it fails at start-up.
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function connect(url: string, schema: string): Db {
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error(`DATABASE_SCHEMA must be a lowercase identifier, got: ${schema}`);
  }
  // search_path is set as a connection parameter rather than by a per-connect
  // hook, so it is in force before the first statement on every connection the
  // pool opens -- including ones opened later to replace a dropped one. `public`
  // is deliberately not in the path: this service shares a server with chuggy,
  // and an unqualified name resolving into someone else's schema is exactly what
  // owning a schema is meant to prevent.
  return new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 10 });
}

// Migrations are numbered files applied in name order, recorded by filename. No
// down migrations: reversing a schema change in a running system is a different
// operation from un-applying it, and pretending otherwise is how the two get
// confused under pressure.
export async function migrate(db: Db, schema: string): Promise<string[]> {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`invalid schema: ${schema}`);
  // First statement of all: search_path names a schema that does not exist yet on
  // a fresh database, and an unqualified `create table` under an empty path fails
  // with "no schema has been selected to create in".
  await db.query(`create schema if not exists ${schema}`);
  await db.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const dir = join(import.meta.dirname, "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (await db.query<{ filename: string }>("select filename from schema_migrations")).rows.map((r) => r.filename),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    // One transaction per migration: a file that fails halfway leaves nothing
    // behind, so re-running it starts from the same place it did the first time.
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      ran.push(file);
    } catch (error: unknown) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  return ran;
}
