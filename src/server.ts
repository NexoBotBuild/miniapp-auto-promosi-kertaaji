import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { Bot, InlineKeyboard } from "grammy";

type Buyer = { id: string; name: string; telegramId: string; broadcastActive: boolean; commentActive: boolean; commentAccountConnected: boolean; planBroadcast: boolean; planComment: boolean; workerId: string | null; updatedAt: string };
type Worker = { id: string; label: string; username: string; status: "AVAILABLE" | "ASSIGNED" | "COOLDOWN" | "DISABLED"; buyerId: string | null; cooldownUntil?: string; createdAt: string };
type Broadcast = { buyerId: string; wording: string; groups: string[]; intervalMinutes: number; updatedBy: "ADMIN" | "BUYER"; updatedAt: string };
type CommentConfig = { buyerId: string; bases: string[]; division: string; keywords: string[]; blacklist: string[]; wording: string; mode: "APPROVAL" | "AUTO"; updatedAt: string };
type Activity = { buyerId: string; kind: "BROADCAST" | "COMMENT"; status: string; label: string; link?: string; at: string };
type Candidate = { id: string; buyerId: string; base: string; messageId: string; link: string; createdAt: string };
type Plan = "BROADCAST" | "COMMENT";
type Payment = { id: string; telegramId: string; plan: Plan; amount: number; status: "PENDING" | "PAID" | "FAILED" | "EXPIRED"; gatewayReference?: string; createdAt: string; paidAt?: string };
type Subscription = { id: string; buyerId: string; plan: Plan; status: "ACTIVE" | "EXPIRED"; startsAt: string; endsAt: string };
type Store = { buyers: Buyer[]; workers: Worker[]; broadcasts: Broadcast[]; commentConfigs: CommentConfig[]; activities: Activity[]; approvalCandidates: Candidate[]; dedupe: { buyerId: string; base: string; messageId: string; at: string }[]; payments: Payment[]; subscriptions: Subscription[] };

const root = dirname(fileURLToPath(import.meta.url));
const dataFile = join(root, "../data/store.json");
const app = Fastify({ logger: true });
if (process.env.NODE_ENV === "production") await app.register(fastifyStatic, { root: join(root, "../dist") });
let bot: Bot | undefined;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

