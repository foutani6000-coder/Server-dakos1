#!/usr/bin/env node
'use strict';
/*
 ╔══════════════════════════════════════════════════════════════════════════╗
 ║  Sedhok — server.js  (خادم تطبيق Sedhok + لوحة الأدمن)                    ║
 ║  ملف واحد، بدون أي اعتماديات (Node 18+ فقط)، يعمل على Termux وأي استضافة.  ║
 ╚══════════════════════════════════════════════════════════════════════════╝

 التشغيل:   node server.js
 لوحة الأدمن (متصفح):   http://127.0.0.1:3000/admin     (admin / admin123 — غيّرها فوراً)

 متغيرات البيئة (كلها اختيارية):
   PORT=3000  HOST=0.0.0.0  DATA_DIR=./data  PUBLIC_URL=https://example.com
   ADMIN_USER=admin  ADMIN_PASS=admin123      (تُستعمل أول تشغيل فقط، ثم تُحفظ مُشفّرة)
   API_KEY=            (إن وُضع: كل طلب يجب أن يحمل توكن مستخدم أو Bearer API_KEY)
   GOOGLE_CLIENT_ID=   (للتحقق من id_token في /auth/google؛ بدونه يُرفض الدخول بـ Google)
   FACEBOOK_APP_ID=  FACEBOOK_APP_SECRET=   (اختياريان: يتحقق /auth/facebook أن الرمز صادر لتطبيقك ويسمح بربط الحساب بالبريد)
   SEED_DEMO=1         (يملأ قاعدة البيانات الفارغة بـ 10 مسلسلات تجريبية)
   COUNT_VIEWS=1       (زيادة مشاهدات المسلسل عند فتح حلقاته؛ 0 لإيقافه)
   MAX_UPLOAD_MB=8     CORS_ORIGIN=*     ALLOW_REGISTER=1

 قاعدة البيانات (Neon Postgres — اختيارية لكنها لازمة على Vercel وRailway بدون Volume):
   DATABASE_URL=postgresql://USER:PASS@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
        (من لوحة Neon: Connect ← انسخ Connection string ← الـ Pooled connection). بدون هذا المتغيّر تُحفظ البيانات في DATA_DIR/data.json.
        يُنشئ الخادم جدولَين تلقائياً (sedhok_kv و sedhok_files) ويتصل عبر Neon HTTP، فلا يحتاج أي حزمة npm.
        إن وُجد data.json محلي والقاعدة فارغة يُستورد تلقائياً أول تشغيل.

 النشر على Railway:   New Project ← Deploy from GitHub (أو Railway CLI: railway up) ← Variables: DATABASE_URL, ADMIN_PASS, (اختياري API_KEY)
        الأمر: node server.js (موجود في package.json و railway.json). المنفذ PORT يضبطه Railway، والمسار /health للفحص.
        الرابط العام يُلتقط تلقائياً من RAILWAY_PUBLIC_DOMAIN (أو اضبط PUBLIC_URL).

 النشر على Vercel:    vercel --prod  (يستعمل vercel.json: server.js كدالة Serverless تستقبل كل المسارات) ← Environment Variables: DATABASE_URL, ADMIN_PASS
        ملاحظات: حدّ حجم الطلب في Vercel هو 4.5MB (رفع الصور ≤ 4MB). Railway أنسب للحمل الكبير لأنه يعمل كعملية واحدة دائمة.
        على Vercel يُعاد تحميل البيانات من Neon عند تغيّر نسختها، ويُنتظر حفظ كل تعديل قبل إرسال الردّ.

 توزيع المهام بين Railway وVercel (اختياري، يُفعَّل بضبط PEER_URL):
   SERVER_ROLE=light|heavy|both   (يُكتشف تلقائياً: Vercel = heavy، Railway = light؛ both = بلا توزيع)
   PEER_URL=https://رابط-السيرفر-الآخر   (على Railway ضع رابط Vercel، وعلى Vercel ضع رابط Railway)
        - السيرفر الخفيف (Railway) يحوّل المهام الثقيلة (رفع الصور، /search، /catalog، /genres، /home، /library/sync،
          /series/:id/episodes، وكل مسارات /admin) إلى السيرفر الثقيل (Vercel)، ويعالج الباقي بنفسه.
        - إن تعطّل الثقيل (انقطاع/مهلة/5xx) يُعلَّم متعطّلاً 45 ثانية ويتولى الخفيف مهامه فوراً، ثم يُجرَّب من جديد فإذا عاد رجعت إليه المهام.
        - السيرفر الثقيل يعالج كل ما يصله بنفسه (فيتولى المهام الخفيفة إن تعطّل الخفيف، لأن التطبيق يحوّلها إليه).
        - طلبات الكتابة لا تُعاد محلياً إلا عند فشل الاتصال كلياً بالسيرفر الآخر، منعاً للتنفيذ المزدوج.
        - السيرفران يشتركان في قاعدة Neon نفسها (نفس DATABASE_URL) فلا تضيع أي بيانات.

 ربط التطبيق:  API_BASE_URL في build_config.json = رابط هذا الخادم (يُقبل أيضاً مع بادئة /api).

 فهرس المسارات (من الأصغر إلى الأكبر) — التفصيل في الأقسام أدناه:
  [1]  النظام:        GET /  /health  /config   +   /uploads/*
  [2]  الحساب:        POST /auth/{register,login,google,forgot-password,reset-password}
                      GET|POST /users/me      GET /users/:id
  [3]  الكتالوج:      GET /home  /search  /catalog/:section  /genres/:genre
                      GET /series  /series/:id  /series/:id/{episodes,related}
                      POST /series/:id/rating
  [4]  التعليقات:     GET|POST /series/:id/comments  /series/:id/episodes/:key/comments
                      POST .../comments/:cid/like
  [5]  الأخبار والإشعارات: GET /news  /news/:id  /notifications
  [6]  المكتبة:       GET /library   POST /library/{sync,lists,lists/:id/items}
  [7]  المنشورات:     GET|POST /posts   POST /posts/:id/{react,vote}   GET|POST /posts/:id/comments
  [8]  المحادثات:     GET|POST /chats   GET|POST /chats/:id/messages
  [9]  المجموعات:     /groups ... (إنشاء/انضمام/أدوار/رسائل)
  [11] التواصل:       POST /auth/facebook   GET|POST /users/me/{privacy,about}   /friends/*   /users/:id/{friends,followers,following,follow,unfollow}
                      POST /posts/:id/{edit,delete}  /posts|series/.../comments/:cid/{react,edit,delete}   POST /activity/{heartbeat,events}  /watch/progress
  [10] الأدمن:        POST /admin/login  +  /admin/* (أعمال، حلقات، رئيسية، أخبار، منشورات،
                      تعليقات، أعضاء، إشعارات، مجموعات، إعدادات، نسخ احتياطي، رفع صور)  +  GET /admin (اللوحة)
*/

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ════════════════════════════════════════════════════════════════════════
//  الإعدادات
// ════════════════════════════════════════════════════════════════════════
const ENV = process.env;
const PORT = parseInt(ENV.PORT || '3000', 10);
const HOST = ENV.HOST || '0.0.0.0';
const DATABASE_URL = ENV.DATABASE_URL || ENV.POSTGRES_URL || ENV.NEON_DATABASE_URL || '';
const PG = !!DATABASE_URL; // true = كل البيانات والصور في Neon Postgres
const SERVERLESS = !!(ENV.VERCEL || ENV.AWS_LAMBDA_FUNCTION_NAME || ENV.SERVERLESS === '1');
const DATA_DIR = path.resolve(ENV.DATA_DIR || ENV.RAILWAY_VOLUME_MOUNT_PATH || (SERVERLESS ? path.join(require('os').tmpdir(), 'sedhok-data') : path.join(__dirname, 'data')));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC_URL = (ENV.PUBLIC_URL
  || (ENV.RAILWAY_PUBLIC_DOMAIN ? 'https://' + ENV.RAILWAY_PUBLIC_DOMAIN : '')
  || (ENV.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + ENV.VERCEL_PROJECT_PRODUCTION_URL : '')).replace(/\/+$/, '');
const API_KEY = ENV.API_KEY || '';
const GOOGLE_CLIENT_ID = ENV.GOOGLE_CLIENT_ID || '';
const FB_APP_ID = ENV.FACEBOOK_APP_ID || '';
const FB_APP_SECRET = ENV.FACEBOOK_APP_SECRET || '';
const COUNT_VIEWS = ENV.COUNT_VIEWS !== '0';
const ALLOW_REGISTER = ENV.ALLOW_REGISTER !== '0';
const MAX_UPLOAD = Math.max(1, parseFloat(ENV.MAX_UPLOAD_MB || (PG ? '4' : '8'))) * 1024 * 1024; // في Neon/Vercel الحدّ العملي ~4MB
const MAX_JSON = 6 * 1024 * 1024;
const CORS_ORIGIN = ENV.CORS_ORIGIN || '*';
const TOKEN_TTL_USER = 10 * 365 * 24 * 3600 * 1000; // ~10 سنوات: لا تنتهي الجلسة إلا بتسجيل الخروج من التطبيق
const TOKEN_TTL_ADMIN = 12 * 3600 * 1000; // 12 ساعة
const NEW_EPISODE_DAYS = 14; // نافذة إشعارات «حلقة جديدة»

// ───────── توزيع المهام بين سيرفرين (Railway خفيف + Vercel ثقيل) ─────────
const SERVER_ROLE = (() => {
  const r = String(ENV.SERVER_ROLE || '').toLowerCase();
  if (['light', 'heavy', 'both'].includes(r)) return r;
  if (ENV.VERCEL) return 'heavy';
  if (ENV.RAILWAY_ENVIRONMENT || ENV.RAILWAY_PUBLIC_DOMAIN || ENV.RAILWAY_PROJECT_ID) return 'light';
  return 'both';
})();
const PEER_URL = (ENV.PEER_URL || '').trim().replace(/\/+$/, '');
const PEER_COOLDOWN = parseInt(ENV.PEER_COOLDOWN_MS || '45000', 10);   // مدة اعتبار السيرفر الآخر متعطّلاً قبل تجربته من جديد
const PEER_TIMEOUT = 25 * 1000;
const HEAVY_PREFIXES = ['/admin', '/search', '/catalog', '/genres', '/library/sync', '/home'];

if (!PG) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ════════════════════════════════════════════════════════════════════════
//  أدوات عامة
// ════════════════════════════════════════════════════════════════════════
const now = () => Date.now();
const uid = (p) => p + '_' + now().toString(36) + crypto.randomBytes(4).toString('hex');
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const str = (v, max = 5000) => (v == null ? '' : String(v)).trim().slice(0, max);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const toInt = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const toNum = (v, d = 0) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : d; };
const bool = (v, d = false) => (v === undefined || v === null || v === '' ? d : v === true || v === 'true' || v === '1' || v === 1 || v === 'on');
const uniq = (a) => [...new Set(a)];
const qHeight = (q) => toInt(String(q).replace(/[^0-9]/g, ''), 0);
const pad2 = (n) => String(n).padStart(2, '0');
const dateLabel = (t) => { const d = new Date(t); return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()); };

/** قائمة نصوص من مصفوفة أو نص مفصول بفاصلة/سطر (يقبل ، أيضاً) */
function strList(v) {
  if (Array.isArray(v)) return uniq(v.map((e) => (isObj(e) ? str(e.name || e.title || '') : str(e))).filter(Boolean));
  if (typeof v === 'string') return uniq(v.split(/[,،\n]/).map((e) => e.trim()).filter(Boolean));
  return [];
}

/** وقت نسبي بالعربية كما يعرضه التطبيق (النص يُعرض كما هو) */
function rel(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((now() - ts) / 1000));
  if (s < 45) return 'الآن';
  const m = Math.floor(s / 60);
  if (m < 2) return 'قبل دقيقة';
  if (m < 3) return 'قبل دقيقتين';
  if (m < 11) return 'قبل ' + m + ' دقائق';
  if (m < 60) return 'قبل ' + m + ' دقيقة';
  const h = Math.floor(m / 60);
  if (h < 2) return 'قبل ساعة';
  if (h < 3) return 'قبل ساعتين';
  if (h < 11) return 'قبل ' + h + ' ساعات';
  if (h < 24) return 'قبل ' + h + ' ساعة';
  const d = Math.floor(h / 24);
  if (d < 2) return 'أمس';
  if (d < 3) return 'قبل يومين';
  if (d < 11) return 'قبل ' + d + ' أيام';
  return dateLabel(ts);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m || 'طلب غير صالح');
const unauthorized = (m) => new HttpError(401, m || 'يلزم تسجيل الدخول');
const forbidden = (m) => new HttpError(403, m || 'غير مسموح');
const notFound = (m) => new HttpError(404, m || 'غير موجود');
const conflict = (m) => new HttpError(409, m || 'تعارض');

// ════════════════════════════════════════════════════════════════════════
//  التشفير والتوكنات
// ════════════════════════════════════════════════════════════════════════
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return salt + ':' + h;
}
function checkPassword(pw, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const x = crypto.scryptSync(String(pw), salt, 32);
  const y = Buffer.from(h, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const b64u = (b) => Buffer.from(b).toString('base64url');
function signToken(payload, ttl) {
  const body = b64u(JSON.stringify({ ...payload, exp: now() + ttl }));
  const sig = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(tok) {
  if (!tok || typeof tok !== 'string' || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const exp = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  const a = Buffer.from(sig || ''); const b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > now() ? p : null;
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════
//  قاعدة البيانات (ملف JSON بحفظ ذري)
// ════════════════════════════════════════════════════════════════════════
const DEFAULT_TYPES = ['مسلسل عربي', 'مسلسل تركي', 'مسلسل أجنبي', 'مسلسل كوري'];
const DEFAULT_GENRES = ['دراما', 'إثارة', 'تاريخي', 'رومانسي', 'انتقام', 'غموض', 'جريمة', 'خيال علمي', 'أكشن', 'كوميديا', 'عائلي', 'فانتازيا', 'رعب', 'مغامرات'];
const DEFAULT_COUNTRIES = ['السعودية', 'مصر', 'لبنان', 'سوريا', 'الكويت', 'الإمارات', 'تركيا', 'الولايات المتحدة', 'المملكة المتحدة', 'كوريا الجنوبية', 'اليابان', 'فرنسا'];
const QUALITY_OPTIONS = ['144p', '320p', '720p', '1080p'];
const STATUS_OPTIONS = ['مستمر', 'مكتمل', 'متوقف'];
const HOME_SECTIONS = {
  hero: 'الهيرو (الأعمال المميّزة)', moods: 'شرائح التصنيفات', continue: 'أكمل المشاهدة', top10: 'أفضل 10',
  types: 'صفوف الأنواع', discover: 'بانر الاكتشاف', suggestions: 'اقتراحات لك', latest: 'أحدث الحلقات', genres: 'صفوف التصنيفات',
};
const BADGES = ['none', 'purple', 'blue', 'yellow'];
const REACTIONS = ['like', 'love', 'laugh', 'wow', 'sad'];

function emptyDb() {
  return {
    v: 1,
    secret: crypto.randomBytes(32).toString('hex'),
    admin: { user: ENV.ADMIN_USER || 'admin', pass: hashPassword(ENV.ADMIN_PASS || 'admin123'), default_pass: !ENV.ADMIN_PASS },
    settings: {
      types: DEFAULT_TYPES.slice(), genres: DEFAULT_GENRES.slice(), countries: DEFAULT_COUNTRIES.slice(),
      adblock: true, announcement: { on: false, text: '' }, sections: {}, featured: [], hidden: [],
    },
    series: [], episodes: {}, news: [], posts: [], comments: [], users: [], ratings: {}, libraries: {},
    broadcasts: [], chats: [], groups: [], resets: {},
    friendships: [], friend_requests: [], follows: [], watch: {}, activity: { seen: {}, events: [] },
  };
}

let db = emptyDb();
let saveTimer = null;
let dirty = false;

// ───────── Neon Postgres عبر HTTP (بدون أي اعتماديات) ─────────
let PG_HTTP = '';
if (PG) {
  try { PG_HTTP = ENV.NEON_HTTP_URL || ('https://' + new URL(DATABASE_URL).hostname + '/sql'); } catch { console.error('⚠ DATABASE_URL غير صالح'); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pgQuery(query, params = []) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(PG_HTTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': DATABASE_URL },
        body: JSON.stringify({ query, params }),
        signal: AbortSignal.timeout(25000),
      });
      const txt = await r.text(); let j = null;
      try { j = JSON.parse(txt); } catch { /* ignore */ }
      if (!r.ok) { const e = new Error('Neon ' + r.status + ': ' + ((j && j.message) || txt.slice(0, 200))); e.status = r.status; throw e; }
      return j || { rows: [] };
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429) break; // خطأ دائم (SQL/صلاحيات): لا إعادة
      await sleep(500 * (i + 1)); // Neon قد يكون «نائماً»: ننتظر ونعيد
    }
  }
  throw lastErr;
}
let pgReady = null;
function pgInit() {
  if (!pgReady) {
    pgReady = (async () => {
      await pgQuery('create table if not exists sedhok_kv (k text primary key, v text not null, ver bigint not null default 1, updated_at timestamptz not null default now())');
      await pgQuery('create table if not exists sedhok_files (name text primary key, mime text, data text not null, created_at timestamptz not null default now())');
    })().catch((e) => { pgReady = null; throw e; });
  }
  return pgReady;
}
let pgVer = 0; // نسخة صف البيانات التي حمّلناها/حفظناها آخر مرة

/** عمليات في الخلفية (رفع/حذف صور في Neon) — على Vercel يُنتظر اكتمالها قبل إرسال الردّ */
const pending = new Set();
function track(p) {
  const q = p.catch((e) => console.error('⚠ عملية قاعدة بيانات فشلت:', e.message));
  pending.add(q); q.finally(() => pending.delete(q));
  return q;
}

// ───────── ملفات الصور: قرص محلي أو Neon ─────────
const fileCache = new Map();
function cacheFile(name, buf) { fileCache.set(name, buf); if (fileCache.size > 60) fileCache.delete(fileCache.keys().next().value); }
function filePut(name, buf, mime) {
  if (!PG) { fs.writeFileSync(path.join(UPLOAD_DIR, name), buf); return; }
  cacheFile(name, buf);
  track(pgInit().then(() => pgQuery('insert into sedhok_files (name, mime, data) values ($1, $2, $3) on conflict (name) do update set data = excluded.data, mime = excluded.mime', [name, mime || '', buf.toString('base64')])));
}
async function fileGet(name) {
  if (!PG) { const fp = path.join(UPLOAD_DIR, name); return fp.startsWith(UPLOAD_DIR) && fs.existsSync(fp) ? fs.readFileSync(fp) : null; }
  if (fileCache.has(name)) return fileCache.get(name);
  await pgInit();
  const r = await pgQuery('select data from sedhok_files where name = $1', [name]);
  const row = r.rows && r.rows[0];
  if (!row) return null;
  const buf = Buffer.from(row.data, 'base64'); cacheFile(name, buf);
  return buf;
}
function fileDel(name) {
  if (!PG) { try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch { /* ignore */ } return; }
  fileCache.delete(name);
  track(pgInit().then(() => pgQuery('delete from sedhok_files where name = $1', [name])));
}
async function fileNames() {
  if (!PG) { try { return fs.readdirSync(UPLOAD_DIR); } catch { return []; } }
  await pgInit();
  const r = await pgQuery('select name from sedhok_files');
  return (r.rows || []).map((x) => x.name);
}

// ───────── تحميل وحفظ البيانات ─────────
function normalizeDb(fresh) {
  db.settings = Object.assign(emptyDb().settings, db.settings || {});
  for (const k of ['series', 'news', 'posts', 'comments', 'users', 'broadcasts', 'chats', 'groups', 'friendships', 'friend_requests', 'follows']) if (!Array.isArray(db[k])) db[k] = [];
  for (const k of ['episodes', 'ratings', 'libraries', 'resets', 'watch']) if (!isObj(db[k])) db[k] = {};
  if (!isObj(db.activity)) db.activity = {};
  if (!isObj(db.activity.seen)) db.activity.seen = {};
  if (!Array.isArray(db.activity.events)) db.activity.events = [];
  if (!db.secret) db.secret = crypto.randomBytes(32).toString('hex');
  if (fresh && ENV.SEED_DEMO === '1') seedDemo();
  ensureTeamUser();
}
async function readDbRow() {
  await pgInit();
  const r = await pgQuery('select v, ver from sedhok_kv where k = $1', ['db']);
  const row = r.rows && r.rows[0];
  return row ? { j: JSON.parse(row.v), ver: Number(row.ver) } : null;
}
async function loadDb() {
  let fresh = true;
  try {
    if (PG) {
      // خطأ هنا (شبكة/صلاحيات) يوقف التشغيل عمداً: لا نبدأ بقاعدة فارغة فنكتب فوق بيانات حقيقية
      const row = await readDbRow();
      if (row && isObj(row.j)) { db = Object.assign(emptyDb(), row.j); pgVer = row.ver; fresh = false; }
      else {
        // القاعدة فارغة: استورد data.json المحلي إن وُجد (انتقال من Termux/استضافة قديمة)
        try { const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); if (isObj(j)) { db = Object.assign(emptyDb(), j); fresh = false; console.log('  استيراد data.json المحلي إلى Neon'); } } catch { /* لا ملف */ }
      }
    } else {
      const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (isObj(j)) { db = Object.assign(emptyDb(), j); fresh = false; }
    }
  } catch (e) {
    if (PG) throw new Error('تعذّر الاتصال بقاعدة Neon: ' + e.message);
    if (e.code !== 'ENOENT') {
      try { fs.copyFileSync(DB_FILE, DB_FILE + '.corrupt-' + now()); } catch { /* ignore */ }
      console.error('⚠ تعذّرت قراءة data.json — حُفظت نسخة تالفة وسيبدأ الخادم بقاعدة جديدة:', e.message);
    }
  }
  normalizeDb(fresh);
  if (!PG || fresh) await saveNow(); // في Neon لا نكتب عند كل إقلاع (لا نُربك النسخ الأخرى)؛ فقط عند الإنشاء الأول
}
let saving = null;
function saveNow() {
  dirty = false;
  clearTimeout(saveTimer);
  if (!PG) {
    const tmp = DB_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error('⚠ فشل حفظ البيانات:', e.message); }
    return Promise.resolve();
  }
  const run = async () => {
    try {
      const json = JSON.stringify(db);
      if (json.length > 8.5e6) console.warn('⚠ حجم البيانات ' + (json.length / 1e6).toFixed(1) + 'MB يقترب من حدّ ردّ Neon HTTP (10MB). نظّف الأنشطة/الدردشات القديمة.');
      await pgInit();
      const r = await pgQuery('insert into sedhok_kv (k, v, ver) values ($1, $2, 1) on conflict (k) do update set v = excluded.v, ver = sedhok_kv.ver + 1, updated_at = now() returning ver', ['db', json]);
      pgVer = Number(r.rows[0].ver);
    } catch (e) {
      dirty = true;
      console.error('⚠ فشل حفظ البيانات في Neon:', e.message);
      if (!SERVERLESS) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 5000); }
    }
  };
  saving = (saving || Promise.resolve()).then(run);
  return saving;
}
function save() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
async function flushAll() {
  if (dirty) await saveNow(); else if (saving) await saving;
  await Promise.allSettled([...pending]);
}
if (!SERVERLESS) {
  process.on('exit', () => { if (!PG && dirty) saveNow(); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await flushAll(); } catch { /* ignore */ } process.exit(0); });
}
/** Vercel: كل طلب قد يصل لنسخة مختلفة من الدالة؛ نعيد تحميل البيانات إن تغيّرت نسختها في Neon */
let lastSync = 0;
async function syncIfStale(force) {
  if (!PG || !SERVERLESS || dirty) return;
  if (!force && now() - lastSync < 3000) return;
  const r = await pgQuery('select ver from sedhok_kv where k = $1', ['db']);
  lastSync = now();
  const v = r.rows && r.rows[0] ? Number(r.rows[0].ver) : 0;
  if (v && v !== pgVer) {
    const row = await readDbRow();
    if (row && isObj(row.j)) { db = Object.assign(emptyDb(), row.j); pgVer = row.ver; normalizeDb(false); }
  }
}

// ════════════════════════════════════════════════════════════════════════
//  مساعدات النماذج
// ════════════════════════════════════════════════════════════════════════
let REQ_BASE = PUBLIC_URL; // يُحدَّث لكل طلب (ملفات /uploads تُرجَع كروابط مطلقة)
function absUrl(u) {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/uploads/')) return REQ_BASE + u;
  return u;
}
/** رابط http/https فقط (أو /uploads/ محلي). يمنع javascript: وغيره */
function safeUrl(u) {
  const s = str(u, 2048);
  if (!s) return '';
  // رابط مطلق لملف مرفوع على هذا الخادم يُحفظ كمسار نسبي (يصمد إن تغيّر النطاق)
  const up = /^https?:\/\/[^\/\s]+(\/uploads\/[\w.\-]+)$/i.exec(s);
  if (up && REQ_BASE && s.toLowerCase().startsWith(REQ_BASE.toLowerCase() + '/')) return up[1];
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^\/uploads\/[\w.\-]+$/.test(s)) return s;
  return '';
}
function badgeKey(v) {
  if (v === true) return 'blue';
  const t = str(v).toLowerCase();
  if (['purple', 'violet', 'بنفسجي'].includes(t)) return 'purple';
  if (['blue', 'verified', 'أزرق'].includes(t)) return 'blue';
  if (['yellow', 'gold', 'أصفر'].includes(t)) return 'yellow';
  return 'none';
}
const userById = (id) => db.users.find((u) => u.id === id);

