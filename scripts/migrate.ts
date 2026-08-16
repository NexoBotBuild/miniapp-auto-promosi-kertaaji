import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = String(process.env.SUPABASE_DB_URL ?? "").trim();
if (!connectionString) throw new Error("Isi SUPABASE_DB_URL dengan connection string Postgres dari Supabase terlebih dahulu.");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = await readFile(join(root, "db/migrations/001_supabase_runtime.sql"), "utf8");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(sql);
  console.log("Migrasi Supabase selesai.");
} finally {
  await client.end();
}