async function load(): Promise<Store> { const store = JSON.parse(await readFile(dataFile, "utf8")) as Partial<Store>; const ready = { ...store, payments: store.payments ?? [], subscriptions: store.subscriptions ?? [] } as Store; for (const worker of ready.workers) if (worker.status === "COOLDOWN") { worker.status = "AVAILABLE"; worker.buyerId = null; delete worker.cooldownUntil; } return ready; }
async function save(store: Store) { await writeFile(dataFile, JSON.stringify(store, null, 2) + "\n"); }
function telegramUserId(req: any): string | null {
  const initData = String(req.headers["x-telegram-init-data"] ?? "");
  if (!initData) return process.env.ALLOW_DEMO === "true" ? String(req.headers["x-buyer-id"] ?? "buyer-demo") : null;
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) return null;
  const data = new URLSearchParams(initData); const receivedHash = data.get("hash");
  if (!receivedHash) return null;
  const authDate = Number(data.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || authDate < 1 || Date.now() / 1000 - authDate > 86_400) return null;
  data.delete("hash");
  const checkString = [...data.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + "=" + value).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secret).update(checkString).digest("hex");
  const received = Buffer.from(receivedHash, "hex"); const expected = Buffer.from(expectedHash, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try { return String(JSON.parse(data.get("user") ?? "{}").id || "") || null; } catch { return null; }
}
function buyerId(req: any) { return telegramUserId(req); }
function adminIds() { return new Set((process.env.ADMIN_TELEGRAM_IDS ?? process.env.ADMIN_TELEGRAM_ID ?? "").split(",").map((item) => item.trim()).filter(Boolean)); }
function isAdmin(req: any) { const telegramId = telegramUserId(req); return Boolean(telegramId && adminIds().has(telegramId)); }
async function adminOnly(req: any, reply: any) { if (!isAdmin(req)) return reply.code(403).send({ error: "admin_only", reason: "Halaman ini khusus pengelola layanan." }); }
function buyerForRequest(store: Store, req: any) {
  const requester = buyerId(req);
  return store.buyers.find((item) => item.telegramId === requester)
    ?? (process.env.ALLOW_DEMO === "true" ? store.buyers.find((item) => item.id === "buyer-demo") : undefined);
}
function cleanGroups(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const groups = raw.map((item) => String(item).trim().replace(/^@/, "")).filter((item) => /^[A-Za-z][A-Za-z0-9_]{3,}$/.test(item));
  if (!groups.length || groups.length > 15 || new Set(groups.map((item) => item.toLowerCase())).size !== groups.length) throw new Error("Masukkan 1–15 grup publik unik ber-username.");
  return groups;
}
function split(value: unknown): string[] { return String(value ?? "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 60); }

function hasPlanAccess(store: Store, buyer: Buyer, plan: Plan) {
  const subscriptions = store.subscriptions.filter((item) => item.buyerId === buyer.id && item.plan === plan);
  return subscriptions.length ? subscriptions.some((item) => item.status === "ACTIVE" && Date.parse(item.endsAt) > Date.now()) : plan === "BROADCAST" ? buyer.planBroadcast : buyer.planComment;
}
function releaseWorker(store: Store, buyer: Buyer) {
  if (!buyer.workerId) return;
  const worker = store.workers.find((item) => item.id === buyer.workerId);
  if (worker) {
    worker.buyerId = null; worker.status = "AVAILABLE"; delete worker.cooldownUntil;
  }
  buyer.workerId = null;
}
function cleanup(store: Store) {
  const ago = (days: number) => Date.now() - days * 86_400_000;
  for (const subscription of store.subscriptions) if (subscription.status === "ACTIVE" && Date.parse(subscription.endsAt) <= Date.now()) subscription.status = "EXPIRED";
  for (const buyer of store.buyers) {
    const ownsSubscription = store.subscriptions.some((item) => item.buyerId === buyer.id);
    if (!ownsSubscription) continue;
    if (!hasPlanAccess(store, buyer, "BROADCAST")) { buyer.planBroadcast = false; buyer.broadcastActive = false; releaseWorker(store, buyer); }
    if (!hasPlanAccess(store, buyer, "COMMENT")) { buyer.planComment = false; buyer.commentActive = false; buyer.commentAccountConnected = false; }
  }
  const expiredBuyerIds = new Set(store.buyers.filter((buyer) => !hasPlanAccess(store, buyer, "COMMENT")).map((buyer) => buyer.id));
  store.approvalCandidates = store.approvalCandidates.filter((item) => !expiredBuyerIds.has(item.buyerId));
  store.dedupe = store.dedupe.filter((item) => !expiredBuyerIds.has(item.buyerId));
  store.approvalCandidates = store.approvalCandidates.filter((item) => Date.parse(item.createdAt) > ago(2));
  store.dedupe = store.dedupe.filter((item) => Date.parse(item.at) > ago(7));
  const byBuyer = new Map<string, Activity[]>();
  for (const item of store.activities.filter((item) => Date.parse(item.at) > ago(30))) byBuyer.set(item.buyerId, [...(byBuyer.get(item.buyerId) ?? []), item]);
  store.activities = [...byBuyer.values()].flatMap((items) => items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 100));
}

app.get("/api/buyer/dashboard", async (req, reply) => {
  const store = await load(); cleanup(store); await save(store); const buyer = buyerForRequest(store, req);
  if (!buyer) return { onboarding: true, buyer: null, worker: null, broadcast: null, comment: null, activity: [] };
  return {
    buyer,
    worker: buyer.workerId ? store.workers.find((item) => item.id === buyer.workerId) ?? null : null,
    broadcast: store.broadcasts.find((item) => item.buyerId === buyer.id) ?? null,
    comment: store.commentConfigs.find((item) => item.buyerId === buyer.id) ?? null,
    activity: store.activities.filter((item) => item.buyerId === buyer.id).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12),
  };
});

app.get("/api/app/session", async (req, reply) => {
  if (!telegramUserId(req)) return reply.code(401).send({ error: "open_from_telegram", reason: "Buka layanan ini dari bot Telegram." });
  return { role: isAdmin(req) ? "ADMIN" : "BUYER" };
});