// ───────── التوثيق: أزرق (بطلب بعد الشروط) · أصفر (100 ساعة مشاهدة تلقائياً) · بنفسجي (فريق Sedhok فقط) ─────────
const YELLOW_WATCH_SECS = 100 * 3600;
const VERIFY_MIN_WATCH_SECS = 3600;   // ساعة مشاهدة على الأقل لطلب الأزرق
const VERIFY_MIN_ACCOUNT_DAYS = 7;
function watchSecsOf(u) {
  if (u.watch_secs === undefined) {
    let n = 0; const lib = db.libraries && db.libraries[u.id];
    if (lib) for (const v of Object.values(lib.reading_seconds || {})) n += toInt(v, 0);
    u.watch_secs = n;
  }
  return u.watch_secs;
}
/** العلامة الفعلية: البنفسجي يمنحه الأدمن فقط ويتقدّم، ثم الأصفر تلقائياً عند 100 ساعة، ثم المخزَّنة */
function effBadge(u) {
  const b = (u && u.badge) || 'none';
  if (b === 'purple') return 'purple';
  if (u && watchSecsOf(u) >= YELLOW_WATCH_SECS) return 'yellow';
  return b;
}
/** شروط الأزرق (نفس شروط التطبيق). أول 7 = الصورة والمعلومات الشخصية */
function verifyChecks(u) {
  const e = u.extras || {}; const has = (v) => str(v).length > 0;
  const days = u.created_at ? Math.floor((now() - u.created_at) / 86400000) : 9999;
  return [
    { key: 'avatar', label: 'صورة بروفايل شخصية', ok: has(u.avatar_url) },
    { key: 'name', label: 'اسم حقيقي (3 أحرف فأكثر)', ok: str(u.name).length >= 3 && u.name !== 'مشاهد Sedhok' },
    { key: 'bio', label: 'نبذة تعريفية (15 حرفاً فأكثر)', ok: str(u.bio).length >= 15 },
    { key: 'country', label: 'الدولة', ok: has(e.country) },
    { key: 'city', label: 'المدينة', ok: has(e.city) },
    { key: 'birthday', label: 'تاريخ الميلاد', ok: has(e.birthday) },
    { key: 'gender', label: 'الجنس', ok: has(e.gender) },
    { key: 'age', label: 'مضى على حسابك ' + VERIFY_MIN_ACCOUNT_DAYS + ' أيام', ok: days >= VERIFY_MIN_ACCOUNT_DAYS },
    { key: 'watch', label: 'شاهدت ساعة واحدة على الأقل', ok: watchSecsOf(u) >= VERIFY_MIN_WATCH_SECS },
  ];
}
const seriesById = (id) => db.series.find((s) => s.id === id);
const isHidden = (id) => db.settings.hidden.includes(id);
const visibleSeries = () => db.series.filter((s) => !isHidden(s.id));

function userPublic(u, withEmail) {
  const o = { id: u.id, name: u.name, avatar_url: absUrl(u.avatar_url || ''), bio: u.bio || '', badge: effBadge(u), joined: u.joined || '' };
  if (withEmail) { o.email = u.email || ''; o.is_admin = false; }
  return o;
}
function authorInfo(userId, fallbackName) {
  const u = userById(userId);
  return { author: u ? u.name : (fallbackName || 'مشاهد'), author_id: userId || '', badge: u ? effBadge(u) : 'none' };
}

/** تقييم العمل: متوسط تقييمات المستخدمين مع احتساب تقييم الأدمن كأنه 10 أصوات */
function effectiveRating(s) {
  const r = db.ratings[s.id];
  const vals = r ? Object.values(r) : [];
  const base = s.rating || 0;
  if (!vals.length) return base;
  const sum = vals.reduce((a, b) => a + b, 0);
  const w = base > 0 ? 10 : 0;
  return Math.round(((base * w + sum) / (w + vals.length)) * 100) / 100;
}
function seriesPublic(s) {
  const eps = db.episodes[s.id];
  return {
    id: s.id, title: s.title, cover: absUrl(s.cover) || null, type: s.type, status: s.status,
    episodes: eps && eps.length ? eps.length : s.episodes || 0, rating: effectiveRating(s), views: s.views || 0,
    genres: s.genres || [], synopsis: s.synopsis || '', is_new: !!s.is_new, year: s.year, seasons: s.seasons || 1,
    country: s.country || '', qualities: s.qualities || [], cast: s.cast || [],
  };
}
function episodePublic(e) {
  return {
    number: e.number, season: e.season, key: e.season * 10000 + e.number, title: e.title, description: e.description || '',
    duration: e.duration || 0, thumb: absUrl(e.thumb) || null, date: e.date || '', is_new: !!e.is_new,
    sources: (e.sources || []).map((x) => ({ quality: x.quality, url: x.url, size_mb: x.size_mb || 0 })),
    subtitles: (e.subtitles || []).map((x) => ({ lang: x.lang, url: x.url, label: x.label || '' })),
    player_url: e.player_url || '',
  };
}

/** يقبل sources كقائمة أو خريطة {"720p":"url"} أو رابطاً واحداً (يصبح جودة «auto») */
function normSources(raw, single) {
  const out = [];
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (!isObj(e)) continue;
      const url = safeUrl(e.url || e.src || e.link);
      if (!url) continue;
      out.push({ quality: str(e.quality || e.label || e.q || 'auto', 20), url, size_mb: Math.max(0, toInt(e.size_mb || e.size || e.mb, 0)) });
    }
  } else if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const url = safeUrl(isObj(v) ? v.url || v.src : v);
      if (url) out.push({ quality: str(k, 20), url, size_mb: isObj(v) ? Math.max(0, toInt(v.size_mb || v.size, 0)) : 0 });
    }
  }
  if (!out.length && single) { const u = safeUrl(single); if (u) out.push({ quality: 'auto', url: u, size_mb: 0 }); }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.quality) ? false : (seen.add(x.quality), true))).sort((a, b) => qHeight(a.quality) - qHeight(b.quality));
}
function normSubtitles(raw) {
  const out = [];
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (!isObj(e)) continue;
      const url = safeUrl(e.url || e.src || e.link);
      if (url) out.push({ lang: str(e.lang || e.language || e.code, 10).toLowerCase(), url, label: str(e.label || e.name || e.title, 40) });
    }
  } else if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const url = safeUrl(isObj(v) ? v.url : v);
      if (url) out.push({ lang: str(k, 10).toLowerCase(), url, label: isObj(v) ? str(v.label || v.name, 40) : '' });
    }
  }
  return out;
}
function normEpisode(b, prev) {
  const number = toInt(b.number ?? b.episode ?? (prev && prev.number), 0);
  const season = toInt(b.season ?? (prev && prev.season), 1) || 1;
  if (number < 1) throw bad('رقم الحلقة يجب أن يكون 1 فأكثر');
  const player = b.player_url !== undefined || b.player !== undefined || b.embed !== undefined ? str(b.player_url || b.player || b.embed, 2048) : (prev ? prev.player_url : '');
  if (player && !safeUrl(player) && !/^<iframe/i.test(player)) throw bad('رابط المشغّل يجب أن يبدأ بـ http:// أو https://');
  const hasSources = b.sources !== undefined || b.qualities !== undefined || b.url !== undefined || b.video_url !== undefined || b.video !== undefined || b.link !== undefined;
  const sources = hasSources
    ? normSources(b.sources ?? b.qualities, b.url || b.video_url || b.video || b.link)
    : (prev ? prev.sources : []);
  if (hasSources) {
    const given = Array.isArray(b.sources ?? b.qualities) ? (b.sources ?? b.qualities).length : isObj(b.sources ?? b.qualities) ? Object.keys(b.sources ?? b.qualities).length : 0;
    if (given > sources.length) throw bad('روابط الجودات يجب أن تبدأ بـ http:// أو https://');
  }
  const subtitles = b.subtitles !== undefined || b.subs !== undefined ? normSubtitles(b.subtitles ?? b.subs) : (prev ? prev.subtitles : []);
  const th = b.thumb !== undefined || b.thumbnail !== undefined || b.image !== undefined ? safeUrl(b.thumb || b.thumbnail || b.image) : (prev ? prev.thumb : '');
  return {
    number, season,
    title: str(b.title ?? b.name ?? (prev && prev.title), 200) || ('الحلقة ' + number),
    description: str(b.description ?? b.synopsis ?? (prev ? prev.description : ''), 3000),
    duration: Math.max(0, toInt(b.duration ?? b.minutes ?? (prev ? prev.duration : 0), 0)),
    thumb: th || '',
    date: str(b.date ?? (prev ? prev.date : ''), 40) || dateLabel(now()),
    is_new: b.is_new !== undefined || b.new !== undefined ? bool(b.is_new ?? b.new) : (prev ? !!prev.is_new : true),
    sources, subtitles, player_url: player,
    added_at: prev && prev.added_at ? prev.added_at : now(),
  };
}
const sortEpisodes = (l) => l.sort((a, b) => (a.season !== b.season ? a.season - b.season : a.number - b.number));

/** مزامنة عدد الحلقات والمواسم والجودات في العمل بعد أي تغيير على حلقاته */
function syncSeriesFromEpisodes(id) {
  const s = seriesById(id);
  if (!s) return;
  const eps = db.episodes[id] || [];
  let seasons = 1; const qs = new Set();
  for (const e of eps) {
    if (e.season > seasons) seasons = e.season;
    for (const v of e.sources || []) if (v.url && v.quality && v.quality !== 'auto') qs.add(v.quality);
  }
  s.episodes = eps.length; s.seasons = seasons;
  if (qs.size) s.qualities = [...qs].sort((a, b) => qHeight(a) - qHeight(b));
}

function normSeries(b, prev) {
  const title = str(b.title ?? (prev && prev.title), 200);
  if (!title) throw bad('أدخل عنوان العمل');
  const p = prev || {};
  const pick = (k, d) => (b[k] !== undefined ? b[k] : p[k] !== undefined ? p[k] : d);
  const cover = b.cover !== undefined ? safeUrl(b.cover) : (p.cover || '');
  const q = strList(pick('qualities', [])).sort((a, c) => qHeight(a) - qHeight(c));
  return {
    id: p.id || str(b.id, 60) || uid('s'),
    title, cover, type: str(pick('type', db.settings.types[0] || 'مسلسل عربي'), 60), status: str(pick('status', 'مستمر'), 30),
    episodes: Math.max(0, toInt(pick('episodes', 0), 0)), seasons: Math.max(1, toInt(pick('seasons', 1), 1)),
    rating: clamp(toNum(pick('rating', 0), 0), 0, 10), views: Math.max(0, toInt(pick('views', 0), 0)),
    genres: strList(pick('genres', [])), synopsis: str(pick('synopsis', ''), 5000), is_new: bool(pick('is_new', false)),
    year: toInt(pick('year', new Date().getFullYear()), new Date().getFullYear()), country: str(pick('country', ''), 60),
    qualities: q, cast: strList(pick('cast', [])), created_at: p.created_at || now(),
  };
}

function getLibrary(userId) {
  if (!db.libraries[userId]) db.libraries[userId] = { followed: [], read_chapters: {}, progress: {}, reading_seconds: {}, recommended: [], lists: [] };
  return db.libraries[userId];
}

function ensureTeamUser() {
  if (!userById('u_team')) {
    db.users.push({ id: 'u_team', name: 'فريق Sedhok', email: '', pass: '', avatar_url: '', bio: 'الحساب الرسمي لفريق Sedhok.', badge: 'purple', banned: false, joined: 'منذ البداية', created_at: now(), system: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
//  بيانات تجريبية (SEED_DEMO=1 أو من لوحة الأدمن ← الإعدادات ← إعادة البيانات التجريبية)
// ════════════════════════════════════════════════════════════════════════
const DEMO_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const DEMO_SERIES = [
  ['m1', 'ظلال الصحراء', 'مسلسل عربي', 'السعودية', 2025, 30, 2, 1250000, 9.5, ['144p', '320p', '720p', '1080p'], ['دراما', 'إثارة', 'تاريخي'], 0, 'في قلب الصحراء، تتقاطع مصائر ثلاث عائلات حول بئر قديم يخبّئ سرّاً يهدد حدود القبائل. صراع على الأرض والشرف والذاكرة.'],
  ['m2', 'ليالي الياسمين', 'مسلسل عربي', 'لبنان', 2024, 30, 1, 842000, 9.1, ['144p', '320p', '720p'], ['رومانسي', 'دراما'], 0, 'طبيبة عائدة إلى مدينتها القديمة تلتقي بحبّها الأول في ظروف لم تتوقعها، وبين الماضي والحاضر تتشابك الحكايات.'],
  ['m3', 'سلطان الغروب', 'مسلسل تركي', 'تركيا', 2023, 60, 3, 2100000, 8.8, ['144p', '320p', '720p', '1080p'], ['دراما', 'تاريخي', 'انتقام'], 0, 'حين يسقط القصر في ليلة واحدة، يعود الوريث المنسيّ بهويّة جديدة ليستعيد عرشاً بُني على الخيانة.'],
  ['m4', 'Silent Harbor', 'مسلسل أجنبي', 'الولايات المتحدة', 2022, 24, 2, 3400000, 8.4, ['320p', '720p', '1080p'], ['غموض', 'جريمة', 'إثارة'], 0, 'محقّقة تصل إلى ميناء صغير هادئ، فتكتشف أن كل سكانه يخفون الحقيقة نفسها عن اختفاء عامل قبل عشرين عاماً.'],
  ['m5', 'Seoul Midnight', 'مسلسل كوري', 'كوريا الجنوبية', 2026, 16, 1, 96000, 7.0, ['144p', '320p', '720p'], ['رومانسي', 'غموض'], 1, 'مصمّمة أزياء تعمل ليلاً في ورشة قديمة، وكل فستان تخيطه يكشف سرّاً عن زبونه الذي لم يلتقِ بها قط.'],
  ['m6', 'قلب الحجر', 'مسلسل تركي', 'تركيا', 2026, 40, 2, 410000, 8.2, ['144p', '320p', '720p', '1080p'], ['رومانسي', 'دراما'], 1, 'قصر حجري على الساحل يجمع عائلتين متخاصمتين، وزواج مدبّر يضع قلبين في مواجهة إرث من الثأر.'],
  ['m7', 'The Last Signal', 'مسلسل أجنبي', 'المملكة المتحدة', 2021, 10, 1, 276000, 9.26, ['720p', '1080p'], ['خيال علمي', 'إثارة'], 0, 'فريق مراقبة يلتقط إشارة من المستقبل تحذّر من حدثٍ يقع بعد ساعات، وكلما حاولوا منعه اقترب أكثر.'],
  ['m8', 'Iron Orchard', 'مسلسل أجنبي', 'الولايات المتحدة', 2024, 36, 3, 735000, 8.9, ['144p', '320p', '720p', '1080p'], ['أكشن', 'دراما', 'جريمة'], 0, 'عائلة تدير بستاناً ريفياً تخفي تحت أشجاره إمبراطورية تهريب، وابنهم الأصغر يقرّر كسر القاعدة الأولى.'],
  ['m9', 'Moonlit Palace', 'مسلسل كوري', 'كوريا الجنوبية', 2025, 20, 1, 38000, 6.8, ['320p', '720p', '1080p'], ['تاريخي', 'رومانسي'], 1, 'أميرة تتنكّر في زيّ خادمة لتكشف مؤامرة في القصر، فتجد نفسها أمام حارس يعرف سرّها منذ البداية.'],
  ['m10', 'بيت الحكايات', 'مسلسل عربي', 'مصر', 2020, 15, 1, 188000, 8.0, ['144p', '320p'], ['كوميديا', 'عائلي'], 0, 'عائلة كبيرة تجتمع في بيت الجدّة كل صيف، وكل حكاية تُروى على المائدة تقلب موازين الأسرة رأساً على عقب.'],
];
const DEMO_EP_TITLES = ['البداية', 'وعد قديم', 'الغريب', 'ليلة العاصفة', 'أسرار مدفونة', 'المواجهة', 'ما بعد الصمت', 'خيط رفيع', 'العودة', 'الحقيقة', 'نقطة اللاعودة', 'الوجه الآخر', 'حافة الليل', 'ثمن الولاء', 'خيانة', 'ظلّ الماضي', 'الصفقة', 'الفجر الأخير'];

function seedDemo() {
  const t = now();
  db.series = []; db.episodes = {};
  for (const r of DEMO_SERIES) {
    const [id, title, type, country, year, episodes, seasons, views, rating, qualities, genres, isNew, synopsis] = r;
    db.series.push({ id, title, cover: '', type, status: 'مستمر', episodes, seasons, rating, views, genres, synopsis, is_new: !!isNew, year, country, qualities, cast: [], created_at: t });
    const perSeason = Math.ceil(episodes / seasons); const list = []; let g = 0;
    for (let sn = 1; sn <= seasons; sn++) {
      for (let n = 1; n <= perSeason && g < episodes; n++) {
        g++;
        const dur = 38 + ((g * 7) % 22); const latest = g === episodes;
        list.push({
          number: n, season: sn, title: DEMO_EP_TITLES[(g - 1) % DEMO_EP_TITLES.length],
          description: 'تتصاعد الأحداث في هذه الحلقة بينما تتكشّف خيوط جديدة، ويجد الأبطال أنفسهم أمام قرار يغيّر مسار القصة.',
          duration: dur, thumb: '', date: latest ? dateLabel(t) : '2026/' + pad2(1 + (g % 11)) + '/' + pad2(1 + (g % 27)), is_new: latest,
          sources: [['144p', 2.0], ['320p', 5.1], ['720p', 16.0], ['1080p', 33.0]].filter(([q]) => qualities.includes(q)).map(([q, m]) => ({ quality: q, url: DEMO_VIDEO, size_mb: Math.round(dur * m) })),
          subtitles: [], player_url: '', added_at: latest ? t : t - 40 * 86400000,
        });
      }
    }
    db.episodes[id] = list;
  }
  db.news = [
    { id: 'n1', title: 'إطلاق النسخة التجريبية من Sedhok', body: 'أهلاً بك في Sedhok! هذه نسخة تجريبية لتجربة كل الواجهات قبل الإصدار.', category: 'إعلان', image: '', at: t },
    { id: 'n2', title: 'حلقات جديدة هذا الأسبوع', body: 'تمت إضافة حلقات جديدة لعدة مسلسلات. تابع مسلسلاتك المفضلة لتصلك الإشعارات.', category: 'تحديث', image: '', at: t - 86400000 },
    { id: 'n3', title: 'تحسينات المشاهدة', body: 'المشاهدة عبر المشغّل الخاص والتحميل بأربع جودات عبر المتصفح داخل التطبيق متاحان الآن.', category: 'ميزات', image: '', at: t - 2 * 86400000 },
  ];
  const demoUsers = [
    ['u_nora', 'نورا', 'purple', 'منذ 2023', 'من فريق Sedhok. أحب الفانتازيا والدراما، وأرشّح لكم كل أسبوع عملاً يستحق.'],
    ['u_yaser', 'أبو ياسر', 'blue', 'منذ 2024', 'متابع للمسلسلات منذ 15 عاماً، موثّق ومهتم بالنقاش الهادئ.'],
    ['u_layla', 'ليلى', 'yellow', 'منذ 2024', 'مترجمة معتمدة. أترجم الأعمال الكورية وأحب الرومانسية والفانتازيا.'],
    ['u_saif', 'سيف', 'none', 'منذ 2025', 'أبحث دائماً عن قصة بحبكة محكمة.'],
  ];
  for (const [id, name, badge, joined, bio] of demoUsers) {
    if (!userById(id)) db.users.push({ id, name, email: '', pass: '', avatar_url: '', bio, badge, banned: false, joined, created_at: t, demo: true });
  }
  db.libraries.u_nora = { followed: [], read_chapters: {}, progress: {}, reading_seconds: {}, recommended: ['m1', 'm3', 'm2'], lists: [] };
  db.libraries.u_yaser = { followed: [], read_chapters: {}, progress: {}, reading_seconds: {}, recommended: ['m4', 'm2'], lists: [] };
  db.posts = [
    { id: 'p1', author_id: 'u_nora', tag: 'توصية', body: 'شاهدت الحلقة الأخيرة للتو ولا أصدّق النهاية! أي مسلسل تنصحونني به بعد هذا؟', images: [], poll: null, reactions: {}, base_reactions: { like: 26, love: 15, wow: 7 }, at: t - 3600000 },
    { id: 'p2', author_id: 'u_yaser', tag: 'نقاش', body: 'برأيكم: هل الأفضل مشاهدة المسلسل حلقة حلقة أم إنهاء الموسم دفعة واحدة؟', images: [], reactions: {}, base_reactions: { like: 19, laugh: 8, wow: 4 }, at: t - 3 * 3600000,
      poll: { question: 'ما وقتك المفضل لمشاهدة المسلسلات؟', options: [{ id: 'o1', text: 'في المساء', base: 41 }, { id: 'o2', text: 'في نهاية الأسبوع', base: 27 }, { id: 'o3', text: 'حسب المسلسل', base: 12 }], votes: {} } },
    { id: 'p3', author_id: 'u_layla', tag: 'ترجمة', body: 'ننتظر حلقات جديدة هذا الأسبوع، تابعوا مسلسلاتكم المفضلة لتصلكم الإشعارات.', images: [], poll: null, reactions: {}, base_reactions: { like: 14, love: 8 }, at: t - 26 * 3600000 },
    { id: 'p3b', author_id: 'u_saif', tag: 'ترشيح', body: 'أفضل مسلسلات الغموض التي شاهدتموها هذا العام؟ أبحث عن قصة بحبكة محكمة.', images: [], poll: null, reactions: {}, base_reactions: { like: 11, wow: 6 }, at: t - 27 * 3600000 },
  ];
  db.comments = []; db.ratings = {}; db.broadcasts = []; db.settings.featured = []; db.settings.hidden = [];
}

// ════════════════════════════════════════════════════════════════════════
//  HTTP: قراءة الجسم، multipart، رفع الصور، الردود
// ════════════════════════════════════════════════════════════════════════
function readBody(req, limit) {
  if (req._buf) return Promise.resolve(req._buf); // الجسم قُرئ سابقاً عند محاولة التحويل للسيرفر الآخر
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'الحجم أكبر من المسموح')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** محلل multipart/form-data بسيط: يعيد {fields, files:{name:[{filename,type,data}]}} */
function parseMultipart(buf, boundary) {
  const fields = {}; const files = {};
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const next = buf.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    let part = buf.subarray(pos + delim.length, next);
    if (part.subarray(0, 2).toString() === '--') break;
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    const hEnd = part.indexOf('\r\n\r\n');
    if (hEnd !== -1) {
      const head = part.subarray(0, hEnd).toString('utf8');
      let data = part.subarray(hEnd + 4);
      if (data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10) data = data.subarray(0, data.length - 2);
      const nm = /name="([^"]*)"/i.exec(head);
      const fn = /filename="([^"]*)"/i.exec(head);
      const ct = /content-type:\s*([^\r\n]+)/i.exec(head);
      if (nm) {
        if (fn) (files[nm[1]] = files[nm[1]] || []).push({ filename: fn[1], type: ct ? ct[1].trim().toLowerCase() : '', data });
        else fields[nm[1]] = data.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}

/** يقرأ الجسم كـ JSON أو urlencoded أو multipart. النتيجة: {body, files} */
async function parseRequest(req, limit) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return { body: {}, files: {} };
  const buf = await readBody(req, ct.startsWith('multipart/') ? MAX_UPLOAD * 6 + 1024 * 1024 : limit);
  if (!buf.length) return { body: {}, files: {} };
  if (ct.startsWith('multipart/form-data')) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] || '');
    if (!m) throw bad('multipart غير صالح');
    const r = parseMultipart(buf, m[1] || m[2]);
    return { body: r.fields, files: r.files };
  }
  if (ct.includes('application/x-www-form-urlencoded')) return { body: Object.fromEntries(new URLSearchParams(buf.toString('utf8'))), files: {} };
  try {
    const j = JSON.parse(buf.toString('utf8'));
    return { body: isObj(j) ? j : {}, files: {} };
  } catch { throw bad('JSON غير صالح'); }
}

const IMG_TYPES = {
  png: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.length > 6 && b.subarray(0, 3).toString() === 'GIF',
  webp: (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};
/** يحفظ صورة مرفوعة (بعد فحص محتواها الحقيقي) ويعيد مسارها /uploads/xxx */
function saveImage(file) {
  if (!file || !file.data || !file.data.length) throw bad('ملف فارغ');
  if (file.data.length > MAX_UPLOAD) throw new HttpError(413, 'الصورة أكبر من ' + Math.round(MAX_UPLOAD / 1048576) + ' ميغابايت');
  const ext = Object.keys(IMG_TYPES).find((k) => IMG_TYPES[k](file.data));
  if (!ext) throw bad('الملف ليس صورة مدعومة (png / jpg / gif / webp)');
  const name = now().toString(36) + crypto.randomBytes(6).toString('hex') + '.' + ext;
  filePut(name, file.data, MIME[ext]);
  return '/uploads/' + name;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
async function serveUpload(res, name) {
  if (!/^[\w.\-]+$/.test(name)) throw notFound();
  const data = await fileGet(name);
  if (!data) throw notFound();
  const ext = name.split('.').pop().toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Content-Security-Policy': "default-src 'none'",
  });
  res.end(data);
}

function send(res, status, data, extra) {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  }, extra || {}));
  res.end(body);
}

// ════════════════════════════════════════════════════════════════════════
//  الموجّه (Router) والمصادقة
// ════════════════════════════════════════════════════════════════════════
const routes = [];
/** auth: 'user' (إلزامي) | 'optional' (يتعرّف على المستخدم إن وُجد) | 'admin' | 'none' */
function route(method, pattern, auth, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, rx, keys, auth, handler, pattern });
}
const GET = (p, a, h) => route('GET', p, a, h);
const POST = (p, a, h) => route('POST', p, a, h);
const PUT = (p, a, h) => route('PUT', p, a, h);
const PATCH = (p, a, h) => route('PATCH', p, a, h);
const DEL = (p, a, h) => route('DELETE', p, a, h);

function bearer(req) {
  const h = String(req.headers.authorization || '');
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}
function identify(req) {
  const tok = bearer(req);
  const out = { user: null, admin: false, apiKey: false };
  if (!tok) return out;
  if (API_KEY && tok.length === API_KEY.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(API_KEY))) { out.apiKey = true; return out; }
  const p = verifyToken(tok);
  if (!p) return out;
  if (p.adm) { out.admin = p.sub === db.admin.user && p.v === (db.admin.v || 0); return out; }
  const u = userById(p.sub);
  if (u && !u.deleted && (p.pv || 0) === (u.pv || 0)) out.user = u;
  return out;
}

// حد معدل بسيط (لكل IP) لمسارات الدخول وكلمات المرور
const attempts = new Map();
function rateLimit(ip, key, max, windowMs) {
  const k = key + '|' + ip; const t = now();
  const a = (attempts.get(k) || []).filter((x) => t - x < windowMs);
  if (a.length >= max) throw new HttpError(429, 'محاولات كثيرة. حاول لاحقاً.');
  a.push(t); attempts.set(k, a);
}
setInterval(() => { const t = now(); for (const [k, v] of attempts) if (!v.some((x) => t - x < 3600000)) attempts.delete(k); }, 600000).unref();

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket.remoteAddress || '';
}
function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket.encrypted ? 'https' : 'http');
  return proto + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:' + PORT);
}

