import "dotenv/config";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { loadPersistentStore, saveEncryptedSession } from "../src/database.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sessionsFile = join(root, "data/worker-sessions.json");
const workerRef = String(process.argv[2] ?? "").replace(/^@/, ""); const apiId = Number(process.env.TELEGRAM_API_ID); const apiHash = process.env.TELEGRAM_API_HASH ?? ""; const secret = process.env.WORKER_SESSION_KEY ?? "";
if (!workerRef || !Number.isInteger(apiId) || !apiHash || secret.length < 24) throw new Error("Isi TELEGRAM_API_ID, TELEGRAM_API_HASH, WORKER_SESSION_KEY, lalu beri @username worker.");
const store = await loadPersistentStore<{ workers?: { id: string; username: string }[] }>(join(root, "data/store.json"), {});
const worker = store.workers?.find((item) => item.id === workerRef || item.username.toLowerCase() === workerRef.toLowerCase());
if (!worker) throw new Error("Worker tidak ditemukan. Tambahkan dulu dari Panel Admin.");
const workerId = worker.id;
const key = createHash("sha256").update(secret).digest();
function encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join("."); }
const rl = createInterface({ input: process.stdin, output: process.stdout });
const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
try {
  await client.start({ phoneNumber: () => rl.question("Nomor Telegram (+62…): "), password: () => rl.question("Password 2FA (kosongkan bila tidak ada): "), phoneCode: () => rl.question("Kode Telegram: "), onError: (error) => console.error("Login gagal:", error.message) });
  const me = await client.getMe(); const username = "username" in me ? String(me.username ?? "") : "";
  if (!username || username.toLowerCase() !== worker.username.toLowerCase()) throw new Error(`Akun yang login (@${username || "tanpa_username"}) tidak cocok dengan worker @${worker.username}.`);
  await saveEncryptedSession("worker", sessionsFile, workerId, encrypt(client.session.save()));
  console.log(`Worker ${workerId} tersambung sebagai @${username}.`);
} finally { await client.disconnect(); rl.close(); }