const planAmount = (plan: Plan) => Number(plan === "BROADCAST" ? process.env.PLAN_BROADCAST_PRICE : process.env.PLAN_COMMENT_PRICE) || 0;
app.post<{ Body: { plan?: Plan } }>("/api/public/checkout", async (req, reply) => {
  const plan = req.body?.plan === "COMMENT" ? "COMMENT" : req.body?.plan === "BROADCAST" ? "BROADCAST" : null;
  const telegramId = telegramUserId(req); const amount = plan ? planAmount(plan) : 0;
  if (!plan || !telegramId) return reply.code(401).send({ error: "open_from_telegram", reason: "Buka layanan ini dari bot Telegram untuk berlangganan." });
  if (amount < 1) return reply.code(409).send({ error: "package_unavailable", reason: "Paket ini belum dibuka untuk pembayaran." });
  if (!process.env.DOKU_CLIENT_ID || !process.env.DOKU_SECRET_KEY) return reply.code(503).send({ error: "payment_unavailable", reason: "Pembayaran belum diaktifkan." });
  return reply.code(503).send({ error: "checkout_preparing", reason: "Pembayaran untuk paket ini sedang disiapkan." });
});

app.post<{ Body: { feature: "BROADCAST" | "COMMENT"; active: boolean } }>("/api/buyer/toggle", async (req, reply) => {
  const store = await load(); cleanup(store); await save(store); const buyer = buyerForRequest(store, req);
  if (!buyer) return reply.code(404).send({ error: "buyer_not_found", reason: "Layanan belum disiapkan untuk akun Telegram ini." });
  const feature = req.body.feature;
  if (feature === "BROADCAST") {
    const ready = hasPlanAccess(store, buyer, "BROADCAST") && buyer.workerId && store.broadcasts.some((item) => item.buyerId === buyer.id);
    if (req.body.active && !ready) return reply.code(409).send({ error: "setup_incomplete", reason: "Admin belum menyelesaikan setup Auto Sebar lo." });
    buyer.broadcastActive = req.body.active;
  } else {
    const ready = hasPlanAccess(store, buyer, "COMMENT") && buyer.commentAccountConnected && store.commentConfigs.some((item) => item.buyerId === buyer.id);
    if (req.body.active && !ready) return reply.code(409).send({ error: "setup_incomplete", reason: "Hubungkan akun dan lengkapi setup Auto Komen dulu." });
    buyer.commentActive = req.body.active;
  }
  buyer.updatedAt = now(); await save(store); return { ok: true, buyer };
});

app.post("/api/buyer/connect-comment-account", async (req, reply) => {
  // Placeholder integrasi MTProto: UI/bot login harus dipasang saat API Telegram client tersedia.
  const store = await load(); cleanup(store); await save(store); const buyer = buyerForRequest(store, req);
  if (!buyer) return reply.code(404).send({ error: "buyer_not_found", reason: "Layanan belum disiapkan untuk akun Telegram ini." });
  if (!hasPlanAccess(store, buyer, "COMMENT")) return reply.code(403).send({ error: "subscription_required", reason: "Akses Auto Komen lo belum aktif." });
  buyer.commentAccountConnected = true; buyer.updatedAt = now(); await save(store);
  return { ok: true, next: "Akun berhasil tersambung." };
});