function userSession(u) {
  return signToken({ sub: u.id, pv: u.pv || 0 }, TOKEN_TTL_USER);
}
function adminSession() {
  return signToken({ sub: db.admin.user, adm: 1, v: db.admin.v || 0 }, TOKEN_TTL_ADMIN);
}
const needUser = (ctx) => { if (!ctx.user) throw unauthorized(); return ctx.user; };
function needActive(ctx) {
  const u = needUser(ctx);
  if (u.banned) throw forbidden('حسابك محظور');
  return u;
}

// ════════════════════════════════════════════════════════════════════════
//  [1] النظام
// ════════════════════════════════════════════════════════════════════════
GET('/', 'none', () => ({ name: 'Sedhok API', status: 'ok', admin: '/admin', health: '/health' }));
GET('/health', 'none', () => ({ ok: true, role: SERVER_ROLE, peer: PEER_URL ? (peerDownUntil > now() ? 'down' : 'up') : 'none', storage: PG ? 'neon' : 'file', runtime: SERVERLESS ? 'serverless' : 'server', time: new Date().toISOString(), series: db.series.length, users: db.users.length }));
/** إعدادات عامة (التطبيق الحالي يضبطها محلياً؛ متاحة لأي نسخة تريد قراءتها من السيرفر) */
GET('/config', 'none', () => ({
  types: db.settings.types, genres: db.settings.genres, countries: db.settings.countries, qualities: QUALITY_OPTIONS,
  statuses: STATUS_OPTIONS, adblock: db.settings.adblock !== false, announcement: db.settings.announcement,
  sections: Object.fromEntries(Object.keys(HOME_SECTIONS).map((k) => [k, db.settings.sections[k] !== false])),
}));

// ════════════════════════════════════════════════════════════════════════
//  [2] الحساب: /auth/* و /users/*
// ════════════════════════════════════════════════════════════════════════
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sessionReply = (u) => ({ token: userSession(u), user: userPublic(u, true) });

POST('/auth/register', 'none', ({ body, ip }) => {
  if (!ALLOW_REGISTER) throw forbidden('التسجيل مغلق حالياً');
  rateLimit(ip, 'register', 10, 3600000);
  const name = str(body.name, 60); const email = str(body.email, 200).toLowerCase(); const password = String(body.password || '');
  if (name.length < 2) throw bad('الاسم قصير جداً');
  if (!EMAIL_RX.test(email)) throw bad('بريد إلكتروني غير صالح');
  if (password.length < 8) throw bad('كلمة المرور 8 أحرف على الأقل');
  if (password.length > 200) throw bad('كلمة المرور طويلة جداً');
  if (db.users.some((u) => u.email === email)) throw conflict('هذا البريد مسجّل مسبقاً');
  const u = { id: uid('u'), name, email, pass: hashPassword(password), avatar_url: '', bio: '', badge: 'none', banned: false, joined: 'منذ ' + new Date().getFullYear(), created_at: now(), pv: 0 };
  db.users.push(u); save();
  return sessionReply(u);
});

POST('/auth/login', 'none', ({ body, ip }) => {
  rateLimit(ip, 'login', 15, 15 * 60000);
  const email = str(body.email, 200).toLowerCase(); const password = String(body.password || '');
  if (!EMAIL_RX.test(email)) throw bad('بريد إلكتروني غير صالح');
  const u = db.users.find((x) => x.email && x.email === email && !x.deleted);
  if (!u) throw notFound('هذا الحساب غير موجود. اضغط «إنشاء حساب» للتسجيل.');
  if (!u.pass) throw bad('هذا الحساب مسجّل عبر Google أو فيسبوك. ادخل بنفس الطريقة.');
  if (!checkPassword(password, u.pass)) throw unauthorized('كلمة المرور غير صحيحة');
  if (u.banned) throw forbidden('هذا الحساب محظور');
  return sessionReply(u);
});

