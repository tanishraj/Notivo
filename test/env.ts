import { join } from "node:path";
import { Database, openDatabase } from "../src/db";
import type { Env } from "../src/types";

/** A fresh in-memory database per test file (Vitest isolates files). */
export const sqlite = openDatabase(":memory:");

export const env = {
  EMAIL_ENABLED: "false",
  RECENT_PAGES: "3",
  BASELINE_PAGES_PER_RUN: "3",
  AUDIT_PAGES_PER_RUN: "2",
  EMAILS_PER_RUN: "5",
  DB: new Database(sqlite),
} satisfies Env;

export const MIGRATIONS = join(import.meta.dirname, "../migrations");