// Dipanggil oleh adapter Telegram userbot saat ada post baru di base. Tidak menyimpan
// isi post secara permanen: hanya jejak anti-duplikat atau kandidat approval singkat.
app.post<{ Body: { buyerId?: string; base?: string; messageId?: string; link?: string; text?: string } }>("/api/internal/incoming-message", async (req, reply) => {
  const body = req.body ?? {}; const targetBuyer = String(body.buyerId ?? ""); const base = String(body.base ?? "").replace(/^@/, ""); const messageId = String(body.messageId ?? ""); const text = String(body.text ?? "").toLowerCase();
  if (!targetBuyer || !base || !messageId || !text) return reply.code(400).send({ error: "buyerId, base, messageId, dan text wajib ada." });
  const store = await load(); cleanup(store); await save(store); const buyer = store.buyers.find((item) => item.id === targetBuyer); const config = store.commentConfigs.find((item) => item.buyerId === targetBuyer);
  if (!buyer?.commentActive || !hasPlanAccess(store, buyer, "COMMENT") || !config || !buyer.commentAccountConnected) return { action: "ignored", reason: "comment_off_or_not_ready" };
  const baseAllowed = config.bases.some((item) => item.toLowerCase() === base.toLowerCase());
  const hitKeyword = config.keywords.some((item) => text.includes(item.toLowerCase()));
  const hitBlacklist = config.blacklist.some((item) => text.includes(item.toLowerCase()));
  const duplicate = store.dedupe.some((item) => item.buyerId === targetBuyer && item.base === base && item.messageId === messageId);
  if (!baseAllowed || !hitKeyword || hitBlacklist || duplicate) return { action: "ignored", reason: !baseAllowed ? "base_not_selected" : hitBlacklist ? "blacklist_oot" : duplicate ? "duplicate" : "keyword_miss" };
  store.dedupe.push({ buyerId: targetBuyer, base, messageId, at: now() });
  if (config.mode === "APPROVAL") {
    const candidate: Candidate = { id: id("lead"), buyerId: targetBuyer, base, messageId, link: String(body.link ?? ""), createdAt: now() };
    store.approvalCandidates.push(candidate); await save(store);
    return { action: "approval", candidate, wording: config.wording };
  }
  store.activities.unshift({ buyerId: targetBuyer, kind: "COMMENT", status: "queued", label: `Komentar otomatis · @${base}`, link: String(body.link ?? ""), at: now() });
  cleanup(store); await save(store);
  return { action: "send_comment", wording: config.wording };
});

app.post<{ Params: { id: string } }>("/api/buyer/approval/:id/send", async (req, reply) => {
  const store = await load(); cleanup(store); await save(store); const buyer = buyerForRequest(store, req); const candidate = store.approvalCandidates.find((item) => item.id === req.params.id && item.buyerId === buyer?.id);
  if (!candidate) return reply.code(404).send({ error: "Kandidat sudah habis atau tidak ditemukan." });
  if (!buyer || !hasPlanAccess(store, buyer, "COMMENT")) return reply.code(403).send({ error: "subscription_required", reason: "Akses Auto Komen lo sudah tidak aktif." });
  store.activities.unshift({ buyerId: candidate.buyerId, kind: "COMMENT", status: "queued", label: `Komentar disetujui · @${candidate.base}`, link: candidate.link, at: now() });
  store.approvalCandidates = store.approvalCandidates.filter((item) => item.id !== candidate.id); cleanup(store); await save(store);
  return { ok: true };
});

app.get("/api/admin/overview", { preHandler: adminOnly }, async () => {
  const store = await load(); cleanup(store); await save(store);
  return { buyers: store.buyers, workers: store.workers, broadcasts: store.broadcasts, comments: store.commentConfigs, subscriptions: store.subscriptions };
});

app.post<{ Body: { name?: string; telegramId?: string } }>("/api/admin/buyers", { preHandler: adminOnly }, async (req, reply) => {
  const name = String(req.body.name ?? "").trim();
  if (!name) return reply.code(400).send({ error: "Nama buyer wajib diisi." });
  const store = await load(); const buyer: Buyer = { id: id("buyer"), name, telegramId: String(req.body.telegramId ?? ""), broadcastActive: false, commentActive: false, commentAccountConnected: false, planBroadcast: false, planComment: false, workerId: null, updatedAt: now() };
  store.buyers.push(buyer); await save(store); return { buyer };
});

app.post<{ Body: { label?: string; username?: string } }>("/api/admin/workers", { preHandler: adminOnly }, async (req, reply) => {
  const label = String(req.body.label ?? "").trim(); const username = String(req.body.username ?? "").trim().replace(/^@/, "");
  if (!label || !/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(username)) return reply.code(400).send({ error: "Isi label dan username akun worker yang valid." });
  const store = await load();
  if (store.workers.some((item) => item.username.toLowerCase() === username.toLowerCase())) return reply.code(409).send({ error: "Username worker sudah terdaftar." });
  const worker: Worker = { id: id("worker"), label, username, status: "AVAILABLE", buyerId: null, createdAt: now() }; store.workers.push(worker); await save(store); return { worker };
});

app.delete<{ Params: { id: string } }>("/api/admin/workers/:id", { preHandler: adminOnly }, async (req, reply) => {
  const store = await load(); const worker = store.workers.find((item) => item.id === req.params.id);
  if (!worker) return reply.code(404).send({ error: "Worker tidak ditemukan." });
  if (worker.buyerId) return reply.code(409).send({ error: "Worker sedang dipakai buyer dan tidak bisa dihapus." });
  store.workers = store.workers.filter((item) => item.id !== worker.id); await save(store); return { ok: true };
});