function httpsGetJson(u) {
  return new Promise((resolve, reject) => {
    const r = https.get(u, { timeout: 8000 }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; if (d.length > 20000) r.destroy(); });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch (e) { reject(e); } });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
  });
}
POST('/auth/google', 'none', async ({ body, ip }) => {
  rateLimit(ip, 'google', 20, 15 * 60000);
  if (!GOOGLE_CLIENT_ID) throw new HttpError(501, 'تسجيل Google غير مفعّل (اضبط GOOGLE_CLIENT_ID)');
  const idToken = str(body.id_token, 4096);
  if (!idToken) throw bad('id_token مطلوب');
  let info;
  try {
    const r = await httpsGetJson('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    if (r.status !== 200) throw new Error('invalid');
    info = r.json;
  } catch { throw unauthorized('رمز Google غير صالح'); }
  if (info.aud !== GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) throw unauthorized('رمز Google غير موجّه لهذا التطبيق');
  if (info.email_verified !== 'true' && info.email_verified !== true) throw unauthorized('بريد Google غير موثّق');
  const email = str(info.email, 200).toLowerCase();
  let u = db.users.find((x) => x.google_sub === info.sub) || db.users.find((x) => x.email === email);
  if (!u) {
    u = { id: uid('u'), name: str(info.name || email.split('@')[0], 60), email, pass: '', google_sub: info.sub, avatar_url: str(info.picture, 500).startsWith('https://') ? str(info.picture, 500) : '', bio: '', badge: 'none', banned: false, joined: 'منذ ' + new Date().getFullYear(), created_at: now(), pv: 0 };
    db.users.push(u);
  } else if (!u.google_sub) u.google_sub = info.sub;
  save();
  return sessionReply(u);
});

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function makeResetToken(u) {
  const token = crypto.randomBytes(20).toString('hex');
  for (const [k, v] of Object.entries(db.resets)) if (v.exp < now()) delete db.resets[k];
  db.resets[sha(token)] = { uid: u.id, exp: now() + 3600000 };
  save();
  return token;
}
POST('/auth/forgot-password', 'none', ({ body, ip }) => {
  rateLimit(ip, 'forgot', 8, 3600000);
  const email = str(body.email, 200).toLowerCase();
  const u = EMAIL_RX.test(email) ? db.users.find((x) => x.email === email) : null;
  if (u) {
    const tok = makeResetToken(u);
    // لا يوجد بريد صادر مدمج: الرمز يُطبع هنا ويستطيع الأدمن إصداره من لوحته أيضاً
    console.log('🔑 رمز استعادة كلمة المرور لـ ' + email + ' (صالح ساعة): ' + tok);
  }
  return { message: 'إن كان البريد مسجّلاً فستصلك تعليمات الاستعادة', ok: true };
});
POST('/auth/reset-password', 'none', ({ body, ip }) => {
  rateLimit(ip, 'reset', 10, 3600000);
  const rec = db.resets[sha(str(body.token, 200))];
  const password = String(body.password || '');
  if (!rec || rec.exp < now()) throw bad('الرمز غير صالح أو منتهٍ');
  if (password.length < 8) throw bad('كلمة المرور 8 أحرف على الأقل');
  const u = userById(rec.uid);
  if (!u) throw bad('الرمز غير صالح');
  u.pass = hashPassword(password); u.pv = (u.pv || 0) + 1;
  delete db.resets[sha(str(body.token, 200))]; save();
  return { ok: true, message: 'تم تغيير كلمة المرور' };
});

GET('/users/me', 'user', ({ user }) => ({ user: userPublic(user, true) }));
POST('/users/me', 'user', ({ user, body }) => {
  const name = str(body.name, 60);
  if (name) { if (name.length < 2) throw bad('الاسم قصير جداً'); user.name = name; }
  if (body.avatar_url !== undefined) {
    const a = str(body.avatar_url, 500);
    user.avatar_url = a === '' ? '' : (safeUrl(a) || user.avatar_url);
  }
  if (body.bio !== undefined) user.bio = str(body.bio, 300);
  save();
  return { user: userPublic(user, true) };
});
PUT('/users/me', 'user', (c) => routes.find((r) => r.method === 'POST' && r.pattern === '/users/me').handler(c));

/** GET /users/me/verification → {badge, verified, checks:[{key,label,ok}], profile_complete, can_verify} */
GET('/users/me/verification', 'user', ({ user }) => {
  const checks = verifyChecks(user);
  return { badge: effBadge(user), verified: (user.badge || 'none') !== 'none', checks, profile_complete: checks.slice(0, 7).every((c) => c.ok), can_verify: checks.every((c) => c.ok) };
});
/** POST /users/me/verify: يمنح الأزرق إن تحققت كل الشروط (السيرفر هو الحكم). البنفسجي لا يُطلب أبداً. */
POST('/users/me/verify', 'user', ({ user }) => {
  needActive({ user });
  const checks = verifyChecks(user);
  if ((user.badge || 'none') === 'none') {
    const bad_ = checks.filter((c) => !c.ok);
    if (bad_.length) { const e = bad('لم تكتمل شروط التوثيق: ' + bad_.map((c) => c.label).join('، ')); e.checks = checks; throw e; }
    user.badge = 'blue'; save();
  }
  return { ok: true, badge: effBadge(user), checks };
});

GET('/users/:id', 'optional', ({ params, user }) => {
  const u = userById(params.id);
  if (!u || u.deleted) throw notFound('المستخدم غير موجود');
  const viewer = user || null; const vid = viewer ? viewer.id : '';
  const relation = relationOf(vid, u.id); const pr = privacyOf(u);
  const allow = (k) => audienceAllows(pr[k], relation);
  let chapters = 0; let secs = 0; let recs = [];
  if (allow('activity')) {
    const lib = db.libraries[u.id] || {};
    for (const v of Object.values(lib.read_chapters || {})) chapters += Array.isArray(v) ? v.length : 0;
    for (const v of Object.values(lib.reading_seconds || {})) secs += toInt(v, 0);
    recs = (Array.isArray(lib.recommended) ? lib.recommended : Object.keys(lib.recommended || {}))
      .map((id) => seriesById(String(id))).filter((s) => s && !isHidden(s.id)).map((s) => ({ series: seriesPublic(s), note: '' }));
  }
  const ex = extrasOf(u); const showAbout = allow('details'); const showStory = allow('story');
  const extras = {
    ...(showAbout ? ex : { country: '', city: '', hometown: '', work: '', education: '', relationship: '', partner: '', birthday: '', gender: '', website: '', interests: [] }),
    cover_url: ex.cover_url, joined_at: ex.joined_at,
    story_text: showStory ? ex.story_text : '', story_image: showStory ? ex.story_image : '', story_at: showStory ? ex.story_at : 0,
  };
  const fr = friendIds(u.id).map(liveUser).filter(Boolean);
  return {
    ...userPublic(u), chapters_read: chapters, reading_seconds: secs, recommendations: recs,
    posts: u.banned ? [] : db.posts.filter((p) => p.author_id === u.id && canPost(p, viewer, 'view')).sort((a, b) => b.at - a.at).slice(0, 30).map((p) => postPublic(p, viewer)),
    extras, privacy: pr, relation, following: !!vid && db.follows.some((f) => f.from === vid && f.to === u.id),
    friends_count: fr.length, followers_count: followerIds(u.id).length, following_count: followingIds(u.id).length,
    mutual_friends: vid && relation !== 'self' ? mutualCount(vid, u.id) : 0,
    friends_preview: allow('friends_list') ? fr.slice(0, 6).map((x) => personPublic(x, vid)) : [],
  };
});

// ════════════════════════════════════════════════════════════════════════
//  [3] الكتالوج: /home /search /catalog /genres /series
// ════════════════════════════════════════════════════════════════════════
function sections() {
  const vis = visibleSeries();
  const byViews = vis.slice().sort((a, b) => (b.views || 0) - (a.views || 0));
  const fresh = [...vis.filter((s) => s.is_new), ...vis.filter((s) => !s.is_new)];
  const feat = db.settings.featured;
  const featured = feat.length ? feat.map((id) => vis.find((s) => s.id === id)).filter(Boolean) : vis.slice(0, 5);
  return { featured, suggestions: vis.slice().reverse(), latest: fresh, popular: byViews };
}
GET('/home', 'none', () => {
  const s = sections();
  return {
    featured: s.featured.map(seriesPublic), suggestions: s.suggestions.map(seriesPublic),
    latest: s.latest.map(seriesPublic), popular: s.popular.map(seriesPublic),
    // إضافات اختيارية (لا يقرؤها التطبيق الحالي)
    announcement: db.settings.announcement, sections: Object.fromEntries(Object.keys(HOME_SECTIONS).map((k) => [k, db.settings.sections[k] !== false])),
  };
});

function paginate(list, q) {
  const page = Math.max(1, toInt(q.page, 1)); const limit = clamp(toInt(q.limit, 20), 1, 100);
  return { items: list.slice((page - 1) * limit, page * limit).map(seriesPublic), page, limit, total: list.length };
}
GET('/catalog/:section', 'none', ({ params, q }) => {
  const s = sections()[params.section];
  if (!s) throw notFound('قسم غير معروف');
  return paginate(s, q);
});
GET('/genres/:genre', 'none', ({ params, q }) => {
  const g = decodeURIComponent(params.genre);
  const l = visibleSeries().filter((s) => (s.genres || []).includes(g)).sort((a, b) => (b.views || 0) - (a.views || 0));
  return paginate(l, q);
});

const csv = (v) => (v ? String(v).split(/[,،]/).map((x) => x.trim()).filter(Boolean) : []);
/** البحث والفلاتر: كل الوسائط التي يرسلها التطبيق (search_filters.dart) */
function searchSeries(q) {
  const term = str(q.q, 200).toLowerCase();
  const types = csv(q.type); const statuses = csv(q.status); const genres = csv(q.genres); const exclude = csv(q.exclude);
  const all = (q.genre_mode || 'all') !== 'any';
  const countries = csv(q.country); const quals = csv(q.quality);
  const epMin = q.chapters_min || q.episodes_min; const epMax = q.chapters_max || q.episodes_max;
  const minRating = toNum(q.min_rating, 0); const minViews = toInt(q.min_views, 0);
  const yFrom = q.year_from ? toInt(q.year_from) : null; const yTo = q.year_to ? toInt(q.year_to) : null; const yExact = q.year ? toInt(q.year) : null;
  const sMin = q.seasons_min ? toInt(q.seasons_min) : null; const sMax = q.seasons_max ? toInt(q.seasons_max) : null;
  const onlyNew = bool(q.only_new || q.new);
  const rows = visibleSeries().map(seriesPublic).filter((s) => {
    if (term && !s.title.toLowerCase().includes(term) && !s.cast.some((c) => c.toLowerCase().includes(term))) return false;
    if (types.length && !types.includes(s.type)) return false;
    if (statuses.length && !statuses.includes(s.status)) return false;
    if (genres.length && !(all ? genres.every((g) => s.genres.includes(g)) : genres.some((g) => s.genres.includes(g)))) return false;
    if (exclude.some((g) => s.genres.includes(g))) return false;
    if (epMin && s.episodes < toInt(epMin)) return false;
    if (epMax && s.episodes > toInt(epMax)) return false;
    if (minRating > 0 && s.rating < minRating) return false;
    if (minViews > 0 && s.views < minViews) return false;
    if (yExact && s.year !== yExact) return false;
    if (yFrom !== null && s.year < yFrom) return false;
    if (yTo !== null && s.year > yTo) return false;
    if (countries.length && !countries.includes(s.country)) return false;
    if (sMin !== null && s.seasons < sMin) return false;
    if (sMax !== null && s.seasons > sMax) return false;
    if (quals.length && !quals.some((x) => s.qualities.includes(x))) return false;
    if (onlyNew && !s.is_new) return false;
    return true;
  });
  const created = Object.fromEntries(db.series.map((s) => [s.id, s.created_at || 0]));
  const sorters = {
    views: (a, b) => b.views - a.views, rating: (a, b) => b.rating - a.rating, chapters: (a, b) => b.episodes - a.episodes,
    episodes: (a, b) => b.episodes - a.episodes, chapters_asc: (a, b) => a.episodes - b.episodes, year: (a, b) => b.year - a.year,
    seasons: (a, b) => b.seasons - a.seasons, title: (a, b) => a.title.localeCompare(b.title, 'ar'),
    new: (a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0) || (created[b.id] || 0) - (created[a.id] || 0),
  };
  rows.sort(sorters[q.sort] || sorters.new);
  return rows;
}
GET('/search', 'none', ({ q }) => {
  const rows = searchSeries(q);
  if (q.page || q.limit) { const p = paginate(rows.map((r) => seriesById(r.id)), q); return p; }
  return rows;
});
GET('/series', 'none', ({ q }) => searchSeries(q));
GET('/series/:id', 'optional', ({ params, user }) => {
  const s = seriesById(params.id);
  if (!s || isHidden(s.id)) throw notFound('العمل غير موجود');
  const out = seriesPublic(s);
  out.my_rating = user && db.ratings[s.id] ? db.ratings[s.id][user.id] || 0 : 0;
  out.rating_count = db.ratings[s.id] ? Object.keys(db.ratings[s.id]).length : 0;
  return out;
});

const viewSeen = new Map();
GET('/series/:id/episodes', 'none', ({ params, ip }) => {
  const s = seriesById(params.id);
  if (!s || isHidden(s.id)) throw notFound('العمل غير موجود');
  if (COUNT_VIEWS) {
    const k = ip + '|' + s.id; const t = now();
    if (!viewSeen.has(k) || t - viewSeen.get(k) > 30 * 60000) { viewSeen.set(k, t); s.views = (s.views || 0) + 1; save(); }
    if (viewSeen.size > 20000) viewSeen.clear();
  }
  return sortEpisodes((db.episodes[s.id] || []).slice()).map(episodePublic);
});
GET('/series/:id/related', 'none', ({ params, q }) => {
  const s = seriesById(params.id);
  if (!s) throw notFound('العمل غير موجود');
  const limit = clamp(toInt(q.limit, 12), 1, 50);
  const score = (x) => (x.genres || []).filter((g) => (s.genres || []).includes(g)).length;
  const l = visibleSeries().filter((x) => x.id !== s.id && score(x) > 0)
    .sort((a, b) => score(b) - score(a) || (b.views || 0) - (a.views || 0)).slice(0, limit);
  return { items: l.map(seriesPublic) };
});
POST('/series/:id/rating', 'user', ({ params, body, user }) => {
  const s = seriesById(params.id);
  if (!s || isHidden(s.id)) throw notFound('العمل غير موجود');
  const r = toInt(body.rating, 0);
  if (r < 1 || r > 10) throw bad('التقييم يجب أن يكون من 1 إلى 10');
  (db.ratings[s.id] = db.ratings[s.id] || {})[user.id] = r; save();
  return { ok: true, rating: effectiveRating(s), count: Object.keys(db.ratings[s.id]).length, my_rating: r };
});

// ════════════════════════════════════════════════════════════════════════
//  [4] التعليقات (أعمال / حلقات / منشورات)
// ════════════════════════════════════════════════════════════════════════
const postedAt = new Map();
function throttle(userId, max = 12, windowMs = 60000) {
  const t = now(); const a = (postedAt.get(userId) || []).filter((x) => t - x < windowMs);
  if (a.length >= max) throw new HttpError(429, 'أرسلت الكثير خلال وقت قصير. انتظر قليلاً.');
  a.push(t); postedAt.set(userId, a);
}
/** تفاعلات التعليق {userId: key}. التعليقات القديمة (likes) تُعدّ تفاعل «إعجاب» */
function reactMap(c) {
  if (!c.reacts) { c.reacts = {}; for (const id of c.likes || []) c.reacts[id] = 'like'; }
  return c.reacts;
}
function commentPublic(c, viewer) {
  const a = authorInfo(c.user_id, c.author_name);
  const rm = reactMap(c); const counts = {};
  for (const r of Object.values(rm)) counts[r] = (counts[r] || 0) + 1;
  const mine = viewer ? rm[viewer.id] || null : null;
  return {
    id: c.id, series_id: c.ref, episode: c.ep, author: a.author, author_id: a.author_id, badge: a.badge, text: c.text,
    created_at: rel(c.at), created_ts: c.at, likes: Object.keys(rm).length, liked: !!mine, reactions: counts, my_reaction: mine,
    edited: !!c.edited, parent_id: c.parent_id || null,
  };
}
const commentsOf = (scope, ref, ep) => db.comments.filter((c) => c.scope === scope && c.ref === ref && (c.ep || null) === (ep || null));
function listComments(scope, ref, ep, viewer, q) {
  const limit = clamp(toInt(q.limit, 300), 1, 500);
  return commentsOf(scope, ref, ep).sort((a, b) => b.at - a.at).slice(0, limit).map((c) => commentPublic(c, viewer));
}
function addComment(scope, ref, ep, user, body) {
  const text = str(body.text, 2000);
  if (!text) throw bad('اكتب نص التعليق');
  const parent = body.parent_id ? String(body.parent_id) : null;
  if (parent && !commentsOf(scope, ref, ep).some((c) => c.id === parent)) throw bad('التعليق الأصلي غير موجود');
  needVoice(user);
  throttle(user.id);
  const c = { id: uid('c'), scope, ref, ep: ep || null, user_id: user.id, text, parent_id: parent, likes: [], reacts: {}, at: now() };
  db.comments.push(c); save();
  return commentPublic(c, user);
}
const findComment = (scope, ref, ep, cid) => {
  const c = db.comments.find((x) => x.id === cid && x.scope === scope && x.ref === ref && (x.ep || null) === (ep || null));
  if (!c) throw notFound('التعليق غير موجود');
  return c;
};
function likeComment(scope, ref, ep, cid, user) {
  const c = findComment(scope, ref, ep, cid);
  const rm = reactMap(c);
  const had = !!rm[user.id];
  if (had) delete rm[user.id]; else rm[user.id] = 'like';
  c.likes = Object.keys(rm); save();
  return { ok: true, liked: !had, likes: c.likes.length };
}
/** POST .../comments/:cid/react {reaction: key|null} — واحد من خمسة تفاعلات أو null لسحبه */
function reactComment(scope, ref, ep, cid, user, body) {
  needActive({ user });
  const c = findComment(scope, ref, ep, cid);
  const r = body.reaction === null || body.reaction === undefined || body.reaction === '' ? null : str(body.reaction, 10).toLowerCase();
  if (r !== null && !REACTIONS.includes(r)) throw bad('تفاعل غير معروف');
  const rm = reactMap(c);
  if (r === null) delete rm[user.id]; else rm[user.id] = r;
  c.likes = Object.keys(rm); save();
  const o = commentPublic(c, user);
  return { ok: true, reactions: o.reactions, my_reaction: o.my_reaction, likes: o.likes };
}
/** POST .../comments/:cid/edit {text} — لصاحب التعليق فقط */
function editComment(scope, ref, ep, cid, user, body) {
  needActive({ user }); needVoice(user);
  const c = findComment(scope, ref, ep, cid);
  if (c.user_id !== user.id) throw forbidden('لا يمكنك تعديل تعليق غيرك');
  const text = str(body.text, 2000);
  if (!text) throw bad('اكتب نص التعليق');
  if (text !== c.text) { c.text = text; c.edited = true; }
  save();
  return commentPublic(c, user);
}
/** POST .../comments/:cid/delete — صاحب التعليق، أو صاحب المنشور لتعليقات منشوره ([ownerId]) */
function deleteComment(scope, ref, ep, cid, user, ownerId) {
  const c = findComment(scope, ref, ep, cid);
  if (c.user_id !== user.id && !(ownerId && ownerId === user.id)) throw forbidden('لا تملك صلاحية حذف هذا التعليق');
  const kill = new Set([c.id]);
  for (let grew = true; grew;) { grew = false; for (const x of db.comments) if (x.parent_id && kill.has(x.parent_id) && !kill.has(x.id)) { kill.add(x.id); grew = true; } }
  db.comments = db.comments.filter((x) => !kill.has(x.id)); save();
  return { ok: true, deleted: kill.size };
}
function checkEpisode(sid, key) {
  const s = seriesById(sid);
  if (!s || isHidden(s.id)) throw notFound('العمل غير موجود');
  const k = toInt(key, 0);
  if (!(db.episodes[sid] || []).some((e) => e.season * 10000 + e.number === k)) throw notFound('الحلقة غير موجودة');
  return k;
}
const checkSeries = (id) => { const s = seriesById(id); if (!s || isHidden(s.id)) throw notFound('العمل غير موجود'); return s.id; };

GET('/series/:id/comments', 'optional', ({ params, user, q }) => listComments('series', checkSeries(params.id), null, user, q));
POST('/series/:id/comments', 'user', ({ params, user, body }) => { needActive({ user }); return addComment('series', checkSeries(params.id), null, user, body); });
POST('/series/:id/comments/:cid/like', 'user', ({ params, user }) => likeComment('series', checkSeries(params.id), null, params.cid, user));
GET('/series/:id/episodes/:key/comments', 'optional', ({ params, user, q }) => listComments('series', params.id, checkEpisode(params.id, params.key), user, q));
POST('/series/:id/episodes/:key/comments', 'user', ({ params, user, body }) => { needActive({ user }); return addComment('series', params.id, checkEpisode(params.id, params.key), user, body); });
POST('/series/:id/episodes/:key/comments/:cid/like', 'user', ({ params, user }) => likeComment('series', params.id, checkEpisode(params.id, params.key), params.cid, user));
POST('/series/:id/comments/:cid/react', 'user', ({ params, user, body }) => reactComment('series', checkSeries(params.id), null, params.cid, user, body));
POST('/series/:id/comments/:cid/edit', 'user', ({ params, user, body }) => editComment('series', checkSeries(params.id), null, params.cid, user, body));
POST('/series/:id/comments/:cid/delete', 'user', ({ params, user }) => deleteComment('series', checkSeries(params.id), null, params.cid, user, ''));
POST('/series/:id/episodes/:key/comments/:cid/react', 'user', ({ params, user, body }) => reactComment('series', params.id, checkEpisode(params.id, params.key), params.cid, user, body));
POST('/series/:id/episodes/:key/comments/:cid/edit', 'user', ({ params, user, body }) => editComment('series', params.id, checkEpisode(params.id, params.key), params.cid, user, body));
POST('/series/:id/episodes/:key/comments/:cid/delete', 'user', ({ params, user }) => deleteComment('series', params.id, checkEpisode(params.id, params.key), params.cid, user, ''));

// ════════════════════════════════════════════════════════════════════════
//  [5] الأخبار والإشعارات
// ════════════════════════════════════════════════════════════════════════
const newsPublic = (n) => ({ id: n.id, title: n.title, body: n.body, created_at: rel(n.at), created_ts: n.at, category: n.category || 'أخبار', image: absUrl(n.image) || null });
GET('/news', 'none', ({ q }) => db.news.slice().sort((a, b) => b.at - a.at).slice(0, clamp(toInt(q.limit, 100), 1, 200)).map(newsPublic));
GET('/news/:id', 'none', ({ params }) => {
  const n = db.news.find((x) => x.id === params.id);
  if (!n) throw notFound('الخبر غير موجود');
  return newsPublic(n);
});
GET('/notifications', 'optional', ({ q, user }) => {
  let ids = csv(q.series_ids);
  if (!ids.length && user) ids = getLibrary(user.id).followed;
  const out = [];
  const since = now() - NEW_EPISODE_DAYS * 86400000;
  for (const sid of uniq(ids).slice(0, 300)) {
    const s = seriesById(sid);
    if (!s || isHidden(sid)) continue;
    for (const e of db.episodes[sid] || []) {
      if (!e.added_at || e.added_at < since) continue;
      out.push({
        id: 'ep_' + sid + '_' + (e.season * 10000 + e.number), title: 'حلقة جديدة · ' + s.title,
        body: 'صدرت الحلقة ' + e.number + (s.seasons > 1 ? ' من الموسم ' + e.season : '') + ' وهي متاحة الآن للمشاهدة والتحميل',
        created_at: rel(e.added_at), series_id: sid, chapter: e.number, read: false, _at: e.added_at,
      });
    }
  }
  for (const b of db.broadcasts) out.push({ id: 'bc_' + b.id, title: b.title, body: b.body, image: b.image ? absUrl(b.image) : null, created_at: rel(b.at), series_id: b.series_id || null, chapter: null, read: false, _at: b.at });
  return out.sort((a, b) => b._at - a._at).slice(0, 60).map(({ _at, ...r }) => r);
});

/** إشعارات الأدمن لشريط إشعارات الهاتف. يفحصها التطبيق دورياً (WorkManager) حتى وهو مغلق.
 *  بلا since (أول تشغيل): لا إشعارات، فقط «now» حتى لا يرى المستخدم الجديد إشعارات قديمة.
 *  مع since: الأحدث من since (الأقدم أولاً، حتى 5). now = ساعة السيرفر بالميلي ثانية. */
GET('/broadcasts', 'none', ({ q }) => {
  const t = now();
  const since = parseInt(q.since, 10) || 0;
  if (!since) return { now: t, broadcasts: [] };
  const list = db.broadcasts.filter((b) => b.at > since).sort((a, b) => a.at - b.at).slice(0, 5)
    .map((b) => ({ id: String(b.id), title: b.title, body: b.body, image: b.image ? absUrl(b.image) : '', series_id: b.series_id || '', created_at_ms: b.at }));
  return { now: t, broadcasts: list };
});

// ════════════════════════════════════════════════════════════════════════
//  [6] المكتبة: /library
// ════════════════════════════════════════════════════════════════════════
GET('/library', 'user', ({ user }) => {
  const lib = getLibrary(user.id);
  const history = [];
  for (const [sid, p] of Object.entries(lib.progress || {})) {
    const s = seriesById(sid);
    history.push({ series_id: sid, title: s ? s.title : 'عمل', chapter: isObj(p) ? (p.c ?? p.chapter ?? '') : '', page: isObj(p) ? (p.p ?? p.page ?? '') : '' });
  }
  return {
    followed: lib.followed.map(seriesById).filter((s) => s && !isHidden(s.id)).map(seriesPublic),
    lists: lib.lists.map((l) => ({ id: l.id, name: l.name, is_public: !!l.is_public, items: l.items })),
    history,
  };
});
POST('/library/sync', 'user', ({ user, body }) => {
  const lib = getLibrary(user.id);
  if (Array.isArray(body.followed_series)) lib.followed = uniq(body.followed_series.map((x) => str(x, 60)).filter(Boolean)).slice(0, 2000);
  if (isObj(body.read_chapters)) {
    lib.read_chapters = {};
    for (const [k, v] of Object.entries(body.read_chapters).slice(0, 2000)) if (Array.isArray(v)) lib.read_chapters[str(k, 60)] = v.map((n) => toInt(n)).slice(0, 5000);
  }
  if (isObj(body.progress)) {
    lib.progress = {};
    for (const [k, v] of Object.entries(body.progress).slice(0, 2000)) if (isObj(v)) lib.progress[str(k, 60)] = { c: toInt(v.c, 1), p: toInt(v.p, 1), t: toInt(v.t, 1) };
  }
  if (isObj(body.reading_seconds)) {
    lib.reading_seconds = {};
    for (const [k, v] of Object.entries(body.reading_seconds).slice(0, 2000)) lib.reading_seconds[str(k, 60)] = Math.max(0, toInt(v));
    user.watch_secs = Object.values(lib.reading_seconds).reduce((a, v) => a + toInt(v, 0), 0); // يغذّي الأصفر (100 ساعة)
  }
  if (Array.isArray(body.recommended)) lib.recommended = uniq(body.recommended.map((x) => str(x, 60)).filter(Boolean)).slice(0, 200);
  save();
  return { ok: true };
});
POST('/library/lists', 'user', ({ user, body }) => {
  const name = str(body.name, 60);
  if (!name) throw bad('اسم القائمة مطلوب');
  const lib = getLibrary(user.id);
  if (lib.lists.length >= 100) throw bad('وصلت للحد الأقصى من القوائم');
  const l = { id: uid('l'), name, is_public: bool(body.is_public), items: [] };
  lib.lists.push(l); save();
  return { ok: true, ...l };
});
POST('/library/lists/:id/items', 'user', ({ user, params, body }) => {
  const l = getLibrary(user.id).lists.find((x) => x.id === params.id);
  if (!l) throw notFound('القائمة غير موجودة');
  const sid = str(body.series_id, 60);
  if (!seriesById(sid)) throw bad('العمل غير موجود');
  if (!l.items.includes(sid)) l.items.push(sid);
  save();
  return { ok: true, items: l.items };
});
DEL('/library/lists/:id/items/:sid', 'user', ({ user, params }) => {
  const l = getLibrary(user.id).lists.find((x) => x.id === params.id);
  if (!l) throw notFound('القائمة غير موجودة');
  l.items = l.items.filter((x) => x !== params.sid); save();
  return { ok: true, items: l.items };
});
DEL('/library/lists/:id', 'user', ({ user, params }) => {
  const lib = getLibrary(user.id);
  if (!lib.lists.some((x) => x.id === params.id)) throw notFound('القائمة غير موجودة');
  lib.lists = lib.lists.filter((x) => x.id !== params.id); save();
  return { ok: true };
});

// ════════════════════════════════════════════════════════════════════════
//  [7] المنشورات: /posts
// ════════════════════════════════════════════════════════════════════════
function postPublic(p, viewer) {
  const a = authorInfo(p.author_id, 'مشاهد');
  const rx = {};
  for (const [k, v] of Object.entries(p.base_reactions || {})) rx[k] = v;
  for (const r of Object.values(p.reactions || {})) rx[r] = (rx[r] || 0) + 1;
  let poll = null;
  if (p.poll) {
    const votes = p.poll.votes || {};
    poll = {
      question: p.poll.question,
      options: p.poll.options.map((o) => ({ id: o.id, text: o.text, votes: (o.base || 0) + Object.values(votes).filter((v) => v === o.id).length })),
      my_vote: viewer ? votes[viewer.id] || null : null,
    };
  }
  return {
    id: p.id, author: a.author, author_id: a.author_id, badge: a.badge, body: p.body, tag: p.tag || '',
    created_at: rel(p.at), created_ts: p.at, comments: db.comments.filter((c) => c.scope === 'post' && c.ref === p.id).length,
    images: (p.images || []).map(absUrl), poll, reactions: rx, my_reaction: viewer ? (p.reactions || {})[viewer.id] || null : null,
    privacy: postPriv(p), edited: !!p.edited,
  };
}
const postVisible = (p) => { const u = userById(p.author_id); return !(u && u.banned); };
/** [viewer] اختياري: إن مُرِّر (حتى null) يُطبَّق عليه تقييد «من يرى المنشور» (يُعاد 404 لمن لا يحق له) */
function findPost(id, viewer) {
  const p = db.posts.find((x) => x.id === id);
  if (!p || !postVisible(p) || (viewer !== undefined && !canPost(p, viewer, 'view'))) throw notFound('المنشور غير موجود');
  return p;
}
GET('/posts', 'optional', ({ user, q }) => {
  const page = Math.max(1, toInt(q.page, 1)); const limit = clamp(toInt(q.limit, 50), 1, 100);
  let l = db.posts.filter((p) => postVisible(p) && canPost(p, user, 'view'));
  if (q.tag) l = l.filter((p) => p.tag === q.tag);
  if (q.user_id) l = l.filter((p) => p.author_id === q.user_id);
  return l.sort((a, b) => b.at - a.at).slice((page - 1) * limit, page * limit).map((p) => postPublic(p, user));
});

/** يبني استفتاءً من JSON {question, options:[نص | {text}]} (2 إلى 5 خيارات) */
function buildPoll(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let j = raw;
  if (typeof raw === 'string') { try { j = JSON.parse(raw); } catch { throw bad('صيغة الاستفتاء غير صالحة'); } }
  if (!isObj(j)) return null;
  const question = str(j.question, 200);
  const opts = (Array.isArray(j.options) ? j.options : []).map((o) => str(isObj(o) ? o.text || o.label : o, 100)).filter(Boolean);
  if (!question) throw bad('سؤال الاستفتاء مطلوب');
  if (opts.length < 2 || opts.length > 5) throw bad('الاستفتاء من 2 إلى 5 خيارات');
  return { question, options: opts.map((text, i) => ({ id: 'o' + (i + 1), text, base: 0 })), votes: {} };
}
POST('/posts', 'user', ({ user, body, files }) => {
  needActive({ user }); needVoice(user);
  const text = str(body.body ?? body.text, 5000);
  const imgs = (files.images || files['images[]'] || files.image || []).slice(0, 4);
  const poll = buildPoll(body.poll);
  if (!text && !imgs.length && !poll) throw bad('اكتب نصاً أو أرفق صورة');
  throttle(user.id, 6, 60000);
  const p = { id: uid('p'), author_id: user.id, tag: str(body.tag, 30), body: text, images: imgs.map(saveImage), poll, reactions: {}, base_reactions: {}, privacy: mergePrivacy(body.privacy, privacyDefaults(user)), at: now() };
  db.posts.unshift(p); save();
  return postPublic(p, user);
});
DEL('/posts/:id', 'user', ({ user, params }) => {
  const p = findPost(params.id);
  if (p.author_id !== user.id) throw forbidden('لا يمكنك حذف منشور غيرك');
  deletePostCascade(p.id); save();
  return { ok: true };
});
POST('/posts/:id/react', 'user', ({ user, params, body }) => {
  needActive({ user });
  const p = findPost(params.id, user);
  if (!canPost(p, user, 'react')) throw forbidden('صاحب المنشور قيّد التفاعل');
  const r = body.reaction === null || body.reaction === undefined || body.reaction === '' ? null : str(body.reaction, 10).toLowerCase();
  if (r !== null && !REACTIONS.includes(r)) throw bad('تفاعل غير معروف');
  p.reactions = p.reactions || {};
  if (r === null) delete p.reactions[user.id]; else p.reactions[user.id] = r;
  save();
  const o = postPublic(p, user);
  return { ok: true, reactions: o.reactions, my_reaction: o.my_reaction };
});
POST('/posts/:id/vote', 'user', ({ user, params, body }) => {
  needActive({ user });
  const p = findPost(params.id, user);
  if (!p.poll) throw bad('لا يوجد استفتاء في هذا المنشور');
  const opt = body.option_id === null || body.option_id === undefined || body.option_id === '' ? null : str(body.option_id, 20);
  if (opt !== null && !p.poll.options.some((o) => o.id === opt)) throw bad('خيار غير موجود');
  p.poll.votes = p.poll.votes || {};
  if (opt === null || p.poll.votes[user.id] === opt) delete p.poll.votes[user.id]; else p.poll.votes[user.id] = opt;
  save();
  return { ok: true, poll: postPublic(p, user).poll };
});
GET('/posts/:id/comments', 'optional', ({ params, user, q }) => listComments('post', findPost(params.id, user || null).id, null, user, q));
POST('/posts/:id/comments', 'user', ({ params, user, body }) => {
  needActive({ user });
  const p = findPost(params.id, user);
  if (!canPost(p, user, 'comment')) throw forbidden('صاحب المنشور قيّد التعليق');
  return addComment('post', p.id, null, user, body);
});
POST('/posts/:id/comments/:cid/like', 'user', ({ params, user }) => likeComment('post', findPost(params.id, user).id, null, params.cid, user));
POST('/posts/:id/comments/:cid/react', 'user', ({ params, user, body }) => reactComment('post', findPost(params.id, user).id, null, params.cid, user, body));
POST('/posts/:id/comments/:cid/edit', 'user', ({ params, user, body }) => editComment('post', findPost(params.id, user).id, null, params.cid, user, body));
POST('/posts/:id/comments/:cid/delete', 'user', ({ params, user }) => { const p = findPost(params.id, user); return deleteComment('post', p.id, null, params.cid, user, p.author_id); });

function deletePostCascade(id) {
  const p = db.posts.find((x) => x.id === id);
  if (p) for (const img of p.images || []) removeUpload(img);
  db.posts = db.posts.filter((x) => x.id !== id);
  db.comments = db.comments.filter((c) => !(c.scope === 'post' && c.ref === id));
}
function removeUpload(u) {
  const m = /^\/uploads\/([\w.\-]+)$/.exec(u || '');
  if (m) fileDel(m[1]);
}

// ════════════════════════════════════════════════════════════════════════
//  [8] المحادثات: /chats (رسائل مباشرة بين مستخدمين)
// ════════════════════════════════════════════════════════════════════════
function chatFor(me, other) {
  return db.chats.find((c) => c.members.includes(me) && c.members.includes(other));
}
function chatPublic(c, me) {
  const otherId = c.members.find((m) => m !== me) || me;
  const o = userById(otherId); const last = c.messages[c.messages.length - 1];
  return {
    id: c.id, user_id: otherId, name: o ? o.name : 'مشاهد', badge: o ? effBadge(o) : 'none',
    last_message: last ? last.text : '', time: last ? rel(last.at) : '', updated_at: last ? last.at : c.at,
    unread: c.messages.filter((m) => m.from !== me && !(m.read || []).includes(me)).length,
  };
}
function chatMine(user, id) {
  const c = db.chats.find((x) => x.id === id);
  if (!c || !c.members.includes(user.id)) throw notFound('المحادثة غير موجودة');
  return c;
}
GET('/chats', 'user', ({ user }) => db.chats.filter((c) => c.members.includes(user.id) && c.messages.length)
  .map((c) => chatPublic(c, user.id)).sort((a, b) => b.updated_at - a.updated_at));
/** بدء محادثة مع مستخدم (أو استرجاع الموجودة) — {user_id} */
POST('/chats', 'user', ({ user, body }) => {
  needActive({ user });
  const other = userById(str(body.user_id, 60));
  if (!other || other.id === user.id || other.deleted) throw bad('مستخدم غير صالح');
  let c = chatFor(user.id, other.id);
  if (!c) { c = { id: uid('ch'), members: [user.id, other.id], messages: [], at: now() }; db.chats.push(c); save(); }
  return chatPublic(c, user.id);
});
GET('/chats/:id/messages', 'user', ({ user, params }) => {
  const c = chatMine(user, params.id);
  let changed = false;
  for (const m of c.messages) if (m.from !== user.id && !(m.read || []).includes(user.id)) { (m.read = m.read || []).push(user.id); changed = true; }
  if (changed) save();
  return c.messages.slice(-300).map((m) => ({ id: m.id, text: m.text, mine: m.from === user.id, created_at: rel(m.at), created_ts: m.at }));
});
POST('/chats/:id/messages', 'user', ({ user, params, body }) => {
  needActive({ user }); needVoice(user);
  const c = chatMine(user, params.id);
  const text = str(body.text, 2000);
  if (!text) throw bad('الرسالة فارغة');
  throttle('m' + user.id, 40, 60000);
  const m = { id: uid('m'), from: user.id, text, at: now(), read: [] };
  c.messages.push(m); if (c.messages.length > 2000) c.messages.splice(0, c.messages.length - 2000);
  save();
  return { id: m.id, text, mine: true, created_at: rel(m.at), created_ts: m.at };
});

// ════════════════════════════════════════════════════════════════════════
//  [9] المجموعات: /groups (نفس منطق groups.dart: مسؤول / مشرفون / أعضاء)
// ════════════════════════════════════════════════════════════════════════
const JOIN_MODES = ['auto', 'manual', 'closed'];
const gNewCode = () => { const ch = 'abcdefghjkmnpqrstuvwxyz23456789'; let c; do { c = Array.from(crypto.randomBytes(8), (b) => ch[b % ch.length]).join(''); } while (db.groups.some((g) => g.code === c)); return c; };
const gRole = (g, id) => (g.owner === id ? 'owner' : !g.members.some((m) => m.id === id) ? 'none' : g.mods.includes(id) ? 'mod' : 'member');
const gManage = (g, id) => ['owner', 'mod'].includes(gRole(g, id));
function gCanEditInfo(g, id) {
  const r = gRole(g, id);
  if (r === 'none') return false;
  if (r === 'owner') return true;
  if (r === 'mod') return g.mods_edit || g.members_edit;
  return g.members_edit;
}
const gName = (id) => { const u = userById(id); return u ? u.name : 'مشاهد'; };
function groupPublic(g, me) {
  const role = gRole(g, me); const last = g.messages[g.messages.length - 1];
  return {
    id: g.id, code: g.code, link: 'sedhok://group/' + g.code, name: g.name, desc: g.desc, photo: absUrl(g.photo) || '', owner: g.owner,
    public: g.public, frozen: !!g.frozen, mode: g.mode, mods_edit: g.mods_edit, members_edit: g.members_edit, members_count: g.members.length,
    role, is_member: role !== 'none', pending: g.requests.some((r) => r.id === me),
    requests_count: gManage(g, me) ? g.requests.length : 0, can_edit: gCanEditInfo(g, me), can_manage: gManage(g, me),
    last_message: last ? { text: last.t, sender: gName(last.s), at: last.at, time: rel(last.at) } : null, created_at: g.at,
  };
}
/** المجموعة بالمعرّف أو بالرمز/الرابط. الخاصة لا تظهر في «اكتشف» لكن تُفتح لمن يملك الرمز أو المعرّف. */
function findGroup(idOrCode) {
  const s = str(idOrCode, 200);
  let g = db.groups.find((x) => x.id === s);
  if (!g) { const m = /([A-Za-z0-9]{6,12})\/?\s*$/.exec(s); if (m) g = db.groups.find((x) => x.code === m[1].toLowerCase()); }
  if (!g) throw notFound('المجموعة غير موجودة');
  return g;
}
const gTouch = (g) => { g.members = g.members.filter((m) => userById(m.id)); };
const groupSort = (a, b) => ((b.messages.at(-1) || {}).at || b.at) - ((a.messages.at(-1) || {}).at || a.at);

GET('/groups', 'user', ({ user }) => ({
  mine: db.groups.filter((g) => gRole(g, user.id) !== 'none').sort(groupSort).map((g) => groupPublic(g, user.id)),
  discover: db.groups.filter((g) => g.public && gRole(g, user.id) === 'none').map((g) => groupPublic(g, user.id)),
  pending_for_me: db.groups.filter((g) => g.owner === user.id).reduce((a, g) => a + g.requests.length, 0),
}));
POST('/groups', 'user', ({ user, body }) => {
  needActive({ user });
  const name = str(body.name, 60);
  if (!name) throw bad('اسم المجموعة مطلوب');
  if (db.groups.filter((g) => g.owner === user.id).length >= 20) throw bad('وصلت للحد الأقصى من المجموعات');
  const mode = JOIN_MODES.includes(body.mode) ? body.mode : 'manual';
  const g = { id: uid('g'), code: gNewCode(), name, desc: str(body.description ?? body.desc, 500), owner: user.id, public: bool(body.public ?? body.is_public, true), mode,
    photo: safeUrl(body.photo), mods_edit: true, members_edit: false, mods: [], members: [{ id: user.id, at: now() }], requests: [], messages: [], at: now() };
  db.groups.push(g); save();
  return groupPublic(g, user.id);
});
GET('/groups/:id', 'user', ({ user, params }) => groupPublic(findGroup(params.id, user.id, true), user.id));
function updateGroup({ user, params, body }) {
  const g = findGroup(params.id, user.id, true);
  const me = user.id; const owner = g.owner === me;
  const wantsAdmin = ['public', 'is_public', 'mode', 'mods_edit', 'members_edit'].some((k) => body[k] !== undefined);
  if (wantsAdmin && !owner) throw forbidden('هذه الإعدادات للمسؤول فقط');
  if ((body.name !== undefined || body.description !== undefined || body.desc !== undefined || body.photo !== undefined) && !gCanEditInfo(g, me)) throw forbidden('لا تملك صلاحية تعديل معلومات المجموعة');
  if (body.name !== undefined && str(body.name, 60)) g.name = str(body.name, 60);
  if (body.description !== undefined || body.desc !== undefined) g.desc = str(body.description ?? body.desc, 500);
  if (body.photo !== undefined) g.photo = safeUrl(body.photo);
  if (body.public !== undefined || body.is_public !== undefined) g.public = bool(body.public ?? body.is_public);
  if (body.mods_edit !== undefined) g.mods_edit = bool(body.mods_edit);
  if (body.members_edit !== undefined) g.members_edit = bool(body.members_edit);
  if (body.mode !== undefined) {
    if (!JOIN_MODES.includes(body.mode)) throw bad('نمط انضمام غير صالح');
    g.mode = body.mode;
    if (g.mode === 'auto') { for (const r of g.requests) if (!g.members.some((m) => m.id === r.id)) g.members.push({ id: r.id, at: now() }); g.requests = []; }
    else if (g.mode === 'closed') g.requests = [];
  }
  save();
  return groupPublic(g, me);
}
PATCH('/groups/:id', 'user', updateGroup);
PUT('/groups/:id', 'user', updateGroup);
DEL('/groups/:id', 'user', ({ user, params }) => {
  const g = findGroup(params.id, user.id, true);
  if (g.owner !== user.id) throw forbidden('المسؤول فقط يحذف المجموعة');
  db.groups = db.groups.filter((x) => x.id !== g.id); save();
  return { ok: true };
});
POST('/groups/:id/join', 'user', ({ user, params }) => {
  needActive({ user });
  const g = findGroup(params.id, user.id, true);
  let result;
  if (gRole(g, user.id) !== 'none') result = 'already';
  else if (g.requests.some((r) => r.id === user.id)) result = 'pending';
  else if (g.mode === 'closed') result = 'closed';
  else if (g.mode === 'auto') { g.members.push({ id: user.id, at: now() }); result = 'joined'; }
  else { g.requests.push({ id: user.id, at: now() }); result = 'pending'; }
  save();
  return { result, group: groupPublic(g, user.id) };
});
POST('/groups/:id/cancel-request', 'user', ({ user, params }) => {
  const g = findGroup(params.id, user.id, true);
  g.requests = g.requests.filter((r) => r.id !== user.id); save();
  return { ok: true };
});
POST('/groups/:id/leave', 'user', ({ user, params }) => {
  const g = findGroup(params.id, user.id, true);
  if (gRole(g, user.id) === 'none') throw bad('لست عضواً في المجموعة');
  const wasOwner = g.owner === user.id;
  g.members = g.members.filter((m) => m.id !== user.id); g.mods = g.mods.filter((m) => m !== user.id);
  if (wasOwner) {
    if (!g.members.length) db.groups = db.groups.filter((x) => x.id !== g.id);
    else {
      const sorted = g.members.slice().sort((a, b) => a.at - b.at);
      const next = sorted.find((m) => g.mods.includes(m.id)) || sorted[0];
      g.owner = next.id; g.mods = g.mods.filter((m) => m !== next.id);
    }
  }
  save();
  return { ok: true };
});
GET('/groups/:id/members', 'user', ({ user, params }) => {
  const g = findGroup(params.id, user.id, true);
  if (gRole(g, user.id) === 'none') throw forbidden('للأعضاء فقط');
  gTouch(g);
  return g.members.map((m) => ({ id: m.id, name: gName(m.id), role: gRole(g, m.id), joined_at: m.at, badge: effBadge(userById(m.id) || {}) }));
});
GET('/groups/:id/requests', 'user', ({ user, params }) => {
  const g = findGroup(params.id, user.id, true);
  if (!gManage(g, user.id)) throw forbidden('للمسؤول والمشرفين فقط');
  return g.requests.filter((r) => userById(r.id)).map((r) => ({ id: r.id, name: gName(r.id), at: r.at }));
});
function decideRequest(approve) {
  return ({ user, params }) => {
    const g = findGroup(params.id, user.id, true);
    if (!gManage(g, user.id)) throw forbidden('للمسؤول والمشرفين فقط');
    const i = g.requests.findIndex((r) => r.id === params.uid);
    if (i < 0) throw notFound('الطلب غير موجود');
    const r = g.requests.splice(i, 1)[0];
    if (approve && !g.members.some((m) => m.id === r.id)) g.members.push({ id: r.id, at: now() });
    save();
    return { ok: true };
  };
}
POST('/groups/:id/requests/:uid/approve', 'user', decideRequest(true));
POST('/groups/:id/requests/:uid/reject', 'user', decideRequest(false));
DEL('/groups/:id/members/:uid', 'user', ({ user, params }) => {
  const g = findGroup(params.id, user.id, true);
  const target = params.uid;
  if (target === g.owner || target === user.id) throw forbidden('لا يمكن إزالة المسؤول أو نفسك (استعمل المغادرة)');
  const allowed = g.owner === user.id || (gRole(g, user.id) === 'mod' && !g.mods.includes(target));
  if (!allowed) throw forbidden('لا تملك صلاحية إزالة هذا العضو');
  g.members = g.members.filter((m) => m.id !== target); g.mods = g.mods.filter((m) => m !== target); save();
  return { ok: true };
});
POST('/groups/:id/moderators/:uid', 'user', ({ user, params, body }) => {
  const g = findGroup(params.id, user.id, true);
  if (g.owner !== user.id) throw forbidden('المسؤول فقط يعيّن المشرفين');
  if (params.uid === g.owner || !g.members.some((m) => m.id === params.uid)) throw bad('عضو غير صالح');
  const on = bool(body.on ?? body.moderator, true);
  g.mods = on ? uniq([...g.mods, params.uid]) : g.mods.filter((m) => m !== params.uid); save();
  return { ok: true, role: gRole(g, params.uid) };
});
GET('/groups/:id/messages', 'user', ({ user, params, q }) => {
  const g = findGroup(params.id, user.id, true);
  if (gRole(g, user.id) === 'none') throw forbidden('للأعضاء فقط');
  const after = toInt(q.after, 0);
  return g.messages.filter((m) => m.at > after).slice(-300).map((m) => ({ id: m.id, sender_id: m.s, sender: gName(m.s), text: m.t, mine: m.s === user.id, at: m.at, time: rel(m.at) }));
});
POST('/groups/:id/messages', 'user', ({ user, params, body }) => {
  needActive({ user }); needVoice(user);
  const g = findGroup(params.id, user.id, true);
  if (g.frozen) throw forbidden('المجموعة مجمّدة من الإدارة');
  if (gRole(g, user.id) === 'none') throw forbidden('للأعضاء فقط');
  const text = str(body.text, 2000);
  if (!text) throw bad('الرسالة فارغة');
  throttle('g' + user.id, 40, 60000);
  const m = { id: uid('gm'), s: user.id, t: text, at: now() };
  g.messages.push(m); if (g.messages.length > 3000) g.messages.splice(0, g.messages.length - 3000);
  save();
  return { id: m.id, sender_id: user.id, sender: user.name, text, mine: true, at: m.at, time: rel(m.at) };
});

// ════════════════════════════════════════════════════════════════════════
//  [11] التواصل الاجتماعي: الخصوصية، الصداقة، المتابعة، البروفايل، فيسبوك، وتتبّع النشاط
//       (عقد التطبيق: docs/SOCIAL_API.md و docs/ADMIN_API.md)
// ════════════════════════════════════════════════════════════════════════
const REL_STATUSES = ['single', 'in_relationship', 'engaged', 'married', 'complicated', 'separated', 'widowed'];
const PRIVACY_KEYS = ['details', 'friends_list', 'posts', 'comments', 'reactions', 'activity', 'story'];
const EVENT_TYPES = ['session', 'watch', 'finish', 'comment', 'post', 'chat', 'group', 'follow', 'friend', 'other'];
const ONLINE_MS = 100000; // «متصل الآن» = آخر نبضة أقل من 100 ثانية

const needVoice = (u) => { if (u && u.muted) throw forbidden('حسابك مكتوم حالياً ولا يمكنك الإرسال'); };

/** حفظ مؤجّل (للنبضات المتكررة) كي لا نكتب الملف كله كل 30 ثانية لكل مستخدم */
let lazyTimer = null;
function lazySave() {
  dirty = true;
  if (lazyTimer) return;
  lazyTimer = setTimeout(() => { lazyTimer = null; if (dirty) saveNow(); }, 15000);
  if (lazyTimer.unref) lazyTimer.unref();
}

// ───────── الخصوصية ─────────
/** يقبل everyone | friends | only_me (وأشكالاً قديمة) */
function audience(v, d = 'everyone') {
  const t = str(v, 20);
  if (t === 'everyone' || t === 'الجميع') return 'everyone';
  if (t === 'friends' || t === 'الأصدقاء') return 'friends';
  if (['only_me', 'onlyMe', 'me', 'private', 'أنا فقط'].includes(t)) return 'only_me';
  return d;
}
function privacyOf(u) {
  const p = (u && u.privacy) || {};
  const o = {};
  for (const k of PRIVACY_KEYS) o[k] = audience(p[k]);
  o.allow_requests = p.allow_requests !== false;
  o.allow_follow = p.allow_follow !== false;
  return o;
}
function audienceAllows(aud, relation) {
  if (relation === 'self') return true;
  if (aud === 'everyone') return true;
  if (aud === 'friends') return relation === 'friends';
  return false;
}
function privacyDefaults(u) { const d = privacyOf(u); return { view: d.posts, comment: d.comments, react: d.reactions }; }
/** خصوصية المنشور {view, comment, react} من JSON (نص أو كائن) فوق قيمة أساسية */
function mergePrivacy(raw, base) {
  let j = raw;
  if (typeof raw === 'string' && raw) { try { j = JSON.parse(raw); } catch { j = null; } }
  if (!isObj(j)) return { ...base };
  return { view: audience(j.view, base.view), comment: audience(j.comment, base.comment), react: audience(j.react, base.react) };
}
function postPriv(p) { const x = p.privacy || {}; return { view: audience(x.view), comment: audience(x.comment), react: audience(x.react) }; }
/** هل يستطيع [viewer] (قد يكون null) فعل [what] = view|comment|react على المنشور؟ */
function canPost(p, viewer, what) {
  return audienceAllows(postPriv(p)[what], relationOf(viewer ? viewer.id : '', p.author_id));
}

// ───────── العلاقات ─────────
const liveUser = (id) => { const u = userById(id); return u && !u.deleted && !u.banned ? u : null; };
const areFriends = (a, b) => db.friendships.some((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));
const friendIds = (id) => db.friendships.filter((f) => f.a === id || f.b === id).map((f) => (f.a === id ? f.b : f.a)).filter((x) => { const u = userById(x); return u && !u.deleted; });
const followerIds = (id) => db.follows.filter((f) => f.to === id).map((f) => f.from);
const followingIds = (id) => db.follows.filter((f) => f.from === id).map((f) => f.to);
function mutualCount(a, b) { const fa = new Set(friendIds(a)); return friendIds(b).filter((x) => fa.has(x)).length; }
/** none | friends | request_sent | request_received | self */
function relationOf(viewerId, targetId) {
  if (!viewerId) return 'none';
  if (viewerId === targetId) return 'self';
  if (areFriends(viewerId, targetId)) return 'friends';
  if (db.friend_requests.some((r) => r.from === viewerId && r.to === targetId)) return 'request_sent';
  if (db.friend_requests.some((r) => r.from === targetId && r.to === viewerId)) return 'request_received';
  return 'none';
}
function personPublic(u, viewerId) {
  return {
    id: u.id, name: u.name, badge: effBadge(u), avatar_url: absUrl(u.avatar_url || ''), bio: u.bio || '',
    mutual: viewerId && viewerId !== u.id ? mutualCount(viewerId, u.id) : 0,
  };
}
const peopleList = (ids, viewer) => uniq(ids).map(liveUser).filter(Boolean).map((u) => personPublic(u, viewer ? viewer.id : ''));
function otherUser(id, me) {
  const u = userById(str(id, 60));
  if (!u || u.deleted || u.id === me.id) throw bad('مستخدم غير صالح');
  return u;
}
function listTarget(id, viewer) {
  const t = userById(id);
  if (!t || t.deleted) throw notFound('المستخدم غير موجود');
  if (!audienceAllows(privacyOf(t).friends_list, relationOf(viewer ? viewer.id : '', t.id))) throw forbidden('هذه القائمة خاصة');
  return t;
}

// ───────── معلومات «حول» ─────────
function extrasOf(u) {
  const e = u.extras || {};
  return {
    country: e.country || '', city: e.city || '', hometown: e.hometown || '', work: e.work || '', education: e.education || '',
    relationship: e.relationship || '', partner: e.partner || '', birthday: e.birthday || '', gender: e.gender || '', website: e.website || '',
    interests: Array.isArray(e.interests) ? e.interests : [], cover_url: absUrl(e.cover_url || ''),
    story_text: e.story_text || '', story_image: absUrl(e.story_image || ''), story_at: e.story_at || 0, joined_at: u.created_at || 0,
  };
}

/** يزيل كل أثر اجتماعي/نشاط لعضو محذوف */
function purgeSocial(id) {
  db.friendships = db.friendships.filter((f) => f.a !== id && f.b !== id);
  db.friend_requests = db.friend_requests.filter((r) => r.from !== id && r.to !== id);
  db.follows = db.follows.filter((f) => f.from !== id && f.to !== id);
  delete db.activity.seen[id]; delete db.watch[id];
  db.activity.events = db.activity.events.filter((e) => e.user_id !== id);
  for (const p of db.posts) if (p.reactions) delete p.reactions[id];
  for (const c of db.comments) { if (c.reacts) delete c.reacts[id]; c.likes = (c.likes || []).filter((x) => x !== id); }
}

// ───────── تسجيل الدخول عبر فيسبوك ─────────
/** POST /auth/facebook {access_token} → {token, user}. التحقق عبر graph.facebook.com؛ ومع FACEBOOK_APP_ID/SECRET يُتحقق أن الرمز صادر لتطبيقك. */
POST('/auth/facebook', 'none', async ({ body, ip }) => {
  rateLimit(ip, 'facebook', 20, 15 * 60000);
  const token = str(body.access_token, 4096);
  if (!token) throw bad('access_token مطلوب');
  let info; let appChecked = false;
  try {
    if (FB_APP_ID && FB_APP_SECRET) {
      const d = await httpsGetJson('https://graph.facebook.com/debug_token?input_token=' + encodeURIComponent(token) + '&access_token=' + encodeURIComponent(FB_APP_ID + '|' + FB_APP_SECRET));
      const dd = d.json && d.json.data;
      if (d.status !== 200 || !dd || !dd.is_valid || String(dd.app_id) !== FB_APP_ID) throw new Error('invalid');
      appChecked = true;
    }
    const r = await httpsGetJson('https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=' + encodeURIComponent(token));
    if (r.status !== 200 || !r.json || !r.json.id) throw new Error('invalid');
    info = r.json;
  } catch { throw unauthorized('رمز فيسبوك غير صالح'); }
  const fbId = str(info.id, 40);
  const email = EMAIL_RX.test(str(info.email, 200).toLowerCase()) ? str(info.email, 200).toLowerCase() : '';
  let u = db.users.find((x) => x.facebook_id === fbId && !x.deleted);
  // الربط بحساب موجود بالبريد لا يتم إلا إن تأكدنا أن الرمز لتطبيقك (حماية من الاستيلاء)
  if (!u && appChecked && email) u = db.users.find((x) => x.email === email && !x.deleted);
  if (!u) {
    const pic = info.picture && info.picture.data && str(info.picture.data.url, 500);
    u = {
      id: uid('u'), name: str(info.name || (email ? email.split('@')[0] : 'مشاهد'), 60) || 'مشاهد',
      email: email && !db.users.some((x) => x.email === email) ? email : '', pass: '', facebook_id: fbId,
      avatar_url: pic && pic.startsWith('https://') ? pic : '', bio: '', badge: 'none', banned: false,
      joined: 'منذ ' + new Date().getFullYear(), created_at: now(), pv: 0,
    };
    db.users.push(u);
  } else if (!u.facebook_id) u.facebook_id = fbId;
  save();
  return sessionReply(u);
});

// ───────── خصوصية الحساب وبياناتي ─────────
GET('/users/me/privacy', 'user', ({ user }) => ({ privacy: privacyOf(user) }));
POST('/users/me/privacy', 'user', ({ user, body }) => {
  const src = isObj(body.privacy) ? body.privacy : body;
  const cur = privacyOf(user);
  for (const k of PRIVACY_KEYS) if (src[k] !== undefined) cur[k] = audience(src[k], cur[k]);
  for (const k of ['allow_requests', 'allow_follow']) if (src[k] !== undefined) cur[k] = bool(src[k], true);
  user.privacy = cur; save();
  return { ok: true, privacy: cur };
});
/** POST /uploads (مستخدم مسجّل): multipart بحقل file → {path, url}. للصورة الشخصية والغلاف وصورة القصة. */
POST('/uploads', 'user', ({ user, files }) => {
  needActive({ user });
  throttle(user.id + ':up', 20, 60000);
  const f = (files.file || files.image || files.images || [])[0];
  if (!f) throw bad('أرفق صورة في الحقل file');
  const path_ = saveImage(f);
  return { path: path_, url: absUrl(path_) };
});
/** POST /users/me/about: country, city, hometown, work, education, relationship, partner, birthday, gender, website, interests, cover_url, story_text, story_image, story_at */
POST('/users/me/about', 'user', ({ user, body }) => {
  const e = user.extras = isObj(user.extras) ? user.extras : {};
  const prevT = e.story_text || ''; const prevI = e.story_image || '';
  const put = (k, max) => { if (body[k] !== undefined) e[k] = str(body[k], max); };
  put('country', 60); put('city', 60); put('hometown', 60); put('work', 100); put('education', 100); put('partner', 60); put('birthday', 20); put('gender', 20);
  if (body.relationship !== undefined) { const r = str(body.relationship, 30); e.relationship = REL_STATUSES.includes(r) ? r : ''; }
  if (body.website !== undefined) e.website = safeUrl(body.website);
  if (body.interests !== undefined) e.interests = strList(body.interests).map((x) => x.slice(0, 40)).slice(0, 20);
  if (body.cover_url !== undefined) e.cover_url = safeUrl(body.cover_url);
  if (body.story_text !== undefined) e.story_text = str(body.story_text, 300);
  if (body.story_image !== undefined) e.story_image = safeUrl(body.story_image);
  // وقت القصة يحدّده الخادم (تنتهي بعد 24 ساعة) ولا يُؤخذ من العميل
  if (!e.story_text && !e.story_image) e.story_at = 0;
  else if ((e.story_text || '') !== prevT || (e.story_image || '') !== prevI || !e.story_at) e.story_at = now();
  save();
  return { ok: true, extras: extrasOf(user) };
});

// ───────── الصداقة ─────────
/** POST /friends/:id/request → {status: "sent" | "friends"} (إن كان بينكما طلب وارد يُقبل مباشرة) */
POST('/friends/:id/request', 'user', ({ user, params }) => {
  needActive({ user });
  const t = otherUser(params.id, user);
  throttle('fr' + user.id, 30, 60000);
  if (areFriends(user.id, t.id)) return { status: 'friends' };
  if (db.friend_requests.some((r) => r.from === user.id && r.to === t.id)) return { status: 'sent' };
  const inc = db.friend_requests.findIndex((r) => r.from === t.id && r.to === user.id);
  if (inc >= 0) { db.friend_requests.splice(inc, 1); db.friendships.push({ a: t.id, b: user.id, at: now() }); save(); return { status: 'friends' }; }
  if (t.banned) throw forbidden('لا يمكن إرسال طلب لهذا الحساب');
  if (!privacyOf(t).allow_requests) throw forbidden('هذا المستخدم لا يستقبل طلبات صداقة');
  if (db.friend_requests.filter((r) => r.from === user.id).length >= 200) throw bad('لديك طلبات معلّقة كثيرة. ألغِ بعضها أولاً.');
  db.friend_requests.push({ from: user.id, to: t.id, at: now() }); save();
  return { status: 'sent' };
});
POST('/friends/:id/cancel', 'user', ({ user, params }) => {
  db.friend_requests = db.friend_requests.filter((r) => !(r.from === user.id && r.to === params.id)); save();
  return { ok: true };
});
POST('/friends/:id/accept', 'user', ({ user, params }) => {
  needActive({ user });
  if (areFriends(user.id, params.id)) return { ok: true, status: 'friends' };
  const i = db.friend_requests.findIndex((r) => r.from === params.id && r.to === user.id);
  if (i < 0) throw notFound('الطلب غير موجود');
  const from = userById(params.id);
  db.friend_requests.splice(i, 1);
  if (from && !from.deleted) db.friendships.push({ a: params.id, b: user.id, at: now() });
  save();
  return { ok: true, status: 'friends' };
});
POST('/friends/:id/decline', 'user', ({ user, params }) => {
  db.friend_requests = db.friend_requests.filter((r) => !(r.from === params.id && r.to === user.id)); save();
  return { ok: true };
});
POST('/friends/:id/remove', 'user', ({ user, params }) => {
  db.friendships = db.friendships.filter((f) => !((f.a === user.id && f.b === params.id) || (f.a === params.id && f.b === user.id))); save();
  return { ok: true };
});
/** GET /friends/requests?direction=in|out */
GET('/friends/requests', 'user', ({ user, q }) => {
  const incoming = str(q.direction, 5) !== 'out';
  const l = db.friend_requests.filter((r) => (incoming ? r.to : r.from) === user.id).sort((a, b) => b.at - a.at);
  return peopleList(l.map((r) => (incoming ? r.from : r.to)), user);
});
/** GET /friends/suggestions: أصدقاء الأصدقاء أولاً ثم الأحدث انضماماً */
GET('/friends/suggestions', 'user', ({ user }) => {
  const mine = new Set(friendIds(user.id));
  const blocked = new Set([user.id, ...mine]);
  for (const r of db.friend_requests) { if (r.from === user.id) blocked.add(r.to); if (r.to === user.id) blocked.add(r.from); }
  const score = new Map();
  for (const f of mine) for (const x of friendIds(f)) if (!blocked.has(x)) score.set(x, (score.get(x) || 0) + 1);
  return db.users.filter((u) => liveUser(u.id) && !u.system && !blocked.has(u.id) && privacyOf(u).allow_requests)
    .sort((a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0) || (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 30).map((u) => personPublic(u, user.id));
});

// ───────── قوائم المستخدم والمتابعة ─────────
GET('/users/:id/friends', 'optional', ({ params, user }) => peopleList(friendIds(listTarget(params.id, user).id), user));
GET('/users/:id/followers', 'optional', ({ params, user }) => peopleList(followerIds(listTarget(params.id, user).id), user));
GET('/users/:id/following', 'optional', ({ params, user }) => peopleList(followingIds(listTarget(params.id, user).id), user));
POST('/users/:id/follow', 'user', ({ user, params }) => {
  needActive({ user });
  const t = otherUser(params.id, user);
  if (!privacyOf(t).allow_follow) throw forbidden('هذا المستخدم لا يسمح بالمتابعة');
  throttle('fo' + user.id, 60, 60000);
  if (!db.follows.some((f) => f.from === user.id && f.to === t.id)) { db.follows.push({ from: user.id, to: t.id, at: now() }); save(); }
  return { ok: true, following: true, followers_count: followerIds(t.id).length };
});
POST('/users/:id/unfollow', 'user', ({ user, params }) => {
  db.follows = db.follows.filter((f) => !(f.from === user.id && f.to === params.id)); save();
  return { ok: true, following: false, followers_count: followerIds(params.id).length };
});

// ───────── تعديل/حذف المنشورات ─────────
/** POST /posts/:id/edit {body?, privacy?} — لصاحب المنشور فقط */
POST('/posts/:id/edit', 'user', ({ user, params, body }) => {
  needActive({ user });
  const p = findPost(params.id);
  if (p.author_id !== user.id) throw forbidden('لا يمكنك تعديل منشور غيرك');
  if (body.body !== undefined || body.text !== undefined) {
    needVoice(user);
    const t = str(body.body ?? body.text, 5000);
    if (!t && !(p.images || []).length && !p.poll) throw bad('نص المنشور فارغ');
    if (t !== p.body) { p.body = t; p.edited = true; }
  }
  if (body.privacy !== undefined) p.privacy = mergePrivacy(body.privacy, postPriv(p));
  save();
  return postPublic(p, user);
});
POST('/posts/:id/delete', 'user', ({ user, params }) => {
  const p = findPost(params.id);
  if (p.author_id !== user.id) throw forbidden('لا يمكنك حذف منشور غيرك');
  deletePostCascade(p.id); save();
  return { ok: true };
});

// ───────── تتبّع النشاط (من تطبيق المستخدم) ─────────
const seenOf = (id) => db.activity.seen[id] || null;
const isOnline = (id) => { const s = seenOf(id); return !!s && now() - s.last_seen < ONLINE_MS; };
/** POST /activity/heartbeat {platform} كل 30 ثانية والتطبيق مفتوح */
POST('/activity/heartbeat', 'user', ({ user, body }) => {
  const t = now(); const platform = str(body.platform, 20).toLowerCase() || 'unknown';
  let s = db.activity.seen[user.id];
  if (!s) s = db.activity.seen[user.id] = { first_seen: t, last_seen: t, sessions: 1, app_seconds: 0, platform };
  else {
    const d = t - s.last_seen;
    if (d < ONLINE_MS) s.app_seconds += Math.round(d / 1000); else s.sessions += 1;
    s.last_seen = t; s.platform = platform;
  }
  lazySave();
  return { ok: true };
});
/** POST /activity/events {type, text, ref} */
POST('/activity/events', 'user', ({ user, body }) => {
  throttle('ev' + user.id, 60, 60000);
  const type = str(body.type, 20);
  const list = db.activity.events;
  list.push({ id: uid('ev'), user_id: user.id, at: now(), type: EVENT_TYPES.includes(type) ? type : 'other', text: str(body.text, 300), ref: str(body.ref, 100) });
  if (list.length > 5000) list.splice(0, list.length - 5000);
  lazySave();
  return { ok: true };
});
/** POST /watch/progress {series_id, episode_key, position_ms, duration_ms} */
POST('/watch/progress', 'user', ({ user, body }) => {
  const sid = str(body.series_id, 60);
  if (!sid) throw bad('series_id مطلوب');
  const key = toInt(body.episode_key, 0);
  const mine = db.watch[user.id] = db.watch[user.id] || {};
  mine[sid + ':' + key] = { series_id: sid, episode_key: key, position_ms: Math.max(0, toInt(body.position_ms, 0)), duration_ms: Math.max(0, toInt(body.duration_ms, 0)), updated_at: now() };
  const keys = Object.keys(mine);
  if (keys.length > 3000) for (const k of keys.sort((a, b) => mine[a].updated_at - mine[b].updated_at).slice(0, keys.length - 3000)) delete mine[k];
  lazySave();
  return { ok: true };
});

// ════════════════════════════════════════════════════════════════════════
//  [10] الأدمن: /admin/*  (يقابل كل شاشات لوحة الأدمن في التطبيق)
//  كلها تتطلب  Authorization: Bearer <admin token>  عدا /admin/login
// ════════════════════════════════════════════════════════════════════════
POST('/admin/login', 'none', ({ body, ip }) => {
  rateLimit(ip, 'adminlogin', 10, 15 * 60000);
  const ok = str(body.username ?? body.user, 100) === db.admin.user && checkPassword(String(body.password ?? body.pass ?? ''), db.admin.pass);
  if (!ok) throw unauthorized('اسم الأدمن أو كلمة المرور غير صحيحة');
  return { token: adminSession(), username: db.admin.user, default_password: !!db.admin.default_pass };
});

// ───────── لوحة التحكم (الإحصاءات) ─────────
GET('/admin/stats', 'admin', async () => {
  let eps = 0; for (const l of Object.values(db.episodes)) eps += l.length;
  return {
    series: db.series.length, episodes: eps, users: db.users.filter((u) => !u.system).length, posts: db.posts.length, comments: db.comments.length,
    news: db.news.length, groups: db.groups.length, broadcasts: db.broadcasts.length, banned: db.users.filter((u) => u.banned).length,
    uploads: (await fileNames()).length, default_password: !!db.admin.default_pass,
  };
});

// ───────── الأعمال ─────────
const adminSeries = (s) => ({ ...seriesPublic(s), hidden: isHidden(s.id), featured: db.settings.featured.includes(s.id), base_rating: s.rating, rating_count: db.ratings[s.id] ? Object.keys(db.ratings[s.id]).length : 0 });
GET('/admin/series', 'admin', ({ q }) => {
  const term = str(q.q, 100).toLowerCase();
  return db.series.filter((s) => !term || s.title.toLowerCase().includes(term)).map(adminSeries);
});
GET('/admin/series/:id', 'admin', ({ params }) => {
  const s = seriesById(params.id); if (!s) throw notFound('العمل غير موجود');
  return adminSeries(s);
});
function applySeriesFlags(s, body) {
  if (body.hidden !== undefined) db.settings.hidden = bool(body.hidden) ? uniq([...db.settings.hidden, s.id]) : db.settings.hidden.filter((x) => x !== s.id);
  if (body.featured !== undefined) db.settings.featured = bool(body.featured) ? uniq([...db.settings.featured, s.id]) : db.settings.featured.filter((x) => x !== s.id);
}
POST('/admin/series', 'admin', ({ body }) => {
  const s = normSeries(body, null);
  if (seriesById(s.id)) throw conflict('المعرّف مستخدم');
  db.series.unshift(s); db.episodes[s.id] = [];
  applySeriesFlags(s, body); save();
  return adminSeries(s);
});
function updateSeries({ params, body }) {
  const s = seriesById(params.id); if (!s) throw notFound('العمل غير موجود');
  const n = normSeries(body, s);
  Object.assign(s, n, { episodes: s.episodes, seasons: s.seasons }); // العدّاد والمواسم تأتي من الحلقات
  if ((db.episodes[s.id] || []).length === 0) { s.episodes = n.episodes; s.seasons = n.seasons; }
  applySeriesFlags(s, body); save();
  return adminSeries(s);
}
PUT('/admin/series/:id', 'admin', updateSeries);
PATCH('/admin/series/:id', 'admin', updateSeries);
function deleteSeriesCascade(id) {
  const s = seriesById(id);
  if (s) { removeUpload(s.cover); for (const e of db.episodes[id] || []) removeUpload(e.thumb); }
  db.series = db.series.filter((x) => x.id !== id);
  delete db.episodes[id]; delete db.ratings[id];
  db.settings.featured = db.settings.featured.filter((x) => x !== id); db.settings.hidden = db.settings.hidden.filter((x) => x !== id);
  db.comments = db.comments.filter((c) => !(c.scope === 'series' && c.ref === id));
  db.broadcasts = db.broadcasts.filter((b) => b.series_id !== id);
  for (const lib of Object.values(db.libraries)) {
    lib.followed = (lib.followed || []).filter((x) => x !== id);
    if (lib.progress) delete lib.progress[id];
    lib.recommended = (lib.recommended || []).filter((x) => x !== id);
    for (const l of lib.lists || []) l.items = l.items.filter((x) => x !== id);
  }
}
DEL('/admin/series/:id', 'admin', ({ params }) => {
  if (!seriesById(params.id)) throw notFound('العمل غير موجود');
  deleteSeriesCascade(params.id); save();
  return { ok: true };
});
POST('/admin/series/:id/hide', 'admin', ({ params, body }) => {
  const s = seriesById(params.id); if (!s) throw notFound('العمل غير موجود');
  applySeriesFlags(s, { hidden: body.hidden === undefined ? true : body.hidden }); save();
  return adminSeries(s);
});
POST('/admin/series/:id/feature', 'admin', ({ params, body }) => {
  const s = seriesById(params.id); if (!s) throw notFound('العمل غير موجود');
  applySeriesFlags(s, { featured: body.featured === undefined ? true : body.featured }); save();
  return adminSeries(s);
});

// ───────── الحلقات ─────────
const adminEpisodes = (id) => sortEpisodes((db.episodes[id] || []).slice()).map((e) => ({ ...episodePublic(e), added_at: e.added_at }));
const needSeries = (id) => { const s = seriesById(id); if (!s) throw notFound('العمل غير موجود'); return s; };
GET('/admin/series/:id/episodes', 'admin', ({ params }) => { needSeries(params.id); return adminEpisodes(params.id); });
POST('/admin/series/:id/episodes', 'admin', ({ params, body }) => {
  needSeries(params.id);
  const list = db.episodes[params.id] = db.episodes[params.id] || [];
  const e = normEpisode(body, null);
  if (list.some((x) => x.season === e.season && x.number === e.number)) throw conflict('الحلقة ' + e.number + ' موجودة بالفعل في الموسم ' + e.season);
  list.push(e); sortEpisodes(list); syncSeriesFromEpisodes(params.id); save();
  return episodePublic(e);
});
/** إضافة عدة حلقات بنمط روابط: {season, from, to, title:'الحلقة {n}', player_pattern, dl_patterns:{'720p':'https://x/{n}.mp4'}, duration} */
POST('/admin/series/:id/episodes/bulk', 'admin', ({ params, body }) => {
  needSeries(params.id);
  const season = Math.max(1, toInt(body.season, 1)); const from = toInt(body.from, 1); const to = toInt(body.to, from);
  if (from < 1 || to < from || to - from > 500) throw bad('نطاق الحلقات غير صالح (حتى 500 حلقة)');
  const list = db.episodes[params.id] = db.episodes[params.id] || [];
  const dl = isObj(body.dl_patterns) ? body.dl_patterns : {};
  let added = 0;
  for (let n = from; n <= to; n++) {
    const fill = (p) => str(p, 2048).replace(/\{n\}/g, String(n));
    const e = normEpisode({
      number: n, season, title: fill(body.title || 'الحلقة {n}'), duration: toInt(body.duration, 0), date: dateLabel(now()),
      player_url: fill(body.player_pattern || body.player_url),
      sources: Object.fromEntries(Object.entries(dl).filter(([, p]) => str(p)).map(([q, p]) => [q, fill(p)])),
    }, null);
    const i = list.findIndex((x) => x.season === season && x.number === n);
    if (i >= 0) list.splice(i, 1);
    list.push(e); added++;
  }
  sortEpisodes(list); syncSeriesFromEpisodes(params.id); save();
  return { ok: true, added };
});
/** استبدال كل حلقات العمل دفعة واحدة (يقابل setEpisodes في التطبيق) */
PUT('/admin/series/:id/episodes', 'admin', ({ params, body }) => {
  needSeries(params.id);
  const arr = Array.isArray(body) ? body : Array.isArray(body.episodes) ? body.episodes : null;
  if (!arr) throw bad('أرسل مصفوفة حلقات في الحقل episodes');
  const old = new Map((db.episodes[params.id] || []).map((e) => [e.season * 10000 + e.number, e]));
  const out = []; const seen = new Set();
  for (const raw of arr) {
    const e = normEpisode(isObj(raw) ? raw : {}, old.get(toInt(raw && raw.season, 1) * 10000 + toInt(raw && raw.number, 0)));
    const k = e.season * 10000 + e.number;
    if (seen.has(k)) throw conflict('حلقة مكررة: الموسم ' + e.season + ' الحلقة ' + e.number);
    seen.add(k); out.push(e);
  }
  db.episodes[params.id] = sortEpisodes(out); syncSeriesFromEpisodes(params.id); save();
  return { ok: true, count: out.length };
});
const findEp = (id, key) => (db.episodes[id] || []).find((e) => e.season * 10000 + e.number === toInt(key, -1));
GET('/admin/series/:id/episodes/:key', 'admin', ({ params }) => {
  const e = findEp(params.id, params.key); if (!e) throw notFound('الحلقة غير موجودة');
  return episodePublic(e);
});
function updateEpisode({ params, body }) {
  needSeries(params.id);
  const list = db.episodes[params.id] || []; const e = findEp(params.id, params.key);
  if (!e) throw notFound('الحلقة غير موجودة');
  const n = normEpisode(body, e);
  if (list.some((x) => x !== e && x.season === n.season && x.number === n.number)) throw conflict('الحلقة ' + n.number + ' موجودة بالفعل في الموسم ' + n.season);
  Object.assign(e, n); sortEpisodes(list); syncSeriesFromEpisodes(params.id); save();
  return episodePublic(e);
}
PUT('/admin/series/:id/episodes/:key', 'admin', updateEpisode);
PATCH('/admin/series/:id/episodes/:key', 'admin', updateEpisode);
DEL('/admin/series/:id/episodes/:key', 'admin', ({ params }) => {
  needSeries(params.id);
  const k = toInt(params.key, -1);
  const list = db.episodes[params.id] || []; const e = findEp(params.id, k);
  if (!e) throw notFound('الحلقة غير موجودة');
  removeUpload(e.thumb);
  db.episodes[params.id] = list.filter((x) => x !== e);
  db.comments = db.comments.filter((c) => !(c.scope === 'series' && c.ref === params.id && c.ep === k));
  syncSeriesFromEpisodes(params.id); save();
  return { ok: true };
});

// ───────── الشاشة الرئيسية ─────────
const adminHome = () => ({
  announcement: db.settings.announcement,
  sections: Object.fromEntries(Object.entries(HOME_SECTIONS).map(([k, label]) => [k, { label, on: db.settings.sections[k] !== false }])),
  featured: db.settings.featured.map(seriesById).filter(Boolean).map(seriesPublic),
});
GET('/admin/home', 'admin', adminHome);
PUT('/admin/home', 'admin', ({ body }) => {
  if (isObj(body.announcement)) db.settings.announcement = { on: bool(body.announcement.on), text: str(body.announcement.text, 300) };
  if (isObj(body.sections)) for (const k of Object.keys(HOME_SECTIONS)) if (body.sections[k] !== undefined) db.settings.sections[k] = bool(isObj(body.sections[k]) ? body.sections[k].on : body.sections[k]);
  if (Array.isArray(body.featured)) db.settings.featured = uniq(body.featured.map((x) => str(isObj(x) ? x.id : x, 60))).filter((id) => seriesById(id));
  save();
  return adminHome();
});
POST('/admin/home/featured/:id', 'admin', ({ params, body }) => {
  const s = needSeries(params.id);
  const f = db.settings.featured; const i = f.indexOf(s.id);
  if (body.delta !== undefined) { // تحريك للأعلى/الأسفل (delta = -1 / +1)
    const j = i + toInt(body.delta, 0);
    if (i >= 0 && j >= 0 && j < f.length) [f[i], f[j]] = [f[j], f[i]];
  } else if (i < 0) f.push(s.id);
  save();
  return adminHome();
});
DEL('/admin/home/featured/:id', 'admin', ({ params }) => {
  db.settings.featured = db.settings.featured.filter((x) => x !== params.id); save();
  return adminHome();
});

// ───────── الأخبار ─────────
function normNews(b, prev) {
  const p = prev || {};
  const title = str(b.title ?? p.title, 200); const body = str(b.body ?? b.content ?? p.body, 20000);
  if (!title) throw bad('أدخل عنوان الخبر');
  if (!body) throw bad('أدخل نص الخبر');
  return { id: p.id || uid('n'), title, body, category: str(b.category ?? p.category ?? 'أخبار', 40) || 'أخبار', image: b.image !== undefined ? safeUrl(b.image) : (p.image || ''), at: p.at || now() };
}
GET('/admin/news', 'admin', () => db.news.slice().sort((a, b) => b.at - a.at).map(newsPublic));
POST('/admin/news', 'admin', ({ body }) => { const n = normNews(body, null); db.news.unshift(n); save(); return newsPublic(n); });
function updateNews({ params, body }) {
  const i = db.news.findIndex((x) => x.id === params.id); if (i < 0) throw notFound('الخبر غير موجود');
  db.news[i] = normNews(body, db.news[i]); save();
  return newsPublic(db.news[i]);
}
PUT('/admin/news/:id', 'admin', updateNews);
PATCH('/admin/news/:id', 'admin', updateNews);
DEL('/admin/news/:id', 'admin', ({ params }) => {
  const n = db.news.find((x) => x.id === params.id); if (!n) throw notFound('الخبر غير موجود');
  removeUpload(n.image); db.news = db.news.filter((x) => x !== n); save();
  return { ok: true };
});

// ───────── المنشورات ─────────
GET('/admin/posts', 'admin', () => db.posts.slice().sort((a, b) => b.at - a.at).map((p) => ({ ...postPublic(p, null), author_banned: !postVisible(p) })));
/** منشور رسمي باسم «فريق Sedhok» (JSON أو multipart مع images[]) */
POST('/admin/posts', 'admin', ({ body, files }) => {
  const text = str(body.body ?? body.text, 5000);
  const imgs = (files.images || files['images[]'] || []).slice(0, 4).map(saveImage);
  const urlImgs = Array.isArray(body.images) ? body.images.map(safeUrl).filter(Boolean).slice(0, 4) : [];
  const poll = buildPoll(body.poll);
  if (!text && !imgs.length && !urlImgs.length && !poll) throw bad('اكتب نصاً أو أرفق صورة');
  ensureTeamUser();
  const p = { id: uid('adm'), author_id: 'u_team', tag: str(body.tag, 30), body: text, images: [...urlImgs, ...imgs], poll, reactions: {}, base_reactions: {}, at: now() };
  db.posts.unshift(p); save();
  return postPublic(p, null);
});
function updatePost({ params, body }) {
  const p = db.posts.find((x) => x.id === params.id); if (!p) throw notFound('المنشور غير موجود');
  if (body.body !== undefined) { const t = str(body.body, 5000); if (!t && !(p.images || []).length && !p.poll) throw bad('نص المنشور فارغ'); p.body = t; }
  if (body.tag !== undefined) p.tag = str(body.tag, 30);
  save();
  return postPublic(p, null);
}
PUT('/admin/posts/:id', 'admin', updatePost);
PATCH('/admin/posts/:id', 'admin', updatePost);
DEL('/admin/posts/:id', 'admin', ({ params }) => {
  if (!db.posts.some((x) => x.id === params.id)) throw notFound('المنشور غير موجود');
  deletePostCascade(params.id); save();
  return { ok: true };
});

// ───────── التعليقات (إشراف) ─────────
/** GET /admin/comments?series_id=&episode=&post_id=&limit=  — كل التعليقات أو بحسب العمل/الحلقة/المنشور */
GET('/admin/comments', 'admin', ({ q }) => {
  let l = db.comments;
  if (q.series_id) l = l.filter((c) => c.scope === 'series' && c.ref === q.series_id);
  if (q.episode !== undefined && q.episode !== '') { const k = toInt(q.episode, 0); l = l.filter((c) => (c.ep || 0) === k); }
  if (q.post_id) l = l.filter((c) => c.scope === 'post' && c.ref === q.post_id);
  if (q.user_id) l = l.filter((c) => c.user_id === q.user_id);
  return l.slice().sort((a, b) => b.at - a.at).slice(0, clamp(toInt(q.limit, 200), 1, 1000)).map((c) => ({
    ...commentPublic(c, null), scope: c.scope,
    target: c.scope === 'post' ? 'منشور' : ((seriesById(c.ref) || {}).title || c.ref) + (c.ep ? ' · حلقة ' + (c.ep % 10000) + ' م' + Math.floor(c.ep / 10000) : ''),
  }));
});
DEL('/admin/comments/:id', 'admin', ({ params }) => {
  const c = db.comments.find((x) => x.id === params.id); if (!c) throw notFound('التعليق غير موجود');
  const kill = new Set([c.id]);
  for (let grew = true; grew;) { grew = false; for (const x of db.comments) if (x.parent_id && kill.has(x.parent_id) && !kill.has(x.id)) { kill.add(x.id); grew = true; } }
  db.comments = db.comments.filter((x) => !kill.has(x.id)); save();
  return { ok: true, deleted: kill.size };
});

// ───────── الأعضاء والتوثيق والحظر ─────────
const adminUserView = (u) => {
  const s = seenOf(u.id);
  return {
    id: u.id, name: u.name, email: u.email || '', avatar_url: absUrl(u.avatar_url || ''), bio: u.bio || '', badge: u.badge || 'none', banned: !!u.banned, muted: !!u.muted,
    last_seen: s ? s.last_seen : 0, online: isOnline(u.id), platform: s ? s.platform : '',
    joined: u.joined || '', created_at: u.created_at || 0, has_password: !!u.pass, google: !!u.google_sub, system: !!u.system, posts: db.posts.filter((p) => p.author_id === u.id).length,
  };
};
/** GET /admin/users?q=&filter=online|today|banned|muted */
GET('/admin/users', 'admin', ({ q }) => {
  const term = str(q.q, 100).toLowerCase(); const f = str(q.filter, 20);
  const day = new Date(); day.setHours(0, 0, 0, 0);
  let l = db.users.filter((u) => !u.deleted && (!term || u.name.toLowerCase().includes(term) || (u.email || '').includes(term)));
  if (f === 'online') l = l.filter((u) => isOnline(u.id));
  else if (f === 'today') l = l.filter((u) => ((seenOf(u.id) || {}).last_seen || 0) >= day.getTime());
  else if (f === 'banned') l = l.filter((u) => u.banned);
  else if (f === 'muted') l = l.filter((u) => u.muted);
  return l.map(adminUserView);
});
GET('/admin/users/:id', 'admin', ({ params }) => adminUserDetail(adminUserOf(params.id)));
POST('/admin/users', 'admin', ({ body }) => {
  const name = str(body.name, 60); if (!name) throw bad('أدخل اسم العضو');
  const email = str(body.email, 200).toLowerCase();
  if (email && !EMAIL_RX.test(email)) throw bad('بريد غير صالح');
  if (email && db.users.some((u) => u.email === email)) throw conflict('البريد مسجّل مسبقاً');
  const pw = String(body.password || '');
  if (pw && pw.length < 8) throw bad('كلمة المرور 8 أحرف على الأقل');
  const u = { id: uid('u'), name, email, pass: pw ? hashPassword(pw) : '', avatar_url: safeUrl(body.avatar_url), bio: str(body.bio, 300), badge: BADGES.includes(badgeKey(body.badge)) ? badgeKey(body.badge) : 'none', banned: bool(body.banned), joined: 'منذ ' + new Date().getFullYear(), created_at: now(), pv: 0 };
  db.users.push(u); save();
  return adminUserView(u);
});
function updateUser({ params, body }) {
  const u = userById(params.id); if (!u || u.deleted) throw notFound('العضو غير موجود');
  if (body.name !== undefined) { const n = str(body.name, 60); if (!n) throw bad('أدخل اسم العضو'); u.name = n; }
  if (body.bio !== undefined) u.bio = str(body.bio, 300);
  if (body.avatar_url !== undefined) u.avatar_url = safeUrl(body.avatar_url);
  if (body.badge !== undefined) u.badge = badgeKey(body.badge);
  if (body.banned !== undefined) u.banned = bool(body.banned);
  if (body.muted !== undefined) u.muted = bool(body.muted);
  if (body.email !== undefined) {
    const e = str(body.email, 200).toLowerCase();
    if (e && !EMAIL_RX.test(e)) throw bad('بريد غير صالح');
    if (e && db.users.some((x) => x !== u && x.email === e)) throw conflict('البريد مسجّل مسبقاً');
    u.email = e;
  }
  if (body.password) { if (String(body.password).length < 8) throw bad('كلمة المرور 8 أحرف على الأقل'); u.pass = hashPassword(String(body.password)); u.pv = (u.pv || 0) + 1; }
  save();
  return adminUserView(u);
}
PUT('/admin/users/:id', 'admin', updateUser);
PATCH('/admin/users/:id', 'admin', updateUser);
DEL('/admin/users/:id', 'admin', ({ params }) => {
  const u = userById(params.id); if (!u || u.deleted) throw notFound('العضو غير موجود');
  if (u.system) throw forbidden('لا يمكن حذف حساب الفريق');
  for (const p of db.posts.filter((x) => x.author_id === u.id)) deletePostCascade(p.id);
  db.comments = db.comments.filter((c) => c.user_id !== u.id);
  db.users = db.users.filter((x) => x !== u); delete db.libraries[u.id];
  for (const r of Object.values(db.ratings)) delete r[u.id];
  db.chats = db.chats.filter((c) => !c.members.includes(u.id));
  purgeSocial(u.id);
  for (const g of db.groups.slice()) {
    g.members = g.members.filter((m) => m.id !== u.id); g.requests = g.requests.filter((m) => m.id !== u.id); g.mods = g.mods.filter((m) => m !== u.id);
    if (g.owner === u.id) {
      if (!g.members.length) db.groups = db.groups.filter((x) => x !== g);
      else { const s = g.members.slice().sort((a, b) => a.at - b.at); g.owner = (s.find((m) => g.mods.includes(m.id)) || s[0]).id; g.mods = g.mods.filter((m) => m !== g.owner); }
    }
  }
  save();
  return { ok: true };
});
/** يصدر رمز استعادة كلمة المرور لعضو (لإبلاغه به يدوياً لأن الخادم لا يرسل بريداً) */
POST('/admin/users/:id/reset-token', 'admin', ({ params }) => {
  const u = userById(params.id); if (!u || !u.email) throw bad('العضو بلا بريد');
  return { token: makeResetToken(u), expires_in_minutes: 60, hint: 'يستعمل العضو POST /auth/reset-password {token, password}' };
});

// ───────── الإشعارات العامة ─────────
const broadcastAdmin = (b) => ({ id: b.id, title: b.title, body: b.body, image: b.image ? absUrl(b.image) : '', series_id: b.series_id || '', created_at: rel(b.at), created_ts: b.at });
GET('/admin/notifications', 'admin', () => db.broadcasts.slice().reverse().map(broadcastAdmin));
GET('/admin/broadcasts', 'admin', () => db.broadcasts.slice().reverse().map(broadcastAdmin));
/** ينشر إشعاراً لكل المستخدمين (JSON أو multipart). الصورة اختيارية: ملف image/file أو رابط image. النص اختياري إن وُجد عنوان. */
function createBroadcast({ body, files }) {
  const title = str(body.title, 120); const text = str(body.body, 500);
  if (!title) throw bad('أدخل عنوان الإشعار');
  const sid = str(body.series_id, 60);
  if (sid && !seriesById(sid)) throw bad('العمل المرتبط غير موجود');
  const f = ((files && (files.image || files.file || files.images)) || [])[0];
  const image = f ? saveImage(f) : safeUrl(body.image);
  const b = { id: uid('b'), title, body: text, image, series_id: sid, at: now() };
  db.broadcasts.push(b); save();
  return { id: b.id, title, body: text, image: image ? absUrl(image) : '', series_id: sid, created_at: rel(b.at) };
}
function deleteBroadcast({ params }) {
  const b = db.broadcasts.find((x) => x.id === params.id);
  if (!b) throw notFound('الإشعار غير موجود');
  if (b.image) removeUpload(b.image);
  db.broadcasts = db.broadcasts.filter((x) => x.id !== params.id); save();
  return { ok: true };
}
POST('/admin/notifications', 'admin', createBroadcast);
POST('/admin/broadcasts', 'admin', createBroadcast);
DEL('/admin/notifications/:id', 'admin', deleteBroadcast);
DEL('/admin/broadcasts/:id', 'admin', deleteBroadcast);
POST('/admin/broadcasts/:id/delete', 'admin', deleteBroadcast);

// ───────── المجموعات (إشراف) ─────────
GET('/admin/groups', 'admin', () => db.groups.map((g) => ({ id: g.id, code: g.code, name: g.name, owner: g.owner, owner_name: gName(g.owner), public: g.public, frozen: !!g.frozen, mode: g.mode, members: g.members.length, requests: g.requests.length, messages: g.messages.length, created_at: g.at })));
DEL('/admin/groups/:id', 'admin', ({ params }) => {
  if (!db.groups.some((g) => g.id === params.id)) throw notFound('المجموعة غير موجودة');
  db.groups = db.groups.filter((g) => g.id !== params.id); save();
  return { ok: true };
});

// ───────── نشاط الأعضاء والإشراف المتقدم (docs/ADMIN_API.md) ─────────
function adminUserDetail(u) {
  const s = seenOf(u.id) || {}; const lib = db.libraries[u.id] || {};
  let chapters = 0; for (const v of Object.values(lib.read_chapters || {})) chapters += Array.isArray(v) ? v.length : 0;
  let secs = 0; for (const v of Object.values(lib.reading_seconds || {})) secs += toInt(v, 0);
  return {
    ...adminUserView(u), first_seen: s.first_seen || 0, sessions: s.sessions || 0, app_seconds: s.app_seconds || 0,
    chapters_read: chapters, reading_seconds: secs, friends: friendIds(u.id).length, followers: followerIds(u.id).length,
  };
}
const adminUserOf = (id) => { const u = userById(id); if (!u || u.deleted) throw notFound('العضو غير موجود'); return u; };
GET('/admin/users/:id/watch', 'admin', ({ params }) => {
  adminUserOf(params.id);
  return Object.values(db.watch[params.id] || {}).sort((a, b) => b.updated_at - a.updated_at);
});
GET('/admin/users/:id/events', 'admin', ({ params, q }) => {
  adminUserOf(params.id);
  const type = str(q.type, 20);
  return db.activity.events.filter((e) => e.user_id === params.id && (!type || e.type === type)).sort((a, b) => b.at - a.at)
    .slice(0, clamp(toInt(q.limit, 200), 1, 1000)).map((e) => ({ at: e.at, type: e.type, text: e.text, ref: e.ref }));
});
GET('/admin/activity', 'admin', ({ q }) => {
  const type = str(q.type, 20);
  return db.activity.events.filter((e) => !type || e.type === type).sort((a, b) => b.at - a.at)
    .slice(0, clamp(toInt(q.limit, 100), 1, 1000)).map((e) => ({ id: e.id, user_id: e.user_id, user_name: gName(e.user_id), at: e.at, type: e.type, text: e.text, ref: e.ref }));
});
/** POST /admin/users/:id/ban {banned} · POST /admin/users/:id/mute {muted} */
POST('/admin/users/:id/ban', 'admin', ({ params, body }) => {
  const u = adminUserOf(params.id);
  if (u.system) throw forbidden('لا يمكن حظر حساب الفريق');
  u.banned = bool(body.banned, true); save();
  return adminUserView(u);
});
POST('/admin/users/:id/mute', 'admin', ({ params, body }) => {
  const u = adminUserOf(params.id);
  if (u.system) throw forbidden('لا يمكن كتم حساب الفريق');
  u.muted = bool(body.muted, true); save();
  return adminUserView(u);
});

// المحادثات الخاصة
const chatAdminMsg = (m) => ({ id: m.id, from: m.from, text: m.text, at: m.at });
const adminChat = (id) => { const c = db.chats.find((x) => x.id === id); if (!c) throw notFound('المحادثة غير موجودة'); return c; };
GET('/admin/chats', 'admin', () => db.chats.filter((c) => c.messages.length).map((c) => ({
  id: c.id, a: c.members[0], b: c.members[1], a_name: gName(c.members[0]), b_name: gName(c.members[1]),
  count: c.messages.length, updated_at: c.messages[c.messages.length - 1].at, messages: c.messages.slice(-200).map(chatAdminMsg),
})).sort((x, y) => y.updated_at - x.updated_at));
GET('/admin/chats/:id/messages', 'admin', ({ params }) => adminChat(params.id).messages.slice(-1000).map(chatAdminMsg));
DEL('/admin/chats/:id/messages/:mid', 'admin', ({ params }) => {
  const c = adminChat(params.id);
  if (!c.messages.some((m) => m.id === params.mid)) throw notFound('الرسالة غير موجودة');
  c.messages = c.messages.filter((m) => m.id !== params.mid); save();
  return { ok: true };
});
DEL('/admin/chats/:id', 'admin', ({ params }) => {
  adminChat(params.id); db.chats = db.chats.filter((c) => c.id !== params.id); save();
  return { ok: true };
});

// المجموعات: تفاصيل وإشراف
const adminGroup = (id) => { const g = db.groups.find((x) => x.id === id); if (!g) throw notFound('المجموعة غير موجودة'); return g; };
GET('/admin/groups/:id', 'admin', ({ params }) => {
  const g = adminGroup(params.id); gTouch(g);
  return {
    id: g.id, code: g.code, name: g.name, desc: g.desc, owner: g.owner, owner_name: gName(g.owner), public: g.public, frozen: !!g.frozen, mode: g.mode, join_mode: g.mode, created_at: g.at,
    members: g.members.map((m) => ({ id: m.id, name: gName(m.id), role: gRole(g, m.id), joined_at: m.at })),
    requests: g.requests.filter((r) => userById(r.id)).map((r) => ({ id: r.id, name: gName(r.id), at: r.at })),
    messages: g.messages.slice(-1000).map((m) => ({ id: m.id, sender_id: m.s, sender: gName(m.s), text: m.t, at: m.at })),
  };
});
DEL('/admin/groups/:id/messages/:mid', 'admin', ({ params }) => {
  const g = adminGroup(params.id);
  if (!g.messages.some((m) => m.id === params.mid)) throw notFound('الرسالة غير موجودة');
  g.messages = g.messages.filter((m) => m.id !== params.mid); save();
  return { ok: true };
});
DEL('/admin/groups/:id/messages', 'admin', ({ params }) => {
  const g = adminGroup(params.id); const n = g.messages.length; g.messages = []; save();
  return { ok: true, deleted: n };
});
POST('/admin/groups/:id/members/:uid/remove', 'admin', ({ params }) => {
  const g = adminGroup(params.id);
  if (params.uid === g.owner) throw bad('لا يمكن إزالة المسؤول؛ انقل الملكية أولاً');
  g.members = g.members.filter((m) => m.id !== params.uid); g.mods = g.mods.filter((m) => m !== params.uid); save();
  return { ok: true };
});
POST('/admin/groups/:id/members/:uid/owner', 'admin', ({ params }) => {
  const g = adminGroup(params.id);
  if (!g.members.some((m) => m.id === params.uid)) throw bad('العضو ليس في المجموعة');
  g.owner = params.uid; g.mods = g.mods.filter((m) => m !== params.uid); save();
  return { ok: true, owner: g.owner };
});
POST('/admin/groups/:id/members/:uid/moderator', 'admin', ({ params, body }) => {
  const g = adminGroup(params.id);
  if (params.uid === g.owner || !g.members.some((m) => m.id === params.uid)) throw bad('عضو غير صالح');
  const on = bool(body.on ?? body.moderator, true);
  g.mods = on ? uniq([...g.mods, params.uid]) : g.mods.filter((m) => m !== params.uid); save();
  return { ok: true, role: gRole(g, params.uid) };
});
/** POST /admin/groups/:id/settings {frozen, public, join_mode} */
POST('/admin/groups/:id/settings', 'admin', ({ params, body }) => {
  const g = adminGroup(params.id);
  if (body.frozen !== undefined) g.frozen = bool(body.frozen);
  if (body.public !== undefined || body.is_public !== undefined) g.public = bool(body.public ?? body.is_public);
  const mode = body.join_mode ?? body.mode;
  if (mode !== undefined) {
    if (!JOIN_MODES.includes(mode)) throw bad('نمط انضمام غير صالح');
    g.mode = mode;
    if (mode === 'auto') { for (const r of g.requests) if (!g.members.some((m) => m.id === r.id)) g.members.push({ id: r.id, at: now() }); g.requests = []; }
    else if (mode === 'closed') g.requests = [];
  }
  save();
  return { ok: true, frozen: !!g.frozen, public: g.public, mode: g.mode, join_mode: g.mode };
});

// ───────── الإعدادات ─────────
GET('/admin/settings', 'admin', () => ({ types: db.settings.types, genres: db.settings.genres, countries: db.settings.countries, adblock: db.settings.adblock !== false, qualities: QUALITY_OPTIONS, statuses: STATUS_OPTIONS, username: db.admin.user }));
PUT('/admin/settings', 'admin', ({ body }) => {
  for (const k of ['types', 'genres', 'countries']) if (body[k] !== undefined) db.settings[k] = strList(body[k]).slice(0, 500);
  if (body.adblock !== undefined) db.settings.adblock = bool(body.adblock);
  save();
  return { types: db.settings.types, genres: db.settings.genres, countries: db.settings.countries, adblock: db.settings.adblock };
});
/** تغيير اسم المستخدم وكلمة مرور الأدمن */
POST('/admin/account', 'admin', ({ body }) => {
  const user = str(body.username, 60); const pw = String(body.password || '');
  if (!user) throw bad('أدخل اسم المستخدم');
  if (pw.length < 6) throw bad('كلمة المرور 6 أحرف على الأقل');
  if (body.confirm !== undefined && String(body.confirm) !== pw) throw bad('كلمتا المرور غير متطابقتين');
  db.admin = { user, pass: hashPassword(pw), default_pass: false, v: (db.admin.v || 0) + 1 }; save();
  return { ok: true, token: adminSession(), message: 'تم التحديث، استعمل البيانات الجديدة في الدخول القادم' };
});

// ───────── النسخ الاحتياطي والاستعادة والتنظيف ─────────
/** نسخة احتياطية كاملة (دون كلمات المرور ومفاتيح التوقيع). الصور تبقى في مجلد uploads */
GET('/admin/backup', 'admin', () => {
  const copy = JSON.parse(JSON.stringify(db));
  delete copy.secret; delete copy.admin; delete copy.resets;
  copy.users = copy.users.map(({ pass, ...u }) => u);
  return copy;
});
POST('/admin/restore', 'admin', ({ body }) => {
  if (!Array.isArray(body.series)) throw bad('نسخة احتياطية غير صالحة');
  const keep = { secret: db.secret, admin: db.admin, resets: db.resets, users: db.users };
  const next = Object.assign(emptyDb(), body, { secret: keep.secret, admin: keep.admin, resets: {} });
  next.settings = Object.assign(emptyDb().settings, body.settings || {});
  // كلمات مرور الأعضاء لا تُستعاد من النسخة: يُحتفظ بالحالية للأعضاء الموجودين
  const old = new Map(keep.users.map((u) => [u.id, u]));
  next.users = (Array.isArray(body.users) ? body.users : []).map((u) => ({ ...u, pass: (old.get(u.id) || {}).pass || '' }));
  db = next; ensureTeamUser(); save();
  return { ok: true, series: db.series.length };
});
POST('/admin/clear', 'admin', () => {
  const imgs = [...db.series.map((s) => s.cover), ...db.news.map((n) => n.image), ...db.posts.flatMap((p) => p.images || []), ...Object.values(db.episodes).flat().map((e) => e.thumb)];
  imgs.forEach(removeUpload);
  db.series = []; db.episodes = {}; db.news = []; db.posts = []; db.comments = []; db.ratings = {}; db.broadcasts = [];
  db.settings.featured = []; db.settings.hidden = []; save();
  return { ok: true };
});
POST('/admin/reset-demo', 'admin', () => { seedDemo(); ensureTeamUser(); save(); return { ok: true, series: db.series.length }; });
/** حذف الصور المرفوعة التي لم يعد أي شيء يستعملها */
POST('/admin/cleanup-uploads', 'admin', async () => {
  const used = new Set();
  const add = (u) => { const m = /^\/uploads\/([\w.\-]+)$/.exec(u || ''); if (m) used.add(m[1]); };
  db.series.forEach((s) => add(s.cover)); db.news.forEach((n) => add(n.image)); db.users.forEach((u) => add(u.avatar_url));
  db.users.forEach((u) => { const e = u.extras || {}; add(e.cover_url); add(e.story_image); });
  db.posts.forEach((p) => (p.images || []).forEach(add)); db.groups.forEach((g) => add(g.photo));
  Object.values(db.episodes).flat().forEach((e) => add(e.thumb));
  let n = 0;
  for (const f of await fileNames()) if (!used.has(f)) { fileDel(f); n++; }
  return { ok: true, deleted: n };
});
/** رفع صورة (غلاف/خبر/حلقة/صورة عضو): multipart بحقل file → {url, path} */
POST('/admin/upload', 'admin', ({ files }) => {
  const f = (files.file || files.image || files.images || [])[0];
  if (!f) throw bad('أرفق ملفاً في الحقل file');
  const p = saveImage(f);
  return { path: p, url: absUrl(p) };
});

// ════════════════════════════════════════════════════════════════════════
//  لوحة الأدمن (صفحة واحدة مضمّنة) — GET /admin
//  كل النصوص تُدرج عبر textContent فلا خطر XSS من بيانات المستخدمين.
// ════════════════════════════════════════════════════════════════════════
const ADMIN_HTML = String.raw`<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>لوحة Sedhok</title>
<style>
:root{--bg:#0f1117;--sf:#181b24;--sf2:#212533;--bd:#2c3142;--tx:#eef0f6;--dim:#9aa1b5;--ac:#8b7bff;--ok:#2fbf71;--er:#ef4b4b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,Tahoma,sans-serif}
a{color:var(--ac)}button,input,select,textarea{font:inherit;color:inherit}
header{position:sticky;top:0;z-index:5;background:var(--sf);border-bottom:1px solid var(--bd);padding:8px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
header b{color:var(--ac);margin-inline-end:6px}
nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}
nav button,.btn{background:var(--sf2);border:1px solid var(--bd);border-radius:10px;padding:6px 12px;cursor:pointer}
nav button.on,.btn.pri{background:var(--ac);border-color:var(--ac);color:#fff}
.btn.danger{border-color:var(--er);color:var(--er)}.btn.sm{padding:3px 9px;font-size:13px}
main{max-width:1000px;margin:0 auto;padding:14px}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:14px;padding:14px;margin-bottom:12px}
h2{margin:6px 0 12px;font-size:19px}h3{margin:14px 0 8px;font-size:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.stat{background:var(--sf2);border-radius:12px;padding:12px;text-align:center}.stat b{display:block;font-size:24px;color:var(--ac)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sp{flex:1}
table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-bottom:1px solid var(--bd);text-align:start;vertical-align:middle}
th{color:var(--dim);font-weight:600;font-size:13px}
.tag{display:inline-block;background:var(--sf2);border-radius:8px;padding:1px 8px;font-size:12px;color:var(--dim);margin:1px}
.tag.ok{color:var(--ok)}.tag.er{color:var(--er)}
img.th{width:42px;height:56px;object-fit:cover;border-radius:6px;background:var(--sf2)}
label{display:block;margin:10px 0 3px;color:var(--dim);font-size:13px}
input[type=text],input[type=number],input[type=password],input[type=email],select,textarea{width:100%;background:var(--sf2);border:1px solid var(--bd);border-radius:10px;padding:8px 10px}
textarea{min-height:80px;resize:vertical}input[dir=ltr]{direction:ltr;text-align:left}
.chk{display:flex;gap:8px;align-items:center;margin:8px 0}.chk input{width:18px;height:18px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chips label{margin:0;background:var(--sf2);border:1px solid var(--bd);border-radius:20px;padding:3px 10px;display:flex;gap:5px;align-items:center;color:var(--tx)}
.modal{position:fixed;inset:0;background:#000a;z-index:20;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:20px 10px}
.modal>div{background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:16px;width:100%;max-width:640px}
.toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--sf2);border:1px solid var(--bd);padding:10px 18px;border-radius:12px;z-index:50}
.toast.er{border-color:var(--er)}.dim{color:var(--dim)}.warn{background:#3b2a12;border:1px solid #805a1c;border-radius:12px;padding:10px;margin-bottom:12px}
.imgp{display:flex;gap:10px;align-items:center}.imgp img{width:64px;height:64px;object-fit:cover;border-radius:10px;background:var(--sf2)}
</style></head><body>
<div id="app"></div>
<script>
(function(){
'use strict';
var TOKEN=null;try{TOKEN=localStorage.getItem('sedhok_admin')}catch(e){}
var S={settings:null,tab:'dash',cache:{}};
var app=document.getElementById('app');

function h(tag,attrs){
  var el=document.createElement(tag);attrs=attrs||{};
  Object.keys(attrs).forEach(function(k){
    var v=attrs[k];if(v===undefined||v===null||v===false)return;
    if(k==='on'){Object.keys(v).forEach(function(ev){el.addEventListener(ev,v[ev])});}
    else if(k==='cls')el.className=v;
    else if(k==='value')el.value=v;
    else if(k==='checked')el.checked=!!v;
    else el.setAttribute(k,v===true?'':v);
  });
  for(var i=2;i<arguments.length;i++)add(el,arguments[i]);
  return el;
}
function add(el,c){
  if(c===null||c===undefined||c===false)return;
  if(Array.isArray(c))c.forEach(function(x){add(el,x)});
  else if(c.nodeType)el.appendChild(c);
  else el.appendChild(document.createTextNode(String(c)));
}
function toast(m,er){var t=h('div',{cls:'toast'+(er?' er':'')},m);document.body.appendChild(t);setTimeout(function(){t.remove()},er?4500:2200)}

function api(method,path,body,raw){
  var opt={method:method,headers:{}};
  if(TOKEN)opt.headers.Authorization='Bearer '+TOKEN;
  if(body instanceof FormData)opt.body=body;
  else if(body!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
  return fetch(path,opt).then(function(r){
    return r.text().then(function(t){
      var j=null;try{j=t?JSON.parse(t):null}catch(e){}
      if(r.status===401&&TOKEN&&path.indexOf('/admin/login')<0){TOKEN=null;try{localStorage.removeItem('sedhok_admin')}catch(e){}render();throw new Error('انتهت الجلسة')}
      if(!r.ok)throw new Error((j&&(j.message||j.error))||('خطأ '+r.status));
      return j;
    });
  });
}
function guard(p,okmsg){return p.then(function(r){if(okmsg)toast(okmsg);return r}).catch(function(e){toast(e.message,true);throw e})}

function modal(title,body){
  var m=h('div',{cls:'modal'},h('div',{},h('div',{cls:'row'},h('h2',{cls:'sp'},title),h('button',{cls:'btn sm',on:{click:function(){m.remove()}}},'إغلاق')),body));
  m.close=function(){m.remove()};document.body.appendChild(m);return m;
}
function confirmAct(msg,fn){if(window.confirm(msg))fn()}

/* نموذج عام: fields = [{k,label,type,opts,ph,dir}] */
function form(fields,vals,submitLabel,onSubmit,extra){
  vals=vals||{};var inputs={};var root=h('div');
  fields.forEach(function(f){
    var v=vals[f.k],el,wrap;
    if(f.type==='check'){
      el=h('input',{type:'checkbox',checked:v});wrap=h('div',{cls:'chk'},el,h('span',{},f.label));
      inputs[f.k]={get:function(){return el.checked}};
    }else if(f.type==='textarea'){
      el=h('textarea',{value:Array.isArray(v)?v.join('\n'):(v==null?'':v),placeholder:f.ph||''});
      wrap=h('div',{},h('label',{},f.label),el);inputs[f.k]={get:function(){return el.value}};
    }else if(f.type==='select'){
      el=h('select',{});(f.opts||[]).forEach(function(o){var val=Array.isArray(o)?o[0]:o,lb=Array.isArray(o)?o[1]:o;var op=h('option',{value:val},lb);if(String(val)===String(v==null?'':v))op.selected=true;el.appendChild(op)});
      wrap=h('div',{},h('label',{},f.label),el);inputs[f.k]={get:function(){return el.value}};
    }else if(f.type==='multi'){
      var set={};(v||[]).forEach(function(x){set[x]=1});
      var boxes=[];var chips=h('div',{cls:'chips'});
      var all=(f.opts||[]).slice();(v||[]).forEach(function(x){if(all.indexOf(x)<0)all.push(x)});
      all.forEach(function(o){var cb=h('input',{type:'checkbox',checked:set[o]});boxes.push([o,cb]);chips.appendChild(h('label',{},cb,o))});
      wrap=h('div',{},h('label',{},f.label),chips);
      inputs[f.k]={get:function(){return boxes.filter(function(b){return b[1].checked}).map(function(b){return b[0]})}};
    }else if(f.type==='image'){
      var cur=v||'';var pv=h('img',{src:cur||'data:,'});var inp=h('input',{type:'file',accept:'image/*'});
      var clr=h('button',{type:'button',cls:'btn sm',on:{click:function(){cur='';pv.removeAttribute('src')}}},'إزالة');
      inp.addEventListener('change',function(){
        if(!inp.files[0])return;var fd=new FormData();fd.append('file',inp.files[0]);
        guard(api('POST','/admin/upload',fd),'تم رفع الصورة').then(function(r){cur=r.path;pv.src=r.url});
      });
      wrap=h('div',{},h('label',{},f.label),h('div',{cls:'imgp'},pv,inp,clr));inputs[f.k]={get:function(){return cur}};
    }else{
      el=h('input',{type:f.type||'text',value:v==null?'':v,placeholder:f.ph||'',dir:f.dir});
      wrap=h('div',{},h('label',{},f.label),el);
      inputs[f.k]={get:function(){return f.type==='number'?(el.value===''?'':Number(el.value)):el.value}};
    }
    root.appendChild(wrap);
  });
  var btn=h('button',{cls:'btn pri',on:{click:function(){
    var out={};Object.keys(inputs).forEach(function(k){out[k]=inputs[k].get()});
    btn.disabled=true;Promise.resolve(onSubmit(out)).catch(function(){}).then(function(){btn.disabled=false});
  }}},submitLabel||'حفظ');
  root.appendChild(h('div',{cls:'row',style:'margin-top:14px'},btn,extra||null));
  return root;
}
function table(head,rows){
  return h('table',{},h('tr',{},head.map(function(x){return h('th',{},x)})),rows.map(function(r){return h('tr',{},r.map(function(c){return h('td',{},c)}))}));
}
function act(label,fn,cls){return h('button',{cls:'btn sm '+(cls||''),on:{click:fn}},label)}
function loadSettings(){return api('GET','/admin/settings').then(function(s){S.settings=s;return s})}
function lines(t){return String(t||'').split(/\n|,|،/).map(function(x){return x.trim()}).filter(Boolean)}

/* ───────── الدخول والإطار ───────── */
var TABS=[['dash','لوحة التحكم'],['series','الأعمال'],['home','الرئيسية'],['news','الأخبار'],['posts','المنشورات'],['comments','التعليقات'],['users','الأعضاء'],['notif','الإشعارات'],['groups','المجموعات'],['settings','الإعدادات']];
function render(){
  app.textContent='';
  if(!TOKEN){
    var u=h('input',{type:'text',dir:'ltr',placeholder:'اسم الأدمن'}),p=h('input',{type:'password',dir:'ltr',placeholder:'كلمة المرور'});
    var go=function(){guard(api('POST','/admin/login',{username:u.value,password:p.value})).then(function(r){TOKEN=r.token;try{localStorage.setItem('sedhok_admin',TOKEN)}catch(e){}S.warn=r.default_password;render()})};
    p.addEventListener('keydown',function(e){if(e.key==='Enter')go()});
    app.appendChild(h('main',{style:'max-width:380px;margin-top:12vh'},h('div',{cls:'card'},h('h2',{},'لوحة Sedhok — دخول الأدمن'),h('label',{},'اسم الأدمن'),u,h('label',{},'كلمة المرور'),p,h('div',{style:'margin-top:14px'},h('button',{cls:'btn pri',on:{click:go}},'دخول')))));
    return;
  }
  var nav=h('nav',{},TABS.map(function(t){return h('button',{cls:S.tab===t[0]?'on':'',on:{click:function(){S.tab=t[0];render()}}},t[1])}));
  var out=h('button',{cls:'btn sm',on:{click:function(){TOKEN=null;try{localStorage.removeItem('sedhok_admin')}catch(e){}render()}}},'خروج');
  var main=h('main',{});
  app.appendChild(h('header',{},h('b',{},'Sedhok'),nav,out));app.appendChild(main);
  loadSettings().then(function(){VIEWS[S.tab](main)}).catch(function(e){main.appendChild(h('div',{cls:'card'},e.message))});
}
function reload(){render()}

var VIEWS={
/* ───────── لوحة التحكم ───────── */
dash:function(m){
  api('GET','/admin/stats').then(function(s){
    var names={series:'عمل',episodes:'حلقة',users:'عضو',posts:'منشور',comments:'تعليق',news:'خبر',groups:'مجموعة',broadcasts:'إشعار',banned:'محظور',uploads:'صورة'};
    if(s.default_password)m.appendChild(h('div',{cls:'warn'},'⚠ ما زالت كلمة مرور الأدمن الافتراضية (admin123). غيّرها الآن من «الإعدادات».'));
    m.appendChild(h('div',{cls:'card'},h('h2',{},'لوحة التحكم'),h('div',{cls:'grid'},Object.keys(names).map(function(k){return h('div',{cls:'stat'},h('b',{},s[k]),names[k])}))));
    m.appendChild(h('div',{cls:'card dim'},'رابط التطبيق (API_BASE_URL): ',h('b',{dir:'ltr'},location.origin)));
  });
},
/* ───────── الأعمال والحلقات ───────── */
series:function(m,q){
  var box=h('input',{type:'text',placeholder:'بحث بين الأعمال',value:q||''});
  var list=h('div');
  var head=h('div',{cls:'card'},h('div',{cls:'row'},h('h2',{cls:'sp'},'الأعمال'),h('button',{cls:'btn pri',on:{click:function(){seriesForm(null)}}},'+ إضافة عمل')),box);
  m.appendChild(head);m.appendChild(list);
  function load(){
    api('GET','/admin/series?q='+encodeURIComponent(box.value)).then(function(rows){
      list.textContent='';
      list.appendChild(h('div',{cls:'card'},table(['','العنوان','النوع','حلقات','حالة',''],rows.map(function(s){
        return [h('img',{cls:'th',src:s.cover||'data:,'}),h('b',{},s.title),s.type,String(s.episodes)+' / '+s.seasons+' م',
          [s.hidden?h('span',{cls:'tag er'},'مخفي'):null,s.featured?h('span',{cls:'tag ok'},'هيرو'):null,s.is_new?h('span',{cls:'tag'},'جديد'):null],
          h('div',{cls:'row'},act('الحلقات',function(){episodesView(s)}),act('تعديل',function(){seriesForm(s)}),
            act(s.hidden?'إظهار':'إخفاء',function(){guard(api('POST','/admin/series/'+s.id+'/hide',{hidden:!s.hidden})).then(load)}),
            act(s.featured?'إلغاء التمييز':'تمييز',function(){guard(api('POST','/admin/series/'+s.id+'/feature',{featured:!s.featured})).then(load)}),
            act('حذف',function(){confirmAct('حذف «'+s.title+'» وكل حلقاته وتعليقاته؟',function(){guard(api('DELETE','/admin/series/'+s.id),'تم الحذف').then(load)})},'danger'))];
      }))));
      if(!rows.length)list.appendChild(h('div',{cls:'card dim'},'لا توجد أعمال.'));
    });
  }
  box.addEventListener('input',function(){clearTimeout(box._t);box._t=setTimeout(load,300)});
  load();
  S.reloadSeries=load;
}
};

function seriesForm(s){
  var st=S.settings;s=s||{};
  var fields=[{k:'cover',label:'غلاف العمل',type:'image'},{k:'title',label:'عنوان العمل'},
    {k:'type',label:'النوع',type:'select',opts:st.types},{k:'status',label:'الحالة',type:'select',opts:st.statuses},
    {k:'country',label:'البلد'},{k:'year',label:'سنة العرض',type:'number'},{k:'rating',label:'التقييم (0-10)',type:'number'},{k:'views',label:'عدد المشاهدات',type:'number'},
    {k:'synopsis',label:'القصة',type:'textarea'},{k:'cast',label:'طاقم التمثيل (افصل بفاصلة)',type:'textarea'},
    {k:'genres',label:'التصنيفات',type:'multi',opts:st.genres},{k:'qualities',label:'الجودات المتاحة',type:'multi',opts:st.qualities},
    {k:'is_new',label:'عمل جديد',type:'check'},{k:'featured',label:'مميّز في الهيرو',type:'check'},{k:'hidden',label:'مخفي عن المستخدمين',type:'check'}];
  var vals=Object.assign({status:'مستمر',type:st.types[0],year:new Date().getFullYear(),is_new:false},s);
  var mm=modal(s.id?'تعديل العمل':'إضافة عمل',form(fields,vals,'حفظ',function(v){
    v.cast=lines(v.cast);
    return guard(api(s.id?'PUT':'POST',s.id?'/admin/series/'+s.id:'/admin/series',v),'تم الحفظ').then(function(r){mm.close();if(!s.id)episodesView(r);else S.reloadSeries&&S.reloadSeries()});
  }));
}

function episodesView(s){
  var body=h('div');var mm=modal('حلقات: '+s.title,body);
  function load(){
    api('GET','/admin/series/'+s.id+'/episodes').then(function(eps){
      body.textContent='';
      body.appendChild(h('div',{cls:'row'},h('button',{cls:'btn pri',on:{click:function(){epForm(s,null,load)}}},'+ حلقة'),h('button',{cls:'btn',on:{click:function(){bulkForm(s,load)}}},'+ عدة حلقات دفعة'),h('span',{cls:'dim sp'},eps.length+' حلقة')));
      var seasons={};eps.forEach(function(e){(seasons[e.season]=seasons[e.season]||[]).push(e)});
      Object.keys(seasons).forEach(function(sn){
        body.appendChild(h('h3',{},'الموسم '+sn));
        body.appendChild(table(['#','العنوان','الجودات',''],seasons[sn].map(function(e){
          return [String(e.number),e.title+(e.is_new?' •جديد':''),e.sources.map(function(x){return x.quality}).join(' ')+(e.player_url?' ▶':''),
            h('div',{cls:'row'},act('تعديل',function(){epForm(s,e,load)}),act('حذف',function(){confirmAct('حذف الحلقة '+e.number+'؟',function(){guard(api('DELETE','/admin/series/'+s.id+'/episodes/'+e.key),'تم الحذف').then(load)})},'danger'))];
        })));
      });
      if(S.reloadSeries)S.reloadSeries();
    });
  }
  load();
}
function epForm(s,e,done){
  var QS=['144p','320p','720p','1080p'];
  var fields=[{k:'thumb',label:'صورة الحلقة (اختياري)',type:'image'},{k:'season',label:'الموسم',type:'number'},{k:'number',label:'رقم الحلقة',type:'number'},
    {k:'title',label:'عنوان الحلقة'},{k:'description',label:'وصف الحلقة',type:'textarea'},{k:'duration',label:'المدة (دقائق)',type:'number'},{k:'date',label:'تاريخ العرض'},
    {k:'is_new',label:'حلقة جديدة',type:'check'},{k:'player_url',label:'رابط المشغّل الخاص',dir:'ltr',ph:'https://...'}];
  QS.forEach(function(q){fields.push({k:'dl_'+q,label:'رابط تنزيل '+q,dir:'ltr',ph:'https://...'})});
  for(var i=0;i<3;i++){fields.push({k:'sl'+i,label:'ترجمة '+(i+1)+' — رمز اللغة (ar/en/tr…)',dir:'ltr'},{k:'su'+i,label:'رابط ملف الترجمة (.srt/.vtt)',dir:'ltr'},{k:'sn'+i,label:'اسم العرض (اختياري)'})}
  var vals=Object.assign({season:1,number:1,is_new:true},e||{});
  if(e){e.sources.forEach(function(x){vals['dl_'+x.quality]=x.url});e.subtitles.forEach(function(t,i){if(i<3){vals['sl'+i]=t.lang;vals['su'+i]=t.url;vals['sn'+i]=t.label}})}
  else vals.number=1;
  var mm=modal(e?'تعديل الحلقة':'حلقة جديدة',form(fields,vals,'حفظ الحلقة',function(v){
    var o={thumb:v.thumb,season:v.season,number:v.number,title:v.title,description:v.description,duration:v.duration,date:v.date,is_new:v.is_new,player_url:v.player_url,sources:[],subtitles:[]};
    QS.forEach(function(q){if(v['dl_'+q])o.sources.push({quality:q,url:v['dl_'+q]})});
    for(var i=0;i<3;i++)if(v['su'+i])o.subtitles.push({lang:v['sl'+i]||'ar',url:v['su'+i],label:v['sn'+i]});
    var key=e?e.key:null;
    return guard(api(e?'PUT':'POST','/admin/series/'+s.id+'/episodes'+(e?'/'+key:''),o),'تم حفظ الحلقة').then(function(){mm.close();done()});
  }));
}
function bulkForm(s,done){
  var fields=[{k:'season',label:'الموسم',type:'number'},{k:'from',label:'من',type:'number'},{k:'to',label:'إلى',type:'number'},
    {k:'title',label:'عنوان الحلقة ({n} = الرقم)'},{k:'player_pattern',label:'نمط رابط المشغّل الخاص',dir:'ltr',ph:'https://player.com/ep{n}'},
    {k:'p144',label:'نمط رابط 144p',dir:'ltr'},{k:'p320',label:'نمط رابط 320p',dir:'ltr'},{k:'p720',label:'نمط رابط 720p',dir:'ltr'},{k:'p1080',label:'نمط رابط 1080p',dir:'ltr'},{k:'duration',label:'المدة (د)',type:'number'}];
  var mm=modal('إضافة عدة حلقات',form(fields,{season:1,from:1,to:10,title:'الحلقة {n}'},'إضافة',function(v){
    var dl={};['144','320','720','1080'].forEach(function(q){if(v['p'+q])dl[q+'p']=v['p'+q]});
    return guard(api('POST','/admin/series/'+s.id+'/episodes/bulk',{season:v.season,from:v.from,to:v.to,title:v.title,player_pattern:v.player_pattern,dl_patterns:dl,duration:v.duration})).then(function(r){toast('تمت إضافة '+r.added+' حلقة');mm.close();done()});
  }));
}

/* ───────── بقية الأقسام ───────── */
VIEWS.home=function(m){
  api('GET','/admin/home').then(function(hm){
    var ann=form([{k:'on',label:'إظهار الإعلان',type:'check'},{k:'text',label:'نص الإعلان',type:'textarea'}],hm.announcement,'حفظ الإعلان',function(v){return guard(api('PUT','/admin/home',{announcement:v}),'تم الحفظ')});
    var secv={};Object.keys(hm.sections).forEach(function(k){secv[k]=hm.sections[k].on});
    var secf=form(Object.keys(hm.sections).map(function(k){return {k:k,label:hm.sections[k].label,type:'check'}}),secv,'حفظ الأقسام',function(v){return guard(api('PUT','/admin/home',{sections:v}),'تم الحفظ')});
    m.appendChild(h('div',{cls:'card'},h('h2',{},'الإعلان أعلى الرئيسية'),ann));
    m.appendChild(h('div',{cls:'card'},h('h2',{},'أقسام الرئيسية'),secf));
    var fl=h('div');
    function drawF(list){
      fl.textContent='';
      fl.appendChild(table(['#','العمل',''],list.map(function(s,i){return [String(i+1),s.title,h('div',{cls:'row'},
        act('▲',function(){guard(api('POST','/admin/home/featured/'+s.id,{delta:-1})).then(function(r){drawF(r.featured)})}),
        act('▼',function(){guard(api('POST','/admin/home/featured/'+s.id,{delta:1})).then(function(r){drawF(r.featured)})}),
        act('إزالة',function(){guard(api('DELETE','/admin/home/featured/'+s.id)).then(function(r){drawF(r.featured)})},'danger'))]})));
      if(!list.length)fl.appendChild(h('p',{cls:'dim'},'لا أعمال مميّزة — تظهر أول 5 أعمال تلقائياً.'));
    }
    drawF(hm.featured);
    var sel=h('select',{});api('GET','/admin/series').then(function(all){all.forEach(function(s){sel.appendChild(h('option',{value:s.id},s.title))})});
    m.appendChild(h('div',{cls:'card'},h('h2',{},'أعمال الهيرو'),fl,h('div',{cls:'row',style:'margin-top:10px'},sel,h('button',{cls:'btn pri',on:{click:function(){if(sel.value)guard(api('POST','/admin/home/featured/'+sel.value,{})).then(function(r){drawF(r.featured)})}}},'+ إضافة'))));
  });
};
VIEWS.news=function(m){
  var list=h('div');m.appendChild(h('div',{cls:'card'},h('div',{cls:'row'},h('h2',{cls:'sp'},'الأخبار'),h('button',{cls:'btn pri',on:{click:function(){newsForm(null,load)}}},'+ خبر جديد'))));m.appendChild(list);
  function load(){api('GET','/admin/news').then(function(rows){list.textContent='';list.appendChild(h('div',{cls:'card'},table(['العنوان','التصنيف','التاريخ',''],rows.map(function(n){return [n.title,n.category,n.created_at,h('div',{cls:'row'},act('تعديل',function(){newsForm(n,load)}),act('حذف',function(){confirmAct('حذف الخبر؟',function(){guard(api('DELETE','/admin/news/'+n.id),'تم الحذف').then(load)})},'danger'))]}))))})}
  load();
};
function newsForm(n,done){
  var mm=modal(n?'تعديل الخبر':'خبر جديد',form([{k:'image',label:'صورة الخبر (اختياري)',type:'image'},{k:'title',label:'العنوان'},{k:'category',label:'التصنيف',ph:'أخبار'},{k:'body',label:'نص الخبر',type:'textarea'}],n||{category:'أخبار'},'نشر',function(v){
    return guard(api(n?'PUT':'POST',n?'/admin/news/'+n.id:'/admin/news',v),'تم الحفظ').then(function(){mm.close();done()});
  }));
}
VIEWS.posts=function(m){
  var list=h('div');m.appendChild(h('div',{cls:'card'},h('div',{cls:'row'},h('h2',{cls:'sp'},'المنشورات'),h('button',{cls:'btn pri',on:{click:function(){postForm(load)}}},'+ منشور رسمي'))));m.appendChild(list);
  function load(){api('GET','/admin/posts').then(function(rows){list.textContent='';list.appendChild(h('div',{cls:'card'},table(['الكاتب','المنشور','تفاعل',''],rows.map(function(p){
    var likes=0;Object.keys(p.reactions).forEach(function(k){likes+=p.reactions[k]});
    return [[p.author,p.author_banned?h('span',{cls:'tag er'},'محظور'):null],(p.tag?'['+p.tag+'] ':'')+p.body.slice(0,120)+(p.images.length?' 🖼'+p.images.length:'')+(p.poll?' 📊':''),likes+' ❤ '+p.comments+' 💬',
      h('div',{cls:'row'},act('تعديل',function(){var mm=modal('تعديل المنشور',form([{k:'body',label:'النص',type:'textarea'},{k:'tag',label:'وسم'}],p,'حفظ',function(v){return guard(api('PUT','/admin/posts/'+p.id,v),'تم الحفظ').then(function(){mm.close();load()})}))}),
        act('حذف',function(){confirmAct('حذف المنشور؟',function(){guard(api('DELETE','/admin/posts/'+p.id),'تم الحذف').then(load)})},'danger'))];
  }))));if(!rows.length)list.appendChild(h('div',{cls:'card dim'},'لا منشورات.'))})}
  load();
};
function postForm(done){
  var mm=modal('منشور رسمي',form([{k:'body',label:'نص المنشور',type:'textarea'},{k:'tag',label:'وسم (اختياري)'},{k:'pq',label:'سؤال الاستفتاء (اختياري)'},{k:'po',label:'خيارات الاستفتاء (سطر لكل خيار، 2–5)',type:'textarea'},{k:'img',label:'صورة (اختياري)',type:'image'}],{},'نشر',function(v){
    var o={body:v.body,tag:v.tag,images:v.img?[v.img]:[]};
    if(v.pq)o.poll={question:v.pq,options:lines(v.po)};
    return guard(api('POST','/admin/posts',o),'تم النشر').then(function(){mm.close();done()});
  }));
}
VIEWS.comments=function(m){
  var sel=h('select',{});sel.appendChild(h('option',{value:''},'كل الأعمال'));
  var epbox=h('input',{type:'number',placeholder:'رقم مفتاح الحلقة (موسم×10000+رقم) — اختياري'});
  var list=h('div');
  api('GET','/admin/series').then(function(all){all.forEach(function(s){sel.appendChild(h('option',{value:s.id},s.title))})});
  m.appendChild(h('div',{cls:'card'},h('h2',{},'إدارة التعليقات'),h('div',{cls:'row'},sel,epbox,h('button',{cls:'btn pri',on:{click:load}},'عرض'))));m.appendChild(list);
  function load(){api('GET','/admin/comments?series_id='+encodeURIComponent(sel.value)+(epbox.value?'&episode='+epbox.value:'')).then(function(rows){
    list.textContent='';list.appendChild(h('div',{cls:'card'},table(['الكاتب','التعليق','الهدف',''],rows.map(function(c){return [c.author,c.text.slice(0,160),[c.target,h('div',{cls:'dim'},c.created_at+' • '+c.likes+' ❤')],act('حذف',function(){confirmAct('حذف التعليق وردوده؟',function(){guard(api('DELETE','/admin/comments/'+c.id),'تم الحذف').then(load)})},'danger')]}))));
    if(!rows.length)list.appendChild(h('div',{cls:'card dim'},'لا تعليقات.'))})}
  load();
};
var BADGE_OPTS=[['none','بدون توثيق'],['purple','فريق Sedhok (بنفسجي)'],['blue','حساب موثّق (أزرق)'],['yellow','مترجم معتمد (أصفر)']];
VIEWS.users=function(m){
  var list=h('div');m.appendChild(h('div',{cls:'card'},h('div',{cls:'row'},h('h2',{cls:'sp'},'الأعضاء'),h('button',{cls:'btn pri',on:{click:function(){userForm(null,load)}}},'+ إضافة عضو')),h('p',{cls:'dim'},'التوثيق يظهر بجانب الاسم في المنشورات والملف الشخصي. العضو المحظور تختفي منشوراته ولا يستطيع الكتابة.')));m.appendChild(list);
  function load(){api('GET','/admin/users').then(function(rows){list.textContent='';list.appendChild(h('div',{cls:'card'},table(['الاسم','البريد','الحالة',''],rows.map(function(u){
    var bl=BADGE_OPTS.filter(function(b){return b[0]===u.badge})[0][1];
    return [u.name,h('span',{dir:'ltr'},u.email||'—'),[u.badge!=='none'?h('span',{cls:'tag ok'},bl):null,u.banned?h('span',{cls:'tag er'},'محظور'):null,u.system?h('span',{cls:'tag'},'نظام'):null],
      h('div',{cls:'row'},act('تعديل',function(){userForm(u,load)}),u.email?act('رمز استعادة',function(){guard(api('POST','/admin/users/'+u.id+'/reset-token',{})).then(function(r){modal('رمز استعادة كلمة المرور',h('div',{},h('p',{},'أعطِ هذا الرمز للعضو (صالح 60 دقيقة):'),h('input',{type:'text',dir:'ltr',value:r.token,readonly:true})))})}):null,
        u.system?null:act('حذف',function(){confirmAct('حذف العضو وكل منشوراته وتعليقاته؟',function(){guard(api('DELETE','/admin/users/'+u.id),'تم الحذف').then(load)})},'danger'))];
  }))))})}
  load();
};
function userForm(u,done){
  var mm=modal(u?'تعديل العضو':'إضافة عضو',form([{k:'name',label:'الاسم'},{k:'email',label:'البريد (اختياري)',dir:'ltr'},{k:'password',label:u?'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)':'كلمة المرور (اختياري، 8+)',type:'password',dir:'ltr'},{k:'bio',label:'نبذة',type:'textarea'},{k:'badge',label:'التوثيق',type:'select',opts:BADGE_OPTS},{k:'banned',label:'حظر العضو (تختفي منشوراته)',type:'check'}],u||{badge:'none'},'حفظ',function(v){
    if(!v.password)delete v.password;
    return guard(api(u?'PUT':'POST',u?'/admin/users/'+u.id:'/admin/users',v),'تم حفظ العضو').then(function(){mm.close();done()});
  }));
}
VIEWS.notif=function(m){
  var list=h('div');
  var sel=h('select',{});sel.appendChild(h('option',{value:''},'بدون ربط'));api('GET','/admin/series').then(function(all){all.forEach(function(s){sel.appendChild(h('option',{value:s.id},s.title))})});
  var t=h('input',{type:'text',placeholder:'عنوان الإشعار'}),b=h('textarea',{placeholder:'نص الإشعار'});
  m.appendChild(h('div',{cls:'card'},h('h2',{},'إرسال إشعار لكل المستخدمين'),h('label',{},'العنوان'),t,h('label',{},'النص'),b,h('label',{},'يفتح عملاً عند الضغط (اختياري)'),sel,h('div',{style:'margin-top:12px'},h('button',{cls:'btn pri',on:{click:function(){guard(api('POST','/admin/notifications',{title:t.value,body:b.value,series_id:sel.value}),'تم الإرسال').then(function(){t.value='';b.value='';load()})}}},'إرسال'))));
  m.appendChild(list);
  function load(){api('GET','/admin/notifications').then(function(rows){list.textContent='';list.appendChild(h('div',{cls:'card'},h('h3',{},'المُرسَلة ('+rows.length+')'),table(['العنوان','النص','',''],rows.map(function(n){return [n.title,n.body,n.created_at,act('حذف',function(){guard(api('DELETE','/admin/notifications/'+n.id)).then(load)},'danger')]}))))})}
  load();
};
VIEWS.groups=function(m){
  api('GET','/admin/groups').then(function(rows){
    m.appendChild(h('div',{cls:'card'},h('h2',{},'المجموعات ('+rows.length+')'),table(['الاسم','المسؤول','النوع','أعضاء/طلبات/رسائل',''],rows.map(function(g){return [g.name,g.owner_name,(g.public?'عامة':'خاصة')+' • '+g.mode,g.members+' / '+g.requests+' / '+g.messages,act('حذف',function(){confirmAct('حذف المجموعة؟',function(){guard(api('DELETE','/admin/groups/'+g.id),'تم الحذف').then(reload)})},'danger')]}))));
  });
};
VIEWS.settings=function(m){
  var st=S.settings;
  m.appendChild(h('div',{cls:'card'},h('h2',{},'القوائم'),form([{k:'types',label:'الأنواع (سطر لكل عنصر)',type:'textarea'},{k:'genres',label:'التصنيفات',type:'textarea'},{k:'countries',label:'البلدان',type:'textarea'},{k:'adblock',label:'تفعيل مانع الإعلانات',type:'check'}],st,'حفظ',function(v){
    return guard(api('PUT','/admin/settings',{types:lines(v.types),genres:lines(v.genres),countries:lines(v.countries),adblock:v.adblock}),'تم الحفظ');
  })));
  m.appendChild(h('div',{cls:'card'},h('h2',{},'حساب الأدمن'),form([{k:'username',label:'اسم المستخدم',dir:'ltr'},{k:'password',label:'كلمة المرور الجديدة (6+)',type:'password',dir:'ltr'},{k:'confirm',label:'تأكيد كلمة المرور',type:'password',dir:'ltr'}],{username:st.username},'حفظ',function(v){
    return guard(api('POST','/admin/account',v),'تم تحديث حساب الأدمن').then(function(r){TOKEN=r.token;try{localStorage.setItem('sedhok_admin',TOKEN)}catch(e){}});
  })));
  var file=h('input',{type:'file',accept:'application/json'});
  m.appendChild(h('div',{cls:'card'},h('h2',{},'نسخ احتياطي وصيانة'),h('p',{cls:'dim'},'النسخة تشمل كل البيانات دون كلمات المرور؛ الصور تبقى في مجلد data/uploads على الخادم.'),
    h('div',{cls:'row'},
      h('button',{cls:'btn',on:{click:function(){api('GET','/admin/backup').then(function(j){var a=h('a',{href:URL.createObjectURL(new Blob([JSON.stringify(j,null,1)],{type:'application/json'})),download:'sedhok-backup-'+new Date().toISOString().slice(0,10)+'.json'});document.body.appendChild(a);a.click();a.remove()}).catch(function(e){toast(e.message,true)})}}},'تنزيل نسخة احتياطية'),
      h('button',{cls:'btn',on:{click:function(){guard(api('POST','/admin/cleanup-uploads',{})).then(function(r){toast('حُذفت '+r.deleted+' صورة غير مستعملة')})}}},'تنظيف الصور'),
      h('button',{cls:'btn danger',on:{click:function(){confirmAct('حذف كل الأعمال والحلقات والأخبار والمنشورات والإشعارات؟',function(){guard(api('POST','/admin/clear',{}),'تم الحذف')})}}},'حذف كل المحتوى'),
      h('button',{cls:'btn danger',on:{click:function(){confirmAct('استبدال المحتوى ببيانات تجريبية؟',function(){guard(api('POST','/admin/reset-demo',{}),'تمت إعادة البيانات التجريبية')})}}},'إعادة البيانات التجريبية')),
    h('label',{},'استعادة من ملف نسخة احتياطية'),file,
    h('div',{style:'margin-top:8px'},h('button',{cls:'btn',on:{click:function(){var f=file.files[0];if(!f)return toast('اختر ملفاً',true);var r=new FileReader();r.onload=function(){var j;try{j=JSON.parse(r.result)}catch(e){return toast('ملف غير صالح',true)}confirmAct('ستُستبدل البيانات الحالية. متابعة؟',function(){guard(api('POST','/admin/restore',j),'تمت الاستعادة')})};r.readAsText(f)}}},'استعادة'))));
};
render();
})();
</script></body></html>`;

// ════════════════════════════════════════════════════════════════════════
//  المعالج الرئيسي وتشغيل الخادم
// ════════════════════════════════════════════════════════════════════════
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

// ───────── تحويل المهام الثقيلة للسيرفر الآخر مع تولّي مهامه عند تعطّله ─────────
let peerDownUntil = 0;
const markPeerDown = (why) => {
  if (peerDownUntil <= now()) console.warn('⚠ السيرفر الآخر متعطّل (' + why + '): سأتولى مهامه ' + PEER_COOLDOWN / 1000 + ' ثانية');
  peerDownUntil = now() + PEER_COOLDOWN;
};

function isHeavyRequest(req, p) {
  if ((req.headers['content-type'] || '').toLowerCase().startsWith('multipart/')) return true; // رفع ملفات
  if (p.includes('/episodes')) return true;
  return HEAVY_PREFIXES.some((x) => p === x || p.startsWith(x + '/'));
}

/** يعيد true إن أُرسل الردّ من السيرفر الآخر؛ false = عالج الطلب محلياً (لا تحويل أو السيرفر الآخر متعطّل) */
async function tryProxyToPeer(req, res, p) {
  if (!PEER_URL || SERVER_ROLE !== 'light') return false;            // التحويل من الخفيف فقط
  if (req.headers['x-sedhok-hop']) return false;                    // منع الحلقات بين السيرفرين
  if (peerDownUntil > now()) return false;                          // متعطّل: نتولى مهامه
  if (!isHeavyRequest(req, p)) return false;
  const idem = req.method === 'GET' || req.method === 'HEAD';
  let body;
  if (!idem) { req._buf = await readBody(req, MAX_UPLOAD * 6 + 1024 * 1024); body = req._buf.length ? req._buf : undefined; }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'expect'].includes(k)) continue;
    headers[k] = v;
  }
  headers['x-sedhok-hop'] = '1';
  headers['x-forwarded-for'] = clientIp(req);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PEER_TIMEOUT);
  let r;
  try {
    r = await fetch(PEER_URL + req.url, { method: req.method, headers, body, signal: ac.signal, redirect: 'manual' });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e && e.name === 'AbortError';
    markPeerDown(timedOut ? 'مهلة' : 'اتصال');
    if (idem || !timedOut) return false;                            // الكتابة تُعاد محلياً فقط إن فشل الاتصال كلياً
    send(res, 504, { message: 'انتهت مهلة السيرفر، حاول مرة أخرى', error: 'peer_timeout' });
    return true;
  }
  let buf;
  try { buf = Buffer.from(await r.arrayBuffer()); } catch (e) { clearTimeout(timer); markPeerDown('قراءة'); return idem ? false : (send(res, 502, { message: 'ردّ غير مكتمل من السيرفر', error: 'peer_bad_response' }), true); }
  clearTimeout(timer);
  if (r.status >= 500 && idem) { markPeerDown('HTTP ' + r.status); return false; }   // قراءة فاشلة: نعالجها محلياً
  if (r.status >= 500) markPeerDown('HTTP ' + r.status);
  peerDownUntil = r.status < 500 ? 0 : peerDownUntil;
  const out = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'X-Sedhok-Served-By': 'peer' };
  const ct = r.headers.get('content-type'); if (ct) out['Content-Type'] = ct;
  out['Content-Length'] = buf.length;
  res.writeHead(r.status, out);
  res.end(req.method === 'HEAD' ? undefined : buf);
  return true;
}

