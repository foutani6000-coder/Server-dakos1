/**
 * Dakos — خادم API واحد
 * التشغيل: Vercel Serverless Function  |  قاعدة البيانات: MongoDB (Atlas أو أي خادم MongoDB)
 *
 * كل المسارات تبدأ بـ /api/... (انظر vercel.json) وتنشئ الفهارس تلقائيًا عند أول تشغيل.
 *
 * متغيرات البيئة المطلوبة فقط (Vercel → Settings → Environment Variables):
 *   MONGODB_URI           رابط الاتصال، مثال: mongodb+srv://user:pass@cluster.mongodb.net/dakos
 *   JWT_SECRET            نص عشوائي طويل (32 حرفًا فأكثر)
 *   ADMIN_EMAIL           بريد المشرف
 *   ADMIN_PASSWORD        كلمة سر المشرف
 *   RESEND_API_KEY + MAIL_FROM   لإرسال رمز التحقق (أو BREVO_API_KEY + MAIL_FROM)
 */
'use strict';

const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const ENV = process.env;
const DAY = 86400000;
const MAX_BODY = 600 * 1024;
const PHOTO_MAX_BYTES = 200 * 1024;
const CODE_TTL = 10 * 60 * 1000;
const USER_TOKEN_TTL = 30 * 24 * 3600;
const ADMIN_TOKEN_TTL = 12 * 3600;
const PAGE_SIZE = 20;
const SERIES_IMG_MAX_BYTES = 300 * 1024;

// الإعدادات الافتراضية للذهب والإعلانات: [القيمة، الحد الأدنى، الحد الأقصى]
const SETTING_DEFS = {
  price: [10, 0, 100000],
  welcomeGold: [30, 0, 1000000],
  referralGold: [20, 0, 1000000],
  dailyGold: [5, 0, 1000000],
  adGold: [1, 0, 10000],
  adDailyLimit: [50, 1, 1000],
  adCooldownSec: [20, 0, 3600],
};

/* ════════════════════════════ أدوات عامة ════════════════════════════ */

class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
const fail = (status, code, message) => new HttpError(status, code, message);
const bad = (message) => fail(400, 'bad_request', message || 'بيانات غير صالحة');
const N = (v) => Number(v) || 0;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const rid = (prefix) => prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const isDup = (e) => !!e && e.code === 11000;

function cleanStr(v, max, multiline = false) {
  let s = typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : '');
  s = s.replace(multiline ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '');
  return s.trim().slice(0, max);
}
function cleanEmail(v) {
  const s = cleanStr(v, 254).toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : '';
}
function cleanId(v) {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw bad('المعرّف غير صالح');
  return s;
}
function cleanUrl(v, required = true) {
  const s = cleanStr(v, 2000);
  if (!s) { if (required) throw bad('الرابط مطلوب'); return ''; }
  let u;
  try { u = new URL(s); } catch { throw bad('الرابط غير صالح'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('الرابط يجب أن يبدأ بـ http أو https');
  return s;
}
function toInt(v, min, max, label = 'القيمة') {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw bad(`${label} غير صالحة`);
  return n;
}
const parseJson = (s, def) => { try { return s ? JSON.parse(s) : def; } catch { return def; } };
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ════════════════════════════ التجزئة والتوكن ════════════════════════════ */

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwtSecret() {
  const s = ENV.JWT_SECRET || '';
  if (s.length < 32) throw fail(500, 'config', 'JWT_SECRET غير مضبوط أو قصير (32 حرفًا على الأقل)');
  return s;
}
function jwtSign(payload, ttlSec, aud) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, aud, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', jwtSecret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function jwtVerify(token, aud) {
  const badCode = aud === 'admin' ? 'admin_auth' : 'bad_session';
  const badMsg = aud === 'admin' ? 'سجّل دخول المشرف من جديد' : 'الجلسة غير صالحة، سجّل الدخول من جديد';
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw fail(401, badCode, badMsg);
  const expect = crypto.createHmac('sha256', jwtSecret()).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) throw fail(401, badCode, badMsg);
  let p;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw fail(401, badCode, badMsg); }
  if (p.aud !== aud) throw fail(401, badCode, badMsg);
  if (!p.exp || p.exp * 1000 < Date.now()) throw fail(401, aud === 'admin' ? 'admin_auth' : 'expired', 'انتهت الجلسة، سجّل الدخول من جديد');
  return p;
}

