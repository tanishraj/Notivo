import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

type Row = Record<string, unknown>;
interface Meta {
  changes: number;
  last_row_id: number;
  rows_read: number;
  rows_written: number;
  duration: number;
  changed_db: boolean;
  size_after: number;
  served_by: string;
}

/** Open a SQLite file with the settings D1 uses: foreign keys enforced. */
export function openDatabase(path: string) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

function toSql(value: unknown): SQLInputValue {
  if (value === null || typeof value === "number" || typeof value === "bigint" || typeof value === "string")
    return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${String(value)}'`);
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map(toSql));
  }

  /** Runs the statement now. Rows come back as plain objects, as D1 returns them. */
  execute(): { results: Row[]; meta: Meta } {
    const started = performance.now();
    const statement: StatementSync = this.db.prepare(this.sql);
    let results: Row[] = [];
    let changes: number;
    let lastRowId: number;
    if (statement.columns().length) {
      const before = this.totalChanges();
      results = statement.all(...this.params).map((row) => ({ ...row }));
      changes = this.totalChanges() - before;
      lastRowId = Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
    } else {
      const outcome = statement.run(...this.params);
      changes = Number(outcome.changes);
      lastRowId = Number(outcome.lastInsertRowid);
    }
    const meta: Meta = {
      changes,
      last_row_id: lastRowId,
      rows_read: results.length,
      rows_written: changes,
      duration: performance.now() - started,
      changed_db: changes > 0,
      size_after: 0,
      served_by: "node-sqlite",
    };
    return { results, meta };
  }

  private totalChanges() {
    return Number(this.db.prepare("SELECT total_changes() AS n").get()!.n);
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const row = this.execute().results[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column] as T;
  }

  async all<T = Row>() {
    const { results, meta } = this.execute();
    return { success: true as const, results: results as T[], meta };
  }

  async run<T = Row>() {
    return this.all<T>();
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const { results } = this.execute();
    const columns = this.db.prepare(this.sql).columns().map((c) => c.name);
    const rows = results.map((row) => columns.map((name) => row[name]));
    return (options?.columnNames ? [columns, ...rows] : rows) as T[];
  }
}

/** The subset of Cloudflare's D1Database API that Notivo and Better Auth use. */
export class NodeD1 {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
    return new Statement(this.sqlite, sql);
  }

  /** Like D1, every statement in a batch commits together or not at all. */
  async batch(statements: Statement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        const { results, meta } = statement.execute();
        return { success: true as const, results, meta };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql: string) {
    const started = performance.now();
    this.sqlite.exec(sql);
    return { count: sql.split(";").filter((s) => s.trim()).length, duration: performance.now() - started };
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("dump() is not supported");
  }

  withSession() {
    return this;
  }
}

export const asD1 = (db: DatabaseSync) => new NodeD1(db) as unknown as D1Database;