async function handle(req, res) {
  REQ_BASE = baseUrl(req);
  const u = new URL(req.url, 'http://x');
  let p = decodeURI(u.pathname).replace(/\/{2,}/g, '/');
  if (p.startsWith('/api/') || p === '/api') p = p.slice(4) || '/'; // يقبل API_BASE_URL مع /api أو بدونها
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);

  if (req.method === 'OPTIONS') return send(res, 204, undefined);

  if (req.method === 'GET' && p.startsWith('/uploads/')) return serveUpload(res, p.slice(9));

  if (req.method === 'GET' && (p === '/admin' || p === '/admin/index.html')) {
    res.writeHead(200, Object.assign({
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    }, SECURITY_HEADERS));
    return res.end(ADMIN_HTML);
  }

  if (await tryProxyToPeer(req, res, p)) return;

  const ident = identify(req);
  let match = null; let methodMismatch = false;
  for (const r of routes) {
    const m = r.rx.exec(p);
    if (!m) continue;
    if (r.method !== req.method) { methodMismatch = true; continue; }
    match = { r, m }; break;
  }
  if (!match) return send(res, methodMismatch ? 405 : 404, { message: methodMismatch ? 'الطريقة غير مدعومة' : 'المسار غير موجود', error: methodMismatch ? 'method_not_allowed' : 'not_found' });

  const { r, m } = match;
  // مفتاح التطبيق (اختياري): يلزم توكن مستخدم/أدمن أو API_KEY لكل مسارات التطبيق
  if (API_KEY && r.auth !== 'admin' && p !== '/admin/login' && p !== '/broadcasts' && !ident.user && !ident.admin && !ident.apiKey && !['/', '/health'].includes(p)) {
    return send(res, 401, { message: 'مفتاح التطبيق مطلوب', error: 'api_key_required' });
  }
  if (r.auth === 'admin' && !ident.admin) return send(res, 401, { message: 'يلزم تسجيل دخول الأدمن', error: 'admin_required' });
  if (r.auth === 'user' && !ident.user) return send(res, 401, { message: 'يلزم تسجيل الدخول', error: 'unauthorized' });

  const params = {};
  r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
  const q = Object.fromEntries([...u.searchParams.entries()].reverse());
  const { body, files } = await parseRequest(req, MAX_JSON);
  const ctx = { req, res, params, q, body, files, user: ident.user, admin: ident.admin, ip: clientIp(req) };
  const out = await r.handler(ctx);
  return send(res, 200, out === undefined ? { ok: true } : out);
}