const scryptAsync = (pw, salt, len) => new Promise((resolve, reject) =>
  crypto.scrypt(String(pw), salt, len, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const k = await scryptAsync(pw, salt, 64);
  return `s1$${salt.toString('base64')}$${k.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [v, s, h] = String(stored || '').split('$');
  if (v !== 's1' || !s || !h) return false;
  const k = await scryptAsync(pw, Buffer.from(s, 'base64'), 64);
  const b = Buffer.from(h, 'base64');
  return b.length === k.length && crypto.timingSafeEqual(b, k);
}
let dummyHash = null;
let adminHashCache = null;

/* ════════════════════════════ قاعدة بيانات MongoDB ════════════════════════════ */

function getDb() {
  if (!globalThis.__dakosMongo) {
    globalThis.__dakosMongo = (async () => {
      const uri = ENV.MONGODB_URI;
      if (!uri) throw fail(500, 'config', 'لم يُضبط MONGODB_URI (رابط قاعدة بيانات MongoDB)');
      const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
      await client.connect();
      return client.db(/mongodb(\+srv)?:\/\/[^/]+\/[^?]+/.test(uri) ? undefined : 'dakos');
    })().catch((e) => { globalThis.__dakosMongo = null; throw e; });
  }
  return globalThis.__dakosMongo;
}
const C = async (name) => (await getDb()).collection(name);
const isDbDown = (e) => !!e && (/^Mongo(ServerSelection|Network|NotConnected|Topology|Server.*Closed)/.test(e.name || '') || ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(e.code));

async function nextUserId() {
  const c = await C('counters');
  const r = await c.findOneAndUpdate({ _id: 'users' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return N(r.seq);
}

async function ensureReady() {
  if (ENV.SKIP_SCHEMA_INIT === '1') return;
  if (!globalThis.__dakosSchema) {
    globalThis.__dakosSchema = (async () => {
      const db = await getDb();
      await Promise.all([
        db.collection('users').createIndexes([
          { key: { email: 1 }, name: 'uq_users_email', unique: true },
          { key: { referral_code: 1 }, name: 'uq_users_refcode', unique: true },
          { key: { referred_by: 1 }, name: 'ix_users_referred' },
          { key: { created_at: -1 }, name: 'ix_users_created' },
        ]),
        db.collection('episodes').createIndex({ series_id: 1, episode: 1 }, { unique: true, name: 'uq_episodes' }),
        db.collection('unlocks').createIndexes([
          { key: { user_id: 1, series_id: 1, episode: 1 }, name: 'uq_unlocks', unique: true },
          { key: { series_id: 1 }, name: 'ix_unlocks_series' },
        ]),
        db.collection('history').createIndex({ user_id: 1, ts: -1 }, { name: 'ix_history_user' }),
        db.collection('ratings').createIndexes([
          { key: { user_id: 1, series_id: 1 }, name: 'uq_ratings', unique: true },
          { key: { series_id: 1 }, name: 'ix_ratings_series' },
        ]),
        db.collection('promo_uses').createIndex({ code: 1, user_id: 1 }, { unique: true, name: 'uq_promo_uses' }),
        db.collection('notifications').createIndex({ created_at: -1 }, { name: 'ix_notif_created' }),
        db.collection('ad_tickets').createIndex({ ymid: 1 }, { name: 'ix_ad_ymid' }),
        db.collection('series').createIndex({ created_at: -1 }, { name: 'ix_series_created' }),
      ]);
      // يضمن أن عدّاد المعرّفات أكبر من أي معرّف مستخدم موجود (مفيد عند نقل بيانات قديمة)
      const top = await db.collection('users').find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray();
      const maxId = top[0] ? N(top[0]._id) : 0;
      await db.collection('counters').updateOne({ _id: 'users' }, { $max: { seq: maxId } }, { upsert: true });
    })().catch((e) => { globalThis.__dakosSchema = null; throw e; });
  }
  return globalThis.__dakosSchema;
}

/* ════════════════════════════ الإعدادات ════════════════════════════ */

async function getSettings() {
  const rows = await (await C('settings')).find({}).toArray();
  const s = {};
  for (const [k, d] of Object.entries(SETTING_DEFS)) s[k] = d[0];
  for (const row of rows) {
    if (row._id in SETTING_DEFS) { const n = Number(row.v); if (Number.isFinite(n)) s[row._id] = n; }
  }
  return s;
}
const publicConfig = (s) => ({
  price: s.price, dailyGold: s.dailyGold, referralGold: s.referralGold, welcomeGold: s.welcomeGold,
  adGold: s.adGold, adReward: s.adGold, adDailyLimit: s.adDailyLimit, adCooldownSec: s.adCooldownSec,
  appLink: ENV.APP_LINK || '', adZone: ENV.AD_ZONE || '12109806',
});

/* ════════════════════════════ تحديد المعدل (في القاعدة) ════════════════════════════ */

async function hit(key, limit, windowMs) {
  // وضع الاختبار المؤقت (SKIP_MAIL_CODE=1): لا حدّ لمحاولات إنشاء الحساب والتحقق والدخول. حدود دخول المشرف تبقى كما هي.
  if (ENV.SKIP_MAIL_CODE === '1' && /^(reg|ver|rs|lg):/.test(key)) return;
  const now = Date.now();
  const col = await C('rate_limits');
  let cnt = 1;
  const pipeline = [{
    $set: {
      cnt: { $cond: [{ $lte: [{ $ifNull: ['$reset_at', 0] }, now] }, 1, { $add: [{ $ifNull: ['$cnt', 0] }, 1] }] },
      reset_at: { $cond: [{ $lte: [{ $ifNull: ['$reset_at', 0] }, now] }, now + windowMs, '$reset_at'] },
    },
  }];
  try {
    const r = await col.findOneAndUpdate({ _id: key }, pipeline, { upsert: true, returnDocument: 'after' });
    if (r) cnt = N(r.cnt);
  } catch (e) { if (!isDup(e)) throw e; }
  if (cnt > limit) throw fail(429, 'rate_limited', 'محاولات كثيرة، حاول مرة أخرى لاحقًا');
  if (Math.random() < 0.02) {
    await col.deleteMany({ reset_at: { $lt: now - DAY } }).catch(() => {});
    await (await C('ad_tickets')).deleteMany({ created_at: { $lt: now - 2 * DAY } }).catch(() => {});
  }
}

/* ════════════════════════════ البريد ════════════════════════════ */

async function sendMail(to, code) {
  if (ENV.SKIP_MAIL_CODE === '1') return; // وضع مؤقت: لا إرسال بريد (الرمز ثابت 000000)
  const subject = 'رمز التحقق من Dakos';
  const text = `رمز التحقق الخاص بك: ${code} (صالح 10 دقائق)`;
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px"><p>رمز التحقق الخاص بك:</p><p style="font-size:30px;font-weight:bold;letter-spacing:8px">${code}</p><p>صالح لمدة 10 دقائق. إن لم تطلب هذا الرمز فتجاهل الرسالة.</p></div>`;
  const from = ENV.MAIL_FROM || '';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000); // أقل من حد Vercel (10ث) ليصل رد واضح بدل انقطاع الاتصال
  try {
    let res;
    if (ENV.RESEND_API_KEY && from) {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${ENV.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
    } else if (ENV.BREVO_API_KEY && from) {
      const m = /^(.*)<(.+)>$/.exec(from);
      const sender = m ? { name: m[1].trim().replace(/^"|"$/g, '') || 'Dakos', email: m[2].trim() } : { name: 'Dakos', email: from };
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', signal: ctl.signal,
        headers: { 'api-key': ENV.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
      });
    } else if (ENV.NODE_ENV !== 'production') {
      console.log(`[dev] رمز التحقق لـ ${to}: ${code}`);
      return;
    } else {
      throw new Error('mail provider not configured');
    }
    if (!res.ok) { const detail = await res.text().catch(() => ''); throw new Error(`mail provider ${res.status} ${detail.slice(0, 300)}`); }
  } catch (e) {
    console.error('mail_failed:', e && e.message);
    // مؤقتًا للتشخيص: نُظهر رقم الحالة ورسالة المزوّد (بدون أي مفاتيح) بكود مختلف كي تعرضه الواجهة كما هو.
    // لإرجاع الرسالة العامة: استبدل السطر التالي بـ throw fail(502, 'mail_failed', 'تعذّر إرسال رمز التحقق إلى البريد، حاول لاحقًا');
    throw fail(502, 'mail_error', `تعذّر إرسال البريد: ${String((e && e.message) || 'unknown').slice(0, 220)}`);
  } finally { clearTimeout(timer); }
}

function issueCode() {
  const code = ENV.SKIP_MAIL_CODE === '1' ? '000000' : String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  return { code, salt, hash: sha(`${salt}:${code}`), expires: Date.now() + CODE_TTL };
}
function referralCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += A[crypto.randomInt(0, A.length)];
  return s;
}

/* ════════════════════════════ المستخدم: الحساب والملف الشخصي ════════════════════════════ */

const photoUrl = (base, id, v) => (N(v) ? `${base}/api/user/photo?id=${id}&v=${N(v)}` : '');

async function hist(userId, kind, amount, extra = {}) {
  await (await C('history')).insertOne({
    user_id: userId, kind, amount, note: extra.note ?? null, series_id: extra.seriesId ?? null, episode: extra.episode ?? null, ts: Date.now(),
  });
}

async function loadAccount(id, ctx) {
  const now = Date.now();
  const [users, unlocks, history, ratings] = await Promise.all([C('users'), C('unlocks'), C('history'), C('ratings')]);
  const [u, unl, hs, rt, fr] = await Promise.all([
    users.findOne({ _id: id }, { projection: { photo: 0, password_hash: 0, code_hash: 0, code_salt: 0 } }),
    unlocks.find({ user_id: id }).sort({ series_id: 1, episode: 1 }).toArray(),
    history.find({ user_id: id }).sort({ ts: -1, _id: -1 }).limit(50).toArray(),
    ratings.find({ user_id: id }).toArray(),
    users.aggregate([
      { $match: { referred_by: id, verified: true } },
      { $group: { _id: null, friends: { $sum: 1 }, gold: { $sum: '$ref_reward' } } },
    ]).toArray(),
  ]);
  if (!u) throw fail(401, 'no_account', 'الحساب غير موجود');
  const s = await getSettings();
  const unlocked = {};
  for (const x of unl) (unlocked[x.series_id] || (unlocked[x.series_id] = [])).push(N(x.episode));
  const ratingsMap = {};
  for (const x of rt) ratingsMap[x.series_id] = N(x.stars);
  const historyOut = hs.map((h) => {
    const o = { type: h.kind, amount: N(h.amount), at: N(h.ts) };
    if (h.note) o.note = h.note;
    if (h.series_id) o.seriesId = h.series_id;
    if (h.episode) o.episode = N(h.episode);
    return o;
  });
  const resetAt = N(u.ads_reset_at);
  const expired = resetAt > 0 && resetAt <= now;
  const profile = {
    gold: N(u.gold),
    friends: fr[0] ? N(fr[0].friends) : 0,
    referralGold: fr[0] ? N(fr[0].gold) : 0,
    referralCode: u.referral_code,
    unlocked, history: historyOut, ratings: ratingsMap,
    nextDailyAt: N(u.next_daily_at),
    adsToday: expired ? 0 : N(u.ads_today),
    adsLimit: s.adDailyLimit,
    adsResetAt: expired ? 0 : resetAt,
    adsNextAt: N(u.ads_next_at),
  };
  if (u.last_series_id) profile.last = { seriesId: u.last_series_id, episode: N(u.last_episode) };
  const user = {
    id: N(u._id), first_name: u.name, email: u.email, bio: u.bio || '',
    photo_url: photoUrl(ctx.base, N(u._id), u.photo_v),
  };
  return { user, profile, config: publicConfig(s) };
}