app.post<{ Params: { id: string }; Body: { planBroadcast?: boolean; planComment?: boolean; workerId?: string | null; wording?: string; groups?: string[]; intervalMinutes?: number; bases?: string; division?: string; keywords?: string; blacklist?: string; commentWording?: string; mode?: "APPROVAL" | "AUTO" } }>("/api/admin/buyers/:id/setup", { preHandler: adminOnly }, async (req, reply) => {
  const store = await load(); const buyer = store.buyers.find((item) => item.id === req.params.id);
  if (!buyer) return reply.code(404).send({ error: "Buyer tidak ditemukan." });
  buyer.planBroadcast = Boolean(req.body.planBroadcast); buyer.planComment = Boolean(req.body.planComment);
  if (buyer.planBroadcast) {
    const worker = store.workers.find((item) => item.id === req.body.workerId);
    if (!worker || (worker.status !== "AVAILABLE" && worker.buyerId !== buyer.id)) return reply.code(409).send({ error: "Pilih worker yang tersedia untuk buyer ini." });
    if (!String(req.body.wording ?? "").trim()) return reply.code(400).send({ error: "Wording Auto Sebar wajib diisi." });
    let groups: string[]; try { groups = cleanGroups(req.body.groups); } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    for (const item of store.workers) if (item.buyerId === buyer.id && item.id !== worker.id) { item.buyerId = null; item.status = "AVAILABLE"; }
    worker.buyerId = buyer.id; worker.status = "ASSIGNED"; delete worker.cooldownUntil; buyer.workerId = worker.id;
    const broadcast: Broadcast = { buyerId: buyer.id, wording: String(req.body.wording).trim().slice(0, 4000), groups, intervalMinutes: Math.min(120, Math.max(5, Number(req.body.intervalMinutes) || 15)), updatedBy: "ADMIN", updatedAt: now() };
    store.broadcasts = [...store.broadcasts.filter((item) => item.buyerId !== buyer.id), broadcast];
  } else { buyer.broadcastActive = false; buyer.workerId = null; store.broadcasts = store.broadcasts.filter((item) => item.buyerId !== buyer.id); }
  if (buyer.planComment) {
    const config: CommentConfig = { buyerId: buyer.id, bases: split(req.body.bases), division: String(req.body.division ?? "Produk").trim().slice(0, 50), keywords: split(req.body.keywords), blacklist: split(req.body.blacklist), wording: String(req.body.commentWording ?? "").trim().slice(0, 4000), mode: req.body.mode === "AUTO" ? "AUTO" : "APPROVAL", updatedAt: now() };
    store.commentConfigs = [...store.commentConfigs.filter((item) => item.buyerId !== buyer.id), config];
  } else { buyer.commentActive = false; store.commentConfigs = store.commentConfigs.filter((item) => item.buyerId !== buyer.id); }
  buyer.updatedAt = now(); await save(store); return { ok: true, buyer };
});

// DOKU integration boundary: payment webhook must verify signature + idempotency, then only grant plan flags.
app.post("/api/payments/doku/webhook", async (_req, reply) => reply.code(501).send({ error: "DOKU belum dikonfigurasi. Jangan aktifkan akses dari return URL." }));

const token = process.env.BOT_TOKEN;
if (token) {
  bot = new Bot(token);
  const miniAppUrl = process.env.MINIAPP_URL;
  if (miniAppUrl) void bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Buka layanan", web_app: { url: miniAppUrl } } }).catch((error) => app.log.error(error, "Menu Mini App belum tersambung"));
  bot.command("start", async (ctx) => {
    await ctx.reply("Buka layanan promosi lo dari Mini App.", miniAppUrl ? { reply_markup: new InlineKeyboard().webApp("Buka Mini App", miniAppUrl) } : undefined);
  });
  bot.command("id", async (ctx) => { await ctx.reply("ID Telegram lo: " + String(ctx.from?.id ?? "")); });
  void bot.start();
}

setInterval(async () => { const store = await load(); cleanup(store); await save(store); }, 5 * 60_000).unref();
await app.listen({ port: Number(process.env.PORT ?? 8787), host: "0.0.0.0" });