function onRequest(req, res) {
  handle(req, res).catch((e) => {
    if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
    if (e instanceof HttpError) return send(res, e.status, { message: e.message, error: e.status === 404 ? 'not_found' : e.status === 401 ? 'unauthorized' : 'error' });
    console.error('✖ خطأ غير متوقع على', req.method, req.url, '\n', e && e.stack ? e.stack : e);
    send(res, 500, { message: 'خطأ داخلي في الخادم', error: 'server_error' });
  });
}
const server = http.createServer(onRequest);
server.requestTimeout = 120000;
server.headersTimeout = 20000;

function banner() {
  console.log('\n  Sedhok server جاهز');
  console.log('  ─────────────────────────────────────────────');
  console.log('  API:            http://127.0.0.1:' + PORT + '   (ضعه في API_BASE_URL)');
  console.log('  لوحة الأدمن:    http://127.0.0.1:' + PORT + '/admin');
  console.log('  المستخدم:       ' + db.admin.user + (db.admin.default_pass ? '   كلمة السر: ' + (ENV.ADMIN_PASS ? '(من ADMIN_PASS)' : 'admin123  ⚠ غيّرها من الإعدادات') : ''));
  console.log('  البيانات:       ' + (PG ? 'Neon Postgres (' + new URL(DATABASE_URL).hostname + ')' : DATA_DIR));
  console.log('  المسارات:       ' + routes.length + ' مساراً');
  console.log('  الدور:          ' + SERVER_ROLE + (PEER_URL ? '   (السيرفر الآخر: ' + PEER_URL + ')' : '   (بدون PEER_URL: لا توزيع)'));
  if (!API_KEY) console.log('  API_KEY:        غير مضبوط (المسارات العامة مفتوحة للقراءة)');
  if (!GOOGLE_CLIENT_ID) console.log('  Google:         غير مفعّل (اضبط GOOGLE_CLIENT_ID لتفعيل /auth/google)');
  console.log('');
}