async function requireUser(ctx) {
  const m = /^Bearer\s+(.+)$/i.exec(ctx.req.headers.authorization || '');
  const p = jwtVerify(m && m[1], 'user');
  const users = await C('users');
  const u = await users.findOne({ _id: N(p.sub) }, { projection: { banned: 1, verified: 1, last_seen: 1 } });
  if (!u || !u.verified) throw fail(401, 'no_account', 'الحساب غير موجود');
  if (u.banned) throw fail(403, 'banned', 'تم حظر هذا الحساب');
  if (ctx.now - N(u.last_seen) > 60000) await users.updateOne({ _id: u._id }, { $set: { last_seen: ctx.now } });
  return { id: N(u._id) };
}

async function requireAdmin(ctx) {
  const m = /^Bearer\s+(.+)$/i.exec(ctx.req.headers.authorization || '');
  const p = jwtVerify(m && m[1], 'admin');
  if (p.role !== 'admin') throw fail(401, 'admin_auth', 'سجّل دخول المشرف من جديد');
  return { admin: true };
}

function mapSeries(r) {
  return {
    id: r._id, title: r.title, category: r.category, year: r.yr || '', rating: r.rating || '', image: r.image,
    tag: r.tag || '', description: r.description || '', episodes: N(r.episodes), i18n: parseJson(r.i18n, {}),
  };
}

/* ════════════════════════════ المسارات ════════════════════════════ */

const routes = new Map();
const add = (method, path, auth, fn) => routes.set(`${method} ${path}`, { auth, fn });

/* ---------- عام ---------- */

add('GET', '/health', null, async () => {
  await (await getDb()).command({ ping: 1 });
  return { ok: true, time: Date.now() };
});

add('GET', '/catalog', null, async (ctx) => {
  const [seriesC, episodesC, ratingsC, storiesC] = await Promise.all([C('series'), C('episodes'), C('ratings'), C('stories')]);
  const [seriesRows, epRows, voteRows, storyRows, settings] = await Promise.all([
    seriesC.find({}, { projection: { image_data: 0 } }).sort({ created_at: -1, _id: 1 }).toArray(),
    episodesC.find({}, { projection: { series_id: 1, episode: 1 } }).sort({ series_id: 1, episode: 1 }).toArray(),
    ratingsC.aggregate([{ $group: { _id: { s: '$series_id', st: '$stars' }, c: { $sum: 1 } } }]).toArray(),
    storiesC.find({ $or: [{ expires_at: 0 }, { expires_at: { $gt: ctx.now } }] }).sort({ created_at: -1 }).toArray(),
    getSettings(),
  ]);
  const linked = {}; const votes = {};
  for (const e of epRows) (linked[e.series_id] || (linked[e.series_id] = [])).push(N(e.episode));
  for (const v of voteRows) {
    const a = votes[v._id.s] || (votes[v._id.s] = [0, 0, 0, 0, 0]);
    const i = N(v._id.st) - 1;
    if (i >= 0 && i < 5) a[i] = N(v.c);
  }
  const series = seriesRows.map((row) => ({ ...mapSeries(row), linked: linked[row._id] || [], votes: votes[row._id] || [0, 0, 0, 0, 0] }));
  const stories = storyRows.map((s) => ({ id: s._id, title: s.title, image: s.image, text: s.body || '', seriesId: s.series_id || '' }));
  return { series, stories, config: publicConfig(settings) };
});

add('GET', '/notifications', null, async (ctx) => {
  const rows = await (await C('notifications')).find({}).sort({ created_at: -1 }).limit(50).toArray();
  return {
    notifications: rows.map((n) => ({ id: n._id, type: n.kind, seriesId: n.series_id, episode: N(n.episode), count: N(n.cnt), title: n.title, image: n.image || '', createdAt: N(n.created_at) })),
    now: ctx.now,
  };
});

add('GET', '/user/photo', null, async (ctx) => {
  const id = toInt(ctx.query.id, 1, Number.MAX_SAFE_INTEGER, 'المعرّف');
  const u = await (await C('users')).findOne({ _id: id, verified: true, banned: false }, { projection: { photo: 1 } });
  const m = u && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(u.photo || '');
  if (!m) throw fail(404, 'not_found', 'لا توجد صورة');
  ctx.raw(200, {
    'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
  }, Buffer.from(m[2], 'base64'));
});

add('GET', '/series/image', null, async (ctx) => {
  const id = cleanId(ctx.query.id);
  const r = await (await C('series')).findOne({ _id: id }, { projection: { image_data: 1 } });
  const m = r && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(r.image_data || '');
  if (!m) throw fail(404, 'not_found', 'لا توجد صورة');
  ctx.raw(200, {
    'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
  }, Buffer.from(m[2], 'base64'));
});

/* ---------- الدخول بالبريد ---------- */

add('POST', '/auth/register', null, async (ctx) => {
  const b = ctx.body;
  const name = cleanStr(b.name, 40);
  const email = cleanEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!name) throw bad('الاسم مطلوب');
  if (!email) throw bad('البريد الإلكتروني غير صالح');
  if (password.length < 8 || password.length > 200) throw bad('كلمة المرور يجب ألا تقل عن 8 أحرف');
  await hit(`reg:ip:${ctx.ip}`, 10, 3600000);
  await hit(`reg:em:${sha1(email)}`, 5, 3600000);

  const users = await C('users');
  const ex = await users.findOne({ email }, { projection: { verified: 1 } });
  if (ex && ex.verified) throw fail(409, 'email_taken', 'هذا البريد مسجّل مسبقًا');

  const pwHash = await hashPassword(password);
  const c = issueCode();
  const now = ctx.now;
  if (ex) {
    // حساب غير مفعّل: نحدّث بياناته ونرسل رمزًا جديدًا بدل الخطأ
    await users.updateOne({ _id: ex._id, verified: false },
      { $set: { name, password_hash: pwHash, code_hash: c.hash, code_salt: c.salt, code_expires: c.expires, code_tries: 0, code_sent_at: now } });
  } else {
    let referrer = null;
    const ref = cleanStr(b.ref, 32).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (ref) {
      const rr = await users.findOne({ referral_code: ref, verified: true, banned: false }, { projection: { _id: 1 } });
      if (rr) referrer = N(rr._id);
    }
    let done = false;
    for (let i = 0; i < 6 && !done; i++) {
      try {
        await users.insertOne({
          _id: await nextUserId(), email, name, bio: '', photo: null, photo_v: 0, password_hash: pwHash,
          verified: false, banned: false, gold: 0, referral_code: referralCode(), referred_by: referrer, ref_reward: 0,
          code_hash: c.hash, code_salt: c.salt, code_expires: c.expires, code_tries: 0, code_sent_at: now,
          created_at: now, last_seen: now, next_daily_at: 0, ads_today: 0, ads_reset_at: 0, ads_next_at: 0,
          last_series_id: null, last_episode: 0,
        });
        done = true;
      } catch (e) {
        if (isDup(e)) {
          if (e.keyPattern && e.keyPattern.email) throw fail(409, 'email_taken', 'هذا البريد مسجّل مسبقًا');
          continue; // تصادم في رمز الدعوة: نولّد رمزًا آخر
        }
        throw e;
      }
    }
    if (!done) throw fail(500, 'server_error', 'تعذّر إنشاء الحساب، حاول مرة أخرى');
  }
  await sendMail(email, c.code);
  return { success: true };
});

