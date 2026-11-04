import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type Row = Record<string, unknown>;
interface Meta {
  changes: number;
  last_row_id: number;
  duration: number;
}

/** Open the SQLite file with foreign keys enforced. */
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
  throw new TypeError(`Type '${typeof value}' cannot be stored (value '${String(value)}')`);
}

export class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map(toSql));
  }

  /** Runs the statement now. Rows come back as plain objects. */
  execute(): { results: Row[]; meta: Meta } {
    const started = performance.now();
    const statement = this.db.prepare(this.sql);
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
    return { results, meta: { changes, last_row_id: lastRowId, duration: performance.now() - started } };
  }

  private totalChanges() {
    return Number(this.db.prepare("SELECT total_changes() AS n").get()!.n);
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const row = this.execute().results[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`Column not found (${column})`);
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

/** Async prepare/bind/batch access to SQLite. Notivo was first written for
 * Cloudflare D1 and keeps its API shape, which Better Auth also recognises
 * (it detects prepare, batch and exec) and uses for its tables. */
export class Database {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
    return new Statement(this.sqlite, sql);
  }

  /** Every statement in a batch commits together or not at all. */
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
}