// ───────── التشغيل: خادم دائم (Railway/Termux/VPS) أو دالة Serverless (Vercel) ─────────
let bootP = null;
const boot = () => bootP || (bootP = loadDb().catch((e) => { bootP = null; throw e; }));

/** معالج Vercel: module.exports. ينتظر حفظ التعديلات في Neon قبل إنهاء الردّ كي لا تضيع عند تجميد الدالة */
async function vercelHandler(req, res) {
  try { await boot(); await syncIfStale(req.method !== 'GET'); } catch (e) {
    console.error('✖ قاعدة البيانات غير متاحة:', e.message);
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': CORS_ORIGIN });
    return res.end(JSON.stringify({ message: 'قاعدة البيانات غير متاحة حالياً، حاول بعد قليل', error: 'db_unavailable' }));
  }
  if (PG) {
    const end = res.end.bind(res);
    res.end = (...a) => { flushAll().catch(() => {}).finally(() => end(...a)); return res; };
  }
  onRequest(req, res);
}
module.exports = vercelHandler;
module.exports.default = vercelHandler;

if (require.main === module) {
  if (SERVERLESS && !PG) console.warn('⚠ بيئة Serverless بدون DATABASE_URL: ستضيع البيانات. اضبط DATABASE_URL (Neon).');
  boot().then(() => server.listen(PORT, HOST, banner)).catch((e) => { console.error('✖', e.message); process.exit(1); });
} else if (!PG) {
  console.warn('⚠ يعمل كدالة Serverless بدون DATABASE_URL: البيانات مؤقتة وستضيع. اضبط DATABASE_URL (Neon).');
}