add('POST', '/auth/verify', null, async (ctx) => {
  const email = cleanEmail(ctx.body.email);
  const code = cleanStr(ctx.body.code, 10);
  if (!email || !/^\d{6}$/.test(code)) throw fail(400, 'invalid_code', 'الرمز غير صحيح');
  await hit(`ver:ip:${ctx.ip}`, 30, 600000);
  await hit(`ver:em:${sha1(email)}`, 15, 600000);

  const users = await C('users');
  const u = await users.findOne({ email }, { projection: { verified: 1, referred_by: 1, code_hash: 1, code_salt: 1, code_expires: 1, code_tries: 1 } });
  if (!u || !u.code_hash) throw fail(400, 'invalid_code', 'الرمز غير صحيح');
  if (N(u.code_expires) < ctx.now) throw fail(400, 'code_expired', 'انتهت صلاحية الرمز، اطلب رمزًا جديدًا');
  if (N(u.code_tries) >= 5) {
    await users.updateOne({ _id: u._id }, { $set: { code_hash: null } });
    throw fail(400, 'code_expired', 'تجاوزت عدد المحاولات، اطلب رمزًا جديدًا');
  }
  if (!safeEq(sha(`${u.code_salt}:${code}`), u.code_hash)) {
    await users.updateOne({ _id: u._id }, [{
      $set: {
        code_tries: { $add: ['$code_tries', 1] },
        code_hash: { $cond: [{ $gte: [{ $add: ['$code_tries', 1] }, 5] }, null, '$code_hash'] },
      },
    }]);
    throw fail(400, 'invalid_code', 'الرمز غير صحيح');
  }

  const id = N(u._id);
  const st = await getSettings();
  // الرمز يُستعمل مرة واحدة: الشرط على code_hash يمنع الاستعمال المزدوج
  const a = await users.updateOne({ _id: u._id, code_hash: u.code_hash },
    { $set: { verified: true, code_hash: null, code_salt: null, code_expires: 0, code_tries: 0 } });
  if (!a.matchedCount) throw fail(400, 'invalid_code', 'الرمز غير صحيح');
  if (!u.verified) {
    if (st.welcomeGold > 0) {
      await users.updateOne({ _id: id }, { $inc: { gold: st.welcomeGold } });
      await hist(id, 'welcome', st.welcomeGold);
    }
    if (u.referred_by && st.referralGold > 0) {
      const rr = await users.updateOne({ _id: N(u.referred_by), banned: false, verified: true }, { $inc: { gold: st.referralGold } });
      if (rr.matchedCount) {
        await hist(N(u.referred_by), 'referral', st.referralGold);
        await users.updateOne({ _id: id }, { $set: { ref_reward: st.referralGold } });
      }
    }
  }
  const acct = await loadAccount(id, ctx);
  return { token: jwtSign({ sub: String(id) }, USER_TOKEN_TTL, 'user'), user: acct.user };
});

add('POST', '/auth/resend', null, async (ctx) => {
  const email = cleanEmail(ctx.body.email);
  if (!email) throw bad('البريد الإلكتروني غير صالح');
  await hit(`rs:ip:${ctx.ip}`, 20, 3600000);
  await hit(`rs:em:${sha1(email)}`, 6, 3600000);
  const users = await C('users');
  const u = await users.findOne({ email }, { projection: { verified: 1, code_sent_at: 1 } });
  if (!u || u.verified) return { success: true }; // لا نكشف وجود الحساب
  if (ctx.now - N(u.code_sent_at) < 60000) throw fail(429, 'rate_limited', 'انتظر دقيقة قبل طلب رمز جديد');
  const c = issueCode();
  await users.updateOne({ _id: u._id, verified: false },
    { $set: { code_hash: c.hash, code_salt: c.salt, code_expires: c.expires, code_tries: 0, code_sent_at: ctx.now } });
  await sendMail(email, c.code);
  return { success: true };
});

add('POST', '/auth/login', null, async (ctx) => {
  const email = cleanEmail(ctx.body.email);
  const password = typeof ctx.body.password === 'string' ? ctx.body.password.slice(0, 200) : '';
  await hit(`lg:ip:${ctx.ip}`, 30, 600000);
  if (email) await hit(`lg:em:${sha1(email)}`, 10, 600000);
  const users = await C('users');
  const u = email ? await users.findOne({ email }, { projection: { password_hash: 1, verified: 1, banned: 1 } }) : null;
  if (!dummyHash) dummyHash = await hashPassword('dummy-password');
  const ok = await verifyPassword(password, u ? u.password_hash : dummyHash); // نفس الزمن سواء وُجد الحساب أم لا
  if (!u || !ok) throw fail(401, 'invalid_credentials', 'البريد أو كلمة المرور غير صحيحة');
  if (!u.verified) throw fail(403, 'not_verified', 'يجب تأكيد البريد الإلكتروني أولًا');
  if (u.banned) throw fail(403, 'banned', 'تم حظر هذا الحساب');
  await users.updateOne({ _id: u._id }, { $set: { last_seen: ctx.now } });
  const acct = await loadAccount(N(u._id), ctx);
  return { token: jwtSign({ sub: String(N(u._id)) }, USER_TOKEN_TTL, 'user'), user: acct.user };
});

/* ---------- المستخدم ---------- */

add('GET', '/user/profile', 'user', async (ctx) => loadAccount(ctx.user.id, ctx));

