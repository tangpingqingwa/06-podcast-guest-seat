import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type AppDb = import("better-sqlite3").Database;

const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof import("better-sqlite3");

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

type MigrationRow = { id: string };
type TableInfoRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};
type IndexListRow = { name: string; unique: number };
type IndexInfoRow = { name: string; seqno: number };
type ForeignKeyRow = { table: string; from: string; to: string };
type SchemaSqlRow = { sql: string | null };

const WAFFO_STATE_MIGRATION = "003_waffo_checkout_state.sql";
const BUSINESS_PAYLOAD_MIGRATION = "004_waffo_business_payload.sql";

export function defaultDatabasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  return configured || join(process.cwd(), "data", "guest-seat.sqlite");
}

export function openDatabase(path: string = defaultDatabasePath()): AppDb {
  const databasePath = path.trim();
  if (!databasePath) throw new Error("BLOCKED-CONFIG: DATABASE_PATH");
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  if (databasePath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function tableExists(db: AppDb, name: string): boolean {
  return (
    db
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== undefined
  );
}

function tableInfo(db: AppDb, table: string): TableInfoRow[] {
  const identifier = table.replaceAll('"', '""');
  return db.prepare(`PRAGMA table_info("${identifier}")`).all() as TableInfoRow[];
}

function tableColumns(db: AppDb, table: string): Set<string> {
  return new Set(tableInfo(db, table).map((row) => row.name));
}

type ColumnFact = {
  type: string;
  notnull: number;
  defaultValue: string | null;
  pk: number;
};

const WAFFO_INTENT_FACTS: Readonly<Record<string, ColumnFact>> = {
  id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 1 },
  provider_checkout_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  provider_checkout_url: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  provider_expires_at: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  episode_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  listing_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  board_window_key: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  kind: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  name: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  site_url: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  one_liner: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  intent_fingerprint: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  normalized_payload: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  mode: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  expected_store_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  expected_product_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  expected_currency: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  tax_category: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  quote_base_cents: { type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
  target_bid_cents: { type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
  charge_cents: { type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
  amount_cents: { type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
  currency: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  expected_product_id_legacy: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  next_usd: { type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
  status: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  paid_at: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  provider_order_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  provider_payment_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  failure_code: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  created_at: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  updated_at: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
};

const WAFFO_EVENT_FACTS: Readonly<Record<string, ColumnFact>> = {
  delivery_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 1 },
  event_type: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  business_event_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  payment_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  order_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  intent_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  mode: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  store_id: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  payload_hash: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  event_fingerprint: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  outcome: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  reason: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  event_timestamp: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  received_at: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
};

const WAFFO_ATTEMPT_FACTS: Readonly<Record<string, ColumnFact>> = {
  attempt_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 1 },
  delivery_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  event_type: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  business_event_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  payment_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  order_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  intent_id: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  payload_hash: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  event_fingerprint: { type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
  outcome: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  reason: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
  received_at: { type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
};

const BUSINESS_PAYLOAD_FACTS: Readonly<Record<string, ColumnFact>> = {
  business_payload: { type: "TEXT", notnull: 1, defaultValue: "''", pk: 0 },
  business_payload_version: { type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
};

function hasColumnFacts(
  db: AppDb,
  table: string,
  facts: Readonly<Record<string, ColumnFact>>,
): boolean {
  const rows = new Map(tableInfo(db, table).map((row) => [row.name, row]));
  return Object.entries(facts).every(([name, expected]) => {
    const actual = rows.get(name);
    return actual !== undefined &&
      actual.type.trim().toUpperCase() === expected.type &&
      actual.notnull === expected.notnull &&
      actual.dflt_value === expected.defaultValue &&
      actual.pk === expected.pk;
  });
}

function indexColumns(db: AppDb, indexName: string): string[] {
  const identifier = indexName.replaceAll('"', '""');
  return (db.prepare(`PRAGMA index_info("${identifier}")`).all() as IndexInfoRow[])
    .sort((left, right) => left.seqno - right.seqno)
    .map((row) => row.name);
}

function hasIndex(
  db: AppDb,
  table: string,
  columns: readonly string[],
  unique: boolean,
): boolean {
  const identifier = table.replaceAll('"', '""');
  const indexes = db.prepare(`PRAGMA index_list("${identifier}")`).all() as IndexListRow[];
  return indexes.some((index) =>
    Number(index.unique) === (unique ? 1 : 0) &&
    JSON.stringify(indexColumns(db, index.name)) === JSON.stringify(columns),
  );
}

function hasForeignKey(db: AppDb, table: string, from: string, target: string, to: string): boolean {
  const identifier = table.replaceAll('"', '""');
  return (db.prepare(`PRAGMA foreign_key_list("${identifier}")`).all() as ForeignKeyRow[])
    .some((foreignKey) => foreignKey.from === from && foreignKey.table === target && foreignKey.to === to);
}

function tableSql(db: AppDb, table: string): string | undefined {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as SchemaSqlRow | undefined;
  return row?.sql?.toUpperCase().replace(/\s+/g, "");
}

function hasSqlFragments(db: AppDb, table: string, fragments: readonly string[]): boolean {
  const sql = tableSql(db, table);
  return sql !== undefined && fragments.every((fragment) => sql.includes(fragment.toUpperCase().replace(/\s+/g, "")));
}

function hasWaffoIntentSchema(db: AppDb): boolean {
  return tableExists(db, "checkout_intents") &&
    hasColumnFacts(db, "checkout_intents", WAFFO_INTENT_FACTS) &&
    hasIndex(db, "checkout_intents", ["provider_checkout_id"], true) &&
    hasIndex(db, "checkout_intents", ["provider_order_id"], true) &&
    hasIndex(db, "checkout_intents", ["provider_payment_id"], true) &&
    hasIndex(db, "checkout_intents", ["episode_id"], false) &&
    hasIndex(db, "checkout_intents", ["status"], false) &&
    hasIndex(db, "checkout_intents", ["intent_fingerprint"], false) &&
    hasForeignKey(db, "checkout_intents", "episode_id", "episodes", "id") &&
    hasSqlFragments(db, "checkout_intents", [
      "CHECK(KINDIN('OPEN','RAISE'))",
      "CHECK(MODEIN('FIXTURE','WAFFO-TEST','WAFFO-PROD'))",
      "CHECK(EXPECTED_CURRENCY='USD')",
      "CHECK(TAX_CATEGORY='DIGITAL_GOODS')",
      "CHECK(QUOTE_BASE_CENTS>=0)",
      "CHECK(TARGET_BID_CENTS>=500)",
      "CHECK(CHARGE_CENTS>0)",
      "CHECK(AMOUNT_CENTS>0)",
      "CHECK(NEXT_USD>=5)",
      "CHECK(STATUSIN('CREATING','OPEN','UNKNOWN','PAID','REJECTED','NEEDS_RECONCILIATION'))",
    ]);
}

function hasWaffoEventSchema(db: AppDb): boolean {
  return tableExists(db, "waffo_checkout_events") &&
    hasColumnFacts(db, "waffo_checkout_events", WAFFO_EVENT_FACTS) &&
    hasIndex(db, "waffo_checkout_events", ["event_type", "business_event_id"], true) &&
    hasIndex(db, "waffo_checkout_events", ["payment_id"], true) &&
    hasIndex(db, "waffo_checkout_events", ["order_id"], true) &&
    hasIndex(db, "waffo_checkout_events", ["intent_id"], true) &&
    hasIndex(db, "waffo_checkout_events", ["order_id"], false) &&
    hasIndex(db, "waffo_checkout_events", ["intent_id"], false) &&
    hasForeignKey(db, "waffo_checkout_events", "intent_id", "checkout_intents", "id") &&
    hasSqlFragments(db, "waffo_checkout_events", ["CHECK(OUTCOME='ACCEPTED')"]);
}

function hasWaffoAttemptSchema(db: AppDb): boolean {
  return tableExists(db, "waffo_webhook_attempts") &&
    hasColumnFacts(db, "waffo_webhook_attempts", WAFFO_ATTEMPT_FACTS) &&
    hasIndex(db, "waffo_webhook_attempts", ["delivery_id", "payload_hash"], true) &&
    hasSqlFragments(db, "waffo_webhook_attempts", ["CHECK(OUTCOMEIN('REJECTED','NEEDS_RECONCILIATION'))"]);
}

function hasBusinessPayloadSchema(db: AppDb): boolean {
  return hasWaffoEventSchema(db) &&
    hasColumnFacts(db, "waffo_checkout_events", BUSINESS_PAYLOAD_FACTS) &&
    hasSqlFragments(db, "waffo_checkout_events", ["CHECK(BUSINESS_PAYLOAD_VERSIONIN(0,1))"]);
}

function hasCompatibleBusinessPayloadColumns(db: AppDb): boolean {
  const rows = new Map(tableInfo(db, "waffo_checkout_events").map((row) => [row.name, row]));
  for (const [name, expected] of Object.entries(BUSINESS_PAYLOAD_FACTS)) {
    const actual = rows.get(name);
    if (actual && (
      actual.type.trim().toUpperCase() !== expected.type ||
      actual.notnull !== expected.notnull ||
      actual.dflt_value !== expected.defaultValue ||
      actual.pk !== expected.pk
    )) return false;
  }
  return !rows.has("business_payload_version") || hasSqlFragments(db, "waffo_checkout_events", ["CHECK(BUSINESS_PAYLOAD_VERSIONIN(0,1))"]);
}

function hasWaffoStateArtifacts(db: AppDb): boolean {
  if (tableExists(db, "checkout_intents_legacy") || tableExists(db, "waffo_checkout_events") || tableExists(db, "waffo_webhook_attempts")) return true;
  const columns = tableColumns(db, "checkout_intents");
  return [
    "board_window_key",
    "intent_fingerprint",
    "normalized_payload",
    "mode",
    "expected_store_id",
    "tax_category",
    "quote_base_cents",
    "target_bid_cents",
    "provider_payment_id",
  ].some((column) => columns.has(column));
}

/**
 * Migration 003 used its own transaction before the marker was written by the
 * migration runner. A process could therefore have committed the complete
 * schema and died before recording the marker. Recognize that finished shape
 * so an upgrade can repair only the marker instead of rerunning DDL.
 */
function hasWaffoStateSchema(db: AppDb): boolean {
  return !tableExists(db, "checkout_intents_legacy") &&
    hasWaffoIntentSchema(db) &&
    hasWaffoEventSchema(db) &&
    hasWaffoAttemptSchema(db);
}

/**
 * Migration 004 was originally two independent ALTER TABLE statements. Keep
 * upgrades idempotent for a database where the first statement committed
 * before the old process stopped; normal application still runs both ALTERs
 * inside the migration transaction below.
 */
function applyBusinessPayloadMigration(db: AppDb): void {
  if (!hasWaffoEventSchema(db) || !hasCompatibleBusinessPayloadColumns(db)) {
    throw new Error("BLOCKED-MIGRATION: incompatible Waffo business-payload schema");
  }
  const columns = tableColumns(db, "waffo_checkout_events");
  if (!columns.has("business_payload")) {
    db.exec(
      "ALTER TABLE waffo_checkout_events ADD COLUMN business_payload TEXT NOT NULL DEFAULT ''",
    );
  }
  if (!columns.has("business_payload_version")) {
    db.exec(
      "ALTER TABLE waffo_checkout_events ADD COLUMN business_payload_version INTEGER NOT NULL DEFAULT 0 CHECK (business_payload_version IN (0, 1))",
    );
  }
  if (!hasBusinessPayloadSchema(db)) {
    throw new Error("BLOCKED-MIGRATION: Waffo business-payload schema verification failed");
  }
}

function applyMigrations(db: AppDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    db
      .prepare<[], MigrationRow>("SELECT id FROM schema_migrations")
      .all()
      .map((row) => row.id),
  );
  const insert = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) {
      if (file === WAFFO_STATE_MIGRATION && !hasWaffoStateSchema(db)) {
        throw new Error("BLOCKED-MIGRATION: applied Waffo state schema is incompatible");
      }
      if (file === BUSINESS_PAYLOAD_MIGRATION && !hasBusinessPayloadSchema(db)) {
        throw new Error("BLOCKED-MIGRATION: applied Waffo business-payload schema is incompatible");
      }
      continue;
    }
    // A second process may have committed this marker after the snapshot
    // above but before this connection obtains its write lock. Re-checking
    // inside the transaction below keeps that race from replaying DDL.
    const needsForeignKeysOff = file === WAFFO_STATE_MIGRATION;
    if (needsForeignKeysOff) {
      // SQLite only changes this setting outside a transaction. Migration 003
      // rebuilds a foreign-keyed table, so the runner owns this boundary.
      db.pragma("foreign_keys = OFF");
    }
    try {
      const applyOne = db.transaction(() => {
        const marker = db
          .prepare<[string], MigrationRow>(
            "SELECT id FROM schema_migrations WHERE id = ?",
          )
          .get(file);
        if (marker) {
          return;
        }
        const stateAlreadyApplied =
          file === WAFFO_STATE_MIGRATION && hasWaffoStateSchema(db);
        if (stateAlreadyApplied) {
          // The DDL committed before its old marker write; this transaction
          // repairs the missing marker without replaying non-idempotent SQL.
        } else if (file === WAFFO_STATE_MIGRATION && hasWaffoStateArtifacts(db)) {
          throw new Error("BLOCKED-MIGRATION: incomplete or incompatible Waffo state schema");
        } else if (file === BUSINESS_PAYLOAD_MIGRATION) {
          applyBusinessPayloadMigration(db);
        } else {
          db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
        }
        insert.run(file, new Date().toISOString());
      }).immediate;
      applyOne();
    } finally {
      if (needsForeignKeysOff) {
        db.pragma("foreign_keys = ON");
      }
    }
  }
}

/**
 * Apply migrations while guaranteeing that a failed migration cannot leave
 * this connection with foreign-key enforcement disabled. Migration 003 uses
 * a connection-level PRAGMA around its table rebuild, so rollback and
 * restoration must live at the TypeScript boundary rather than only in SQL.
 */
export function migrate(db: AppDb): void {
  let migrationError: unknown;
  try {
    applyMigrations(db);
  } catch (error) {
    migrationError = error;
  }

  let restoreError: unknown;
  try {
    if (db.inTransaction) {
      db.exec("ROLLBACK");
    }
    db.pragma("foreign_keys = ON");
    const enabled = db.pragma("foreign_keys", { simple: true });
    if (Number(enabled) !== 1) {
      throw new Error("database foreign_keys could not be restored");
    }
  } catch (error) {
    restoreError = error;
  }

  if (migrationError && restoreError) {
    throw new AggregateError(
      [migrationError, restoreError],
      "database migration and foreign-key restoration failed",
    );
  }
  if (restoreError) throw restoreError;
  if (migrationError) throw migrationError;
}