add('POST', '/user/update', 'user', async (ctx) => {
  const b = ctx.body;
  const name = cleanStr(b.name, 40);
  const bio = cleanStr(b.bio, 150, true);
  if (!name) throw bad('الاسم مطلوب');
  const set = { name, bio };
  if (b.photo !== undefined) {
    if (b.photo === '' || b.photo === null) { set.photo = null; set.photo_v = 0; }
    else {
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.photo === 'string' ? b.photo : '');
      if (!m) throw bad('صيغة الصورة غير مدعومة');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > PHOTO_MAX_BYTES) throw bad('حجم الصورة كبير (الحد 200KB)');
      const magicOk = (m[1] === 'jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
        || (m[1] === 'png' && buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
        || (m[1] === 'webp' && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');
      if (!magicOk) throw bad('ملف الصورة غير صالح');
      set.photo = b.photo; set.photo_v = ctx.now;
    }
  }
  await (await C('users')).updateOne({ _id: ctx.user.id }, { $set: set });
  return { user: (await loadAccount(ctx.user.id, ctx)).user };
});

add('GET', '/user/referrals', 'user', async (ctx) => {
  const rows = await (await C('users')).find({ referred_by: ctx.user.id, verified: true },
    { projection: { name: 1, photo_v: 1, ref_reward: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(500).toArray();
  return { friends: rows.map((f) => ({ name: f.name, username: '', photo_url: photoUrl(ctx.base, N(f._id), f.photo_v), at: N(f.created_at), gold: N(f.ref_reward) })) };
});

add('POST', '/episodes/watch', 'user', async (ctx) => {
  const seriesId = cleanId(ctx.body.seriesId);
  const episode = toInt(ctx.body.episode, 1, 100000, 'رقم الحلقة');
  const [seriesC, episodesC, unlocks, users] = await Promise.all([C('series'), C('episodes'), C('unlocks'), C('users')]);
  const ser = await seriesC.findOne({ _id: seriesId }, { projection: { episodes: 1 } });
  if (!ser || episode > N(ser.episodes)) throw fail(404, 'not_found', 'المسلسل أو الحلقة غير موجودة');
  const link = await episodesC.findOne({ series_id: seriesId, episode });
  if (!link) throw fail(404, 'no_link', 'رابط هذه الحلقة غير متاح بعد');
  const st = await getSettings();
  const u = ctx.user.id;

  let already = true;
  const existing = await unlocks.findOneAndUpdate({ user_id: u, series_id: seriesId, episode }, { $inc: { views: 1 } });
  if (!existing) {
    already = false;
    if (st.price > 0) {
      // الخصم ذرّي: الشرط على الرصيد في نفس جملة التحديث
      const d = await users.updateOne({ _id: u, gold: { $gte: st.price } }, { $inc: { gold: -st.price } });
      if (!d.matchedCount) throw fail(402, 'insufficient', 'رصيدك من الذهب لا يكفي');
    }
    try {
      await unlocks.insertOne({ user_id: u, series_id: seriesId, episode, views: 1, ts: ctx.now });
      if (st.price > 0) await hist(u, 'episode_unlock', -st.price, { seriesId, episode });
    } catch (e) {
      if (!isDup(e)) {
        if (st.price > 0) await users.updateOne({ _id: u }, { $inc: { gold: st.price } }).catch(() => {});
        throw e;
      }
      // طلبان متزامنان: الآخر فتح الحلقة، نُرجع الذهب ونزيد المشاهدات فقط
      if (st.price > 0) await users.updateOne({ _id: u }, { $inc: { gold: st.price } });
      await unlocks.updateOne({ user_id: u, series_id: seriesId, episode }, { $inc: { views: 1 } });
      already = true;
    }
  }
  await users.updateOne({ _id: u }, { $set: { last_series_id: seriesId, last_episode: episode } });
  const acct = await loadAccount(u, ctx);
  return { profile: acct.profile, watchUrl: link.watch_url, alreadyUnlocked: already };
});

add('POST', '/tasks/claim', 'user', async (ctx) => {
  const task = cleanStr(ctx.body.task, 20);
  if (task === 'channel') throw fail(400, 'channel_off', 'هذه المهمة غير متاحة');
  if (task !== 'daily') throw bad('مهمة غير معروفة');
  const st = await getSettings();
  const u = ctx.user.id;
  const a = await (await C('users')).updateOne({ _id: u, next_daily_at: { $lte: ctx.now } },
    { $inc: { gold: st.dailyGold }, $set: { next_daily_at: ctx.now + DAY } });
  if (!a.matchedCount) throw fail(429, 'daily_wait', 'المكافأة اليومية غير جاهزة بعد');
  await hist(u, 'task_daily', st.dailyGold);
  return { profile: (await loadAccount(u, ctx)).profile, reward: st.dailyGold };
});

/* ---------- الإعلانات (Monetag) ---------- */

add('POST', '/ads/start', 'user', async (ctx) => {
  const st = await getSettings();
  const u = await (await C('users')).findOne({ _id: ctx.user.id }, { projection: { ads_today: 1, ads_reset_at: 1, ads_next_at: 1 } });
  let today = N(u.ads_today);
  if (N(u.ads_reset_at) > 0 && N(u.ads_reset_at) <= ctx.now) today = 0;
  if (today >= st.adDailyLimit) throw fail(429, 'ad_limit', 'وصلت للحد اليومي من الإعلانات، يتجدد بعد 24 ساعة');
  if (N(u.ads_next_at) > ctx.now) throw fail(429, 'ad_cooldown', 'انتظر قليلًا قبل مشاهدة إعلان آخر');
  const ticket = crypto.randomBytes(24).toString('hex');
  const ymid = `u${ctx.user.id}_${crypto.randomBytes(6).toString('hex')}`;
  await (await C('ad_tickets')).insertOne({ _id: ticket, user_id: ctx.user.id, ymid, created_at: ctx.now, confirmed: false, claimed: false });
  return { ticket, ymid };
});

add('POST', '/ads/claim', 'user', async (ctx) => {
  const ticket = cleanStr(ctx.body.ticket, 64);
  const u = ctx.user.id;
  const tickets = await C('ad_tickets');
  const t = await tickets.findOne({ _id: ticket, user_id: u });
  if (!t || ctx.now - N(t.created_at) > 30 * 60000) throw fail(404, 'not_found', 'انتهت صلاحية الإعلان، ابدأ من جديد');
  if (t.claimed) throw fail(409, 'conflict', 'تم استلام مكافأة هذا الإعلان سابقًا');
  if (ENV.MONETAG_POSTBACK_SECRET) {
    if (!t.confirmed) return { pending: true, profile: (await loadAccount(u, ctx)).profile };
  } else if (ctx.now - N(t.created_at) < 5000) {
    throw fail(409, 'ad_wait', 'شاهد الإعلان كاملًا أولًا');
  }
  const st = await getSettings();
  const c = await tickets.updateOne({ _id: ticket, user_id: u, claimed: false }, { $set: { claimed: true } });
  if (!c.matchedCount) throw fail(409, 'conflict', 'تم استلام مكافأة هذا الإعلان سابقًا');
  const now = ctx.now;
  const a = await (await C('users')).updateOne(
    { _id: u, ads_next_at: { $lte: now }, $or: [{ ads_reset_at: { $lte: now } }, { ads_today: { $lt: st.adDailyLimit } }] },
    [{
      $set: {
        gold: { $add: ['$gold', st.adGold] },
        ads_today: { $cond: [{ $and: [{ $gt: ['$ads_reset_at', 0] }, { $lte: ['$ads_reset_at', now] }] }, 1, { $add: ['$ads_today', 1] }] },
        ads_reset_at: { $cond: [{ $or: [{ $eq: ['$ads_reset_at', 0] }, { $lte: ['$ads_reset_at', now] }] }, now + DAY, '$ads_reset_at'] },
        ads_next_at: now + st.adCooldownSec * 1000,
      },
    }]);
  if (!a.matchedCount) {
    await tickets.updateOne({ _id: ticket }, { $set: { claimed: false } }); // نُعيد التذكرة لأن المكافأة لم تُمنح
    throw fail(429, 'ad_limit', 'وصلت للحد اليومي من الإعلانات أو أنت ضمن مهلة الانتظار');
  }
  await hist(u, 'ad_reward', st.adGold);
  return { profile: (await loadAccount(u, ctx)).profile, reward: st.adGold };
});

// Postback من Monetag: ضع هذا الرابط في إعدادات المنطقة (يفعَّل بوجود MONETAG_POSTBACK_SECRET)
add('GET', '/ads/postback', null, async (ctx) => {
  if (!ENV.MONETAG_POSTBACK_SECRET || !safeEq(sha(ctx.query.secret || ''), sha(ENV.MONETAG_POSTBACK_SECRET))) throw fail(403, 'forbidden', 'غير مسموح');
  const ymid = cleanStr(ctx.query.ymid, 64);
  const ev = cleanStr(ctx.query.reward_event_type || ctx.query.event_type || 'valued', 30);
  if (ymid && ev === 'valued') await (await C('ad_tickets')).updateMany({ ymid }, { $set: { confirmed: true } });
  return { ok: true };
});

/* ---------- البرومو والتقييم ---------- */

add('POST', '/promo/redeem', 'user', async (ctx) => {
  const code = cleanStr(ctx.body.code, 24).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) throw bad('أدخل الكود');
  await hit(`promo:${ctx.user.id}`, 20, 3600000);
  const u = ctx.user.id;
  const [promos, uses, users] = await Promise.all([C('promos'), C('promo_uses'), C('users')]);
  const p = await promos.findOne({ _id: code });
  if (!p) throw fail(404, 'not_found', 'الكود غير صحيح');
  try {
    await uses.insertOne({ code, user_id: u, ts: ctx.now });
  } catch (e) {
    if (isDup(e)) throw fail(409, 'promo_used', 'لقد استخدمت هذا الكود من قبل');
    throw e;
  }
  const up = await promos.updateOne({ _id: code, $expr: { $lt: ['$used', '$max_uses'] } }, { $inc: { used: 1 } });
  if (!up.matchedCount) {
    await uses.deleteOne({ code, user_id: u });
    throw fail(409, 'promo_exhausted', 'انتهى هذا الكود (اكتمل عدد المستفيدين)');
  }
  await users.updateOne({ _id: u }, { $inc: { gold: N(p.per_user) } });
  await hist(u, 'promo', N(p.per_user), { note: code });
  return { profile: (await loadAccount(u, ctx)).profile, reward: N(p.per_user) };
});

add('POST', '/series/rate', 'user', async (ctx) => {
  const seriesId = cleanId(ctx.body.seriesId);
  const stars = toInt(ctx.body.stars, 1, 5, 'التقييم');
  if (!(await (await C('series')).findOne({ _id: seriesId }, { projection: { _id: 1 } }))) throw fail(404, 'not_found', 'المسلسل غير موجود');
  const ratings = await C('ratings');
  await ratings.updateOne({ user_id: ctx.user.id, series_id: seriesId }, { $set: { stars } }, { upsert: true });
  const rows = await ratings.aggregate([{ $match: { series_id: seriesId } }, { $group: { _id: '$stars', c: { $sum: 1 } } }]).toArray();
  const votes = [0, 0, 0, 0, 0];
  for (const x of rows) { const i = N(x._id) - 1; if (i >= 0 && i < 5) votes[i] = N(x.c); }
  return { votes };
});

/* ════════════════════════════ المشرف ════════════════════════════ */

add('POST', '/admin/login', null, async (ctx) => {
  const email = cleanStr(ctx.body.username, 254).toLowerCase();
  const password = typeof ctx.body.password === 'string' ? ctx.body.password.slice(0, 200) : '';
  await hit(`adm:ip:${ctx.ip}`, 10, 900000);
  await hit('adm:all', 60, 900000);
  const ae = String(ENV.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!ae || !(ENV.ADMIN_PASSWORD_HASH || ENV.ADMIN_PASSWORD)) throw fail(500, 'config', 'لم تُضبط بيانات المشرف في الخادم');
  const stored = ENV.ADMIN_PASSWORD_HASH || adminHashCache || (adminHashCache = await hashPassword(ENV.ADMIN_PASSWORD));
  const okPw = await verifyPassword(password, stored);
  const okEm = safeEq(sha(email), sha(ae));
  if (!okPw || !okEm) throw fail(401, 'admin_auth', 'بيانات الدخول غير صحيحة');
  return { token: jwtSign({ sub: 'admin', role: 'admin' }, ADMIN_TOKEN_TTL, 'admin'), expiresIn: ADMIN_TOKEN_TTL };
});

add('GET', '/admin/stats', 'admin', async (ctx) => {
  const d = ctx.now - DAY;
  const [seriesC, episodesC, usersC, unlocksC] = await Promise.all([C('series'), C('episodes'), C('users'), C('unlocks')]);
  const [a, linked, u, k, top] = await Promise.all([
    seriesC.aggregate([{ $group: { _id: null, series: { $sum: 1 }, episodes: { $sum: '$episodes' } } }]).toArray(),
    episodesC.countDocuments({}),
    usersC.aggregate([
      { $match: { verified: true } },
      {
        $group: {
          _id: null, users: { $sum: 1},
          banned: { $sum: { $cond: ['$banned', 1, 0] } },
          newToday: { $sum: { $cond: [{ $gt: ['$created_at', d] }, 1, 0] } },
          activeToday: { $sum: { $cond: [{ $gt: ['$last_seen', d] }, 1, 0] } },
          gold: { $sum: '$gold' },
        },
      },
    ]).toArray(),
    unlocksC.aggregate([{ $group: { _id: null, unlocks: { $sum: 1 }, views: { $sum: '$views' } } }]).toArray(),
    unlocksC.aggregate([
      { $group: { _id: '$series_id', views: { $sum: '$views' } } },
      { $sort: { views: -1 } }, { $limit: 10 },
      { $lookup: { from: 'series', localField: '_id', foreignField: '_id', as: 's' } },
    ]).toArray(),
  ]);
  const A = a[0] || {}; const U = u[0] || {}; const K = k[0] || {};
  return {
    stats: {
      series: N(A.series), episodes: N(A.episodes), episodesLinked: N(linked),
      users: N(U.users), banned: N(U.banned), newToday: N(U.newToday), activeToday: N(U.activeToday), gold: N(U.gold),
      views: N(K.views), unlocks: N(K.unlocks),
    },
    top: top.filter((x) => x.s && x.s[0]).map((x) => ({ id: x._id, title: x.s[0].title, views: N(x.views) })),
  };
});

/* ---------- المستخدمون ---------- */

const USER_PROJECTION = { photo: 0, password_hash: 0, code_hash: 0, code_salt: 0 };
const mapUserRow = (u, unlocked = 0, views = 0, friends = 0) => ({
  id: N(u._id), name: u.name, username: u.email, email: u.email, gold: N(u.gold), unlocked, views,
  friends, banned: !!u.banned, createdAt: N(u.created_at), lastSeen: N(u.last_seen),
});

async function enrichUsers(rows) {
  const ids = rows.map((u) => u._id);
  const [unlocks, users] = await Promise.all([C('unlocks'), C('users')]);
  const [uk, fr] = await Promise.all([
    unlocks.aggregate([{ $match: { user_id: { $in: ids } } }, { $group: { _id: '$user_id', unlocked: { $sum: 1 }, views: { $sum: '$views' } } }]).toArray(),
    users.aggregate([{ $match: { referred_by: { $in: ids }, verified: true } }, { $group: { _id: '$referred_by', c: { $sum: 1 } } }]).toArray(),
  ]);
  const ukMap = new Map(uk.map((x) => [x._id, x]));
  const frMap = new Map(fr.map((x) => [x._id, N(x.c)]));
  return rows.map((u) => mapUserRow(u, N((ukMap.get(u._id) || {}).unlocked), N((ukMap.get(u._id) || {}).views), frMap.get(u._id) || 0));
}

add('GET', '/admin/users', 'admin', async (ctx) => {
  const users = await C('users');
  if (ctx.query.id) {
    const id = toInt(ctx.query.id, 1, Number.MAX_SAFE_INTEGER, 'المعرّف');
    const u = await users.findOne({ _id: id }, { projection: USER_PROJECTION });
    if (!u) throw fail(404, 'not_found', 'المستخدم غير موجود');
    const [unl, hs, [row]] = await Promise.all([
      (await C('unlocks')).find({ user_id: id }).sort({ series_id: 1, episode: 1 }).toArray(),
      (await C('history')).find({ user_id: id }).sort({ ts: -1, _id: -1 }).limit(50).toArray(),
      enrichUsers([u]),
    ]);
    const titles = new Map((await (await C('series')).find({ _id: { $in: [...new Set(unl.map((x) => x.series_id))] } }, { projection: { title: 1 } }).toArray()).map((s) => [s._id, s.title]));
    const map = new Map();
    for (const x of unl) {
      if (!map.has(x.series_id)) map.set(x.series_id, { seriesId: x.series_id, title: titles.get(x.series_id) || x.series_id, episodes: [] });
      map.get(x.series_id).episodes.push(N(x.episode));
    }
    return { user: { ...row, referralCode: u.referral_code, watched: [...map.values()], history: hs.map((h) => ({ type: h.kind, amount: N(h.amount), note: h.note || '', at: N(h.ts) })) } };
  }

  const filter = { verified: true };
  if (ctx.query.status === 'banned') filter.banned = true;
  const term = cleanStr(ctx.query.q, 80);
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    const or = [{ name: rx }, { email: rx }];
    if (/^\d{1,15}$/.test(term)) or.push({ _id: Number(term) });
    filter.$or = or;
  }
  const total = await users.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, parseInt(ctx.query.page, 10) || 1));
  const skip = (page - 1) * PAGE_SIZE;

  let rows;
  if (ctx.query.sort === 'views') {
    rows = await users.aggregate([
      { $match: filter },
      { $lookup: { from: 'unlocks', let: { uid: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$user_id', '$$uid'] } } }, { $group: { _id: null, v: { $sum: '$views' } } }], as: 'uk' } },
      { $addFields: { vw: { $ifNull: [{ $arrayElemAt: ['$uk.v', 0] }, 0] } } },
      { $sort: { vw: -1, _id: -1 } }, { $skip: skip }, { $limit: PAGE_SIZE },
      { $project: { ...USER_PROJECTION, uk: 0, vw: 0 } },
    ]).toArray();
  } else {
    const sortMap = { joined: { created_at: -1 }, recent: { last_seen: -1 }, gold: { gold: -1 } };
    rows = await users.find(filter, { projection: USER_PROJECTION }).sort({ ...(sortMap[ctx.query.sort] || sortMap.joined), _id: -1 }).skip(skip).limit(PAGE_SIZE).toArray();
  }
  return { users: await enrichUsers(rows), total, page, pages };
});

add('POST', '/admin/users', 'admin', async (ctx) => {
  const b = ctx.body;
  const action = cleanStr(b.action, 20);
  const note = cleanStr(b.note, 80) || null;
  const amountOf = (min) => toInt(b.amount, min, 1000000000, 'المبلغ');
  const users = await C('users');

  if (action === 'gift_all') {
    const a = amountOf(1);
    const ids = (await users.find({ banned: false, verified: true }, { projection: { _id: 1 } }).toArray()).map((x) => x._id);
    const history = await C('history');
    for (let i = 0; i < ids.length; i += 1000) {
      await history.insertMany(ids.slice(i, i + 1000).map((uid) => ({ user_id: uid, kind: 'admin_gift', amount: a, note, series_id: null, episode: null, ts: ctx.now })), { ordered: false });
    }
    const r = await users.updateMany({ banned: false, verified: true }, { $inc: { gold: a } });
    return { success: true, count: r.modifiedCount || 0 };
  }

  const id = toInt(b.id, 1, Number.MAX_SAFE_INTEGER, 'المعرّف');
  if (action === 'add' || action === 'subtract' || action === 'set') {
    const a = amountOf(action === 'set' ? 0 : 1);
    const upd = action === 'add' ? { $add: ['$gold', a] } : action === 'subtract' ? { $max: [0, { $subtract: ['$gold', a] }] } : a;
    const before = await users.findOneAndUpdate({ _id: id }, [{ $set: { gold: upd } }], { returnDocument: 'before', projection: { gold: 1 } });
    if (!before) throw fail(404, 'not_found', 'المستخدم غير موجود');
    const oldG = N(before.gold);
    const newG = action === 'add' ? oldG + a : action === 'subtract' ? Math.max(0, oldG - a) : a;
    if (newG - oldG !== 0) await hist(id, 'admin_adjust', newG - oldG, { note });
    return { gold: newG };
  }
  if (action === 'ban' || action === 'unban') {
    const r = await users.updateOne({ _id: id }, { $set: { banned: action === 'ban' } });
    if (!r.matchedCount) throw fail(404, 'not_found', 'المستخدم غير موجود');
    return { success: true };
  }
  if (action === 'delete') {
    if (!(await users.findOne({ _id: id }, { projection: { _id: 1 } }))) throw fail(404, 'not_found', 'المستخدم غير موجود');
    await Promise.all(['history', 'unlocks', 'ratings', 'promo_uses', 'ad_tickets'].map(async (n) => (await C(n)).deleteMany({ user_id: id })));
    await users.updateMany({ referred_by: id }, { $set: { referred_by: null } });
    await users.deleteOne({ _id: id });
    return { success: true };
  }
  throw bad('إجراء غير معروف');
});

/* ---------- المسلسلات ---------- */

async function addNotification(kind, seriesId, title, image, episode, count) {
  await (await C('notifications')).insertOne({ _id: rid('n'), kind, series_id: seriesId, episode, cnt: count, title, image, created_at: Date.now() });
}
function cleanI18n(v) {
  const out = {};
  for (const lang of ['en', 'fr']) {
    const o = v && typeof v === 'object' ? v[lang] : null;
    if (!o || typeof o !== 'object') continue;
    const title = cleanStr(o.title, 200); const description = cleanStr(o.description, 2000, true);
    if (title || description) out[lang] = { title, description };
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

add('GET', '/admin/series', 'admin', async () => {
  const [seriesC, episodesC, unlocksC] = await Promise.all([C('series'), C('episodes'), C('unlocks')]);
  const [rows, eps, views] = await Promise.all([
    seriesC.find({}, { projection: { image_data: 0 } }).sort({ created_at: -1, _id: 1 }).toArray(),
    episodesC.find({}, { projection: { series_id: 1, episode: 1 } }).sort({ series_id: 1, episode: 1 }).toArray(),
    unlocksC.aggregate([{ $group: { _id: '$series_id', v: { $sum: '$views' } } }]).toArray(),
  ]);
  const linked = {};
  for (const e of eps) (linked[e.series_id] || (linked[e.series_id] = [])).push(N(e.episode));
  const vmap = new Map(views.map((x) => [x._id, N(x.v)]));
  return { series: rows.map((x) => ({ ...mapSeries(x), views: vmap.get(x._id) || 0, linked: linked[x._id] || [] })) };
});

add('POST', '/admin/series', 'admin', async (ctx) => {
  const b = ctx.body;
  const title = cleanStr(b.title, 200);
  if (!title) throw bad('اسم المسلسل مطلوب');
  const f = {
    title,
    category: cleanStr(b.category || 'drama', 30).toLowerCase() || 'drama',
    yr: cleanStr(b.year, 10), rating: cleanStr(b.rating, 10),
    tag: cleanStr(b.tag, 40),
    description: cleanStr(b.description, 2000, true),
    episodes: toInt(b.episodes, 1, 5000, 'عدد الحلقات'),
    i18n: cleanI18n(b.i18n),
  };
  const seriesC = await C('series');
  let id = b.id ? cleanId(b.id) : '';
  const exists = id ? !!(await seriesC.findOne({ _id: id }, { projection: { _id: 1 } })) : false;
  if (!id) id = rid('s');

  // صورة الغلاف: إمّا رفع من الهاتف (data:image) فتُخزَّن في القاعدة وتُخدَم من /api/series/image، أو رابط http(s)
  const imgIn = typeof b.image === 'string' ? b.image.trim() : '';
  let imageData = null;
  if (/^data:/i.test(imgIn)) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imgIn);
    if (!m) throw bad('صيغة الصورة غير مدعومة');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > SERIES_IMG_MAX_BYTES) throw bad('حجم الصورة كبير (الحد 300KB)');
    const magicOk = (m[1] === 'jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
      || (m[1] === 'png' && buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
      || (m[1] === 'webp' && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');
    if (!magicOk) throw bad('ملف الصورة غير صالح');
    imageData = imgIn;
    f.image = `${ctx.base}/api/series/image?id=${id}&v=${ctx.now}`;
  } else if (imgIn && imgIn.includes(`/api/series/image?id=${id}`)) {
    f.image = null; // الصورة المرفوعة نفسها دون تغيير
  } else {
    f.image = cleanUrl(imgIn);
  }
  if (!exists && !f.image) throw bad('صورة الغلاف مطلوبة');
  const unsetImg = {};
  if (imageData) f.image_data = imageData;
  else if (f.image) unsetImg.image_data = ''; // تحوّل إلى رابط خارجي: نحذف الصورة المخزّنة
  if (f.image === null) delete f.image;

  if (exists) {
    await seriesC.updateOne({ _id: id }, { $set: f, ...(Object.keys(unsetImg).length ? { $unset: unsetImg } : {}) });
    await (await C('episodes')).deleteMany({ series_id: id, episode: { $gt: f.episodes } });
  } else {
    await seriesC.insertOne({ _id: id, ...f, created_at: ctx.now });
    if (b.notify !== false) await addNotification('series', id, title, f.image || '', 0, 1);
  }
  return { success: true, series: { id, title: f.title, category: f.category, year: f.yr, rating: f.rating, image: f.image || '', tag: f.tag, description: f.description, episodes: f.episodes, i18n: parseJson(f.i18n, {}) } };
});

add('DELETE', '/admin/series', 'admin', async (ctx) => {
  const id = cleanId(ctx.body.id);
  const r = await (await C('series')).deleteOne({ _id: id });
  if (!r.deletedCount) throw fail(404, 'not_found', 'المسلسل غير موجود');
  await Promise.all([
    (await C('episodes')).deleteMany({ series_id: id }),
    (await C('stories')).deleteMany({ series_id: id }),
    (await C('ratings')).deleteMany({ series_id: id }),
    (await C('unlocks')).deleteMany({ series_id: id }),
    (await C('notifications')).deleteMany({ series_id: id }),
  ]);
  return { success: true };
});

/* ---------- الحلقات ---------- */

add('POST', '/admin/episodes', 'admin', async (ctx) => {
  const b = ctx.body;
  const seriesId = cleanId(b.seriesId);
  const ser = await (await C('series')).findOne({ _id: seriesId }, { projection: { title: 1, image: 1, episodes: 1 } });
  if (!ser) throw fail(404, 'not_found', 'المسلسل غير موجود');

  let items;
  if (Array.isArray(b.urls)) {
    const start = toInt(b.start, 1, 100000, 'رقم الحلقة');
    if (b.urls.length < 1 || b.urls.length > 300) throw bad('عدد الروابط يجب أن يكون بين 1 و300');
    items = b.urls.map((u, i) => ({ episode: start + i, url: cleanUrl(u) }));
  } else {
    items = [{ episode: toInt(b.episode, 1, 100000, 'رقم الحلقة'), url: cleanUrl(b.watchUrl) }];
  }
  const maxEp = Math.max(...items.map((x) => x.episode));
  if (maxEp > N(ser.episodes)) throw bad(`عدد حلقات هذا المسلسل ${N(ser.episodes)} فقط`);

  const res = await (await C('episodes')).bulkWrite(items.map((it) => ({
    updateOne: {
      filter: { series_id: seriesId, episode: it.episode },
      update: { $set: { watch_url: it.url }, $setOnInsert: { created_at: ctx.now } },
      upsert: true,
    },
  })), { ordered: true });
  const inserted = Object.keys(res.upsertedIds || {}).map((i) => items[Number(i)].episode);
  if (b.notify !== false && inserted.length) await addNotification('episode', seriesId, ser.title, ser.image, Math.min(...inserted), inserted.length);
  return { success: true, saved: items.length };
});

add('DELETE', '/admin/episodes', 'admin', async (ctx) => {
  await (await C('episodes')).deleteOne({ series_id: cleanId(ctx.body.seriesId), episode: toInt(ctx.body.episode, 1, 100000, 'رقم الحلقة') });
  return { success: true };
});

/* ---------- القصص ---------- */

add('GET', '/admin/stories', 'admin', async () => {
  const rows = await (await C('stories')).find({}).sort({ created_at: -1 }).toArray();
  return { stories: rows.map((s) => ({ id: s._id, title: s.title, image: s.image, text: s.body || '', seriesId: s.series_id || '', expiresAt: N(s.expires_at), createdAt: N(s.created_at) })) };
});

add('POST', '/admin/stories', 'admin', async (ctx) => {
  const b = ctx.body;
  const title = cleanStr(b.title, 100);
  if (!title) throw bad('عنوان القصة مطلوب');
  const image = cleanUrl(b.image);
  const text = cleanStr(b.text, 200);
  const hours = toInt(b.hours === undefined || b.hours === '' ? 24 : b.hours, 0, 720, 'المدة');
  let seriesId = null;
  if (b.seriesId) {
    seriesId = cleanId(b.seriesId);
    if (!(await (await C('series')).findOne({ _id: seriesId }, { projection: { _id: 1 } }))) throw bad('المسلسل المرتبط غير موجود');
  }
  const id = rid('t');
  const expiresAt = hours > 0 ? ctx.now + hours * 3600000 : 0;
  await (await C('stories')).insertOne({ _id: id, title, image, body: text, series_id: seriesId, expires_at: expiresAt, created_at: ctx.now });
  return { success: true, story: { id, title, image, text, seriesId: seriesId || '', expiresAt } };
});

add('DELETE', '/admin/stories', 'admin', async (ctx) => {
  await (await C('stories')).deleteOne({ _id: cleanId(ctx.body.id) });
  return { success: true };
});

/* ---------- أكواد البرومو ---------- */

add('GET', '/admin/promos', 'admin', async () => {
  const rows = await (await C('promos')).find({}).sort({ created_at: -1 }).toArray();
  return { promos: rows.map((p) => ({ code: p._id, totalGold: N(p.total_gold), maxUses: N(p.max_uses), perUser: N(p.per_user), used: N(p.used), createdAt: N(p.created_at) })) };
});

add('POST', '/admin/promos', 'admin', async (ctx) => {
  const b = ctx.body;
  const totalGold = toInt(b.totalGold, 1, 10000000, 'إجمالي الذهب');
  const maxUses = toInt(b.maxUses, 1, 100000, 'عدد المستفيدين');
  const perUser = toInt(b.perUser, 1, 10000000, 'نصيب الشخص');
  if (perUser * maxUses > totalGold) throw bad('مجموع الموزَّع أكبر من الإجمالي');
  let code = cleanStr(b.code, 24).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (code && code.length < 3) throw bad('الكود يجب ألا يقل عن 3 أحرف');
  if (!code) { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; code = 'DAKOS'; for (let i = 0; i < 6; i++) code += A[crypto.randomInt(0, A.length)]; }
  try {
    await (await C('promos')).insertOne({ _id: code, total_gold: totalGold, max_uses: maxUses, per_user: perUser, used: 0, created_at: ctx.now });
  } catch (e) { if (isDup(e)) throw fail(409, 'conflict', 'هذا الكود موجود مسبقًا'); throw e; }
  return { success: true, promo: { code, totalGold, maxUses, perUser, used: 0, createdAt: ctx.now } };
});

add('DELETE', '/admin/promos', 'admin', async (ctx) => {
  const code = cleanStr(ctx.body.code, 24).toUpperCase();
  await (await C('promo_uses')).deleteMany({ code });
  await (await C('promos')).deleteOne({ _id: code });
  return { success: true };
});

/* ---------- الإعدادات ---------- */

add('GET', '/admin/settings', 'admin', async () => ({ settings: await getSettings() }));

add('POST', '/admin/settings', 'admin', async (ctx) => {
  const entries = [];
  for (const [k, [, min, max]] of Object.entries(SETTING_DEFS)) {
    if (ctx.body[k] === undefined || ctx.body[k] === '') continue;
    entries.push([k, toInt(ctx.body[k], min, max, k)]);
  }
  const col = await C('settings');
  for (const [k, v] of entries) await col.updateOne({ _id: k }, { $set: { v: String(v) } }, { upsert: true });
  return { settings: await getSettings() };
});

// الإرسال عبر بوت تيليجرام أُزيل مع الدخول بالبريد؛ المسار باقٍ للتوافق مع لوحة الإدارة فقط
add('POST', '/admin/notifications/push', 'admin', async () => ({ done: true, sent: 0, blocked: 0, failed: 0 }));

/* ════════════════════════════ المعالج الرئيسي ════════════════════════════ */

const ORIGINS = new Set(['https://localhost', 'capacitor://localhost', 'http://localhost',
  ...String(ENV.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);

function applyCors(req, res) {
  res.setHeader('Vary', 'Origin');
  const o = req.headers.origin;
  if (o && ORIGINS.has(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}
function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return {};
  let b = req.body;
  if (b === undefined || b === null) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw fail(413, 'bad_request', 'حجم الطلب كبير'); chunks.push(c); }
    b = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    if (b.length > MAX_BODY) throw fail(413, 'bad_request', 'حجم الطلب كبير');
    if (!b.trim()) return {};
    try { b = JSON.parse(b); } catch { throw bad('صيغة JSON غير صالحة'); }
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('جسم الطلب غير صالح');
  return b;
}
function clientIp(req) {
  const h = req.headers;
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || 'unknown').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = url.pathname.replace(/^\/api(?=\/|$)/, '').replace(/\/+$/, '') || '/';
    if (path === '/index') path = '/';
    const route = routes.get(`${req.method} ${path}`);
    if (!route) throw fail(404, 'not_found', 'المسار غير موجود');

    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const ctx = {
      req, res, now: Date.now(), ip: clientIp(req),
      query: Object.fromEntries(url.searchParams), body: await readBody(req),
      base: String(ENV.PUBLIC_URL || (host ? `https://${host}` : '')).replace(/\/+$/, ''),
      rawSent: false,
      raw(status, headers, buf) {
        res.statusCode = status;
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
        res.end(buf); this.rawSent = true;
      },
    };
    await ensureReady();
    if (route.auth === 'user') ctx.user = await requireUser(ctx);
    else if (route.auth === 'admin') ctx.admin = await requireAdmin(ctx);
    const out = await route.fn(ctx);
    if (!ctx.rawSent) send(res, 200, out === undefined ? { success: true } : out);
  } catch (e) {
    if (e instanceof HttpError) {
      send(res, e.status, { success: false, code: e.code, message: e.message });
    } else {
      console.error('server_error:', e && e.stack || e);
      const dbDown = isDbDown(e);
      send(res, dbDown ? 503 : 500, { success: false, code: dbDown ? 'db_unavailable' : 'server_error', message: dbDown ? 'قاعدة البيانات غير متاحة حاليًا، حاول بعد قليل' : 'حدث خطأ في الخادم' });
    }
  }
};
