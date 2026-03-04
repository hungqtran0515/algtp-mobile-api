// ============================================================================
// 🔥 ALGTP™ — Massive Scanner (REST + WS HALT + WS AM fallback + Mini Chart Hover)
// Single-file Node.js (ESM)
// ----------------------------------------------------------------------------
// UI:  /ui   (Dashboard: Symbols + Max Stepper + Roller + Box matrix)
// API:
//   /list
//   /scan
//   /snapshot-all
//   /premarket
//   /aftermarket
//   /movers-premarket        (Massive movers list -> filter by session -> rank by Gap% + Float Turnover %)
//   /movers-afterhours       (Massive movers list -> filter by session -> rank by Gap% + Float Turnover %)
//   /most-active
//   /unusual-volume
//   /most-volatile
//   /most-lately
//   /halt
//   /apia
// Extra:
//   /mini-chart?symbol=AAPL&tf=1   (hover mini chart)
// ----------------------------------------------------------------------------
// Data priority (most important parts):
// - Gap% (Regular Trading Hours gap) is computed from Polygon daily aggregates:
//     GapPercent = ((RegularTradingHoursOpen - PreviousClose) / PreviousClose) * 100
// - Float is enriched from Financial Modeling Prep "shares-float" endpoint (best-effort).
// - Float Turnover Percent is computed as:
//     FloatTurnoverPercent = (Volume / FloatShares) * 100
// - Movers Premarket / After-hours use Massive Movers list as the fastest "fragment":
//     1) Massive movers list (fast ticker list)
//     2) Enrich with Massive ticker snapshot (price/volume/basic fields)
//     3) Overwrite Gap% using Polygon daily aggregates (Regular Trading Hours open / previous close)
//     4) Enrich Float using Financial Modeling Prep shares-float
//     5) Rank: highest absolute Gap% first, then highest Float Turnover Percent, then highest Volume
// ============================================================================

import "dotenv/config";

// ============================================================================
// 🔍 QUICK ENV DEBUG (10 seconds to verify)
// ============================================================================
console.log("\n🔍 ENV Debug Check:");
console.log("ENV has GOOGLE_CLIENT_ID:", "GOOGLE_CLIENT_ID" in process.env);
console.log("ENV has GOOGLE_CLIENT_SECRET:", "GOOGLE_CLIENT_SECRET" in process.env);
console.log("CWD:", process.cwd());
console.log("");

import express from "express";
import axios from "axios";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import bcrypt from "bcryptjs";
import { 
  initDB, 
  getUserByGoogleId, 
  getUserById, 
  getUserByEmail, 
  createUser, 
  updateUser,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getWatchlistCount,
  clearWatchlist
} from "./db.js";

// DEBUG: Check if .env is loaded
console.log("GOOGLE_CLIENT_ID?", Boolean(process.env.GOOGLE_CLIENT_ID));
console.log("GOOGLE_CLIENT_SECRET?", Boolean(process.env.GOOGLE_CLIENT_SECRET));
console.log("GOOGLE_CALLBACK_URL?", process.env.GOOGLE_CALLBACK_URL);

// DEBUG: Preview env to verify they're correct
const id = String(process.env.GOOGLE_CLIENT_ID || "");
const sec = String(process.env.GOOGLE_CLIENT_SECRET || "");
console.log("GOOGLE_CLIENT_ID preview:", id.slice(0, 12), "...", id.slice(-12));
console.log("GOOGLE_CLIENT_SECRET preview:", sec.slice(0, 4), "...", sec.slice(-4));


// ============================================================================
// SECTION 00 — Brand
// ============================================================================
const BRAND = {
  mark: "🔥",
  name: "ALGTP™",
  legal: "ALGTP™ – Algorithmic Trading Platform",
  subtitle: "Smart Market Scanner",
  watermark: "Powered by ALGTP™",
};

// ============================================================================
// SECTION 01 — ENV / CONFIG
// ============================================================================
const PORT = Number(process.env.PORT || 3000);
const DEBUG = String(process.env.DEBUG || "true").toLowerCase() === "true";

// Massive REST
const MASSIVE_API_KEY = String(process.env.MASSIVE_API_KEY || "").trim();
const MASSIVE_AUTH_TYPE = String(process.env.MASSIVE_AUTH_TYPE || "query").trim(); // query | xapi | bearer
const MASSIVE_QUERY_KEYNAME = String(process.env.MASSIVE_QUERY_KEYNAME || "apiKey").trim();
const MASSIVE_MOVER_URL = String(process.env.MASSIVE_MOVER_URL || "https://api.massive.com/v2/snapshot/locale/us/markets/stocks").trim();
const MASSIVE_TICKER_SNAPSHOT_URL = String(process.env.MASSIVE_TICKER_SNAPSHOT_URL || "https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers").trim();
const MASSIVE_SNAPSHOT_ALL_URL = String(process.env.MASSIVE_SNAPSHOT_ALL_URL || "https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers").trim();
const MASSIVE_AGGS_URL = String(process.env.MASSIVE_AGGS_URL || "https://api.massive.com/v2/aggs/ticker").trim();

// Massive WS
const MASSIVE_WS_URL = String(process.env.MASSIVE_WS_URL || "wss://socket.massive.com/stocks").trim();
const ENABLE_HALT_WS = String(process.env.ENABLE_HALT_WS || "true").toLowerCase() === "true";
const ENABLE_AM_WS = String(process.env.ENABLE_AM_WS || "true").toLowerCase() === "true";
const AM_WS_SUBS = String(process.env.AM_WS_SUBS || "AM.*").trim();

// UI / Limits
const UI_AUTO_REFRESH_MS = Math.max(0, Math.min(600000, Number(process.env.UI_AUTO_REFRESH_MS || 15000)));
const IMPORTANT_SYMBOLS = String(process.env.IMPORTANT_SYMBOLS || "NVDA,TSLA,AAPL,AMD,META").trim();
const IMPORTANT_SYMBOLS_A = String(process.env.IMPORTANT_SYMBOLS_A || IMPORTANT_SYMBOLS).trim();
const IMPORTANT_SYMBOLS_B = String(process.env.IMPORTANT_SYMBOLS_B || "SPY,QQQ,IWM,DIA").trim();
const SYMBOL_DOT_TO_DASH = String(process.env.SYMBOL_DOT_TO_DASH || "false").toLowerCase() === "true";
const SCAN_MAX_SYMBOLS = Math.max(20, Math.min(10000, Number(process.env.SCAN_MAX_SYMBOLS || 200)));
const SCAN_HARD_MAX = Math.max(50, Math.min(10000, Number(process.env.SCAN_HARD_MAX || 1000)));

// Snapshot-all mode (optional)
const ENABLE_SNAPSHOT_ALL = String(process.env.ENABLE_SNAPSHOT_ALL || "false").toLowerCase() === "true";

// Aggs / Indicators
const AGGS_INCLUDE_PREPOST = String(process.env.AGGS_INCLUDE_PREPOST || "true").toLowerCase() === "true";
const ENABLE_5M_INDICATORS = String(process.env.ENABLE_5M_INDICATORS || "true").toLowerCase() === "true";
const AGGS_5M_LIMIT = Math.max(40, Math.min(5000, Number(process.env.AGGS_5M_LIMIT || 120)));
const VOL_SPIKE_MULT = Math.max(1.1, Math.min(10, Number(process.env.VOL_SPIKE_MULT || 1.5)));
const VOL_AVG_LEN_5M = Math.max(5, Math.min(200, Number(process.env.VOL_AVG_LEN_5M || 20)));
const SNAP_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.SNAP_CONCURRENCY || 4)));
const INCLUDE_OTC = String(process.env.INCLUDE_OTC || "false").toLowerCase() === "true";

// AO Filter
const ENABLE_AO_FILTER = String(process.env.ENABLE_AO_FILTER || "false").toLowerCase() === "true";
const AO_MODE = String(process.env.AO_MODE || "above_zero").toLowerCase(); // above_zero | rising

// AM cache / enrich
const AM_CACHE_MAX = Math.max(200, Math.min(20000, Number(process.env.AM_CACHE_MAX || 8000)));
const AM_ENRICH_LIMIT = Math.max(50, Math.min(1000, Number(process.env.AM_ENRICH_LIMIT || 200)));
const AM_ENRICH_TTL_MS = Math.max(5000, Math.min(300000, Number(process.env.AM_ENRICH_TTL_MS || 60000)));

// Mini chart cache
const MINI_CACHE_TTL_MS = Math.max(2000, Math.min(120000, Number(process.env.MINI_CACHE_TTL_MS || 15000)));

// Polygon daily open/prevClose for Regular Trading Hours Gap%
const POLYGON_BASE_URL = String(process.env.POLYGON_BASE_URL || "https://api.polygon.io").trim();
const POLYGON_API_KEY = String(process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || "").trim();

// Float enrich (Financial Modeling Prep)
const ENABLE_FLOAT_ENRICH = String(process.env.ENABLE_FLOAT_ENRICH || "false").toLowerCase() === "true";
const FMP_API_KEY = String(process.env.FMP_API_KEY || "").trim();
const FLOAT_TTL_MS = Math.max(60_000, Math.min(7 * 86400000, Number(process.env.FLOAT_TTL_MS || 86400000)));

// KR Mode
const ALGTP_KR_MODE = String(process.env.ALGTP_KR_MODE || "false").toLowerCase() === "true";

// Auto-detect Render deployment
const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_NAME || process.env.RENDER_EXTERNAL_URL);
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
const DEFAULT_APP_URL = IS_RENDER ? RENDER_URL : `http://localhost:${PORT}`;

const APP_URL = String(process.env.APP_URL || DEFAULT_APP_URL).trim();

// Google OAuth Configuration
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const GOOGLE_CALLBACK_URL = String(process.env.GOOGLE_CALLBACK_URL || `${APP_URL}/auth/google/callback`).trim();

// DEBUG: OAuth Configuration
console.log("🔐 OAuth Config:");
console.log("  APP_URL:", APP_URL);
console.log("  NODE_ENV:", process.env.NODE_ENV || "(not set)");
console.log("  GOOGLE_CLIENT_ID:", GOOGLE_CLIENT_ID ? `${GOOGLE_CLIENT_ID.substring(0, 20)}...` : "(missing)");
console.log("  GOOGLE_CLIENT_ID (full):", GOOGLE_CLIENT_ID);
console.log("  GOOGLE_CLIENT_SECRET:", GOOGLE_CLIENT_SECRET ? `${GOOGLE_CLIENT_SECRET.substring(0, 15)}...` : "(missing)");
console.log("  GOOGLE_CALLBACK_URL:", GOOGLE_CALLBACK_URL);
console.log("");

// ============================================================================
// Memory Monitoring (to prevent 502 errors)
// ============================================================================
setInterval(() => {
  const used = process.memoryUsage();
  const heapMB = Math.round(used.heapUsed / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);
  console.log(`📊 Memory: Heap=${heapMB}MB RSS=${rssMB}MB`);
  
  // Warning if memory is high (approaching 512MB limit on free tier)
  if (heapMB > 400) {
    console.warn(`⚠️ HIGH MEMORY: ${heapMB}MB - consider restarting or clearing caches`);
  }
}, 60000); // Log every 60 seconds
if (GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')) {
  console.warn("⚠️  WARNING: GOOGLE_CLIENT_ID doesn't look like a Web application client!");
  console.warn("⚠️  Make sure you're using OAuth 2.0 'Web application' type, not 'iOS' or 'Android'");
}

// Session Configuration
const SESSION_SECRET = String(process.env.SESSION_SECRET || "algtp-secret-change-in-production").trim();

// Admin Login Configuration
const ENABLE_ADMIN_LOGIN = String(process.env.ENABLE_ADMIN_LOGIN || "false").toLowerCase() === "true";
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@algtp.ai").trim().toLowerCase();
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || "").trim();

// Admin session expiry (2 hours)
const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Admin security
const ADMIN_ACCESS_KEY = String(process.env.ADMIN_ACCESS_KEY || "").trim();
const ADMIN_IP_ALLOWLIST = String(process.env.ADMIN_IP_ALLOWLIST || "").trim();
const ENABLE_ADMIN_IMPERSONATE = String(process.env.ENABLE_ADMIN_IMPERSONATE || "false").toLowerCase() === "true";

// Watchlist Configuration
const WATCHLIST_MAX = Math.max(10, Math.min(500, Number(process.env.WATCHLIST_MAX || 100)));

if (!MASSIVE_API_KEY || !MASSIVE_MOVER_URL || !MASSIVE_TICKER_SNAPSHOT_URL) {
  console.error("❌ Missing ENV. Required:");
  console.error(" - MASSIVE_API_KEY");
  console.error(" - MASSIVE_MOVER_URL");
  console.error(" - MASSIVE_TICKER_SNAPSHOT_URL");
  process.exit(1);
}

// Initialize Database
initDB();

// ============================================================================
// SECTION 02 — App + Helpers
// ============================================================================
const app = express();

// Trust Render proxy (CRITICAL for HTTPS cookies)
app.set('trust proxy', 1);

// Session middleware (before passport)
app.use(session({
  name: 'algtp.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,              // 🔥 Trust Render proxy (CRITICAL for HTTPS)
  rolling: true,            // Refresh cookie on each request
  cookie: { 
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // 🔥 HTTPS on Render, HTTP for local dev
    sameSite: 'lax',        // 🔥 Allow same-site fetch + OAuth redirects
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Auto-logout admin sessions after 2 hours
app.use((req, res, next) => {
  // Only apply to logged-in sessions
  if (!req.session || !req.user) return next();

  // Only admin sessions
  if (req.session.isAdmin && req.session.adminLoginAt) {
    const elapsed = Date.now() - Number(req.session.adminLoginAt || 0);

    if (elapsed > ADMIN_SESSION_TTL_MS) {
      console.warn("⏱ Admin session expired → auto logout");

      return req.logout(() => {
        req.session.destroy(() => {
          return res.redirect("/pricing?admin_expired=1");
        });
      });
    }
  }

  next();
});

// Passport Google OAuth Strategy
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log('✅ OAuth profile received:', profile?.id, profile?.emails?.[0]?.value);
        
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName;
        const avatar = profile.photos?.[0]?.value;
        
        let user = await getUserByGoogleId(googleId);
        
        if (!user) {
          console.log('ℹ️ Creating new user:', email);
          
          user = await createUser({
            googleId,
            email,
            name,
            avatar,
          });
          console.log('✅ User created:', user.id);
        } else {
          console.log('✅ Existing user found:', user.id, user.email);
        }
        
        return done(null, user);
      } catch (err) {
        console.error('❌ Google OAuth Strategy error:', err);
        console.error('Error stack:', err.stack);
        return done(err, null);
      }
    }
  ));
  
  passport.serializeUser((user, done) => {
    console.log('📦 Serialize user:', user.id, user.email);
    done(null, user.id);
  });
  
  passport.deserializeUser(async (id, done) => {
    try {
      console.log('📦 Deserialize user ID:', id);
      const user = await getUserById(id);
      if (user) {
        console.log('✅ User deserialized:', user.id, user.email);
      } else {
        console.warn('⚠️  Deserialize: user not found for ID:', id);
      }
      done(null, user);
    } catch (err) {
      console.error('❌ Deserialize user error:', err);
      done(err, null);
    }
  });
  
  console.log('✅ Google OAuth configured');
} else {
  console.warn('⚠️  GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. OAuth disabled.');
}


// Body parsing middleware (AFTER webhook handler)
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  
  next();
});

// ============================================================================
// Analytics System (In-Memory Event Store)
// ============================================================================
const analyticsEvents = []; // in-memory log
const ANALYTICS_MAX = Math.max(1000, Math.min(100_000, Number(process.env.ANALYTICS_MAX || 50_000)));

function pushEvent(evt) {
  analyticsEvents.push(evt);
  if (analyticsEvents.length > ANALYTICS_MAX) {
    analyticsEvents.splice(0, analyticsEvents.length - ANALYTICS_MAX);
  }
}

function getUserTier(user) {
  if (!user) return "ANONYMOUS";
  if (user.tier) return String(user.tier).toUpperCase();
  return user.is_paid ? "PAID" : "FREE";
}

// ============================================================================
// Access Countdown Computation (PAID only)
// ============================================================================
/**
 * Compute user access mode and days remaining
 * Handles both camelCase and snake_case DB fields
 * Priority: PAID > EXPIRED
 */
function computeAccessCountdown(user) {
  const now = Date.now();

  const paidUntil = Number(user?.paid_until || user?.paidUntil || 0);

  const calc = (untilMs) => {
    const msLeft = Math.max(0, untilMs - now);
    const totalHours = Math.ceil(msLeft / (60 * 60 * 1000));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return { msLeft, totalHours, days, hours };
  };

  // PAID
  if (user?.is_paid === 1 && paidUntil > now) {
    const t = calc(paidUntil);
    return {
      mode: "PAID",
      tier: String(user?.tier || "PAID").toUpperCase(),
      until: paidUntil,
      ...t,
    };
  }

  // EXPIRED
  return { mode: "EXPIRED", tier: String(user?.tier || "FREE"), until: 0, msLeft: 0, totalHours: 0, days: 0, hours: 0 };
}

// ============================================================================
// Auth Middleware (Simple Login Check)
// ============================================================================
function requireLogin(req, res, next) {
  if (!req.isAuthenticated()) {
    // Check if it's an API request (JSON)
    const accept = String(req.headers.accept || "");
    if (accept.includes("application/json") || req.xhr) {
      return res.status(401).json({
        ok: false,
        error: "UNAUTHORIZED",
        message: "Please log in to access this feature."
      });
    }
    // Browser request - redirect to login
    return res.redirect('/auth/google');
  }
  next();
}

// ============================================================================
// Access Gate: Check if user has paid access
// ============================================================================
function requireAccess(req, res, next) {
  const u = req.user;
  const now = Date.now();

  // PAID
  const paidUntil = Number(u?.paid_until || u?.paidUntil || 0);
  const paidActive = (u?.is_paid === 1) && (paidUntil > now);
  if (paidActive) return next();

  // LOCK - No access without paid subscription
  const accept = String(req.headers.accept || "");
  if (accept.includes("application/json") || req.xhr) {
    return res.status(403).json({
      ok: false,
      error: "LOCKED",
      message: "Paid subscription required. Please upgrade.",
    });
  }
  return res.redirect("/pricing?locked=1");
}

// ============================================================================
// Admin Security Guards
// ============================================================================
function getClientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").toString();
  return xff.split(",")[0].trim() || req.socket.remoteAddress || "";
}

function ipAllowed(req) {
  if (!ADMIN_IP_ALLOWLIST) return true; // allow all if not set
  const ip = getClientIp(req);
  const allow = ADMIN_IP_ALLOWLIST.split(",").map(s => s.trim()).filter(Boolean);
  return allow.includes(ip);
}

function keyAllowed(req) {
  if (!ADMIN_ACCESS_KEY) return true; // if not set, skip key check
  const key = String(req.query.key || req.headers["x-admin-key"] || "").trim();
  return key === ADMIN_ACCESS_KEY;
}

function adminGuard(req, res) {
  if (!ENABLE_ADMIN_LOGIN) { res.status(404).send("Not found"); return false; }
  if (!ipAllowed(req)) { res.status(403).send("Forbidden (IP)"); return false; }
  if (!keyAllowed(req)) { res.status(403).send("Forbidden (KEY)"); return false; }
  return true;
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.session?.isAdmin) return res.status(403).send("Admin only");
  next();
}

function dlog(...args) {
  if (DEBUG) console.log(...args);
}

function envMissingFor({ needSnapshotAll = false, needAggs = false } = {}) {
  const miss = [];
  if (!MASSIVE_API_KEY) miss.push("MASSIVE_API_KEY");
  if (!MASSIVE_MOVER_URL) miss.push("MASSIVE_MOVER_URL");
  if (!MASSIVE_TICKER_SNAPSHOT_URL) miss.push("MASSIVE_TICKER_SNAPSHOT_URL");
  if (needSnapshotAll && !MASSIVE_SNAPSHOT_ALL_URL) miss.push("MASSIVE_SNAPSHOT_ALL_URL");
  if (needAggs && !MASSIVE_AGGS_URL) miss.push("MASSIVE_AGGS_URL");
  return miss;
}

function auth(params = {}, headers = {}) {
  const t = String(MASSIVE_AUTH_TYPE).toLowerCase();
  if (t === "query") params[MASSIVE_QUERY_KEYNAME || "apiKey"] = MASSIVE_API_KEY;
  else if (t === "xapi") headers["x-api-key"] = MASSIVE_API_KEY;
  else if (t === "bearer") headers["authorization"] = `Bearer ${MASSIVE_API_KEY}`;
  else params[MASSIVE_QUERY_KEYNAME || "apiKey"] = MASSIVE_API_KEY;

  headers["user-agent"] =
    headers["user-agent"] ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36";

  // 🔍 DEBUG: Log auth method and what's being sent (DISABLED - too verbose)
  // Uncomment below ONLY when debugging API auth issues
  /*
  if (DEBUG) {
    const keyName = MASSIVE_QUERY_KEYNAME || "apiKey";
    const hasQueryKey = Boolean(params[keyName]);
    const hasXApiKey = Boolean(headers["x-api-key"]);
    const hasBearer = Boolean(headers["authorization"]);
    const keyPreview = MASSIVE_API_KEY ? `${MASSIVE_API_KEY.substring(0, 8)}...` : "(missing)";
    
    console.log("[MASSIVE AUTH]", {
      type: MASSIVE_AUTH_TYPE,
      queryKeyName: keyName,
      hasQueryKey,
      hasXApiKey,
      hasBearer,
      keyPreview,
      headerKeys: Object.keys(headers).filter(k => k !== "user-agent")
    });
  }
  */

  return { params, headers };
}

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
function round2(x) {
  const v = n(x);
  return v === null ? null : Number(v.toFixed(2));
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function norm01(x, lo, hi) {
  const v = n(x);
  if (v === null) return 0;
  if (hi <= lo) return 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

function normalizeSymbolForAPI(sym) {
  const s = String(sym || "").trim().toUpperCase();
  if (!s) return "";
  return SYMBOL_DOT_TO_DASH ? s.replace(/\./g, "-") : s;
}

function parseSymbols(input) {
  return String(input || "")
    .replace(/[\n\r\t;]/g, ",")
    .replace(/\s+/g, "")
    .split(",")
    .map((s) => normalizeSymbolForAPI(s))
    .filter(Boolean);
}

function normSym(sym) {
  return String(sym || "").trim().toUpperCase();
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

function ymd(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ----------------------------------------------------------------------------
// Session time (New York)
// ----------------------------------------------------------------------------
function toMs(ts) {
  const x = n(ts);
  if (x === null) return null;
  if (x > 1e14) return Math.floor(x / 1e6); // nanoseconds -> milliseconds
  if (x > 1e12) return Math.floor(x); // milliseconds
  if (x > 1e9) return Math.floor(x * 1000); // seconds -> milliseconds
  return null;
}

function nyHM(ms) {
  try {
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return { h, m };
  } catch {
    return { h: 0, m: 0 };
  }
}

function sessionOfMs(ms) {
  // Premarket: 04:00–09:29
  // Regular trading hours: 09:30–15:59
  // After-hours: 16:00–19:59
  const { h, m } = nyHM(ms);
  const mins = h * 60 + m;
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "pre";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "rth";
  if (mins >= 16 * 60 && mins < 20 * 60) return "after";
  return "off";
}

function extractSnapshotTimestampMs(snap) {
  const root = snap?.results ?? snap ?? {};
  const ms =
    toMs(root?.lastTrade?.t) ??
    toMs(root?.lastQuote?.t) ??
    toMs(root?.updated) ??
    toMs(root?.timestamp) ??
    toMs(root?.e) ??
    toMs(root?.s) ??
    null;
  return ms;
}

// group helpers
function groupToDirection(group) {
  if (String(group || "").trim() === "topLosers") return "losers";
  return "gainers";
}
function sortRowsByGroup(rows, group) {
  if (!Array.isArray(rows)) return;
  if (group === "topGappers") rows.sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0));
  else rows.sort((a, b) => Math.abs(b.pricePct ?? 0) - Math.abs(a.pricePct ?? 0));
}
function capPass(row, cap) {
  const want = String(cap || "all").toLowerCase();
  if (want === "all" || want === "") return true;
  return String(row?.cap || "").toLowerCase() === want;
}

// ============================================================================
// SECTION 03 — Axios Safe
// ============================================================================
function axiosFail(e) {
  if (!e || !e.isAxiosError) return { kind: "unknown", message: String(e?.message || e) };
  const code = e.code || null;
  const msg = e.message || "axios error";
  const url = e.config?.url || null;
  if (!e.response) return { kind: "network", code, message: msg, url };

  const status = e.response.status;
  const data = e.response.data;
  const bodyPreview = typeof data === "string" ? data.slice(0, 800) : JSON.stringify(data).slice(0, 800);
  return { kind: "http", status, message: msg, url, bodyPreview };
}

async function safeGet(url, { params, headers }) {
  try {
    const r = await axios.get(url, { params, headers, timeout: 25000, validateStatus: () => true });
    return { ok: r.status < 400, status: r.status, data: r.data, url };
  } catch (e) {
    return { ok: false, status: null, data: null, url, errorDetail: axiosFail(e) };
  }
}

// ============================================================================
// SECTION 04 — Massive REST
// ============================================================================
function readRowsFromAnySnapshotShape(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  // Common keys from various API providers
  const keys = ["tickers", "results", "data", "gainers", "losers", "symbols", "items", "stocks"];
  for (const k of keys) {
    if (Array.isArray(data?.[k])) return data[k];
  }

  // Nested structures
  if (data?.results && Array.isArray(data.results?.tickers)) return data.results.tickers;
  if (data?.results && Array.isArray(data.results?.data)) return data.results.data;

  return [];
}

async function fetchMovers(direction = "gainers") {
  const d = String(direction || "gainers").toLowerCase().trim();
  const directionSafe = d === "losers" ? "losers" : "gainers";
  const base = MASSIVE_MOVER_URL.replace(/\/+$/, "");
  const url = `${base}/${directionSafe}`;

  const params = {};
  if (INCLUDE_OTC) params.include_otc = "true";

  const a = auth(params, {});
  
  // 🔍 DEBUG: Log what's being sent
  if (DEBUG) {
    console.log("[fetchMovers]", {
      url,
      direction: directionSafe,
      paramKeys: Object.keys(a.params),
      headerKeys: Object.keys(a.headers).filter(k => k !== "user-agent")
    });
  }
  
  const r = await safeGet(url, { params: a.params, headers: a.headers });
  
  // 🔍 DEBUG: Log response structure
  if (DEBUG) {
    const dataKeys = r.data && typeof r.data === 'object' ? Object.keys(r.data).slice(0, 10) : [];
    console.log("[fetchMovers RESPONSE]", {
      status: r.status,
      ok: r.ok,
      dataKeys,
      isArray: Array.isArray(r.data)
    });
    if (!r.ok) {
      console.log("[fetchMovers ERROR]", r.errorDetail);
    }
  }

  const rows = readRowsFromAnySnapshotShape(r.data);
  
  // 🔍 DEBUG: Log parsed rows
  if (DEBUG) {
    console.log("[fetchMovers PARSED]", {
      rowCount: rows.length,
      sampleRows: rows.slice(0, 3).map(x => ({
        ticker: x?.ticker ?? x?.symbol ?? x?.T ?? x?.sym,
        keys: Object.keys(x || {}).slice(0, 8)
      }))
    });
  }
  
  return { ok: r.ok && Array.isArray(rows), url, status: r.status, rows, errorDetail: r.errorDetail };
}

async function fetchTickerSnapshot(ticker) {
  const base = MASSIVE_TICKER_SNAPSHOT_URL.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(String(ticker || "").trim().toUpperCase())}`;
  const a = auth({}, {});
  const r = await safeGet(url, { params: a.params, headers: a.headers });
  return { ok: r.ok, url, status: r.status, data: r.data, errorDetail: r.errorDetail };
}

async function fetchSnapshotAll() {
  const url = MASSIVE_SNAPSHOT_ALL_URL.replace(/\/+$/, "");
  const a = auth({}, {});
  const r = await safeGet(url, { params: a.params, headers: a.headers });
  const rows = readRowsFromAnySnapshotShape(r.data);
  return { ok: r.ok && Array.isArray(rows), url, status: r.status, rows, errorDetail: r.errorDetail };
}

// Aggs cache
const aggsCache = new Map(); // key -> {ts, bars}
async function fetchAggs(sym, tf = "1", limit = 300, sort = "asc") {
  const ticker = String(sym || "").trim().toUpperCase();
  const cacheKey = `${ticker}|${tf}|${sort}|${limit}`;
  const now = Date.now();
  const hit = aggsCache.get(cacheKey);
  if (hit && now - hit.ts < 15_000) return { ok: true, cached: true, bars: hit.bars };

  const base = MASSIVE_AGGS_URL.replace(/\/+$/, "");
  const to = ymd(new Date());
  const from = ymd(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  const url = `${base}/${encodeURIComponent(ticker)}/range/${encodeURIComponent(tf)}/minute/${from}/${to}`;

  const params = { adjusted: "true", sort: String(sort), limit: String(limit) };
  if (AGGS_INCLUDE_PREPOST) params.includePrePost = "true";

  const a = auth(params, {});
  const r = await safeGet(url, { params: a.params, headers: a.headers });
  const bars = Array.isArray(r.data?.results) ? r.data.results : [];
  const ok = r.ok && bars.length > 0;
  if (ok) aggsCache.set(cacheKey, { ts: now, bars });

  return { ok, url, status: r.status, bars, errorDetail: r.errorDetail };
}
async function fetchAggs5m(sym) {
  return fetchAggs(sym, "5", AGGS_5M_LIMIT, "desc");
}

// ============================================================================
// SECTION 05 — Normalize Snapshot (price/open/prevClose/gap/float/marketCap)
// ============================================================================
function findFirstNumberByKeys(obj, candidateKeys, maxNodes = 6000) {
  if (!obj || typeof obj !== "object") return { value: null };
  const wanted = new Set(candidateKeys.map((k) => String(k).toLowerCase()));
  const q = [{ v: obj }];
  let visited = 0;

  while (q.length && visited < maxNodes) {
    const { v } = q.shift();
    visited++;
    if (!v || typeof v !== "object") continue;

    if (Array.isArray(v)) {
      for (const item of v) if (item && typeof item === "object") q.push({ v: item });
      continue;
    }

    for (const k of Object.keys(v)) {
      const keyLower = String(k).toLowerCase();
      const val = v[k];
      if (wanted.has(keyLower)) {
        const num = n(val);
        if (num !== null) return { value: num };
      }
      if (val && typeof val === "object") q.push({ v: val });
    }
  }
  return { value: null };
}

function capCategory(marketCap) {
  const mc = n(marketCap);
  if (mc === null) return null;
  if (mc < 2_000_000_000) return "small";
  if (mc < 10_000_000_000) return "mid";
  return "big";
}
function floatCategory(floatShares) {
  const fs = n(floatShares);
  if (fs === null) return null;
  if (fs < 10_000_000) return "nano";
  if (fs < 20_000_000) return "low";
  if (fs < 50_000_000) return "mid";
  return "high";
}

function normalizeSnapshotAuto(ticker, snap) {
  const root = snap?.results ?? snap ?? {};
  const day = root?.day ?? root?.todays ?? root?.today ?? null;
  const prev = root?.prevDay ?? root?.previousDay ?? root?.prev ?? null;

  const lastTradePrice =
    n(root?.lastTrade?.p) ??
    n(root?.lastTrade?.price) ??
    n(root?.last?.p) ??
    n(root?.last) ??
    n(root?.price) ??
    null;

  const dayClose = n(day?.c ?? day?.close ?? root?.close ?? root?.dayClose) ?? null;
  const prevClose0 = n(prev?.c ?? prev?.close ?? root?.prevClose ?? root?.previousClose) ?? null;

  let price = lastTradePrice ?? dayClose ?? null;
  let open = n(day?.o ?? day?.open ?? root?.open) ?? null;
  let volume = n(day?.v ?? day?.volume ?? root?.volume ?? root?.dayVolume) ?? null;

  let pricePct =
    n(root?.todaysChangePerc) ??
    n(root?.todaysChangePercent) ??
    n(root?.changePerc) ??
    n(root?.changePercent) ??
    null;

  if (price === null) price = findFirstNumberByKeys(root, ["price", "last", "p", "c", "close"]).value;
  if (open === null) open = findFirstNumberByKeys(root, ["open", "o", "dayopen", "openprice"]).value;

  let prevClose = prevClose0;
  if (prevClose === null) prevClose = findFirstNumberByKeys(root, ["prevclose", "previousclose", "pc", "prevc"]).value;
  if (volume === null) volume = findFirstNumberByKeys(root, ["volume", "v", "dayvolume"]).value;

  if (pricePct === null && price !== null && prevClose !== null && prevClose > 0) {
    pricePct = ((price - prevClose) / prevClose) * 100;
  }

  // Gap% here is best-effort; final correct Regular Trading Hours gap is overwritten later by Polygon.
  const gapPct = open !== null && prevClose !== null && prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : null;

  let floatShares =
    n(root?.float) ??
    n(root?.freeFloat) ??
    n(root?.sharesFloat) ??
    n(root?.floatShares) ??
    null;
  if (floatShares === null) floatShares = findFirstNumberByKeys(root, ["float", "freefloat", "sharesfloat", "floatshares"]).value;

  let marketCap =
    n(root?.marketCap) ??
    n(root?.marketcap) ??
    n(root?.mktcap) ??
    n(root?.market_cap) ??
    n(root?.marketCapitalization) ??
    null;
  if (marketCap === null) marketCap = findFirstNumberByKeys(root, ["marketcap", "mktcap", "market_cap", "capitalization"]).value;

  // Market capitalization estimation if missing:
  // MarketCapitalization = LastPrice * FloatShares
  const marketCapEst = marketCap === null && price !== null && floatShares !== null ? price * floatShares : null;
  const marketCapFinal = marketCap ?? marketCapEst;

  return {
    symbol: String(ticker || "").trim().toUpperCase(),
    price: price !== null ? round2(price) : null,
    open: open !== null ? round2(open) : null,
    prevClose: prevClose !== null ? round2(prevClose) : null,
    pricePct: pricePct !== null ? round2(pricePct) : null,
    gapPct: gapPct !== null ? round2(gapPct) : null,
    volume: volume !== null ? Math.round(volume) : null,
    floatShares: floatShares !== null ? Math.round(floatShares) : null,
    floatM: floatShares !== null ? round2(floatShares / 1_000_000) : null,
    floatCat: floatCategory(floatShares),
    marketCap: marketCapFinal !== null ? Math.round(marketCapFinal) : null,
    marketCapB: marketCapFinal !== null ? round2(marketCapFinal / 1_000_000_000) : null,
    cap: capCategory(marketCapFinal),
  };
}

function addExtPctFromPrevClose(row) {
  const price = n(row?.price);
  const prevClose = n(row?.prevClose);
  const extPct = price !== null && prevClose !== null && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;
  return { ...row, extPct: extPct !== null ? round2(extPct) : null };
}

// Float Turnover Percent: (Volume / FloatShares) * 100
function addFloatTurnoverPct(row) {
  const volume = n(row?.volume);
  const floatShares = n(row?.floatShares);
  const floatTurnoverPct =
    volume !== null && floatShares !== null && floatShares > 0
      ? (volume / floatShares) * 100
      : null;
  return { ...row, floatTurnoverPct: floatTurnoverPct !== null ? round2(floatTurnoverPct) : null };
}

// ----------------------------------------------------------------------------
// Z-score normalization helper for ranking
// ----------------------------------------------------------------------------
function z_score(val, arr) {
  const v = n(val);
  if (v === null) return 0;
  const nums = arr.map(n).filter((x) => x !== null);
  if (!nums.length) return 0;
  const mean = nums.reduce((s, x) => s + x, 0) / nums.length;
  const variance = nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length;
  const std = Math.sqrt(variance);
  return std > 0 ? (v - mean) / std : 0;
}

// ----------------------------------------------------------------------------
// Composite rank for /rank-rovl endpoint
// Multi-factor ranking: ROVL (volRatio_5m) + Float Turnover + Gap + Volume + Price Change
// ----------------------------------------------------------------------------
function computeCompositeRank(row, allRows = []) {
  const rovl = n(row?.volRatio_5m) ?? 0;
  const floatTurnover = n(row?.floatTurnoverPct) ?? 0;
  const gap = Math.abs(n(row?.gapPct) ?? 0);
  const vol = n(row?.volume) ?? 0;
  const priceChg = Math.abs(n(row?.pricePct) ?? 0);

  // If allRows is provided, use z-score normalization; otherwise use raw values
  if (allRows && allRows.length > 1) {
    const s_rovl = z_score(rovl, allRows.map((r) => r?.volRatio_5m));
    const s_ft = z_score(floatTurnover, allRows.map((r) => r?.floatTurnoverPct));
    const s_gap = z_score(gap, allRows.map((r) => Math.abs(r?.gapPct ?? 0)));
    const s_vol = z_score(vol, allRows.map((r) => r?.volume));
    const s_pc = z_score(priceChg, allRows.map((r) => Math.abs(r?.pricePct ?? 0)));

    const score =
      0.35 * s_rovl +
      0.20 * s_ft +
      0.20 * s_gap +
      0.15 * s_vol +
      0.10 * s_pc;

    return Number(score.toFixed(4));
  } else {
    // Fallback: simple weighted sum of raw values
    return Number((0.35 * rovl + 0.20 * floatTurnover + 0.20 * gap + 0.15 * vol / 1000000 + 0.10 * priceChg).toFixed(4));
  }
}

// BOX 2 — Composite rank using norm01 (0-1 scale normalization)
function computeCompositeRankNorm01(row) {
  const rovl = n(row?.volRatio_5m) ?? 0;
  const ft = n(row?.floatTurnoverPct) ?? 0;
  const gap = Math.abs(n(row?.gapPct) ?? 0);
  const vol = n(row?.volume) ?? 0;
  const pc = Math.abs(n(row?.pricePct) ?? 0);

  // Normalize each metric to 0-1 scale with reasonable bounds
  const s_rovl = norm01(rovl, 1.0, 6.0);
  const s_ft = norm01(ft, 0.10, 3.00);
  const s_gap = norm01(gap, 2.0, 40.0);
  const s_vol = norm01(vol, 200000, 20000000);
  const s_pc = norm01(pc, 2.0, 25.0);

  const score =
    0.30 * s_rovl +
    0.25 * s_ft +
    0.20 * s_gap +
    0.15 * s_vol +
    0.10 * s_pc;

  return Number(score.toFixed(4));
}

// ============================================================================
// SECTION 05.5 — Float Enrich (Financial Modeling Prep shares-float)
// ============================================================================
const floatCache = new Map(); // sym -> {ts, floatShares}
async function fetchFloatSharesFMP(sym) {
  if (!ENABLE_FLOAT_ENRICH) return { ok: false, floatShares: null, reason: "disabled" };
  const ticker = String(sym || "").trim().toUpperCase();
  if (!ticker) return { ok: false, floatShares: null, reason: "no_symbol" };
  if (!FMP_API_KEY) return { ok: false, floatShares: null, reason: "missing_FMP_API_KEY" };

  const hit = floatCache.get(ticker);
  if (hit && Date.now() - hit.ts < FLOAT_TTL_MS) return { ok: true, floatShares: hit.floatShares, cached: true };

  const url = "https://financialmodelingprep.com/stable/shares-float";
  const r = await safeGet(url, {
    params: { symbol: ticker, apikey: FMP_API_KEY },
    headers: { "user-agent": "ALGTP" },
  });

  const arr = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : [];
  const row = arr && arr.length ? arr[0] : null;

  const fs =
    n(row?.floatShares) ??
    n(row?.float) ??
    n(row?.sharesFloat) ??
    n(row?.freeFloat) ??
    null;

  if (!r.ok || fs === null) return { ok: false, floatShares: null, detail: r.errorDetail || r.data };

  floatCache.set(ticker, { ts: Date.now(), floatShares: Math.round(fs) });
  return { ok: true, floatShares: Math.round(fs), cached: false };
}

async function enrichRowsWithFloat(rows, maxN = 200) {
  if (!ENABLE_FLOAT_ENRICH) return rows;

  const top = rows.slice(0, maxN);
  const needSymbols = top
    .filter((r) => r && (r.floatShares == null || r.floatM == null))
    .map((r) => r.symbol)
    .filter(Boolean);

  const symbols = Array.from(new Set(needSymbols));
  if (!symbols.length) return rows;

  const fetched = await mapPool(symbols, Math.min(6, SNAP_CONCURRENCY), async (sym) => {
    const x = await fetchFloatSharesFMP(sym);
    return { sym, ...x };
  });

  const map = new Map(fetched.filter((x) => x.ok && x.floatShares != null).map((x) => [x.sym, x.floatShares]));

  return rows.map((r) => {
    const fmpFloatShares = map.get(r.symbol);
    if (!fmpFloatShares) return r;

    const floatShares = r.floatShares ?? fmpFloatShares;
    const floatM = r.floatM ?? round2(floatShares / 1_000_000);
    const floatCat = r.floatCat ?? floatCategory(floatShares);

    // If market capitalization is missing, estimate:
    // MarketCapitalization = LastPrice * FloatShares
    const price = n(r?.price);
    const marketCapExisting = n(r?.marketCap);

    const marketCap =
      marketCapExisting != null
        ? Math.round(marketCapExisting)
        : (price != null ? Math.round(price * floatShares) : (r.marketCap ?? null));

    const marketCapB = marketCap != null ? round2(marketCap / 1_000_000_000) : (r.marketCapB ?? null);
    const cap = capCategory(marketCap);

    return addFloatTurnoverPct({
      ...r,
      floatShares,
      floatM,
      floatCat,
      floatSource: "financialmodelingprep_shares_float",
      marketCap,
      marketCapB,
      cap,
      capSource: (marketCapExisting != null) ? (r.capSource || "snapshot") : "last_price_times_float_shares",
    });
  });
}

// ============================================================================
// SECTION 06 — Signals (icons)
// ============================================================================
function demandScore(row) {
  const gap = Math.abs(n(row?.gapPct) ?? 0);
  const pc = Math.abs(n(row?.pricePct ?? row?.extPct) ?? 0);

  let s = 0;
  if (gap >= 20) s += 1;
  if (gap >= 40) s += 1;
  if (gap >= 60) s += 1;
  if (pc >= 10) s += 1;
  if (pc >= 20) s += 1;
  if (row?.aboveVWAP_5m && row?.volSpike_5m) s += 1;

  return clamp(s, 0, 5);
}
function signalIcon(d) {
  if (d >= 5) return "🚀";
  if (d >= 4) return "🔥";
  if (d >= 3) return "👀";
  return "⛔";
}
function paSignalIcon(row) {
  const above = Boolean(row?.aboveVWAP_5m);
  const volSpike = Boolean(row?.volSpike_5m);
  if (above && volSpike) return "🚨";
  if (above) return "✅";
  if (volSpike) return "🔊";
  return "";
}

// ============================================================================
// SECTION 07 — Indicators (EMA/SMA/VWAP) + Awesome Oscillator
// ============================================================================
function computeSMA(arr, len) {
  if (!Array.isArray(arr) || arr.length < len) return null;
  let sum = 0;
  for (let i = arr.length - len; i < arr.length; i++) sum += arr[i];
  return sum / len;
}
function computeEMA(arr, len) {
  if (!Array.isArray(arr) || arr.length < len) return null;
  const k = 2 / (len + 1);
  let ema = computeSMA(arr.slice(0, len), len);
  if (ema === null) return null;
  for (let i = len; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}
function computeVWAP(closes, volumes) {
  if (!Array.isArray(closes) || !Array.isArray(volumes) || closes.length === 0 || closes.length !== volumes.length) return null;
  let pv = 0, vv = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = n(closes[i]);
    const v = n(volumes[i]);
    if (c === null || v === null || v <= 0) continue;
    pv += c * v;
    vv += v;
  }
  if (vv <= 0) return null;
  return pv / vv;
}
function computeAvg(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let s = 0, c = 0;
  for (const x of arr) {
    const v = n(x);
    if (v === null) continue;
    s += v;
    c++;
  }
  if (c === 0) return null;
  return s / c;
}

function indicatorsFromAggs5m(barsDesc) {
  if (!Array.isArray(barsDesc) || barsDesc.length === 0) {
    return { sma26_5m: null, ema9_5m: null, ema34_5m: null, vwap_5m: null, lastVol_5m: null, avgVol_5m: null };
  }
  const bars = barsDesc
    .map((b) => ({
      c: n(b?.c ?? b?.close),
      v: n(b?.v ?? b?.volume),
      h: n(b?.h ?? b?.high),
      l: n(b?.l ?? b?.low),
    }))
    .filter((x) => x.c !== null)
    .slice(0, 600);

  const barsChrono = [...bars].reverse();
  const closes = barsChrono.map((x) => x.c);
  const vols = barsChrono.map((x) => x.v ?? 0);

  const sma26 = closes.length >= 26 ? computeSMA(closes, 26) : null;
  const ema9 = computeEMA(closes, 9);
  const ema34 = computeEMA(closes, 34);
  const vwap = computeVWAP(closes, vols);

  const lastBar = barsChrono[barsChrono.length - 1] || null;
  const lastVol = lastBar?.v ?? null;
  const avgVol = computeAvg(vols.slice(-VOL_AVG_LEN_5M));

  return {
    sma26_5m: sma26 !== null ? round2(sma26) : null,
    ema9_5m: ema9 !== null ? round2(ema9) : null,
    ema34_5m: ema34 !== null ? round2(ema34) : null,
    vwap_5m: vwap !== null ? round2(vwap) : null,
    lastVol_5m: lastVol !== null ? Math.round(lastVol) : null,
    avgVol_5m: avgVol !== null ? Math.round(avgVol) : null,
    _bars5m_forAwesomeOscillator: bars,
  };
}

function computeAwesomeOscillatorFrom5mBars(bars) {
  // Awesome Oscillator = SimpleMovingAverage(5, median) - SimpleMovingAverage(34, median)
  if (!Array.isArray(bars) || bars.length < 34) return { ao: null, aoPrev: null };

  const medianPriceSeries = bars
    .filter((b) => n(b?.h) !== null && n(b?.l) !== null)
    .map((b) => (Number(b.h) + Number(b.l)) / 2)
    .reverse();

  if (medianPriceSeries.length < 35) return { ao: null, aoPrev: null };

  const simpleMovingAverageAt = (arr, len, idx) => {
    if (idx + len > arr.length) return null;
    let s = 0;
    for (let i = idx; i < idx + len; i++) s += arr[i];
    return s / len;
  };

  const aoNow = simpleMovingAverageAt(medianPriceSeries, 5, 0) - simpleMovingAverageAt(medianPriceSeries, 34, 0);
  const aoPrev = simpleMovingAverageAt(medianPriceSeries, 5, 1) - simpleMovingAverageAt(medianPriceSeries, 34, 1);

  return { ao: aoNow !== null ? round2(aoNow) : null, aoPrev: aoPrev !== null ? round2(aoPrev) : null };
}

function attach5mSignals(row) {
  const price = n(row?.price);
  const vwap = n(row?.vwap_5m);
  const lastVol = n(row?.lastVol_5m);
  const avgVol = n(row?.avgVol_5m);

  const aboveVWAP = price !== null && vwap !== null ? price > vwap : false;
  const volSpike = lastVol !== null && avgVol !== null && avgVol > 0 ? lastVol >= avgVol * VOL_SPIKE_MULT : false;

  const volRatio = lastVol !== null && avgVol !== null && avgVol > 0 ? lastVol / avgVol : null;

  return {
    ...row,
    aboveVWAP_5m: aboveVWAP,
    volSpike_5m: volSpike,
    volRatio_5m: volRatio !== null ? Number(volRatio.toFixed(2)) : null,
    paIcon: paSignalIcon({ aboveVWAP_5m: aboveVWAP, volSpike_5m: volSpike }),
  };
}

function aoPass(row) {
  if (!ENABLE_AO_FILTER) return true;
  const ao = n(row?.ao);
  const aoPrev = n(row?.aoPrev);
  // ✅ FIX: If AO data unavailable (off-hours/weekends), don't drop ticker - keep it
  if (ao === null) return true; // was: return false
  if (AO_MODE === "above_zero") return ao > 0;
  if (AO_MODE === "rising") return aoPrev !== null && ao > aoPrev;
  return true;
}

async function attachIndicatorsIfEnabled(rows) {
  if (!ENABLE_5M_INDICATORS) return { rows, aggsErrors: [] };

  const aggsErrors = [];
  const ind = await mapPool(rows, SNAP_CONCURRENCY, async (r) => {
    const a = await fetchAggs5m(r.symbol);
    if (!a.ok) {
      aggsErrors.push({ ticker: r.symbol, status: a.status, url: a.url, errorDetail: a.errorDetail });
      return { symbol: r.symbol };
    }
    const base = indicatorsFromAggs5m(a.bars);
    const aoData = computeAwesomeOscillatorFrom5mBars(base._bars5m_forAwesomeOscillator || []);
    delete base._bars5m_forAwesomeOscillator;
    return { symbol: r.symbol, ...base, ...aoData };
  });

  const mapInd = new Map(ind.map((x) => [x.symbol, x]));
  let out = rows.map((r) => ({ ...r, ...(mapInd.get(r.symbol) || {}) }));
  out = out.map(attach5mSignals);

  if (ENABLE_AO_FILTER) out = out.filter(aoPass);

  return { rows: out, aggsErrors };
}

// ============================================================================
// SINGLE TICKER CHECK — 5 DOMAIN STRATEGIES (Float/Vol, Vol Spike, RSI, MACD, AO+EMA)
// Endpoint: /check?symbol=AAPL&tf=5
// ============================================================================

// ---- extra env thresholds (safe defaults) ----
const CHECK_TF = String(process.env.CHECK_TF || "5"); // 5m default
const CHECK_LIMIT = clamp(Number(process.env.CHECK_LIMIT || 200), 60, 800);

// Float turnover thresholds (choose for small caps; tune later)
const TURNOVER_MIN_PCT = Number(process.env.TURNOVER_MIN_PCT || 0.25); // 0.25%
const VOLRATIO_MIN = Number(process.env.VOLRATIO_MIN || 1.8);

// RSI thresholds
const RSI_LEN = clamp(Number(process.env.RSI_LEN || 14), 5, 50);
const RSI_BULL_MIN = Number(process.env.RSI_BULL_MIN || 50); // bullish zone >= 50
const RSI_OVERBOUGHT = Number(process.env.RSI_OVERBOUGHT || 75);

// MACD defaults
const MACD_FAST = clamp(Number(process.env.MACD_FAST || 12), 2, 50);
const MACD_SLOW = clamp(Number(process.env.MACD_SLOW || 26), 5, 120);
const MACD_SIGNAL = clamp(Number(process.env.MACD_SIGNAL || 9), 2, 50);

// EMA set (9/34/50)
const EMA_1 = 9, EMA_2 = 34, EMA_3 = 50;

// ---- indicator helpers (emaSeries already exists in SECTION 11, reuse it) ----
function rsiSeries(closes, len = 14) {
  const out = Array(closes.length).fill(null);
  if (!Array.isArray(closes) || closes.length < len + 1) return out;

  let gain = 0, loss = 0;
  for (let i = 1; i <= len; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= len; loss /= len;

  let rs = loss === 0 ? 100 : gain / loss;
  out[len] = 100 - 100 / (1 + rs);

  for (let i = len + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    gain = (gain * (len - 1) + g) / len;
    loss = (loss * (len - 1) + l) / len;
    rs = loss === 0 ? 100 : gain / loss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

function macdSeries(closes, fast=12, slow=26, signal=9) {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);

  const macd = closes.map((_, i) => {
    if (emaFast[i] == null || emaSlow[i] == null) return null;
    return emaFast[i] - emaSlow[i];
  });

  // build signal EMA on macd (skip nulls by forward filling last value)
  const macdFilled = [];
  for (let i = 0; i < macd.length; i++) {
    const v = macd[i];
    if (v == null) continue;
    macdFilled.push({ i, v });
  }
  const signalLine = Array(closes.length).fill(null);
  if (macdFilled.length >= signal) {
    const vals = macdFilled.map(x => x.v);
    const sigVals = emaSeries(vals, signal);
    for (let k = 0; k < macdFilled.length; k++) {
      const idx = macdFilled[k].i;
      const sv = sigVals[k];
      if (sv != null) signalLine[idx] = sv;
    }
  }

  const hist = closes.map((_, i) => {
    if (macd[i] == null || signalLine[i] == null) return null;
    return macd[i] - signalLine[i];
  });

  return { macd, signal: signalLine, hist };
}

// ---- compute indicators from bars (chronological) ----
function computeFromBars(barsChrono) {
  const closes = barsChrono.map(b => n(b.c)).filter(x => x != null);
  const vols = barsChrono.map(b => n(b.v) ?? 0);

  if (closes.length < 60) return { ok:false };

  const ema9  = emaSeries(closes, EMA_1);
  const ema34 = emaSeries(closes, EMA_2);
  const ema50 = emaSeries(closes, EMA_3);

  const rsi = rsiSeries(closes, RSI_LEN);
  const macd = macdSeries(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);

  const last = closes.length - 1;
  const lastVol = vols[vols.length - 1] ?? null;

  // avg vol for ratio
  const avgLen = clamp(Number(VOL_AVG_LEN_5M || 20), 5, 200);
  const volSlice = vols.slice(Math.max(0, vols.length - avgLen));
  const avgVol = volSlice.length ? (volSlice.reduce((a,b)=>a+b,0) / volSlice.length) : null;
  const volRatio = (lastVol != null && avgVol != null && avgVol > 0) ? (lastVol / avgVol) : null;

  return {
    ok: true,
    ema9:  ema9[last]  != null ? round2(ema9[last])  : null,
    ema34: ema34[last] != null ? round2(ema34[last]) : null,
    ema50: ema50[last] != null ? round2(ema50[last]) : null,
    rsi:   rsi[last]   != null ? round2(rsi[last])   : null,
    macd:  macd.macd[last]   != null ? Number(macd.macd[last].toFixed(4)) : null,
    macdSignal: macd.signal[last] != null ? Number(macd.signal[last].toFixed(4)) : null,
    macdHist:   macd.hist[last]   != null ? Number(macd.hist[last].toFixed(4)) : null,
    lastVol_5m: lastVol != null ? Math.round(lastVol) : null,
    avgVol_5m:  avgVol  != null ? Math.round(avgVol)  : null,
    volRatio_5m: volRatio != null ? Number(volRatio.toFixed(2)) : null,
  };
}

// ---- domain scoring ----
function domainResults(row) {
  // 1) Float turnover
  const ft = n(row?.floatTurnoverPct);
  const d1Pass = ft != null && ft >= TURNOVER_MIN_PCT;
  const d1Note = ft == null ? "no float data" : (d1Pass ? `turnover ${ft.toFixed(2)}% ≥ ${TURNOVER_MIN_PCT}%` : `turnover ${ft.toFixed(2)}% < ${TURNOVER_MIN_PCT}%`);
  const d1 = { name:"FLOAT_TURNOVER", pass:d1Pass, score:d1Pass?1:0, note: d1Note };

  // 2) Volume spike (vol ratio)
  const vr = n(row?.volRatio_5m);
  const d2Pass = vr != null && vr >= VOLRATIO_MIN;
  const d2Note = vr == null ? "no volume data" : (d2Pass ? `volRatio ${vr.toFixed(1)} ≥ ${VOLRATIO_MIN}` : `volRatio ${vr.toFixed(1)} < ${VOLRATIO_MIN}`);
  const d2 = { name:"VOLUME_SPIKE", pass:d2Pass, score:d2Pass?1:0, note: d2Note };

  // 3) RSI
  const rsi = n(row?.rsi);
  const d3Pass = rsi != null && rsi >= RSI_BULL_MIN && rsi <= RSI_OVERBOUGHT;
  const d3Note = rsi == null ? "no RSI data" : (d3Pass ? `RSI ${rsi.toFixed(0)} bullish zone` : `RSI ${rsi.toFixed(0)} outside [${RSI_BULL_MIN}-${RSI_OVERBOUGHT}]`);
  const d3 = { name:"RSI", pass:d3Pass, score:d3Pass?1:0, note: d3Note };

  // 4) MACD
  const macd = n(row?.macd);
  const sig  = n(row?.macdSignal);
  const d4Pass = macd != null && sig != null && macd > sig;
  const d4Note = (macd == null || sig == null) ? "no MACD data" : (d4Pass ? "macd > signal" : "macd ≤ signal");
  const d4 = { name:"MACD", pass:d4Pass, score:d4Pass?1:0, note: d4Note };

  // 5) AO + EMA stack
  const ao = n(row?.ao);
  const aoPrev = n(row?.aoPrev);
  const e9 = n(row?.ema9);
  const e34 = n(row?.ema34);
  const e50 = n(row?.ema50);

  const emaStackPass = (e9!=null && e34!=null && e50!=null) ? (e9 > e34 && e34 > e50) : false;
  const aoPassNow = (ao!=null) ? (ao > 0 && (aoPrev==null ? true : ao >= aoPrev)) : false;
  const d5Pass = emaStackPass && aoPassNow;
  const d5Note = (ao == null) ? "no AO data" : (d5Pass ? "AO rising & EMA9>EMA34>EMA50" : `AO/EMA stack failed`);
  const d5 = { name:"AO_EMA", pass:d5Pass, score:d5Pass?1:0, note: d5Note };

  const domains = [d1,d2,d3,d4,d5];
  const passed = domains.reduce((s,d)=>s+(d.pass?1:0),0);
  const failed = domains.length - passed;
  const rate = Math.round((passed / domains.length) * 100);

  // ---- SCORE (0..100) — strength score, not just pass/fail ----
  const rovl = n(row?.volRatio_5m);
  const gap  = Math.abs(n(row?.gapPct) ?? 0);
  const rsiV = n(row?.rsi);

  // normalize each metric (tune ranges later)
  const sROVL = norm01(rovl, 1.0, 6.0);
  const sFT   = norm01(ft,   0.10, 3.00);
  const sGAP  = norm01(gap,  2.0,  40.0);

  // RSI score: best around 55–65, penalize too low / too high
  let sRSI = 0;
  if (rsiV !== null) {
    if (rsiV < 30) sRSI = norm01(rsiV, 10, 30);
    else if (rsiV <= 70) sRSI = 1;
    else sRSI = 1 - norm01(rsiV, 70, 90);
    sRSI = clamp(sRSI, 0, 1);
  }

  // MACD score: how much macd above signal
  let sMACD = 0;
  if (macd !== null && sig !== null) {
    sMACD = norm01(macd - sig, 0, 0.30); // 0..0.30 typical small range
  }

  // AO+EMA score: stack + ao rising
  let sAOEMA = 0;
  sAOEMA = (emaStackPass ? 0.6 : 0) + (aoPassNow ? 0.4 : 0);

  // weighted composite (0..100)
  const composite =
    0.22 * sROVL +
    0.22 * sFT +
    0.18 * sGAP +
    0.18 * sRSI +
    0.12 * sMACD +
    0.08 * sAOEMA;

  const score = Math.round(clamp(composite, 0, 1) * 100);

  return { domains, passed, failed, rate, score };
}

// ============================================================================
// SECTION 08 — HALT WebSocket + /halts
// ============================================================================
const haltedMap = new Map(); // sym -> { halted, lastEvent, tsMs, reason }

function setHalt(sym) {
  haltedMap.set(sym, { halted: true, lastEvent: "HALT", tsMs: Date.now(), reason: "LimitUpLimitDown" });
}
function setResume(sym) {
  haltedMap.set(sym, { halted: false, lastEvent: "RESUME", tsMs: Date.now(), reason: "LimitUpLimitDown" });
}

function handleLULD(payload) {
  const msgs = Array.isArray(payload) ? payload : [payload];
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const ev = String(m.ev || m.event || "").toUpperCase();
    if (ev !== "LULD") continue;

    const sym = String(m.T || m.ticker || m.sym || "").trim().toUpperCase();
    if (!sym) continue;

    const indicators = Array.isArray(m.i) ? m.i : Array.isArray(m.indicators) ? m.indicators : [];
    if (indicators.includes(17)) setHalt(sym);
    if (indicators.includes(18)) setResume(sym);
  }
}

function startHaltWebSocket() {
  if (!ENABLE_HALT_WS) return;
  if (!WebSocket) return console.log("⚠️ HALT WebSocket disabled: npm i ws");
  if (!MASSIVE_API_KEY) return console.log("⚠️ HALT WebSocket disabled: missing MASSIVE_API_KEY");

  const ws = new WebSocket(MASSIVE_WS_URL);
  let subscribed = false;

  ws.on("open", () => {
    ws.send(JSON.stringify({ action: "auth", params: MASSIVE_API_KEY }));
    console.log("✅ HALT WebSocket connected (waiting auth_success...)");
  });

  ws.on("message", (buf) => {
    try {
      const parsed = JSON.parse(buf.toString("utf8"));
      const msgs = Array.isArray(parsed) ? parsed : [parsed];

      const st = msgs.find((x) => x && String(x.ev || "").toLowerCase() === "status");
      if (st && String(st.status || "").toLowerCase() === "auth_success" && !subscribed) {
        subscribed = true;
        ws.send(JSON.stringify({ action: "subscribe", params: "LULD.*" }));
        console.log("✅ HALT WebSocket auth_success → subscribed LULD.*");
      }
      handleLULD(parsed);
    } catch {}
  });

  ws.on("close", () => {
    console.log("⚠️ HALT WebSocket closed. Reconnect in 3 seconds...");
    setTimeout(startHaltWebSocket, 3000);
  });

  ws.on("error", (err) => console.log("⚠️ HALT WebSocket error:", String(err?.message || err)));
}

function attachHaltFlag(row) {
  const sym = String(row?.symbol || "").trim().toUpperCase();
  if (!sym) return row;
  const x = haltedMap.get(sym);
  return {
    ...row,
    halted: Boolean(x?.halted),
    haltIcon: x?.halted ? "⛔" : "",
    haltTsMs: x?.tsMs ?? null,
  };
}

app.get("/halts", (req, res) => {
  const only = String(req.query.only || "all").toLowerCase(); // all | halted
  const out = [];
  for (const [symbol, v] of haltedMap.entries()) {
    if (only === "halted" && !v.halted) continue;
    out.push({ symbol, ...v });
  }
  out.sort((a, b) => (b.tsMs ?? 0) - (a.tsMs ?? 0));
  res.json({ ok: true, count: out.length, results: out.slice(0, 500) });
});

// ============================================================================
// SECTION 09 — AM WebSocket (minute aggregates) + enrich cache
// ============================================================================
const amMap = new Map(); // sym -> AM payload

function trimAMCache() {
  if (amMap.size <= AM_CACHE_MAX) return;
  const arr = Array.from(amMap.entries());
  arr.sort((a, b) => (a[1]?._recvTs ?? 0) - (b[1]?._recvTs ?? 0));
  const drop = arr.length - AM_CACHE_MAX;
  for (let i = 0; i < drop; i++) amMap.delete(arr[i][0]);
}

function handleAMPayload(payload) {
  const msgs = Array.isArray(payload) ? payload : [payload];
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const ev = String(m.ev || m.event || "").toUpperCase();
    if (ev !== "AM") continue;

    const sym = String(m.sym || m.S || m.ticker || "").trim().toUpperCase();
    if (!sym) continue;

    amMap.set(sym, { ...m, _recvTs: Date.now() });
    trimAMCache();
  }
}

function startAMWebSocket() {
  if (!ENABLE_AM_WS) return;
  if (!WebSocket) return console.log("⚠️ AM WebSocket disabled: npm i ws");
  if (!MASSIVE_API_KEY) return console.log("⚠️ AM WebSocket disabled: missing MASSIVE_API_KEY");

  const ws = new WebSocket(MASSIVE_WS_URL);
  let subscribed = false;

  ws.on("open", () => {
    ws.send(JSON.stringify({ action: "auth", params: MASSIVE_API_KEY }));
    console.log("✅ AM WebSocket connected (waiting auth_success...)");
  });

  ws.on("message", (buf) => {
    try {
      const parsed = JSON.parse(buf.toString("utf8"));
      const msgs = Array.isArray(parsed) ? parsed : [parsed];

      const st = msgs.find((x) => x && String(x.ev || "").toLowerCase() === "status");
      if (st && String(st.status || "").toLowerCase() === "auth_success" && !subscribed) {
        subscribed = true;
        ws.send(JSON.stringify({ action: "subscribe", params: AM_WS_SUBS }));
        console.log(`✅ AM WebSocket auth_success → subscribed: ${AM_WS_SUBS}`);
      }

      handleAMPayload(parsed);
    } catch {}
  });

  ws.on("close", () => {
    console.log("⚠️ AM WebSocket closed. Reconnect in 3 seconds...");
    setTimeout(startAMWebSocket, 3000);
  });

  ws.on("error", (err) => console.log("⚠️ AM WebSocket error:", String(err?.message || err)));
}

// AM enrich snapshot cache
const amSnapCache = new Map(); // sym -> {ts,row}
function getSnapCached(sym) {
  const hit = amSnapCache.get(sym);
  if (!hit) return null;
  if (Date.now() - hit.ts > AM_ENRICH_TTL_MS) return null;
  return hit.row;
}
function setSnapCached(sym, row) {
  amSnapCache.set(sym, { ts: Date.now(), row });
}

function normalizeFromAMOnly(sym, am) {
  const price = n(am?.c) ?? null;
  const openMinute = n(am?.op) ?? null; // AM minute "open"
  const extPct = price !== null && openMinute !== null && openMinute > 0 ? ((price - openMinute) / openMinute) * 100 : null;
  const vol = n(am?.av) ?? n(am?.v) ?? null;
  const ms = toMs(am?.e) || toMs(am?.s);

  return {
    symbol: sym,
    price: price !== null ? round2(price) : null,
    open: openMinute !== null ? round2(openMinute) : null,
    pricePct: null,
    gapPct: null,
    extPct: extPct !== null ? round2(extPct) : null,
    volume: vol !== null ? Math.round(vol) : null,
    floatShares: null,
    floatM: null,
    marketCap: null,
    marketCapB: null,
    cap: null,
    source: "AM_WebSocket",
    am_ts: ms,
  };
}

function mergeAMWithSnapshot(amRow, snapRow) {
  const price = n(amRow?.price) ?? n(snapRow?.price);
  const prevClose = n(snapRow?.prevClose);

  // open: snapshot first, fallback to AM openMinute
  let open = n(snapRow?.open);
  if (open === null) open = n(amRow?.open);

  const pricePct =
    price !== null && prevClose !== null && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : n(snapRow?.pricePct);

  const gapPct =
    open !== null && prevClose !== null && prevClose > 0
      ? ((open - prevClose) / prevClose) * 100
      : n(snapRow?.gapPct);

  const extPct =
    price !== null && prevClose !== null && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : n(amRow?.extPct);

  const volA = n(amRow?.volume);
  const volS = n(snapRow?.volume);
  const volume = volA !== null && volS !== null ? Math.max(volA, volS) : volA ?? volS ?? null;

  return {
    ...snapRow,
    price: price !== null ? round2(price) : null,
    open: open !== null ? round2(open) : snapRow?.open ?? null,
    prevClose: prevClose !== null ? round2(prevClose) : snapRow?.prevClose ?? null,
    pricePct: pricePct !== null ? round2(pricePct) : null,
    gapPct: gapPct !== null ? round2(gapPct) : null,
    extPct: extPct !== null ? round2(extPct) : null,
    volume: volume !== null ? Math.round(volume) : null,
    source: "AM_WebSocket_plus_Snapshot",
    am_ts: amRow?.am_ts ?? null,
  };
}

// ============================================================================
// SECTION 09.5 — Polygon daily aggregates (Regular Trading Hours open / previous close)
// ============================================================================
const dailyOpenCache = new Map(); // sym -> {ymd, open, prevClose, ts}

function todayYMD_NY() {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);

    const y = parts.find((p) => p.type === "year")?.value || "1970";
    const m = parts.find((p) => p.type === "month")?.value || "01";
    const d = parts.find((p) => p.type === "day")?.value || "01";
    return `${y}-${m}-${d}`;
  } catch {
    return ymd(new Date());
  }
}

async function fetchDailyOpenPrevClose(sym) {
  const ticker = String(sym || "").trim().toUpperCase();
  if (!ticker) return { ok: false, open: null, prevClose: null };

  const ymdNY = todayYMD_NY();
  const hit = dailyOpenCache.get(ticker);
  if (hit && hit.ymd === ymdNY && Date.now() - hit.ts < 6 * 60 * 60 * 1000) {
    return { ok: true, open: hit.open, prevClose: hit.prevClose, cached: true };
  }

  if (!POLYGON_API_KEY) return { ok: false, open: null, prevClose: null, error: "missing_POLYGON_API_KEY" };

  const base = POLYGON_BASE_URL.replace(/\/+$/, "");
  const to = ymdNY;
  const from = ymd(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)); // buffer for weekends/holidays
  const url = `${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}`;

  const r = await safeGet(url, {
    params: { adjusted: "true", sort: "asc", limit: "10", apiKey: POLYGON_API_KEY },
    headers: { "user-agent": "ALGTP" },
  });

  const bars = Array.isArray(r.data?.results) ? r.data.results : [];
  if (!r.ok || bars.length < 1) return { ok: false, open: null, prevClose: null, detail: r.errorDetail || r.data };

  const last = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null;

  const open = n(last?.o);
  const prevClose = n(prev?.c) ?? n(last?.c) ?? null;

  dailyOpenCache.set(ticker, { ymd: ymdNY, open: open ?? null, prevClose, ts: Date.now() });
  return { ok: true, open: open ?? null, prevClose, cached: false };
}

async function enrichRowsWithDailyOpen(rows, maxN = 200) {
  // GapPercent (Regular Trading Hours) = ((RegularTradingHoursOpen - PreviousClose) / PreviousClose) * 100
  // Always prefer Polygon daily aggregates because snapshot open or AM minute open can be NOT Regular Trading Hours open.

  const top = rows.slice(0, maxN);
  const symbols = Array.from(new Set(top.map((r) => r?.symbol).filter(Boolean)));
  if (!symbols.length) return rows;

  const fetched = await mapPool(symbols, Math.min(6, SNAP_CONCURRENCY), async (sym) => {
    const x = await fetchDailyOpenPrevClose(sym);
    return { sym, ...x };
  });

  const map = new Map(fetched.filter((x) => x.ok).map((x) => [x.sym, x]));

  return rows.map((r) => {
    const x = map.get(r.symbol);
    if (!x) return r;

    const polygonOpen = x.open != null ? round2(x.open) : null;
    const polygonPrevClose = x.prevClose != null ? round2(x.prevClose) : null;

    const open = polygonOpen ?? r.open ?? null;
    const prevClose = polygonPrevClose ?? r.prevClose ?? null;

    const gapPct =
      open !== null && prevClose !== null && prevClose > 0
        ? round2(((open - prevClose) / prevClose) * 100)
        : r.gapPct;

    return {
      ...r,
      open,
      prevClose,
      gapPct,
      gapSource:
        (polygonOpen != null || polygonPrevClose != null)
          ? "polygon_daily_aggregates_regular_trading_hours_open_previous_close"
          : (r.gapSource ?? null),
    };
  });
}

// ============================================================================
// SECTION 10 — Builders + Sorting
// - Movers ranking uses Gap% (Regular Trading Hours) + Float Turnover Percent + Volume
// - Gap% is overwritten later by Polygon daily aggregates (Regular Trading Hours open / previous close)
// - Float is enriched later by Financial Modeling Prep shares-float
// - Float Turnover Percent = (Volume / FloatShares) * 100
// - IMPORTANT FIX: when snapshot timestamp is missing, we DO NOT drop the ticker
// ============================================================================

function finalizeRows(rows) {
  // Attach score + icons + halt flag + float turnover percent
  let out = rows.map((r) => {
    const d = demandScore(r);
    const domainRes = domainResults(r);
    return {
      ...r,
      demandScore: d,
      signalIcon: signalIcon(d),
      paIcon: r.paIcon || "",
      score: domainRes.score,
      passed: domainRes.passed,
      failed: domainRes.failed,
      rate: domainRes.rate,
    };
  });

  out = out.map(attachHaltFlag);
  out = out.map(addFloatTurnoverPct);

  return out;
}

function prelimScoreVolatile(row) {
  // Volatility score uses the largest absolute move among:
  // - GapPercent
  // - PricePercent
  // - ExtendedHoursPercent
  const gapAbs = Math.abs(n(row?.gapPct) ?? 0);
  const priceAbs = Math.abs(n(row?.pricePct) ?? 0);
  const extAbs = Math.abs(n(row?.extPct) ?? 0);
  return Math.max(gapAbs, priceAbs, extAbs);
}

function sortForPrepick(rows, mode) {
  // Used to reduce universe size BEFORE indicators to save API calls
  const safeN = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

  if (mode === "active") {
    return [...rows].sort((a, b) => safeN(b.volume) - safeN(a.volume));
  }

  if (mode === "volatile") {
    return [...rows].sort(
      (a, b) => prelimScoreVolatile(b) - prelimScoreVolatile(a) || safeN(b.volume) - safeN(a.volume)
    );
  }

  if (mode === "gap") {
    return [...rows].sort(
      (a, b) => Math.abs(safeN(b.gapPct)) - Math.abs(safeN(a.gapPct)) || safeN(b.volume) - safeN(a.volume)
    );
  }

  if (mode === "gapFloatRank") {
    // Movers special rank: Gap% (abs) desc -> FloatTurnoverPercent desc -> Volume desc
    return [...rows].sort((a, b) => {
      const aGap = Math.abs(safeN(a.gapPct));
      const bGap = Math.abs(safeN(b.gapPct));

      const aFloatTurn = safeN(a.floatTurnoverPct);
      const bFloatTurn = safeN(b.floatTurnoverPct);

      const aVol = safeN(a.volume);
      const bVol = safeN(b.volume);

      return bGap - aGap || bFloatTurn - aFloatTurn || bVol - aVol;
    });
  }

  // default: active
  return [...rows].sort((a, b) => safeN(b.volume) - safeN(a.volume));
}

function sortGapFloatVolume(rows) {
  // Movers ranking rule (most important for "mover"):
  // 1) Highest absolute GapPercent first (GapPercent is Regular Trading Hours gap after Polygon overwrite)
  //    GapPercent = ((RegularTradingHoursOpen - PreviousClose) / PreviousClose) * 100
  // 2) Highest FloatTurnoverPercent next
  //    FloatTurnoverPercent = (Volume / FloatShares) * 100
  // 3) Highest Volume last
  rows.sort((a, b) => {
    const gapA = Math.abs(n(a?.gapPct) ?? 0);
    const gapB = Math.abs(n(b?.gapPct) ?? 0);

    const floatTurnA = n(a?.floatTurnoverPct) ?? 0;
    const floatTurnB = n(b?.floatTurnoverPct) ?? 0;

    const volA = n(a?.volume) ?? 0;
    const volB = n(b?.volume) ?? 0;

    return gapB - gapA || floatTurnB - floatTurnA || volB - volA;
  });
}

async function buildRowsFromSnapshotAll({ cap = "all", limit = 120, session = null, sortMode = "gap" } = {}) {
  if (!ENABLE_SNAPSHOT_ALL) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: "Snapshot-All is OFF",
        hint: "Set ENABLE_SNAPSHOT_ALL=true or use WebSocket fallback (AM cache).",
      },
    };
  }

  const miss = envMissingFor({ needSnapshotAll: true, needAggs: ENABLE_5M_INDICATORS });
  if (miss.length) return { ok: false, status: 400, body: { ok: false, error: "Missing env", miss } };

  const snap = await fetchSnapshotAll();
  if (!snap.ok) return { ok: false, status: 500, body: { ok: false, error: "Snapshot-all failed", debug: snap } };

  // Build map ticker -> raw snapshot object
  const snapMap = new Map();
  for (const x of snap.rows) {
    const t = String(x?.ticker ?? x?.symbol ?? x?.sym ?? "").trim().toUpperCase();
    if (t) snapMap.set(t, x);
  }

  // Normalize to standard row objects
  let rows = [];
  for (const [ticker, raw] of snapMap.entries()) {
    let r = normalizeSnapshotAuto(ticker, raw);
    r = addExtPctFromPrevClose(r);
    rows.push(r);
  }

  // Session filter:
  // IMPORTANT: if timestamp missing, do not drop (keep the ticker).
  if (session) {
    rows = rows.filter((r) => {
      const raw = snapMap.get(r.symbol);
      const ms = extractSnapshotTimestampMs(raw);

      // If we cannot determine timestamp, keep it (better than losing movers).
      if (!ms) return true;

      return sessionOfMs(ms) === session;
    });
  }

  rows = rows.filter((r) => capPass(r, cap));

  // Overwrite open/prevClose/gapPct using Polygon daily aggregates (Regular Trading Hours open / previous close)
  rows = await enrichRowsWithDailyOpen(rows, 200);

  // Enrich float using Financial Modeling Prep shares-float
  rows = await enrichRowsWithFloat(rows, 200);

  // Reduce before indicators
  const lim = clamp(Number(limit || 120), 10, 500);
  const prepickN = Math.max(250, lim * 5);
  rows = sortForPrepick(rows, sortMode).slice(0, prepickN);

  // Indicators
  const { rows: withInd, aggsErrors } = await attachIndicatorsIfEnabled(rows);
  rows = finalizeRows(withInd);

  // Final sort
  if (sortMode === "active") {
    rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  } else if (sortMode === "volatile") {
    rows.sort((a, b) => prelimScoreVolatile(b) - prelimScoreVolatile(a) || (b.volume ?? 0) - (a.volume ?? 0));
  } else if (sortMode === "gapFloatRank") {
    sortGapFloatVolume(rows);
  } else {
    rows.sort(
      (a, b) =>
        Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0) ||
        Math.abs(b.extPct ?? 0) - Math.abs(a.extPct ?? 0) ||
        Math.abs(b.pricePct ?? 0) - Math.abs(a.pricePct ?? 0) ||
        (b.volume ?? 0) - (a.volume ?? 0)
    );
  }

  rows = rows.slice(0, lim);

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      source: "SNAPSHOT_ALL",
      session: session || null,
      cap,
      results: rows,
      aggsErrors: DEBUG ? aggsErrors.slice(0, 10) : undefined,
    },
  };
}

async function buildRowsFromAMCache({ cap = "all", limit = 120, session = null, sortMode = "gap" } = {}) {
  // Base from AM WebSocket cache
  let base = [];
  for (const [sym, am] of amMap.entries()) {
    const ms = toMs(am?.e) || toMs(am?.s);
    if (!ms) continue;
    if (session && sessionOfMs(ms) !== session) continue;
    base.push(normalizeFromAMOnly(sym, am));
  }

  if (!base.length) {
    return { ok: true, status: 200, body: { ok: true, source: "AM_WebSocket", session, cap, results: [] } };
  }

  const lim = clamp(Number(limit || 120), 10, 500);

  // Pick top candidates to enrich by snapshot (limit REST load)
  const candidates = sortForPrepick(base, sortMode);
  const pick = candidates.slice(0, AM_ENRICH_LIMIT).map((x) => x.symbol);

  // Fetch snapshots for missing ones
  const toFetch = pick.filter((sym) => !getSnapCached(sym));
  if (toFetch.length) {
    const snaps = await mapPool(toFetch, SNAP_CONCURRENCY, async (t) => {
      const r = await fetchTickerSnapshot(t);
      return { ticker: t, ...r };
    });
    for (const s of snaps) {
      if (s.ok) setSnapCached(s.ticker, normalizeSnapshotAuto(s.ticker, s.data));
    }
  }

  // Merge AM + Snapshot (best-effort)
  let rows = base.map((r) => {
    const snapRow = getSnapCached(r.symbol);
    return snapRow ? mergeAMWithSnapshot(r, snapRow) : r;
  });

  if (String(cap || "all").toLowerCase() !== "all") rows = rows.filter((r) => capPass(r, cap));

  // Overwrite open/prevClose/gapPct using Polygon daily aggregates (Regular Trading Hours open / previous close)
  rows = await enrichRowsWithDailyOpen(rows, 200);

  // Enrich float using Financial Modeling Prep shares-float
  rows = await enrichRowsWithFloat(rows, 200);

  // Reduce before indicators
  rows = sortForPrepick(rows, sortMode).slice(0, Math.max(200, lim * 4));

  const { rows: withInd, aggsErrors } = await attachIndicatorsIfEnabled(rows);
  rows = finalizeRows(withInd);

  // Final sort
  if (sortMode === "active") {
    rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  } else if (sortMode === "volatile") {
    rows.sort((a, b) => prelimScoreVolatile(b) - prelimScoreVolatile(a) || (b.volume ?? 0) - (a.volume ?? 0));
  } else if (sortMode === "gapFloatRank") {
    sortGapFloatVolume(rows);
  } else {
    rows.sort(
      (a, b) =>
        Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0) ||
        (b.demandScore ?? 0) - (a.demandScore ?? 0) ||
        Math.abs(b.extPct ?? 0) - Math.abs(a.extPct ?? 0) ||
        (b.volume ?? 0) - (a.volume ?? 0)
    );
  }

  rows = rows.slice(0, lim);

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      source: "AM_FALLBACK",
      session,
      cap,
      results: rows,
      aggsErrors: DEBUG ? aggsErrors.slice(0, 10) : undefined,
    },
  };
}

// ============================================================================
// KR MODE (WS-only) — avoid Massive REST movers/snapshot endpoints
// ============================================================================
function normalizeFromAM(sym, am) {
  const price = n(am?.c) ?? null;
  const openM = n(am?.op) ?? null;
  const vol = n(am?.av ?? am?.v) ?? null;
  const ms = toMs(am?.e) || toMs(am?.s) || null;

  const extPct =
    price !== null && openM !== null && openM > 0 ? round2(((price - openM) / openM) * 100) : null;

  return {
    symbol: sym,
    price: price !== null ? round2(price) : null,
    open: openM !== null ? round2(openM) : null,
    prevClose: null,
    gapPct: null,     // optional (polygon) if you want later
    pricePct: null,
    extPct,
    volume: vol !== null ? Math.round(vol) : null,
    floatShares: null,
    floatM: null,
    floatTurnoverPct: null,
    marketCap: null,
    marketCapB: null,
    cap: null,
    source: "AM_WS_ONLY",
    am_ts: ms,
  };
}

function buildFromAMCacheKR({ session = null, limit = 120 } = {}) {
  let rows = [];
  for (const [sym, am] of amMap.entries()) {
    const ms = toMs(am?.e) || toMs(am?.s);
    if (!ms) continue;
    if (session && sessionOfMs(ms) !== session) continue;
    rows.push(normalizeFromAM(sym, am));
  }

  // Ranking KR style: Volume desc -> abs(extPct) desc
  rows.sort((a, b) => {
    const vA = n(a.volume) ?? 0;
    const vB = n(b.volume) ?? 0;
    const pA = Math.abs(n(a.extPct) ?? 0);
    const pB = Math.abs(n(b.extPct) ?? 0);
    return vB - vA || pB - pA;
  });

  return rows.slice(0, clamp(Number(limit || 120), 10, 500));
}

async function buildRowsFromMoversUnion({ cap = "all", limit = 120, sortMode = "active" } = {}) {
  // Universe fallback when snapshot-all is OFF:
  // Use Massive movers list (gainers + losers) -> fetch snapshots -> normalize -> enrich -> rank
  const lim = clamp(Number(limit || 120), 10, 500);

  const g = await fetchMovers("gainers");
  const l = await fetchMovers("losers");

  const pool = [...(g.ok ? g.rows : []), ...(l.ok ? l.rows : [])]
    .map((x) => String(x?.ticker ?? x?.symbol ?? x?.sym ?? "").trim().toUpperCase())
    .filter(Boolean);

  const tickers = Array.from(new Set(pool)).slice(0, Math.max(400, lim * 8));

  const snaps = await mapPool(tickers, SNAP_CONCURRENCY, async (t) => {
    const r = await fetchTickerSnapshot(t);
    return { ticker: t, ...r };
  });

  const good = snaps.filter((x) => x.ok);
  let rows = good.map((x) => normalizeSnapshotAuto(x.ticker, x.data)).map(addExtPctFromPrevClose);

  if (String(cap || "all").toLowerCase() !== "all") rows = rows.filter((r) => capPass(r, cap));

  rows = await enrichRowsWithDailyOpen(rows, 200);
  rows = await enrichRowsWithFloat(rows, 200);

  // Reduce before indicators
  rows = sortForPrepick(rows, sortMode).slice(0, Math.max(250, lim * 5));

  const { rows: withInd, aggsErrors } = await attachIndicatorsIfEnabled(rows);
  rows = finalizeRows(withInd);

  if (sortMode === "gapFloatRank") sortGapFloatVolume(rows);
  else if (sortMode === "volatile") rows.sort((a, b) => prelimScoreVolatile(b) - prelimScoreVolatile(a) || (b.volume ?? 0) - (a.volume ?? 0));
  else if (sortMode === "active") rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  else rows.sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0) || (b.volume ?? 0) - (a.volume ?? 0));

  rows = rows.slice(0, lim);

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      source: "MOVERS_UNION",
      cap,
      results: rows,
      aggsErrors: DEBUG ? aggsErrors.slice(0, 10) : undefined,
    },
  };
}

async function buildRowsFromMoversUnionBySession({ session, limit = 120 } = {}) {
  // Movers list is the fastest data fragment:
  // 1) Massive movers list -> candidate tickers
  // 2) Massive ticker snapshot -> normalize
  // 3) Polygon daily aggregates -> overwrite Regular Trading Hours open and previous close -> compute Gap%
  // 4) Financial Modeling Prep shares-float -> enrich Float -> compute Float Turnover Percent
  // 5) Rank: highest absolute Gap% first, then highest Float Turnover Percent, then Volume

  const lim = clamp(Number(limit || 120), 10, 500);

  const g = await fetchMovers("gainers");
  const l = await fetchMovers("losers");

  const pool = [...(g.ok ? g.rows : []), ...(l.ok ? l.rows : [])]
    .map((x) => String(x?.ticker ?? x?.symbol ?? x?.sym ?? "").trim().toUpperCase())
    .filter(Boolean);

  const tickers = Array.from(new Set(pool)).slice(0, Math.max(400, lim * 10));

  const snaps = await mapPool(tickers, SNAP_CONCURRENCY, async (t) => {
    const r = await fetchTickerSnapshot(t);
    return { ticker: t, ...r };
  });

  const good = snaps.filter((x) => x.ok);
  const snapDataMap = new Map(good.map((x) => [x.ticker, x.data]));

  let rows = good
    .map((x) => normalizeSnapshotAuto(x.ticker, x.data))
    .map(addExtPctFromPrevClose);

  // ✅ CRITICAL FIX:
  // When timestamp is missing in snapshot, DO NOT drop the mover.
  // If timestamp exists, use it to filter by requested session.
  rows = rows.filter((r) => {
    const raw = snapDataMap.get(r.symbol);
    const ms = extractSnapshotTimestampMs(raw);

    // Missing timestamp → keep it (this prevents empty movers)
    if (!ms) return true;

    return sessionOfMs(ms) === session;
  });

  rows = await enrichRowsWithDailyOpen(rows, 200);
  rows = await enrichRowsWithFloat(rows, 200);

  const { rows: withInd } = await attachIndicatorsIfEnabled(rows);
  rows = finalizeRows(withInd);

  sortGapFloatVolume(rows);

  return rows.slice(0, lim);
}

// ============================================================================
// SECTION 11 — Mini Chart endpoint (hover)
// ============================================================================
const miniCache = new Map(); // key -> {ts, payload}

function smaSeries(values, len) {
  const out = Array(values.length).fill(null);
  if (values.length < len) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= len) sum -= values[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}
function emaSeries(values, len) {
  const out = Array(values.length).fill(null);
  if (values.length < len) return out;
  const k = 2 / (len + 1);
  let seed = 0;
  for (let i = 0; i < len; i++) seed += values[i];
  let e = seed / len;
  out[len - 1] = e;
  for (let i = len; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}
function vwapSeries(closes, vols) {
  const out = Array(closes.length).fill(null);
  let pv = 0, vv = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const v = vols[i] || 0;
    pv += c * v;
    vv += v;
    out[i] = vv > 0 ? pv / vv : null;
  }
  return out;
}

app.get("/mini-chart", async (req, res) => {
  try {
    const sym = String(req.query.symbol || "").trim().toUpperCase();
    const tf = String(req.query.tf || "1");
    if (!sym) return res.json({ ok: false, error: "symbol required" });

    const key = `${sym}|${tf}`;
    const hit = miniCache.get(key);
    if (hit && Date.now() - hit.ts < MINI_CACHE_TTL_MS) return res.json(hit.payload);

    const miss = envMissingFor({ needAggs: true });
    if (miss.length) return res.status(400).json({ ok: false, error: "Missing env", miss });

    const ag = await fetchAggs(sym, tf, 280, "asc");
    if (!ag.ok) return res.json({ ok: false, error: "no bars", detail: ag.errorDetail });

    const bars = ag.bars
      .map((b) => ({
        time: Math.floor((Number(b.t) || 0) / 1000),
        open: n(b.o),
        high: n(b.h),
        low: n(b.l),
        close: n(b.c),
        volume: n(b.v) ?? 0,
      }))
      .filter((x) => x.time > 0 && x.open !== null && x.high !== null && x.low !== null && x.close !== null);

    if (!bars.length) return res.json({ ok: false, error: "no bars" });

    const closes = bars.map((x) => x.close);
    const vols = bars.map((x) => x.volume);

    const ema9 = emaSeries(closes, 9);
    const ema34 = emaSeries(closes, 34);
    const sma26 = smaSeries(closes, 26);
    const vw = vwapSeries(closes, vols);

    const toLine = (arr) =>
      bars
        .map((b, i) => (arr[i] == null ? null : { time: b.time, value: Number(arr[i].toFixed(4)) }))
        .filter(Boolean);

    const payload = {
      ok: true,
      symbol: sym,
      tf,
      ohlc: bars.map(({ volume, ...x }) => x),
      overlays: {
        ema9: toLine(ema9),
        ema34: toLine(ema34),
        sma26: toLine(sma26),
        vwap: toLine(vw),
      },
    };

    miniCache.set(key, { ts: Date.now(), payload });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: "mini-chart failed", detail: String(e?.message || e) });
  }
});

// ============================================================================
// SECTION 12 — API Routes  ✅ (FIXED)
// Fixes included:
// 1) /list topGappers minGap filter happens AFTER Polygon gap overwrite (enrichRowsWithDailyOpen)
// 2) /list uses better "topGappers universe": gainers + losers union (so gappers don't miss losers)
// 3) /movers-premarket & /movers-afterhours rely on buildRowsFromMoversUnionBySession (already fixed in SECTION 10)
// ============================================================================

// Helper: Stub for unimplemented endpoints
function stub(name) {
  return (req, res) => res.json({ ok: true, stub: true, name, results: [] });
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: `${BRAND.legal} running ✅`,
    ui: "/ui",
    endpoints: [
      "/list",
      "/scan",
      "/scan-a",
      "/scan-b",
      "/check",
      "/snapshot-all",
      "/premarket",
      "/aftermarket",
      "/movers-premarket",
      "/movers-afterhours",
      "/most-active",
      "/unusual-volume",
      "/most-volatile",
      "/most-lately",
      "/mini-chart",
      "/halts",
      "/api",
      "/watchlist",
      "/watchlist/add",
      "/watchlist/remove",
      "/watchlist/clear",
    ],
  });
});

app.get("/api", (req, res) => {
  res.json({
    ok: true,
    config: {
      port: PORT,
      snapshotAllEnabled: ENABLE_SNAPSHOT_ALL,
      indicators5mEnabled: ENABLE_5M_INDICATORS,
      awesomeOscillatorFilterEnabled: ENABLE_AO_FILTER,
      haltWebSocketEnabled: ENABLE_HALT_WS,
      amWebSocketEnabled: ENABLE_AM_WS,
      amSubscriptions: AM_WS_SUBS,
      amCacheSize: amMap.size,
      amSnapCacheSize: amSnapCache.size,
      miniCacheSize: miniCache.size,
      uiAutoRefreshMs: UI_AUTO_REFRESH_MS,
      polygonApiKeyPresent: Boolean(POLYGON_API_KEY),
      floatEnrichEnabled: ENABLE_FLOAT_ENRICH,
      financialModelingPrepApiKeyPresent: Boolean(FMP_API_KEY),
      strictSessionFilter: typeof STRICT_SESSION_FILTER === "boolean" ? STRICT_SESSION_FILTER : undefined,
    },
  });
});

// 🔍 DEBUG ENDPOINT: Inspect raw movers API response
app.get("/debug/movers", async (req, res) => {
  try {
    const direction = String(req.query.direction || "gainers").toLowerCase();
    const g = await fetchMovers(direction);
    
    res.json({
      ok: true,
      direction,
      fetchResult: {
        ok: g.ok,
        status: g.status,
        url: g.url,
        rowCount: g.rows?.length ?? 0,
        errorDetail: g.errorDetail,
      },
      sampleRows: (g.rows || []).slice(0, 5).map(x => ({
        ticker: x?.ticker ?? x?.symbol ?? x?.T ?? x?.sym,
        allKeys: Object.keys(x || {})
      })),
      rawDataKeys: g.rows?.length > 0 ? Object.keys(g.rows[0] || {}) : [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "debug/movers failed", detail: String(e?.message || e) });
  }
});

// 🔍 DEBUG ENDPOINT: Raw movers data with full sample rows
app.get("/debug/movers-raw", async (req, res) => {
  const dir = String(req.query.dir || "gainers").toLowerCase();
  const out = await fetchMovers(dir === "losers" ? "losers" : "gainers");
  // trả raw data keys + sample rows
  res.json({
    ok: true,
    dir,
    status: out.status,
    url: out.url,
    rowsLen: out.rows?.length || 0,
    sampleRows: (out.rows || []).slice(0, 5),
    // in ra keys của raw response để biết shape
    rawKeys: out?.rows?.length ? Object.keys(out.rows[0] || {}) : null,
  });
});

// 🔍 DEBUG ENDPOINT: Meta information from both gainers and losers APIs
app.get("/debug/movers-meta", async (req, res) => {
  const g = await safeGet(`${MASSIVE_MOVER_URL.replace(/\/+$/, "")}/gainers`, auth({}, {}));
  const l = await safeGet(`${MASSIVE_MOVER_URL.replace(/\/+$/, "")}/losers`, auth({}, {}));
  res.json({
    ok: true,
    gainers: { ok: g.ok, status: g.status, url: g.url, topKeys: Object.keys(g.data || {}).slice(0, 20) },
    losers:  { ok: l.ok, status: l.status, url: l.url, topKeys: Object.keys(l.data || {}).slice(0, 20) },
  });
});

// Removed duplicate - see /me endpoint at line ~5858

// --------------------------------------------------------------------------
// 🚀 TURBO MODE Helper - Detects turbo mode and adjusts performance settings
// --------------------------------------------------------------------------
function getTurboSettings(req) {
  const isTurbo = String(req.query.turbo || req.query.boost || "").toLowerCase() === "1" || 
                  String(req.query.turbo || req.query.boost || "").toLowerCase() === "true";
  
  return {
    enabled: isTurbo,
    concurrency: isTurbo ? Math.min(8, SNAP_CONCURRENCY * 2) : SNAP_CONCURRENCY,
    enrichLimit: isTurbo ? 300 : 200,
    aggsLimit: isTurbo ? 250 : AGGS_5M_LIMIT,
  };
}

// --------------------------------------------------------------------------
// Helper function for scan operations
// --------------------------------------------------------------------------
async function runScanForSymbols(symbols, maxN, turboSettings = {}) {
  const concurrency = turboSettings.concurrency || SNAP_CONCURRENCY;
  const enrichLimit = turboSettings.enrichLimit || 200;
  
  const snaps = await mapPool(symbols, concurrency, async (t) => {
    const r = await fetchTickerSnapshot(t);
    return { ticker: t, ...r };
  });

  const good = snaps.filter((x) => x.ok);
  const bad = snaps.filter((x) => !x.ok);

  let rows = good.map((x) => normalizeSnapshotAuto(x.ticker, x.data)).map(addExtPctFromPrevClose);
  rows = await enrichRowsWithDailyOpen(rows, enrichLimit);
  rows = await enrichRowsWithFloat(rows, enrichLimit);

  const badRows = bad.map((x) => ({ symbol: x.ticker, source: "SNAPSHOT_FAILED" }));
  rows = rows.concat(badRows);

  const { rows: withInd, aggsErrors } = await attachIndicatorsIfEnabled(rows);
  rows = finalizeRows(withInd);

  rows.sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0) || (b.volume ?? 0) - (a.volume ?? 0));
  return { rows, aggsErrors, turboUsed: turboSettings.enabled };
}

// --------------------------------------------------------------------------
// /scan — scan YOUR symbols list only (IMPORTANT_SYMBOLS or query symbols=)
// --------------------------------------------------------------------------
app.get("/scan", async (req, res) => {
  try {
    const miss = envMissingFor({ needAggs: ENABLE_5M_INDICATORS });
    if (miss.length) return res.status(400).json({ ok: false, error: "Missing env", miss });

    // 🚀 Check for turbo mode
    const turbo = getTurboSettings(req);

    const q = req.query.symbols || req.query.symbol;
    let ALL;

    if (q) {
      ALL = parseSymbols(q);
    } else {
      // No query symbols => use default IMPORTANT_SYMBOLS (no user required)
      ALL = parseSymbols(IMPORTANT_SYMBOLS);
    }


    const MAX_FROM_UI = Number(req.query.max);
    const ENV_MAX = Number(process.env.SCAN_MAX_SYMBOLS || SCAN_MAX_SYMBOLS);
    const HARD_MAX = Number(process.env.SCAN_HARD_MAX || SCAN_HARD_MAX);

    const maxN = (() => {
      const base = Number.isFinite(MAX_FROM_UI) ? MAX_FROM_UI : ENV_MAX;
      return Math.max(20, Math.min(HARD_MAX, Math.floor(base)));
    })();

    const symbols = ALL.slice(0, maxN);

    // Use turbo concurrency if enabled
    const snaps = await mapPool(symbols, turbo.concurrency, async (t) => {
      const r = await fetchTickerSnapshot(t);
      return { ticker: t, ...r };
    });

    const good = snaps.filter((x) => x.ok);
    const bad = snaps.filter((x) => !x.ok);

    let rows = good.map((x) => normalizeSnapshotAuto(x.ticker, x.data)).map(addExtPctFromPrevClose);

    // ✅ Gap% overwrite (Polygon RTH open/prevClose) - use turbo limit
    rows = await enrichRowsWithDailyOpen(rows, turbo.enrichLimit);

    // ✅ Float enrich (FMP) - use turbo limit
    rows = await enrichRowsWithFloat(rows, turbo.enrichLimit);

    const badRows = bad.map((x) => ({
      symbol: x.ticker,
      price: null,
      open: null,
      prevClose: null,
      pricePct: null,
      gapPct: null,
      extPct: null,
      volume: null,
      floatShares: null,
      floatM: null,
      floatTurnoverPct: null,
      marketCapB: null,
      cap: null,
      demandScore: 0,
      signalIcon: "⚠️",
      paIcon: "",
      source: "SNAPSHOT_FAILED",
    }));

    rows = rows.concat(badRows);

    const { rows: withInd, aggsErrors } = await attachIndicatorsIfEnabled(rows);
    rows = finalizeRows(withInd);

    rows.sort(
      (a, b) =>
        Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0) ||
        Math.abs(b.pricePct ?? 0) - Math.abs(a.pricePct ?? 0)
    );

    res.json({
      ok: true,
      mode: "symbols",
      scanned: symbols.length,
      results: rows,
      turboMode: turbo.enabled, // 🚀 Indicate if turbo was used
      snapshotErrors: DEBUG
        ? bad.slice(0, 10).map((x) => ({
            ticker: x.ticker,
            status: x.status,
            url: x.url,
            errorDetail: x.errorDetail,
          }))
        : undefined,
      aggsErrors: DEBUG ? aggsErrors.slice(0, 10) : undefined,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Scan failed", detail: String(e?.message || e) });
  }
});

// --------------------------------------------------------------------------
// /scan-a — scan with IMPORTANT_SYMBOLS_A
// --------------------------------------------------------------------------
app.get("/scan-a", async (req, res) => {
  try {
    const ALL = parseSymbols(req.query.symbols || IMPORTANT_SYMBOLS_A);
    const maxN = clamp(Number(req.query.max || SCAN_MAX_SYMBOLS), 20, SCAN_HARD_MAX);
    const symbols = ALL.slice(0, maxN);

    const out = await runScanForSymbols(symbols, maxN);
    res.json({ ok: true, box: "A", scanned: symbols.length, results: out.rows, aggsErrors: DEBUG ? out.aggsErrors?.slice(0,10) : undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: "scan-a failed", detail: String(e?.message || e) });
  }
});

// --------------------------------------------------------------------------
// /scan-b — scan with IMPORTANT_SYMBOLS_B
// --------------------------------------------------------------------------
app.get("/scan-b", async (req, res) => {
  try {
    const ALL = parseSymbols(req.query.symbols || IMPORTANT_SYMBOLS_B);
    const maxN = clamp(Number(req.query.max || SCAN_MAX_SYMBOLS), 20, SCAN_HARD_MAX);
    const symbols = ALL.slice(0, maxN);

    const out = await runScanForSymbols(symbols, maxN);
    res.json({ ok: true, box: "B", scanned: symbols.length, results: out.rows, aggsErrors: DEBUG ? out.aggsErrors?.slice(0,10) : undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: "scan-b failed", detail: String(e?.message || e) });
  }
});

// --------------------------------------------------------------------------
// /check — single ticker check route
// --------------------------------------------------------------------------
app.get("/check", async (req, res) => {
  try {
    const symbol = normalizeSymbolForAPI(String(req.query.symbol || req.query.ticker || "").trim().toUpperCase());
    const tf = String(req.query.tf || CHECK_TF);
    if (!symbol) return res.status(400).json({ ok:false, error:"symbol required" });

    // Snapshot (price/volume + prevClose)
    const snap = await fetchTickerSnapshot(symbol);
    if (!snap.ok) return res.status(500).json({ ok:false, error:"snapshot failed", detail: snap.errorDetail || snap });

    let row = normalizeSnapshotAuto(symbol, snap.data);
    row = addExtPctFromPrevClose(row);

    // Polygon overwrite RTH gap
    row = (await enrichRowsWithDailyOpen([row], 1))[0];

    // Float enrich (FMP) + compute float turnover
    row = (await enrichRowsWithFloat([row], 1))[0];
    row = addFloatTurnoverPct(row);

    // Aggs for indicators (use your existing fetchAggs + AO)
    const ag = await fetchAggs5m(symbol);
    if (!ag.ok) {
      const base = domainResults(row);
      return res.json({ ok:true, symbol, note:"no aggs, domains partial", ...row, ...base });
    }

    const bars = (Array.isArray(ag.bars) ? ag.bars : []).map(b => ({
      c: n(b.c ?? b.close), v: n(b.v ?? b.volume) ?? 0, h: n(b.h ?? b.high), l: n(b.l ?? b.low),
    })).filter(x => x.c!=null && x.h!=null && x.l!=null);

    if (bars.length === 0) {
      const base = domainResults(row);
      return res.json({ ok:true, symbol, note:"no bars, domains partial", ...row, ...base });
    }

    // Reverse to chronological order for computeFromBars
    const barsChrono = [...bars].reverse();

    // compute RSI/MACD/EMA50/volRatio
    const ind = computeFromBars(barsChrono);
    if (ind.ok) {
      row = { ...row, ...ind };
    }

    // compute AO from bars
    const aoData = computeAwesomeOscillatorFrom5mBars(bars);
    row = { ...row, ...aoData };

    // add PA icon
    row = attach5mSignals(row);

    const result = domainResults(row);

    // Clean output format focusing on domains
    return res.json({
      ok: true,
      symbol,
      price: row.price,
      open: row.open,
      prevClose: row.prevClose,
      gapPct: row.gapPct,
      pricePct: row.pricePct,
      floatM: row.floatM,
      volume: row.volume,
      floatTurnoverPct: row.floatTurnoverPct,
      volRatio_5m: row.volRatio_5m,
      rsi: row.rsi,
      macd: row.macd,
      macdSignal: row.macdSignal,
      ao: row.ao,
      aoPrev: row.aoPrev,
      ema9: row.ema9,
      ema34: row.ema34,
      ema50: row.ema50,
      domains: result.domains,
      passed: result.passed,
      failed: result.failed,
      rate: result.rate,
      score: result.score,
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:"check failed", detail: String(e?.message || e) });
  }
});

// --------------------------------------------------------------------------
// /list — groups: topGainers | topLosers | topGappers
// ✅ FIX: for topGappers, we use gainers+losers union universe
// ✅ FIX: minGap filter runs AFTER Polygon gap overwrite
// --------------------------------------------------------------------------
app.get("/list", async (req, res) => {
  try {
    const miss = envMissingFor({ needAggs: ENABLE_5M_INDICATORS });
    if (miss.length) return res.status(400).json({ ok: false, error: "Missing env", miss });

    const group = String(req.query.group || "topGainers").trim(); // topGainers | topLosers | topGappers
    const cap = String(req.query.cap || "all").trim().toLowerCase();
    const limit = clamp(Number(req.query.limit || 50), 5, 200);
    const minGap = n(req.query.minGap);
    const minGapAbs = String(req.query.minGapAbs || "false").toLowerCase() === "true"; // optional: abs filter

    console.log("[/list] 🔍 Request:", { group, cap, limit, minGap, minGapAbs });

    // Build ticker universe:
    // - topGainers => gainers only
    // - topLosers  => losers only
    // - topGappers => union (gainers + losers) so you don't miss down-gappers
    let universeTickers = [];

    if (group === "topGappers") {
      const g = await fetchMovers("gainers");
      const l = await fetchMovers("losers");
      if (!g.ok && !l.ok) return res.status(500).json({ ok: false, error: "Movers failed", moverDebug: { g, l } });

      const pool = [...(g.ok ? g.rows : []), ...(l.ok ? l.rows : [])]
        .map((x) => String(x?.ticker ?? x?.symbol ?? x?.sym ?? "").trim().toUpperCase())
        .filter(Boolean);

      universeTickers = Array.from(new Set(pool)).slice(0, limit * 6);
    } else {
      const direction = groupToDirection(group);
      const movers = await fetchMovers(direction);
      if (!movers.ok) return res.status(500).json({ ok: false, error: "Movers failed", moverDebug: movers });

      universeTickers = movers.rows
        .map((x) => String(x?.ticker ?? x?.symbol ?? x?.sym ?? "").trim().toUpperCase())
        .filter(Boolean)
        .slice(0, limit * 3);
    }

    // ✅ FALLBACK: If movers returns empty, use watchlist or IMPORTANT_SYMBOLS
    let source = "MOVERS";
    if (!universeTickers || universeTickers.length === 0) {
      console.log("[/list] ⚠️  Movers empty, using fallback...");
      
      // Try user watchlist first
      const wl = await getWatchlist(Number(req.user.id));
      if (wl.length > 0) {
        universeTickers = wl.slice(0, Math.max(60, limit * 3));
        source = "FALLBACK_WATCHLIST";
        console.log("[/list] 🔖 Using watchlist:", wl.length, "symbols");
      } else {
        // Fallback to IMPORTANT_SYMBOLS
        const fallback = parseSymbols(IMPORTANT_SYMBOLS || "AAPL,TSLA,NVDA,AMD,MSFT,SPY,QQQ,META,GOOGL,AMZN");
        universeTickers = fallback.slice(0, Math.max(60, limit * 3));
        source = "FALLBACK_IMPORTANT_SYMBOLS";
        console.log("[/list] 🐞 Watchlist empty, using IMPORTANT_SYMBOLS:", fallback.length, "symbols");
      }
    }

    console.log("[/list] 📊 Universe tickers:", universeTickers.length, "samples:", universeTickers.slice(0, 10));

    const snaps = await mapPool(universeTickers, SNAP_CONCURRENCY, async (t) => {
      const r = await fetchTickerSnapshot(t);
      return { ticker: t, ...r };
    });

    const good = snaps.filter((x) => x.ok);
    const bad = snaps.filter((x) => !x.ok);

    console.log("[/list] 📸 Snapshots:", { total: snaps.length, good: good.length, bad: bad.length });
    if (bad.length > 0) {
      console.log("[/list] ⚠️  Bad snapshots samples:", bad.slice(0, 3).map(x => ({ ticker: x.ticker, status: x.status, error: x.errorDetail })));
    }

    let rows = good.map((x) => normalizeSnapshotAuto(x.ticker, x.data)).map(addExtPctFromPrevClose);

    // cap filter first
    rows = rows.filter((r) => capPass(r, cap));
    console.log("[/list] 🔍 After cap filter ('", cap, "'):", rows.length, "rows");

    // ✅ IMPORTANT FIX: overwrite Gap% using Polygon FIRST
    rows = await enrichRowsWithDailyOpen(rows, 200);
    console.log("[/list] 📈 After Polygon gap enrich:", rows.length, "rows");

    // ✅ then apply minGap filter using correct gapPct
    if (minGap !== null && Number.isFinite(minGap) && group === "topGappers") {
      const beforeMinGap = rows.length;
      if (minGapAbs) rows = rows.filter((r) => Math.abs(r.gapPct ?? 0) >= minGap);
      else rows = rows.filter((r) => (r.gapPct ?? 0) >= minGap);
      console.log("[/list] 🎯 After minGap filter (", minGap, minGapAbs ? "abs" : "", "):", beforeMinGap, "→", rows.length);
    }

    // float enrich
    rows = await enrichRowsWithFloat(rows, 200);

    // now cut to limit
    rows = rows.slice(0, limit);

    const { rows: withInd, aggsErrors } = await attachIndicatorsIfEnabled(rows);
    rows = finalizeRows(withInd);

    // final sort based on group
    sortRowsByGroup(rows, group);

    console.log("[/list] ✅ Final results:", rows.length, "rows");

    res.json({
      ok: true,
      mode: "group",
      group,
      cap,
      limitRequested: limit,
      source,  // MOVERS | FALLBACK_WATCHLIST | FALLBACK_IMPORTANT_SYMBOLS
      minGap: group === "topGappers" ? minGap : undefined,
      minGapAbs: group === "topGappers" ? minGapAbs : undefined,
      results: rows,
      snapshotErrors: DEBUG
        ? bad.slice(0, 10).map((x) => ({
            ticker: x.ticker,
            status: x.status,
            url: x.url,
            errorDetail: x.errorDetail,
          }))
        : undefined,
      aggsErrors: DEBUG ? aggsErrors.slice(0, 10) : undefined,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "List failed", detail: String(e?.message || e) });
  }
});

// --------------------------------------------------------------------------
// Snapshot-all + sessions
// --------------------------------------------------------------------------
app.get("/snapshot-all", async (req, res) => {
  const cap = String(req.query.cap || "all").toLowerCase();
  const limit = req.query.limit;
  const out = await buildRowsFromSnapshotAll({ cap, limit, session: null, sortMode: "gap" });
  return res.status(out.status).json(out.body);
});

app.get("/premarket", async (req, res) => {
  const cap = String(req.query.cap || "all").toLowerCase();
  const limit = req.query.limit;

  if (ENABLE_SNAPSHOT_ALL) {
    const out = await buildRowsFromSnapshotAll({ cap, limit, session: "pre", sortMode: "gap" });
    return res.status(out.status).json(out.body);
  }

  const out = await buildRowsFromAMCache({ cap, limit, session: "pre", sortMode: "gap" });
  return res.status(out.status).json(out.body);
});

app.get("/aftermarket", async (req, res) => {
  const cap = String(req.query.cap || "all").toLowerCase();
  const limit = req.query.limit;

  if (ENABLE_SNAPSHOT_ALL) {
    const out = await buildRowsFromSnapshotAll({ cap, limit, session: "after", sortMode: "gap" });
    return res.status(out.status).json(out.body);
  }

  const out = await buildRowsFromAMCache({ cap, limit, session: "after", sortMode: "gap" });
  return res.status(out.status).json(out.body);
});

// --------------------------------------------------------------------------
// Movers Premarket / After-hours (Massive Movers list is the fastest fragment)
// Ranking: Gap% (abs) desc -> FloatTurnover% desc -> Volume desc
// --------------------------------------------------------------------------
app.get("/movers-premarket", async (req, res) => {
  try {
    const limit = clamp(Number(req.query.limit || 120), 10, 500);

    if (ALGTP_KR_MODE) {
      const rows = buildFromAMCacheKR({ session: "pre", limit });
      return res.json({ ok: true, mode: "KR_WS_ONLY", session: "premarket", results: rows });
    }

    // fallback old behavior (if you ever re-enable)
    const rows = await buildRowsFromMoversUnionBySession({ session: "pre", limit });
    return res.json({ ok: true, session: "premarket", results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "movers-premarket failed", detail: String(e?.message || e) });
  }
});

app.get("/movers-afterhours", async (req, res) => {
  try {
    const limit = clamp(Number(req.query.limit || 120), 10, 500);
    const rows = await buildRowsFromMoversUnionBySession({ session: "after", limit });
    res.json({
      ok: true,
      session: "afterhours",
      source: "massive_movers_list",
      rank: "gap_percent_then_float_turnover_percent_then_volume",
      results: rows,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "movers-afterhours failed", detail: String(e?.message || e) });
  }
});

// --------------------------------------------------------------------------
// Most Active / Most Volatile / Most Lately / Unusual Volume
// --------------------------------------------------------------------------
app.get("/most-active", async (req, res) => {
  const limit = clamp(Number(req.query.limit || 120), 10, 500);

  if (ALGTP_KR_MODE) {
    const rows = buildFromAMCacheKR({ session: null, limit });
    return res.json({ ok: true, mode: "KR_WS_ONLY", results: rows });
  }

  // old behavior
  const cap = String(req.query.cap || "all").toLowerCase();
  const out = ENABLE_SNAPSHOT_ALL
    ? await buildRowsFromSnapshotAll({ cap, limit, session: null, sortMode: "active" })
    : await buildRowsFromMoversUnion({ cap, limit, sortMode: "active" });
  return res.status(out.status).json(out.body);
});

app.get("/most-volatile", async (req, res) => {
  const limit = clamp(Number(req.query.limit || 120), 10, 500);

  if (ALGTP_KR_MODE) {
    let rows = buildFromAMCacheKR({ session: null, limit: Math.max(300, limit * 3) });
    rows.sort((a, b) => Math.abs(n(b.extPct) ?? 0) - Math.abs(n(a.extPct) ?? 0) || (n(b.volume) ?? 0) - (n(a.volume) ?? 0));
    rows = rows.slice(0, limit);
    return res.json({ ok: true, mode: "KR_WS_ONLY", results: rows });
  }

  const cap = String(req.query.cap || "all").toLowerCase();
  const out = ENABLE_SNAPSHOT_ALL
    ? await buildRowsFromSnapshotAll({ cap, limit, session: null, sortMode: "volatile" })
    : await buildRowsFromMoversUnion({ cap, limit, sortMode: "volatile" });
  return res.status(out.status).json(out.body);
});

app.get("/most-lately", async (req, res) => {
  const cap = String(req.query.cap || "all").toLowerCase();
  const limit = clamp(Number(req.query.limit || 120), 10, 500);

  const lastTimestampMsOfRow = (r) => {
    const a = toMs(r?.am_ts) ?? null;
    const b = n(r?.haltTsMs) ?? null;
    return a ?? b ?? 0;
  };

  const out = ENABLE_SNAPSHOT_ALL
    ? await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 3), session: null, sortMode: "active" })
    : await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 3), sortMode: "active" });

  if (!out.ok) return res.status(out.status).json(out.body);

  let rows = Array.isArray(out.body?.results) ? out.body.results : [];
  rows = rows
    .map((r) => ({ ...r, lastTsMs: lastTimestampMsOfRow(r) }))
    .sort((a, b) => (b.lastTsMs ?? 0) - (a.lastTsMs ?? 0))
    .slice(0, limit);

  return res.json({ ok: true, cap, results: rows });
});

app.get("/unusual-volume", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);

    const base = ENABLE_SNAPSHOT_ALL
      ? await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 5), session: null, sortMode: "active" })
      : await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 5), sortMode: "active" });

    if (!base.ok) return res.status(base.status).json(base.body);

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    if (!ENABLE_5M_INDICATORS) {
      rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
      rows = rows.slice(0, limit);
      return res.json({
        ok: true,
        cap,
        note: "ENABLE_5M_INDICATORS is false, fallback ranking by volume",
        results: rows,
      });
    }

    rows = rows
      .filter((r) => r && (r.volSpike_5m || (n(r.volRatio_5m) ?? 0) >= 2))
      .sort((a, b) => (n(b.volRatio_5m) ?? 0) - (n(a.volRatio_5m) ?? 0) || (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, limit);

    res.json({ ok: true, cap, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "unusual-volume failed", detail: String(e?.message || e) });
  }
});

// --------------------------------------------------------------------------
// Technical Indicator Filter Endpoints
// --------------------------------------------------------------------------

// Float Turnover Leaders
app.get("/float-turnover", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);
    const minTurnover = Number(req.query.minTurnover || 0.5); // 0.5% default

    const base = ENABLE_SNAPSHOT_ALL
      ? await buildRowsFromSnapshotAll({ cap, limit: Math.max(300, limit * 3), session: null, sortMode: "active" })
      : await buildRowsFromMoversUnion({ cap, limit: Math.max(300, limit * 3), sortMode: "active" });

    if (!base.ok) return res.status(base.status).json(base.body);

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    // Enrich with float data
    if (ENABLE_FLOAT_ENRICH && FMP_API_KEY) {
      rows = await enrichRowsWithFloat(rows, Math.min(rows.length, 200));
    }

    // Filter by float turnover %
    rows = rows
      .filter((r) => {
        const ft = n(r?.floatTurnoverPct);
        return ft !== null && ft >= minTurnover;
      })
      .sort((a, b) => (n(b.floatTurnoverPct) ?? 0) - (n(a.floatTurnoverPct) ?? 0))
      .slice(0, limit);

    res.json({ ok: true, cap, minTurnover, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "float-turnover failed", detail: String(e?.message || e) });
  }
});

// Low Float Hotlist (< 20M float with high activity)
app.get("/low-float-hot", async (req, res) => {
  try {
    const limit = clamp(Number(req.query.limit || 120), 10, 500);
    const maxFloat = Number(req.query.maxFloat || 20); // 20M shares max

    const base = ENABLE_SNAPSHOT_ALL
      ? await buildRowsFromSnapshotAll({ cap: "all", limit: Math.max(300, limit * 3), session: null, sortMode: "active" })
      : await buildRowsFromMoversUnion({ cap: "all", limit: Math.max(300, limit * 3), sortMode: "active" });

    if (!base.ok) return res.status(base.status).json(base.body);

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    // Enrich with float data
    if (ENABLE_FLOAT_ENRICH && FMP_API_KEY) {
      rows = await enrichRowsWithFloat(rows, Math.min(rows.length, 200));
    }

    // Filter by low float and rank by Gap% + Float Turnover
    rows = rows
      .filter((r) => {
        const floatM = n(r?.floatM);
        return floatM !== null && floatM > 0 && floatM <= maxFloat;
      })
      .sort((a, b) => {
        const aGap = Math.abs(n(a.gapPct) ?? 0);
        const bGap = Math.abs(n(b.gapPct) ?? 0);
        if (Math.abs(bGap - aGap) > 0.01) return bGap - aGap;
        const aTurn = n(a.floatTurnoverPct) ?? 0;
        const bTurn = n(b.floatTurnoverPct) ?? 0;
        if (Math.abs(bTurn - aTurn) > 0.01) return bTurn - aTurn;
        return (n(b.volume) ?? 0) - (n(a.volume) ?? 0);
      })
      .slice(0, limit);

    res.json({ ok: true, maxFloat, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "low-float-hot failed", detail: String(e?.message || e) });
  }
});

// RSI Bull Zone (50-75)
app.get("/filter-rsi", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);
    const minRSI = Number(req.query.min || 50);
    const maxRSI = Number(req.query.max || 75);

    if (!ENABLE_5M_INDICATORS) {
      return res.json({
        ok: true,
        note: "ENABLE_5M_INDICATORS is false, cannot compute RSI",
        results: [],
      });
    }

    const base = ENABLE_SNAPSHOT_ALL
      ? await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 3), session: null, sortMode: "active" })
      : await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 3), sortMode: "active" });

    if (!base.ok) return res.status(base.status).json(base.body);

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    // Compute RSI from 5m bars
    const withRSI = await mapPool(rows, SNAP_CONCURRENCY, async (r) => {
      const ag = await fetchAggs5m(r.symbol);
      if (!ag.ok || !ag.bars || ag.bars.length < 60) return { ...r, rsi: null };

      const barsChrono = [...ag.bars].reverse();
      const closes = barsChrono.map((b) => n(b.c)).filter((x) => x !== null);

      if (closes.length < RSI_LEN + 1) return { ...r, rsi: null };

      const rsiArr = rsiSeries(closes, RSI_LEN);
      const rsi = rsiArr[rsiArr.length - 1];

      return { ...r, rsi: rsi !== null ? round2(rsi) : null };
    });

    // Filter by RSI range
    rows = withRSI
      .filter((r) => {
        const rsi = n(r?.rsi);
        return rsi !== null && rsi >= minRSI && rsi <= maxRSI;
      })
      .sort((a, b) => Math.abs(n(b.gapPct) ?? 0) - Math.abs(n(a.gapPct) ?? 0) || (n(b.volume) ?? 0) - (n(a.volume) ?? 0))
      .slice(0, limit);

    res.json({ ok: true, cap, minRSI, maxRSI, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "filter-rsi failed", detail: String(e?.message || e) });
  }
});

// RSI Reversal (RSI <= 30, oversold)
app.get("/filter-rsi-reversal", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);
    const maxRSI = Number(req.query.max || 30); // oversold threshold

    if (!ENABLE_5M_INDICATORS) {
      return res.json({
        ok: true,
        note: "ENABLE_5M_INDICATORS is false, cannot compute RSI",
        results: [],
      });
    }

    const base = ENABLE_SNAPSHOT_ALL
      ? await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 3), session: null, sortMode: "active" })
      : await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 3), sortMode: "active" });

    if (!base.ok) return res.status(base.status).json(base.body);

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    // Compute RSI from 5m bars
    const withRSI = await mapPool(rows, SNAP_CONCURRENCY, async (r) => {
      const ag = await fetchAggs5m(r.symbol);
      if (!ag.ok || !ag.bars || ag.bars.length < 60) return { ...r, rsi: null };

      const barsChrono = [...ag.bars].reverse();
      const closes = barsChrono.map((b) => n(b.c)).filter((x) => x !== null);

      if (closes.length < RSI_LEN + 1) return { ...r, rsi: null };

      const rsiArr = rsiSeries(closes, RSI_LEN);
      const rsi = rsiArr[rsiArr.length - 1];

      return { ...r, rsi: rsi !== null ? round2(rsi) : null };
    });

    // Filter by oversold RSI
    rows = withRSI
      .filter((r) => {
        const rsi = n(r?.rsi);
        return rsi !== null && rsi <= maxRSI;
      })
      .sort((a, b) => (n(b.volume) ?? 0) - (n(a.volume) ?? 0)) // sort by volume
      .slice(0, limit);

    res.json({ ok: true, cap, maxRSI, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "filter-rsi-reversal failed", detail: String(e?.message || e) });
  }
});

// MACD Cross Up (MACD > Signal)
app.get("/filter-macd", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);
    const mode = String(req.query.mode || "cross_up").toLowerCase();

    if (!ENABLE_5M_INDICATORS) {
      return res.json({
        ok: true,
        note: "ENABLE_5M_INDICATORS is false, cannot compute MACD",
        results: [],
      });
    }

    const base = ENABLE_SNAPSHOT_ALL
      ? await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 3), session: null, sortMode: "active" })
      : await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 3), sortMode: "active" });

    if (!base.ok) return res.status(base.status).json(base.body);

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    // Compute MACD from 5m bars
    const withMACD = await mapPool(rows, SNAP_CONCURRENCY, async (r) => {
      const ag = await fetchAggs5m(r.symbol);
      if (!ag.ok || !ag.bars || ag.bars.length < 60) return { ...r, macd: null, macdSignal: null, macdHist: null };

      const barsChrono = [...ag.bars].reverse();
      const closes = barsChrono.map((b) => n(b.c)).filter((x) => x !== null);

      if (closes.length < MACD_SLOW + MACD_SIGNAL) return { ...r, macd: null, macdSignal: null, macdHist: null };

      const macdData = macdSeries(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
      const last = closes.length - 1;

      return {
        ...r,
        macd: macdData.macd[last] !== null ? Number(macdData.macd[last].toFixed(4)) : null,
        macdSignal: macdData.signal[last] !== null ? Number(macdData.signal[last].toFixed(4)) : null,
        macdHist: macdData.hist[last] !== null ? Number(macdData.hist[last].toFixed(4)) : null,
      };
    });

    // Filter by MACD cross up
    rows = withMACD
      .filter((r) => {
        const macd = n(r?.macd);
        const sig = n(r?.macdSignal);
        if (macd === null || sig === null) return false;
        if (mode === "cross_up") return macd > sig;
        if (mode === "cross_down") return macd < sig;
        return false;
      })
      .sort((a, b) => Math.abs(n(b.gapPct) ?? 0) - Math.abs(n(a.gapPct) ?? 0) || (n(b.volume) ?? 0) - (n(a.volume) ?? 0))
      .slice(0, limit);

    res.json({ ok: true, cap, mode, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "filter-macd failed", detail: String(e?.message || e) });
  }
});

// AO Rising (Awesome Oscillator trending up)
app.get("/filter-ao", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);
    const mode = String(req.query.mode || "rising").toLowerCase(); // rising | above_zero

    if (!ENABLE_5M_INDICATORS) {
      return res.json({
        ok: true,
        note: "ENABLE_5M_INDICATORS is false, cannot compute AO",
        results: [],
      });
    }

    const base = ENABLE_SNAPSHOT_ALL
      ? await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 3), session: null, sortMode: "active" })
      : await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 3), sortMode: "active" });

    if (!base.ok) return res.status(base.status).json(base.body);

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    // Compute AO from 5m bars
    const withAO = await mapPool(rows, SNAP_CONCURRENCY, async (r) => {
      const ag = await fetchAggs5m(r.symbol);
      if (!ag.ok || !ag.bars || ag.bars.length < 40) return { ...r, ao: null, aoPrev: null };

      const aoData = computeAwesomeOscillatorFrom5mBars(ag.bars);
      return { ...r, ...aoData };
    });

    // Filter by AO mode
    rows = withAO
      .filter((r) => {
        const ao = n(r?.ao);
        const aoPrev = n(r?.aoPrev);
        if (ao === null) return false;
        if (mode === "above_zero") return ao > 0;
        if (mode === "rising") return aoPrev !== null && ao > aoPrev;
        return false;
      })
      .sort((a, b) => Math.abs(n(b.gapPct) ?? 0) - Math.abs(n(a.gapPct) ?? 0) || (n(b.volume) ?? 0) - (n(a.volume) ?? 0))
      .slice(0, limit);

    res.json({ ok: true, cap, mode, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "filter-ao failed", detail: String(e?.message || e) });
  }
});

// EMA Stack (9 > 34 > 50)
app.get("/filter-ema-stack", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);

    if (!ENABLE_5M_INDICATORS) {
      return res.json({
        ok: true,
        note: "ENABLE_5M_INDICATORS is false, cannot compute EMA",
        results: [],
      });
    }

    const base = ENABLE_SNAPSHOT_ALL
      ? await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 3), session: null, sortMode: "active" })
      : await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 3), sortMode: "active" });

    if (!base.ok) return res.status(base.status).json(base.body);

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    // Compute EMA 9/34/50 from 5m bars
    const withEMA = await mapPool(rows, SNAP_CONCURRENCY, async (r) => {
      const ag = await fetchAggs5m(r.symbol);
      if (!ag.ok || !ag.bars || ag.bars.length < 60) return { ...r, ema9: null, ema34: null, ema50: null };

      const barsChrono = [...ag.bars].reverse();
      const closes = barsChrono.map((b) => n(b.c)).filter((x) => x !== null);

      if (closes.length < 50) return { ...r, ema9: null, ema34: null, ema50: null };

      const ema9Arr = emaSeries(closes, 9);
      const ema34Arr = emaSeries(closes, 34);
      const ema50Arr = emaSeries(closes, 50);

      const last = closes.length - 1;

      return {
        ...r,
        ema9: ema9Arr[last] !== null ? round2(ema9Arr[last]) : null,
        ema34: ema34Arr[last] !== null ? round2(ema34Arr[last]) : null,
        ema50: ema50Arr[last] !== null ? round2(ema50Arr[last]) : null,
      };
    });

    // Filter by EMA stack
    rows = withEMA
      .filter((r) => {
        const e9 = n(r?.ema9);
        const e34 = n(r?.ema34);
        const e50 = n(r?.ema50);
        return e9 !== null && e34 !== null && e50 !== null && e9 > e34 && e34 > e50;
      })
      .sort((a, b) => Math.abs(n(b.gapPct) ?? 0) - Math.abs(n(a.gapPct) ?? 0) || (n(b.volume) ?? 0) - (n(a.volume) ?? 0))
      .slice(0, limit);

    res.json({ ok: true, cap, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "filter-ema-stack failed", detail: String(e?.message || e) });
  }
});

// --------------------------------------------------------------------------
// FMP Intraday 1-minute Scanner (BOX FMP 1M) — BOOSTED
// Real-time scanner using FMP intraday 1-minute bars with parallel fetching
// --------------------------------------------------------------------------

// FMP 1M Cache for boosted performance
const fmp1mCache = new Map(); // symbol -> {ts, data}
const FMP1M_CACHE_TTL = 30_000; // 30 seconds aggressive caching

// 🚀 BOOSTED FMP 1M Scanner — Parallel + Cached
async function getBoostedFMP1M(symbols, max = 200) {
  if (!FMP_API_KEY) {
    throw new Error("FMP_API_KEY not configured");
  }

  const syms = symbols
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, max);

  if (!syms.length) {
    return [];
  }

  // Fetch function with aggressive caching
  const fetchFMP1mBoosted = async (sym) => {
    const now = Date.now();
    const cached = fmp1mCache.get(sym);
    
    // Return cached if fresh
    if (cached && (now - cached.ts) < FMP1M_CACHE_TTL) {
      return { ...cached.data, cached: true };
    }

    const url = `https://financialmodelingprep.com/api/v3/historical-chart/1min/${sym}`;
    const r = await safeGet(url, {
      params: { apikey: FMP_API_KEY },
      headers: { "user-agent": "ALGTP" },
      timeout: 5000 // Faster timeout for boosted mode
    });
    
    if (!r.ok) {
      return { sym, ok: false, error: r.errorDetail };
    }
    
    const bars = Array.isArray(r.data) ? r.data : [];
    if (!bars.length) {
      return { sym, ok: false, error: "no bars" };
    }
    
    // FMP returns newest first, reverse to oldest first
    bars.reverse();
    
    // Take last 60 bars (1 hour of 1m data)
    const recent = bars.slice(-60);
    
    // Compute indicators on 1m bars
    const closes = recent.map(b => n(b.close)).filter(x => x !== null);
    const vols = recent.map(b => n(b.volume) ?? 0);
    const highs = recent.map(b => n(b.high)).filter(x => x !== null);
    const lows = recent.map(b => n(b.low)).filter(x => x !== null);
    
    if (!closes.length) {
      return { sym, ok: false, error: "no valid closes" };
    }
    
    // Last bar = current price
    const lastBar = recent[recent.length - 1];
    const price = n(lastBar.close);
    const lastVol = n(lastBar.volume) ?? 0;
    
    // EMA9, EMA34 on 1m (simplified - just use last close as proxy)
    const ema9_1m = closes.length >= 9 ? closes.slice(-1)[0] : null;
    const ema34_1m = closes.length >= 34 ? closes.slice(-1)[0] : null;
    
    // VWAP (cumulative)
    let pvSum = 0, vSum = 0;
    for (let i = 0; i < recent.length; i++) {
      const c = n(recent[i].close);
      const v = n(recent[i].volume) ?? 0;
      if (c !== null) {
        pvSum += c * v;
        vSum += v;
      }
    }
    const vwap_1m = vSum > 0 ? pvSum / vSum : null;
    
    // Volume metrics
    const avgVol = vols.length >= 20 ? vols.slice(-20).reduce((s, v) => s + v, 0) / 20 : null;
    const volRatio_1m = avgVol && avgVol > 0 ? lastVol / avgVol : null;
    const volSpike_1m = volRatio_1m ? volRatio_1m >= VOL_SPIKE_MULT : false;
    
    // Price change %
    const firstClose = closes[0];
    const lastClose = closes[closes.length - 1];
    const pricePct_1m = firstClose && firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : null;
    
    // Awesome Oscillator on 1m (median high-low)
    const medians = recent.map((b, i) => {
      const h = n(b.high), l = n(b.low);
      return h !== null && l !== null ? (h + l) / 2 : null;
    }).filter(x => x !== null);
    
    const ao_1m = medians.length >= 34 ? 
      (medians.slice(-5).reduce((s, x) => s + x, 0) / 5) - 
      (medians.slice(-34).reduce((s, x) => s + x, 0) / 34) : null;
    
    // ROVL composite for 1m
    const rovl_1m = volRatio_1m ? Number((volRatio_1m * (Math.abs(pricePct_1m ?? 0) + 1)).toFixed(2)) : null;
    
    const result = {
      sym,
      ok: true,
      symbol: sym,
      price: price !== null ? round2(price) : null,
      pricePct_1m: pricePct_1m !== null ? round2(pricePct_1m) : null,
      volume: Math.round(vols.reduce((s, v) => s + v, 0)),
      lastVol_1m: Math.round(lastVol),
      avgVol_1m: avgVol !== null ? Math.round(avgVol) : null,
      volRatio_1m: volRatio_1m !== null ? round2(volRatio_1m) : null,
      volSpike_1m,
      rovl_1m,
      vwap_1m: vwap_1m !== null ? round2(vwap_1m) : null,
      ema9_1m: ema9_1m !== null ? round2(ema9_1m) : null,
      ema34_1m: ema34_1m !== null ? round2(ema34_1m) : null,
      ao_1m: ao_1m !== null ? round2(ao_1m) : null,
      aboveVWAP_1m: price !== null && vwap_1m !== null ? price > vwap_1m : null,
      bars: recent.length,
      timestamp: lastBar.date || null,
      dataSource: "fmp_intraday_1m_boosted"
    };

    // Cache it
    fmp1mCache.set(sym, { ts: now, data: result });

    return result;
  };

  // 🚀 BOOST: Higher concurrency (8 instead of 4)
  const results = await mapPool(syms, Math.min(8, SNAP_CONCURRENCY * 2), fetchFMP1mBoosted);
  
  // Filter successful results
  let rows = results.filter(r => r.ok).map(r => {
    const { sym, ok, error, cached, ...rest } = r;
    return rest;
  });
  
  // Sort by ROVL 1m (descending)
  rows.sort((a, b) => (n(b.rovl_1m) ?? 0) - (n(a.rovl_1m) ?? 0));
  
  return rows;
}

app.get("/box/fmp-intraday-1m-scan", async (req, res) => {
  try {
    if (!FMP_API_KEY) {
      return res.status(400).json({ 
        ok:false, 
        error:"FMP_API_KEY not configured" 
      });
    }

    const symbols = String(req.query.symbols || IMPORTANT_SYMBOLS);
    const max = clamp(Number(req.query.max || 50), 10, 200);

    const rows = await getBoostedFMP1M(symbols, max);

    res.json({
      ok: true,
      box: "fmp_intraday_1m",
      source: "FMP (BOOSTED)",
      symbols: symbols.split(",").filter(Boolean).length,
      results: rows,
    });
  } catch (e) {
    res.status(500).json({ 
      ok: false, 
      error: "/box/fmp-intraday-1m-scan failed", 
      detail: String(e?.message || e) 
    });
  }
});

// --------------------------------------------------------------------------
// ROVL Multi-Factor Ranking
// Combines: ROVL (volRatio_5m) + Float Turnover + Gap% + Volume + Price Change
// --------------------------------------------------------------------------
app.get("/rank-rovl", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);

    // Build a universe:
    // - If snapshot-all enabled: use it (fast)
    // - Else: use movers union (gainers+losers) OR AM fallback if you prefer
    let base;
    if (typeof ENABLE_SNAPSHOT_ALL !== "undefined" && ENABLE_SNAPSHOT_ALL) {
      base = await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 6), session: null, sortMode: "active" });
    } else if (typeof buildRowsFromMoversUnion === "function") {
      base = await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 6), sortMode: "active" });
    } else if (typeof buildRowsFromAMCache === "function") {
      base = await buildRowsFromAMCache({ cap, limit: Math.max(250, limit * 6), session: null, sortMode: "active" });
    } else {
      return res.status(500).json({ ok: false, error: "no universe builder available" });
    }

    if (!base || !base.ok) return res.status(base?.status || 500).json(base?.body || { ok: false, error: "builder failed" });

    let rows = Array.isArray(base.body?.results) ? base.body.results : [];

    // Need indicators to get ROVL (volRatio_5m). If indicators are off, we can still rank using volume/gap/price.
    // But best is ON.
    // Ensure Float turnover exists:
    rows = rows.map(addFloatTurnoverPct);

    // compute composite score for all rows
    rows = rows.map((r) => ({
      ...r,
      rovl: n(r?.volRatio_5m),
      compositeRank: 0, // placeholder, will be computed next
    }));

    // Now compute composite rank with z-score normalization
    rows = rows.map((r) => ({
      ...r,
      compositeRank: computeCompositeRank(r, rows),
    }));

    // sort by composite score
    rows.sort((a, b) => (b.compositeRank ?? 0) - (a.compositeRank ?? 0));

    // cut
    rows = rows.slice(0, limit);

    res.json({
      ok: true,
      cap,
      rank: "ROVL + FloatTurnover + Gap + Volume + PriceMove",
      results: rows,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "rank-rovl failed", detail: String(e?.message || e) });
  }
});

// ============================================================================
// SECTION 13 — UI (Dashboard) ✅ FULL REWRITE + FIXED
// ============================================================================
function riskNoticeContent() {
  return {
    title: "⚠️ Risk Notice & Data Disclaimer",

    en: [
      // --------------------------------------------------
      // Acceptance of Terms
      // --------------------------------------------------
      "Acceptance of Terms: By accessing or using ALGTP™ products, services, software, indicators, scanners, or website, you agree to be bound by the Terms of Service, Privacy Policy, and this Disclaimer. If you do not agree to these terms, you must not access or use ALGTP™.",

      // --------------------------------------------------
      // Real-Time Scanner & System Dependency Notice
      // --------------------------------------------------
      "Real-Time Operation Disclaimer: The ALGTP™ scanner operates using real-time and near real-time market data and system processes. While ALGTP™ is designed to actively scan and update market conditions, real-time performance is not guaranteed.",

      "Scanner accuracy, speed, and timeliness may be affected by network conditions (internet speed, latency, outages), user hardware limitations (CPU, RAM, system load), third-party APIs or data providers (rate limits, maintenance, delayed or incorrect data), and browser or operating system constraints.",

      "If any of these factors occur, scanner data may be delayed, incomplete, inaccurate, or temporarily unavailable, and real-time behavior may be degraded.",

      // --------------------------------------------------
      // No Guarantee
      // --------------------------------------------------
      "No Guarantee of Accuracy or Availability: ALGTP™ does not guarantee that scanner results, signals, rankings, alerts, or data outputs will be accurate, complete, uninterrupted, or delivered in real time. Market conditions can change faster than any system can process or display.",

      // --------------------------------------------------
      // Not Financial Advice
      // --------------------------------------------------
      "Not Financial Advice: ALGTP™ content is provided for educational and informational purposes only and does not constitute investment, financial, legal, or tax advice.",

      "All trading decisions are made solely at your own risk. You are fully responsible for verifying all information independently on your broker platform and official market sources before placing any trade.",

      // --------------------------------------------------
      // Limitation of Liability
      // --------------------------------------------------
      "Limitation of Liability: ALGTP™ shall not be held liable for any losses, damages, missed opportunities, delays, or system failures resulting from network issues, hardware limitations, third-party API failures, software bugs, unexpected behavior, market volatility, or rapid price changes.",

      // --------------------------------------------------
      // Final Acknowledgment
      // --------------------------------------------------
      "Final Acknowledgment: By continuing to use ALGTP™, you acknowledge that you understand the risks of real-time market scanning, accept system and data limitations, and agree to use the platform at your own discretion and responsibility."
    ],
  };
}


function renderUI() {
  const risk = riskNoticeContent();

  const importantDefault = IMPORTANT_SYMBOLS || "NVDA,TSLA,AAPL,AMD,META";
  const autoMs = UI_AUTO_REFRESH_MS;
  const autoSec = Math.max(1, Math.round(autoMs / 1000));

  const snapAllOn = ENABLE_SNAPSHOT_ALL ? "ON" : "OFF";
  const indOn = ENABLE_5M_INDICATORS ? "ON" : "OFF";

  const envMax = Number(process.env.SCAN_MAX_SYMBOLS || SCAN_MAX_SYMBOLS);
  const hardMax = Number(process.env.SCAN_HARD_MAX || SCAN_HARD_MAX);
  const initMax = Math.max(20, Math.min(hardMax, Number.isFinite(envMax) ? envMax : 200));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${BRAND?.name || "ALGTP™"} Dashboard</title>
<style>
:root{ color-scheme: dark; }
body{ margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; background:#0b0d12; color:#e6e8ef; }
.wrap{ max-width:1900px; margin:0 auto; padding:0 12px; }
header{ position:sticky; top:0; background:rgba(11,13,18,.92); backdrop-filter: blur(10px); border-bottom:1px solid rgba(255,255,255,.08); z-index:20; }

.brandRow{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; }
.brandTitle{ display:flex; align-items:center; gap:10px; }
.brandMark{ font-size:18px; }
.brandName{ font-weight:900; font-size:13px; letter-spacing:.3px; }
.brandSub{ font-size:12px; color:#a7adc2; margin-top:3px; }

.pill{ font-size:12px; padding:7px 12px; border-radius:999px; background:#121622; border:1px solid rgba(255,255,255,.12); color:#c8cde0; white-space:nowrap; }
.tag{ font-size:12px; padding:7px 12px; border-radius:999px; background:#121622; border:1px solid rgba(255,255,255,.12); color:#c8cde0; white-space:nowrap; }

.panel{ border-bottom:1px solid rgba(255,255,255,.06); padding:10px 0 12px; }
.hint{ font-size:12px; color:#a7adc2; margin-top:8px; line-height:1.4; }

.right{ text-align:right; }
.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.symLink{ color:#e6e8ef; text-decoration:none; border-bottom:1px dashed rgba(255,255,255,.25); cursor:pointer; }
.symLink:hover{ border-bottom-color: rgba(255,255,255,.55); }

.err{ white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; color:#ffb4b4; background:#1a0f12; border:1px solid rgba(255,128,128,.25); border-radius:12px; padding:10px 12px; margin-top:12px; display:none; }

/* ===== TOP BAR ===== */
.topBar{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.topBar .left{ display:flex; align-items:center; gap:10px; flex:1; min-width: 720px; flex-wrap:wrap; }
.topBar .right{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

.symbolsInput{
  flex:1; min-width:520px;
  background:#0f1320; border:1px solid rgba(255,255,255,.14);
  border-radius:16px;
  padding:11px 14px;
  color:#e6e8ef;
}
.hintMini{ font-size:12px; color:#a7adc2; white-space:nowrap; }

.btnTiny{
  font-size:12px;
  padding:7px 10px;
  border-radius:999px;
  background:#121622;
  border:1px solid rgba(255,255,255,.12);
  color:#c8cde0;
  cursor:pointer;
  user-select:none;
}
.btnTiny:hover{ border-color: rgba(255,255,255,.22); }

.btnHelp{
  font-size:12px;
  padding:7px 12px;
  border-radius:999px;
  background:linear-gradient(135deg, #9b59fe 0%, #00d4ff 100%);
  border:1px solid rgba(155,89,254,.3);
  color:#fff;
  cursor:pointer;
  user-select:none;
  text-decoration:none;
  font-weight:600;
  display:inline-flex;
  align-items:center;
  gap:6px;
  transition:all .3s ease;
}
.btnHelp:hover{ 
  transform:translateY(-1px);
  box-shadow:0 4px 12px rgba(155,89,254,.4);
  border-color: rgba(155,89,254,.5);
}

/* ===== TURBO MODE TOGGLE ===== */
.turboToggle{
  font-size:12px;
  padding:7px 12px;
  border-radius:999px;
  background:#121622;
  border:1px solid rgba(255,255,255,.12);
  color:#c8cde0;
  cursor:pointer;
  user-select:none;
  display:inline-flex;
  align-items:center;
  gap:8px;
  transition:all .3s ease;
  font-weight:600;
}
.turboToggle:hover{ 
  border-color: rgba(255,255,255,.22);
}
.turboToggle.active{
  background:linear-gradient(135deg, #facc15 0%, #f97316 100%);
  border:1px solid rgba(250,204,21,.4);
  color:#fff;
  box-shadow:0 4px 16px rgba(250,204,21,.3);
  animation:turbo-pulse 2s ease-in-out infinite;
}
.turboToggle.active:hover{
  box-shadow:0 6px 24px rgba(250,204,21,.5);
  transform:translateY(-1px);
}
@keyframes turbo-pulse{
  0%, 100% { box-shadow:0 4px 16px rgba(250,204,21,.3); }
  50% { box-shadow:0 8px 32px rgba(250,204,21,.6); }
}
.turboIndicator{
  width:8px;
  height:8px;
  border-radius:50%;
  background:#64748b;
  transition:all .3s ease;
}
.turboToggle.active .turboIndicator{
  background:#fff;
  box-shadow:0 0 8px rgba(255,255,255,.8);
  animation:turbo-blink 1s ease-in-out infinite;
}
@keyframes turbo-blink{
  0%, 100% { opacity:1; }
  50% { opacity:0.4; }
}

/* ===== ECO MODE TOGGLE (Lower API Requests) ===== */
.ecoToggle{
  font-size:12px;
  padding:7px 12px;
  border-radius:999px;
  background:#121622;
  border:1px solid rgba(255,255,255,.12);
  color:#c8cde0;
  cursor:pointer;
  user-select:none;
  display:inline-flex;
  align-items:center;
  gap:8px;
  transition:all .3s ease;
  font-weight:600;
}
.ecoToggle:hover{ 
  border-color: rgba(255,255,255,.22);
}
.ecoToggle.active{
  background:linear-gradient(135deg, #10b981 0%, #059669 100%);
  border:1px solid rgba(16,185,129,.4);
  color:#fff;
  box-shadow:0 4px 16px rgba(16,185,129,.3);
  animation:eco-pulse 2s ease-in-out infinite;
}
.ecoToggle.active:hover{
  box-shadow:0 6px 24px rgba(16,185,129,.5);
  transform:translateY(-1px);
}
@keyframes eco-pulse{
  0%, 100% { box-shadow:0 4px 16px rgba(16,185,129,.3); }
  50% { box-shadow:0 8px 32px rgba(16,185,129,.6); }
}
.ecoIndicator{
  width:8px;
  height:8px;
  border-radius:50%;
  background:#64748b;
  transition:all .3s ease;
}
.ecoToggle.active .ecoIndicator{
  background:#fff;
  box-shadow:0 0 8px rgba(255,255,255,.8);
  animation:eco-blink 1.5s ease-in-out infinite;
}
@keyframes eco-blink{
  0%, 100% { opacity:1; }
  50% { opacity:0.3; }
}

.stepper{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:7px 10px;
  border-radius:999px;
  background:#121622;
  border:1px solid rgba(255,255,255,.12);
  color:#c8cde0;
}
.stepper label{ font-size:12px; color:#a7adc2; }
.stepper input{
  width:72px;
  background:#0f1320;
  border:1px solid rgba(255,255,255,.14);
  border-radius:12px;
  padding:7px 10px;
  color:#e6e8ef;
  outline:none;
  font-size:12px;
}
.stepBtns{ display:flex; gap:6px; }
.stepBtn{
  width:28px; height:28px;
  border-radius:10px;
  border:1px solid rgba(255,255,255,.12);
  background:#0f1320;
  color:#e6e8ef;
  cursor:pointer;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  user-select:none;
}
.stepBtn:hover{ border-color: rgba(255,255,255,.22); }

@media (max-width: 1050px){
  .symbolsInput{ min-width:100%; }
}

/* ===== SYMBOLS ROLLER ===== */
.rollerWrap{
  margin-top:10px;
  border:1px solid rgba(255,255,255,.10);
  background:#0f1320;
  border-radius:14px;
  padding:8px 10px;
}
.rollerHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom:8px;
}
.rollerTitle{ font-size:12px; font-weight:900; color:#c8cde0; }
.rollerHint{ font-size:12px; color:#a7adc2; }
.roller{
  display:flex;
  gap:8px;
  overflow-x:auto;
  padding-bottom:4px;
  scrollbar-width: thin;
}
.chip{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:7px 10px;
  border-radius:999px;
  background:#121622;
  border:1px solid rgba(255,255,255,.12);
  color:#e6e8ef;
  font-size:12px;
  white-space:nowrap;
  cursor:pointer;
  user-select:none;
}
.chip:hover{ border-color: rgba(255,255,255,.22); }
.chip small{ color:#a7adc2; font-size:11px; }

/* ===== GRID ===== */
.grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap:8px; padding:12px 0 18px; }
.box{ grid-column: span 3; border:1px solid rgba(255,255,255,.14); border-radius:10px; overflow:hidden; background:#0b0d12; min-height:180px; }
.box.cols2{ grid-column: span 4; }
.box.cols3{ grid-column: span 4; }
.box.cols4{ grid-column: span 6; }
.box.cols6{ grid-column: span 12; }

.boxHead{ background:#121622; border-bottom:1px solid rgba(255,255,255,.10); padding:6px 10px; display:flex; align-items:center; justify-content:space-between; font-weight:900; font-size:12px; letter-spacing:.3px; }
.boxMeta{ font-weight:600; font-size:11px; color:#a7adc2; }
.boxBody{ overflow:auto; max-height:420px; }
.box table{ width:100%; border-collapse:collapse; }
.box th,.box td{ padding:6px 8px; border-bottom:1px solid rgba(255,255,255,.06); font-size:12px; white-space:nowrap; }
.box th{ position:sticky; top:0; background:#0b0d12; color:#a7adc2; }
.box tr:hover td{ background: rgba(255,255,255,.03); }

/* ===== Stats ===== */
.stats{ display:flex; gap:8px; align-items:center; }
.stat{ display:flex; flex-direction:column; align-items:center; gap:2px; }
.stat .label{ font-size:9px; color:#a7adc2; text-transform:uppercase; }
.stat .val{ font-size:11px; font-weight:700; }
.stat .val.ok{ color:#4ade80; }
.stat .val.bad{ color:#f87171; }
.stat .val.blue{ color:#60a5fa; }

/* ===== Risk popup ===== */
.riskBack{ position:fixed; inset:0; background: rgba(0,0,0,.72); display:none; align-items:center; justify-content:center; z-index:120; }
.riskBox{ width:min(760px, 94vw); background:#0b0d12; border:1px solid rgba(255,255,255,.16); border-radius:18px; box-shadow:0 18px 70px rgba(0,0,0,.60); overflow:hidden; }
.riskTop{ padding:12px 14px; background:#121622; border-bottom:1px solid rgba(255,255,255,.10); }
.riskTitle{ font-weight:900; font-size:13px; }
.riskBody{ padding:12px 14px; color:#cdd3ea; font-size:13px; line-height:1.45; max-height: 68vh; overflow:auto; }
.riskBody ul{ margin:8px 0 0 18px; padding:0; }
.riskBody li{ margin:6px 0; }
.riskFoot{ padding:12px 14px; display:flex; justify-content:flex-end; gap:10px; background:#0b0d12; border-top:1px solid rgba(255,255,255,.08); }
.riskBtn{ cursor:pointer; border:1px solid rgba(255,255,255,.18); background:#121622; color:#e6e8ef; border-radius:12px; padding:10px 12px; font-size:13px; }
.riskBtn:disabled{ opacity:.45; cursor:not-allowed; }

.watermark{ position: fixed; bottom: 10px; right: 12px; font-size: 11px; color: rgba(230,232,239,.30); pointer-events:none; user-select:none; z-index:9999; }

/* ===== Toast Notification ===== */
.toast{ position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#121622; border:1px solid rgba(255,255,255,.18); border-radius:16px; padding:16px 24px; color:#e6e8ef; font-size:14px; font-weight:600; z-index:200; box-shadow:0 8px 32px rgba(0,0,0,.4); opacity:0; pointer-events:none; transition:opacity .3s ease; display:flex; align-items:center; gap:12px; max-width:90vw; }
.toast.show{ opacity:1; pointer-events:auto; }
.toast.success{ background:#0d3320; border-color:rgba(74,222,128,.35); color:#4ade80; }
.toast.error{ background:#3a1a1a; border-color:rgba(248,113,113,.25); color:#f87171; }
.toast.warning{ background:#2a2412; border-color:rgba(250,204,21,.25); color:#facc15; }
.toast button{ margin-left:8px; padding:8px 16px; background:#e6e8ef; color:#0b0d12; border:none; border-radius:10px; font-size:13px; font-weight:700; cursor:pointer; transition:all .2s; }
.toast button:hover{ background:#fff; transform:translateY(-1px); }
</style>
</head>

<body>
<header>
  <div class="wrap">
    <div class="brandRow">
      <div>
        <div class="brandTitle">
          <span class="brandMark">${BRAND?.mark || "🔥"}</span>
          <span class="brandName">${BRAND?.legal || "ALGTP™"}</span>
        </div>
        <div class="brandSub">Movers ranked by Gap% + Float Turnover % • Hover mini-chart</div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="pill">Auto: <b>${autoSec}s</b></div>
        <button class="ecoToggle" id="ecoBtn" title="Toggle ECO Mode: Lower API requests to save costs">
          <div class="ecoIndicator"></div>
          <span id="ecoLabel">ECO OFF</span>
        </button>
        <button class="turboToggle" id="turboBtn" title="Toggle Turbo Mode: Faster scanning with more data">
          <div class="turboIndicator"></div>
          <span id="turboLabel">TURBO OFF</span>
        </button>
        <a href="/pricing" id="upgradeBtn" class="btnHelp" style="display:none; text-decoration:none;" title="Upgrade to unlock all features">
          <span>⚡</span>
          <span>Upgrade</span>
        </a>
      </div>
    </div>
  </div>
</header>

<div class="panel">
  <div class="wrap">
    <div class="topBar">
      <div class="left">
        <span class="tag">🔎 SYMBOLS</span>
        <input id="symbols" class="symbolsInput"
               value="${String(importantDefault).replace(/"/g, "&quot;")}"
               placeholder="Paste many symbols... (Enter)" />

        <div class="stepper" title="Max symbols to scan from your list">
          <label>Max</label>
          <div class="stepBtns">
            <div class="stepBtn" id="maxDown">−</div>
            <div class="stepBtn" id="maxUp">+</div>
          </div>
          <input id="maxSymbols" type="number" min="20" max="${hardMax}" step="20" value="${initMax}" />
        </div>

        <button class="btnTiny" id="btnApply">Apply</button>
        <button class="btnTiny" id="btnClear">Clear</button>
        <span class="hintMini">Enter/Apply → update IMPORTANT_STOCKS</span>
      </div>

      <div class="right">
        <a href="/user-guide" target="_blank" class="btnHelp" title="Open User Guide in new tab">
          <span>📖</span>
          <span>Help</span>
        </a>
        <span class="pill" id="userStatus">Loading...</span>
        <a href="/auth/google" class="btnTiny" id="loginBtn" style="display:none; text-decoration:none;">Login</a>
        <a href="/logout" class="btnTiny" id="logoutBtn" style="display:none; text-decoration:none;">Logout</a>
        <span class="pill" id="statusPill">Dashboard</span>
        <span class="pill">Snapshot-All: <b>${snapAllOn}</b></span>
        <span class="pill">Indicators: <b>${indOn}</b></span>
      </div>
    </div>

    <div class="rollerWrap">
      <div class="rollerHead">
        <div class="rollerTitle">SYMBOL ROLLER</div>
        <div class="rollerHint">Scroll → hover chip = mini chart • click chip = TradingView</div>
      </div>
      <div class="roller" id="roller"></div>
    </div>

    <div class="hint">
      TradingView click FIXED: no forced NASDAQ prefix. Movers ranked by Gap% + Float Turnover%.
    </div>

    <div class="err" id="errBox"></div>
  </div>
</div>

<div class="wrap">
  <div class="grid" id="grid"></div>
</div>

<div class="watermark">${BRAND?.watermark || ""}</div>

<!-- Toast Notification -->
<div class="toast" id="toast"></div>

<!-- Risk popup -->
<div class="riskBack" id="riskBack" aria-hidden="true">
  <div class="riskBox" role="dialog" aria-modal="true">
    <div class="riskTop"><div class="riskTitle">${risk.title}</div></div>
    <div class="riskBody">
      <div style="font-weight:900; margin-bottom:6px;">${BRAND?.legal || "ALGTP™"}</div>
      <ul>${risk.en.map((x)=>`<li>${x}</li>`).join("")}</ul>

      <div style="margin-top:12px; padding:10px 12px; border:1px solid rgba(255,255,255,.10); border-radius:12px; background:#121622;">
        <label style="display:flex; gap:10px; align-items:flex-start; font-size:13px; line-height:1.35; cursor:pointer;">
          <input type="checkbox" id="riskAgree" style="transform:translateY(2px);" />
          <span><b>I Understand & Agree</b></span>
        </label>
      </div>

      <div id="riskHint" style="margin-top:10px; color:#ffb4b4; font-size:12px; display:none;">
        ⚠️ Please check “I Understand & Agree” to continue.
      </div>
    </div>
    <div class="riskFoot"><button class="riskBtn" id="riskContinueBtn" disabled>Continue</button></div>
  </div>
</div>

<script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
<script>
const byId = (id) => document.getElementById(id);
const grid = byId("grid");
const errBox = byId("errBox");
const statusPill = byId("statusPill");
const roller = byId("roller");
const userStatus = byId("userStatus");

// ============================================================================
// Countdown Helpers (Days + Hours + Color)
// ============================================================================
function fmtLeft(days, hours){
  if (days <= 0 && hours <= 0) return "0h left";
  if (days <= 0) return \`\${hours}h left\`;
  if (hours <= 0) return \`\${days}d left\`;
  return \`\${days}d \${hours}h left\`;
}

function setPillStyle(mode, totalHoursLeft, tier){
  // Default colors
  let bg = "#121622", border = "rgba(255,255,255,.12)", color = "#c8cde0";

  if (mode === "PAID") {
    // green -> yellow -> red as expiry approaches
    if (totalHoursLeft <= 24) { bg="#3a1a1a"; border="rgba(248,113,113,.25)"; color="#f87171"; }
    else if (totalHoursLeft <= 72) { bg="#2a2412"; border="rgba(250,204,21,.25)"; color="#facc15"; }
    else { bg="#0d3320"; border="rgba(74,222,128,.25)"; color="#4ade80"; }
  } else if (mode === "FREE") {
    if (totalHoursLeft <= 24) { bg="#3a1a1a"; border="rgba(248,113,113,.25)"; color="#f87171"; }
    else if (totalHoursLeft <= 72) { bg="#2a2412"; border="rgba(250,204,21,.25)"; color="#facc15"; }
    else { bg="#1a1622"; border="rgba(255,180,180,.2)"; color="#ffb4b4"; }
  } else {
    bg="#3a1a1a"; border="rgba(248,113,113,.25)"; color="#f87171";
  }

  userStatus.style.background = bg;
  userStatus.style.borderColor = border;
  userStatus.style.color = color;
}

// ============================================================================
// Toast Notification System
// ============================================================================
let toastEl = null;
function toast(msg, type="info"){
  if (!toastEl){
    toastEl = document.createElement("div");
    toastEl.style.position="fixed";
    toastEl.style.left="50%";
    toastEl.style.bottom="18px";
    toastEl.style.transform="translateX(-50%)";
    toastEl.style.padding="12px 14px";
    toastEl.style.borderRadius="14px";
    toastEl.style.border="1px solid rgba(255,255,255,.14)";
    toastEl.style.background="#121622";
    toastEl.style.color="#e6e8ef";
    toastEl.style.fontSize="13px";
    toastEl.style.boxShadow="0 18px 70px rgba(0,0,0,.55)";
    toastEl.style.zIndex="99999";
    toastEl.style.display="none";
    document.body.appendChild(toastEl);
  }
  if (type === "success") { toastEl.style.borderColor="rgba(74,222,128,.35)"; }
  else if (type === "warn") { toastEl.style.borderColor="rgba(250,204,21,.35)"; }
  else if (type === "error") { toastEl.style.borderColor="rgba(248,113,113,.35)"; }
  else { toastEl.style.borderColor="rgba(255,255,255,.14)"; }

  toastEl.textContent = msg;
  toastEl.style.display="block";
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>{ toastEl.style.display="none"; }, 2600);
}

// ============================================================================
// User Status & Feature Toggle System (Tier-Based)
// ============================================================================
let userInfo = { isPaid: false, paidUntil: 0, tier: "FREE", allowedBoxes: null };

// Tier display configuration
const TIER_STYLES = {
  FREE: { bg: "#1a1622", border: "rgba(255,180,180,.2)", color: "#ffb4b4" },
  BASIC: { bg: "#1a2a3a", border: "rgba(100,149,237,.25)", color: "#6495ed" },
  PRO: { bg: "#0d3320", border: "rgba(74,222,128,.25)", color: "#4ade80" },
};

function updateUserStatusDisplay(data) {
  const mode = data?.mode || "EXPIRED";
  const tier = (data?.tier || "FREE").toUpperCase();
  const days = Number(data?.daysLeft || 0);
  const hours = Number(data?.hoursLeft || 0);
  const totalH = Number(data?.totalHoursLeft || 0);

  if (mode === "PAID" && totalH > 0) {
    userStatus.textContent = \`\${tier} (\${fmtLeft(days, hours)})\`;
    setPillStyle("PAID", totalH, tier);
    return;
  }

  userStatus.textContent = "EXPIRED";
  setPillStyle("EXPIRED", 0, tier);
}

async function loadUserStatus() {
  const loginBtn = byId("loginBtn");
  const logoutBtn = byId("logoutBtn");
  const upgradeBtn = byId("upgradeBtn");
  
  try {
    const r = await fetch("/me", {
      credentials: "same-origin"
    });
    if (!r.ok) {
      // User not logged in
      updateUserStatusDisplay({ tier: "FREE", isPaid: false, paidUntil: 0 });
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (upgradeBtn) upgradeBtn.style.display = "none";
      return;
    }
    const data = await r.json();
    userInfo = data;
    updateUserStatusDisplay(data);
    
    // Show/hide Upgrade button based on user status
    const showUpgrade = data?.mode === "EXPIRED" || 
                        (!data?.isPaid && data?.totalHoursLeft <= 72);
    if (upgradeBtn) upgradeBtn.style.display = showUpgrade ? "inline-flex" : "none";
    
    // Toast notification for expired access
    if (data?.mode === "EXPIRED") {
      toast("🔒 Access expired — please upgrade to continue", "error");
    }
    
    // Show logout button for logged-in users
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-block";

    // Store in localStorage for persistence
    try {
      localStorage.setItem("ALGTP_USER_STATUS", JSON.stringify(userInfo));
    } catch {}
    
    // ✅ CRITICAL: Load boxes AFTER userInfo is set
    console.log('[loadUserStatus] userInfo set:', userInfo);
    console.log('[loadUserStatus] loadAll type:', typeof loadAll);
    if (typeof loadAll === "function") {
      console.log('[loadUserStatus] Calling loadAll()...');
      loadAll();
    } else {
      console.warn('[loadUserStatus] loadAll is not a function yet!');
    }
  } catch (e) {
    console.error("Failed to load user status:", e);
    userStatus.textContent = "ERROR";
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
}

// Load cached user status immediately
try {
  const cached = localStorage.getItem("ALGTP_USER_STATUS");
  if (cached) {
    userInfo = JSON.parse(cached);
    updateUserStatusDisplay(userInfo);
    
    // Show upgrade button for cached status if needed
    const upgradeBtn = byId("upgradeBtn");
    const showUpgrade = userInfo?.mode === "EXPIRED" || 
                        (!userInfo?.isPaid && userInfo?.totalHoursLeft <= 72);
    if (upgradeBtn) upgradeBtn.style.display = showUpgrade ? "inline-flex" : "none";
  }
} catch {}

// Load fresh user status from server
loadUserStatus();

// ============================================================================
// Checkout Success/Cancel Toast Handler
// ============================================================================
(function handleCheckoutToast(){
  try {
    const u = new URL(window.location.href);
    const ok = u.searchParams.get("checkout");
    const plan = (u.searchParams.get("plan") || "").toUpperCase();
    if (ok === "success") {
      toast(\`✅ Payment success — \${plan} unlocked\`, "success");
      // clean URL
      u.searchParams.delete("checkout");
      u.searchParams.delete("plan");
      window.history.replaceState({}, "", u.toString());
      // refresh user status
      loadUserStatus();
    }
    if (ok === "cancel") {
      toast("⚠️ Checkout cancelled", "warn");
      u.searchParams.delete("checkout");
      u.searchParams.delete("plan");
      window.history.replaceState({}, "", u.toString());
    }
  } catch {}
})();

// ============================================================================
// Admin Session Expired Toast Handler
// ============================================================================
(function adminExpiredToast(){
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get("admin_expired") === "1") {
      toast("⏱ Admin session expired — please login again", "warn");
      u.searchParams.delete("admin_expired");
      window.history.replaceState({}, "", u.toString());
    }
  } catch {}
})();

// ============================================================================
// Admin Impersonation Toast Handler
// ============================================================================
(function impersonateToast(){
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get("impersonated") === "1") {
      toast("👤 Admin impersonation active", "warn");
      u.searchParams.delete("impersonated");
      window.history.replaceState({}, "", u.toString());
    }
    if (u.searchParams.get("admin_restored") === "1") {
      toast("✅ Admin account restored", "success");
      u.searchParams.delete("admin_restored");
      window.history.replaceState({}, "", u.toString());
    }
  } catch {}
})();

// ============================================================================
// Admin Session Countdown (Live)
// ============================================================================
async function loadAdminSessionCountdown(){
  try{
    const r = await fetch("/admin/session", {
      credentials: "same-origin"
    });
    if(!r.ok) return;
    const j = await r.json();
    if(!j.ok || !j.isAdmin) return;

    const pill = document.getElementById("statusPill");
    if(!pill) return;

    let ms = Number(j.msLeft||0);
    function tick(){
      const m = Math.max(0, ms);
      const totalMin = Math.ceil(m/60000);
      const hh = Math.floor(totalMin/60);
      const mm = totalMin%60;
      pill.textContent = \`ADMIN (\${hh}h \${mm}m)\`;
      ms -= 1000;
      if(ms <= 0) pill.textContent = "ADMIN (expired)";
    }
    tick();
    setInterval(tick, 1000);
  }catch{}
}
loadAdminSessionCountdown();

// ============================================================================
// Analytics Tracking (Client-side)
// ============================================================================
function trackEvent(event, options = {}) {
  try {
    const payload = {
      event,
      page: window.location.pathname,
      featureId: options.featureId || null,
      symbol: options.symbol || null,
      meta: options.meta || null,
    };

    fetch("/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin", // 🔥 BẮT BUỘC để gửi session cookie
      body: JSON.stringify(payload),
    }).catch(e => console.warn("Analytics failed:", e));
  } catch (e) {
    // Silently fail - don't break user experience
  }
}

// ============================================================================
// Feature Toggle Tracking Helper
// ============================================================================
// Use this when implementing feature toggles:
// const enabledIds = new Set(); // Your feature toggle state
//
// function toggleFeature(id) {
//   const turningOn = !enabledIds.has(id); // Check state BEFORE toggle
//   trackEvent("feature_toggle", { featureId: id, meta: { on: turningOn } });
//   
//   if (turningOn) {
//     enabledIds.add(id);
//   } else {
//     enabledIds.delete(id);
//   }
// }

// Track page view with detailed metadata
trackEvent("page_view", {
  meta: { 
    path: location.pathname,
    userAgent: navigator.userAgent,
    referrer: document.referrer || "direct",
    screenResolution: \`\${screen.width}x\${screen.height}\`,
    viewport: \`\${window.innerWidth}x\${window.innerHeight}\`,
    timestamp: new Date().toISOString()
  } 
});

// Also track legacy page_load event for backward compatibility
trackEvent("page_load", { meta: { userAgent: navigator.userAgent } });

let riskAccepted = false;
(function riskNotice(){
  const back = byId("riskBack");
  const agree = byId("riskAgree");
  const btn = byId("riskContinueBtn");
  const hint = byId("riskHint");
  back.style.display = "flex";
  btn.disabled = true;

  agree.addEventListener("change", () => {
    btn.disabled = !agree.checked;
    hint.style.display = agree.checked ? "none" : "block";
  });

  btn.addEventListener("click", () => {
    if (!agree.checked) { hint.style.display = "block"; return; }
    riskAccepted = true;
    back.style.display = "none";
    trackEvent("risk_notice_accepted");
  });
})();
function riskIsOpen(){ return !riskAccepted; }

function showError(obj){
  errBox.style.display = "block";
  errBox.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}
function clearError(){ errBox.style.display = "none"; errBox.textContent = ""; }

function fmtNum(x, digits=2){
  if (x === null || x === undefined) return "-";
  const nn = Number(x);
  if (!Number.isFinite(nn)) return "-";
  return nn.toFixed(digits);
}
function fmtInt(x){
  if (x === null || x === undefined) return "-";
  const nn = Number(x);
  if (!Number.isFinite(nn)) return "-";
  return Math.round(nn).toLocaleString();
}

// ✅ TradingView URL FIX: do NOT force "NASDAQ:" prefix
function tvUrlFor(sym){
  return "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(sym) + "&interval=5";
}
window.handleTickerClick = function(ev, sym){
  // Track both events: generic symbol_click and specific TradingView click
  trackEvent("symbol_click", { symbol: sym, featureId: "tradingview_link" });
  trackEvent("click_tradingview", { symbol: sym, meta: { symbol: sym } });
  
  // 🔥 IMPROVED FIX: Use window.open with noreferrer (more reliable than anchor.click())
  // This prevents TradingView from blocking the popup on Render deployments
  const url = tvUrlFor(sym);
  const newWindow = window.open(url, "_blank", "noopener,noreferrer");
  
  // Fallback: if window.open was blocked, try anchor method
  if (!newWindow || newWindow.closed || typeof newWindow.closed === "undefined") {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.referrerPolicy = "no-referrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
};

// hover mini chart
let miniBox=null, miniChart=null, candle=null, lineEMA9=null, lineEMA34=null, lineSMA26=null, lineVWAP=null;
let miniSym=null, hoverTimer=null;
const miniCache = new Map();

function ensureMiniBox(){
  if (miniBox) return;
  miniBox=document.createElement("div");
  miniBox.style.position="fixed";
  miniBox.style.width="380px";
  miniBox.style.height="250px";
  miniBox.style.background="#0b0d12";
  miniBox.style.border="1px solid rgba(255,255,255,.18)";
  miniBox.style.borderRadius="16px";
  miniBox.style.boxShadow="0 18px 70px rgba(0,0,0,.55)";
  miniBox.style.padding="10px";
  miniBox.style.zIndex="110";
  miniBox.style.display="none";
  miniBox.innerHTML=\`
    <div id="miniTitle" style="font-weight:900;font-size:12px;margin-bottom:6px;"></div>
    <div id="miniChart" style="width:100%;height:190px;"></div>
    <div style="margin-top:6px;font-size:11px;color:#a7adc2">Hover = mini chart • Click = TradingView</div>\`;
  document.body.appendChild(miniBox);

  const el = miniBox.querySelector("#miniChart");
  miniChart = LightweightCharts.createChart(el, {
    layout: { background: { type: "solid", color: "#0b0d12" }, textColor: "#c8cde0" },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { visible: true },
    timeScale: { visible: false },
    crosshair: { mode: 0 },
  });
  candle = miniChart.addCandlestickSeries();
  lineEMA9  = miniChart.addLineSeries();
  lineEMA34 = miniChart.addLineSeries();
  lineSMA26 = miniChart.addLineSeries();
  lineVWAP  = miniChart.addLineSeries();
}

function posMini(ev){
  const pad=12;
  let x=ev.clientX+pad, y=ev.clientY+pad;
  const w=400,h=270;
  if (x+w>window.innerWidth) x=ev.clientX-w-pad;
  if (y+h>window.innerHeight) y=ev.clientY-h-pad;
  miniBox.style.left=x+"px";
  miniBox.style.top=y+"px";
}

async function fetchMini(sym){
  if (miniCache.has(sym)) return miniCache.get(sym);
  const r = await fetch("/mini-chart?symbol="+encodeURIComponent(sym)+"&tf=1", {
    credentials: "same-origin"
  });
  const j = await r.json();
  if (!j.ok) return null;
  miniCache.set(sym,j);
  return j;
}

async function showMini(ev, sym){
  ensureMiniBox();
  miniSym=sym;
  posMini(ev);
  miniBox.style.display="block";
  miniBox.querySelector("#miniTitle").textContent = "📈 " + sym + " — mini chart";
  trackEvent("mini_chart_hover", { symbol: sym });

  const data = await fetchMini(sym);
  if (!data || miniSym!==sym) return;

  candle.setData(data.ohlc||[]);
  lineEMA9.setData(data.overlays?.ema9||[]);
  lineEMA34.setData(data.overlays?.ema34||[]);
  lineSMA26.setData(data.overlays?.sma26||[]);
  lineVWAP.setData(data.overlays?.vwap||[]);
}
function hideMini(){ miniSym=null; if(miniBox) miniBox.style.display="none"; }

function bindMiniHover(){
  document.querySelectorAll(".symLink").forEach(a=>{
    const sym = a.getAttribute("data-sym") || a.textContent.trim();
    a.onmouseenter = (ev)=>{ clearTimeout(hoverTimer); hoverTimer=setTimeout(()=>showMini(ev,sym),120); };
    a.onmousemove  = (ev)=>{ if(miniBox && miniBox.style.display==="block") posMini(ev); };
    a.onmouseleave = ()=>{ clearTimeout(hoverTimer); hideMini(); };
  });
}

// ===== Dashboard state =====
let importantSymbols = byId("symbols").value || "";
let scanMax = Number(byId("maxSymbols").value || 200);
const REFRESH_MS = ${UI_AUTO_REFRESH_MS};

// ============================================================================
// 🌿 ECO MODE — Lower API requests to save costs
// ============================================================================
let ecoMode = localStorage.getItem('ecoMode') === 'true';
const ecoBtn = byId('ecoBtn');
const ecoLabel = byId('ecoLabel');

function applyEcoMode(enabled) {
  ecoMode = enabled;
  localStorage.setItem('ecoMode', String(enabled));
  
  if (enabled) {
    ecoBtn.classList.add('active');
    ecoLabel.textContent = '🌿 ECO ON';
    toast('ECO Mode ACTIVATED: Lower API requests to save costs', 'success');
    trackEvent('eco_mode_on');
    
    // Disable turbo mode when eco is enabled
    if (turboMode) {
      applyTurboMode(false);
    }
  } else {
    ecoBtn.classList.remove('active');
    ecoLabel.textContent = 'ECO OFF';
    toast('ECO Mode OFF: Normal API usage', 'info');
    trackEvent('eco_mode_off');
  }
}

// Initialize eco button state
applyEcoMode(ecoMode);

ecoBtn.addEventListener('click', () => {
  applyEcoMode(!ecoMode);
});

// ============================================================================
// 🚀 TURBO MODE — Boost scanner performance
// ============================================================================
let turboMode = localStorage.getItem('turboMode') === 'true';
const turboBtn = byId('turboBtn');
const turboLabel = byId('turboLabel');

function applyTurboMode(enabled) {
  turboMode = enabled;
  localStorage.setItem('turboMode', String(enabled));
  
  if (enabled) {
    turboBtn.classList.add('active');
    turboLabel.textContent = '🚀 TURBO ON';
    toast('Turbo Mode ACTIVATED: Faster scanning + more data', 'success');
    trackEvent('turbo_mode_on');
    
    // Disable eco mode when turbo is enabled
    if (ecoMode) {
      applyEcoMode(false);
    }
  } else {
    turboBtn.classList.remove('active');
    turboLabel.textContent = 'TURBO OFF';
    toast('Turbo Mode OFF: Normal speed', 'info');
    trackEvent('turbo_mode_off');
  }
}

// Initialize turbo button state
applyTurboMode(turboMode);

turboBtn.addEventListener('click', () => {
  applyTurboMode(!turboMode);
});

// Modify fetch behavior based on mode
function getModeQueryParams() {
  if (ecoMode) {
    // ECO mode: reduce limits and skip heavy operations
    return '&eco=1&limit=50&skipIndicators=1';
  }
  if (turboMode) {
    // TURBO mode: boost parameters
    return '&turbo=1&boost=1';
  }
  return '';
}

// ============================================================================
// ✅ ALGTP™ — FEATURE REGISTRY (Tier-Based Access Control)
// ============================================================================
// Tier hierarchy (must match server-side)
const TIER_HIERARCHY = {
  FREE: 0,
  BASIC: 1,
  PRO: 2,
};

// Free users have no access - must upgrade
const FREE_ALLOWED_BOXES = [];

const FEATURE_REGISTRY = [
  // Basic features - requires BASIC or PRO tier
  { id:"gappers_dn",   title:"Top Gappers Down",      minTier:"BASIC", endpoint:"/list?group=topGappers&cap=all&limit=220&minGap=5&minGapAbs=true", cols:3, limit:20, sort:"gapDesc", type:"table", defaultOn:true },
  { id:"gappers_up",   title:"Top Gappers Up",        minTier:"BASIC", endpoint:"/list?group=topGappers&cap=all&limit=220&minGap=5", cols:3, limit:20, sort:"gapDesc", type:"table", defaultOn:true },
  { id:"top_gainers",  title:"Top Gainers",           minTier:"BASIC", endpoint:"/list?group=topGainers&cap=all&limit=220", cols:3, limit:20, sort:"pctDesc", type:"table", defaultOn:true },
  { id:"top_losers",   title:"Top Losers",            minTier:"BASIC", endpoint:"/list?group=topLosers&cap=all&limit=220", cols:3, limit:20, sort:"pctAsc", type:"table", defaultOn:true },

  // Standard features
  { id:"pm_movers",    title:"Premarket Movers",      minTier:"BASIC", endpoint:"/movers-premarket?limit=200", cols:3, limit:30, sort:"gapFloatRank", type:"table", defaultOn:true },
  { id:"ah_movers",    title:"After Hours Movers",    minTier:"BASIC", endpoint:"/movers-afterhours?limit=200", cols:3, limit:30, sort:"gapFloatRank", type:"table", defaultOn:true },
  { id:"most_active",  title:"Most Active (Volume)",  minTier:"BASIC", endpoint:"/most-active?cap=all&limit=220", cols:3, limit:20, sort:"active", type:"table", defaultOn:true },
  { id:"unusual_vol",  title:"Unusual Volume",        minTier:"BASIC", endpoint:"/unusual-volume?cap=all&limit=220", cols:3, limit:20, sort:"uv", type:"table", defaultOn:true },
  { id:"most_volatile",title:"Most Volatile",         minTier:"BASIC", endpoint:"/most-volatile?cap=all&limit=220", cols:3, limit:20, sort:"volatile", type:"table", defaultOn:true },
  { id:"most_lately",  title:"Most Lately",           minTier:"BASIC", endpoint:"/most-lately?cap=all&limit=220", cols:3, limit:20, sort:"active", type:"table", defaultOn:true },

  // PRO features
  { id:"float_turn",   title:"Float Turnover Leaders", minTier:"PRO", endpoint:"/float-turnover?cap=all&limit=220", cols:3, limit:20, sort:"floatTurn", type:"table", defaultOn:true },
  { id:"low_float",    title:"Low Float Hotlist",     minTier:"PRO", endpoint:"/low-float-hot?limit=220", cols:3, limit:20, sort:"gapFloatRank", type:"table", defaultOn:true },
  { id:"rsi_bull",     title:"RSI Bull Zone (50-75)",  minTier:"PRO", endpoint:"/filter-rsi?min=50&max=75&limit=220", cols:3, limit:20, sort:"gapDesc", type:"table", defaultOn:true },
  { id:"rsi_rev",      title:"RSI Reversal (≤30)",     minTier:"PRO", endpoint:"/filter-rsi-reversal?limit=220", cols:3, limit:20, sort:"active", type:"table", defaultOn:true },
  { id:"macd_up",      title:"MACD Cross Up",         minTier:"PRO", endpoint:"/filter-macd?mode=cross_up&limit=220", cols:3, limit:20, sort:"gapDesc", type:"table", defaultOn:true },
  { id:"ao_rise",      title:"AO Rising",             minTier:"PRO", endpoint:"/filter-ao?mode=rising&limit=220", cols:3, limit:20, sort:"gapDesc", type:"table", defaultOn:true },
  { id:"ema_stack",    title:"EMA Stack (9>34>50)",   minTier:"PRO", endpoint:"/filter-ema-stack?limit=220", cols:3, limit:20, sort:"gapDesc", type:"table", defaultOn:true },
  { id:"rovl_rank",    title:"ROVL Composite Rank",   minTier:"PRO", endpoint:"/rank-rovl?cap=all&limit=220", cols:3, limit:20, sort:"compositeRank", type:"table", defaultOn:true },
  { id:"box_fmp_1m",   title:"FMP Intraday 1m",       minTier:"PRO", endpoint:"/box/fmp-intraday-1m-scan?symbols="+encodeURIComponent(importantSymbols)+"&max="+encodeURIComponent(scanMax), cols:3, limit:20, sort:"rovl1m", type:"table", defaultOn:true },

  // Special boxes (requires paid subscription)
  { id:"watchlist",    title:"📋 My Watchlist",       minTier:"BASIC", endpoint:"/watchlist", cols:3, limit:100, sort:"gapDesc", type:"watchlist", defaultOn:true },
  { id:"watchlist_scan", title:"🔍 Watchlist Scan",   minTier:"BASIC", endpoint:"/scan", cols:6, limit:200, sort:"gapDesc", type:"table", defaultOn:true },
  { id:"important",    title:"Important Stocks",      minTier:"BASIC", endpoint:"/scan?symbols="+encodeURIComponent(importantSymbols)+"&max="+encodeURIComponent(scanMax), cols:6, limit:200, sort:"gapDesc", type:"table", hideSymbol:false, defaultOn:true },
  { id:"halts",        title:"HALT (LULD) Monitor",   minTier:"BASIC", endpoint:"/halts?only=all", cols:6, limit:200, type:"halts", defaultOn:true },
];

// Helper: Get boxes user has access to based on tier
function getAccessibleBoxes(userTier) {
  const tierLevel = TIER_HIERARCHY[String(userTier || "FREE").toUpperCase()] ?? 0;
  return FEATURE_REGISTRY.filter(f => {
    const requiredLevel = TIER_HIERARCHY[String(f.minTier).toUpperCase()] ?? 0;
    return tierLevel >= requiredLevel;
  });
}

// Helper: Get default enabled box IDs
function getDefaultEnabledIds(userTier) {
  const accessible = getAccessibleBoxes(userTier);
  return accessible.filter(f => f.defaultOn).map(f => f.id);
}

// Legacy: Map FEATURE_REGISTRY to SECTIONS for backward compatibility
const SECTIONS = FEATURE_REGISTRY.map(f => ({
  id: f.id,
  title: f.title,
  url: f.endpoint || f.url,
  endpoint: f.endpoint,
  cols: f.cols,
  limit: f.limit,
  sort: f.sort,
  type: f.type,
  hideSymbol: f.hideSymbol,
  minTier: f.minTier,
  defaultOn: f.defaultOn,
}));

function boxHtml(sec){
  const cls = sec.cols ? "cols"+sec.cols : "";
  return \`
    <div class="box \${cls}" id="box_\${sec.id}">
      <div class="boxHead">
        <div>\${sec.title}</div>
        <div class="boxMeta" id="meta_\${sec.id}">...</div>
      </div>
      <div class="boxBody" id="body_\${sec.id}"></div>
    </div>\`;
}
function renderGrid(){ grid.innerHTML = SECTIONS.map(boxHtml).join(""); }

function sortRows(rows, mode){
  const safe = (v)=> (Number.isFinite(Number(v)) ? Number(v) : null);
  if (mode==="gapDesc") return [...rows].sort((a,b)=> (safe(b.gapPct)??-1e18)-(safe(a.gapPct)??-1e18));
  if (mode==="pctDesc") return [...rows].sort((a,b)=> (safe(b.pricePct)??-1e18)-(safe(a.pricePct)??-1e18));
  if (mode==="pctAsc")  return [...rows].sort((a,b)=> (safe(a.pricePct)??1e18)-(safe(b.pricePct)??1e18));
  if (mode==="active")  return [...rows].sort((a,b)=> (safe(b.volume)??-1e18)-(safe(a.volume)??-1e18));
  if (mode==="volatile")return [...rows].sort((a,b)=> (Math.abs(safe(b.gapPct)??0))-(Math.abs(safe(a.gapPct)??0)) );
  if (mode==="uv")      return [...rows].sort((a,b)=> (safe(b.volRatio_5m)??-1e18)-(safe(a.volRatio_5m)??-1e18) || (safe(b.volume)??-1e18)-(safe(a.volume)??-1e18));
  if (mode==="floatTurn") return [...rows].sort((a,b)=> (safe(b.floatTurnoverPct)??-1e18)-(safe(a.floatTurnoverPct)??-1e18));
  if (mode==="gapFloatRank"){
    return [...rows].sort((a,b)=>
      Math.abs((safe(b.gapPct)??0)) - Math.abs((safe(a.gapPct)??0)) ||
      ((safe(b.floatTurnoverPct)??0)) - ((safe(a.floatTurnoverPct)??0)) ||
      ((safe(b.volume)??0)) - ((safe(a.volume)??0))
    );
  }
  if (mode==="compositeRank"){
    return [...rows].sort((a,b)=> (safe(b.compositeRank)??-1e18)-(safe(a.compositeRank)??-1e18));
  }
  if (mode==="rovl1m"){
    return [...rows].sort((a,b)=> (safe(b.rovl1m)??-1e18)-(safe(a.rovl1m)??-1e18) || (safe(b.lastVol)??-1e18)-(safe(a.lastVol)??-1e18));
  }
  return rows;
}

function rowsTable(rowsRaw, sec){
  const rows = sortRows(rowsRaw, sec.sort).slice(0, sec.limit ?? 40);
  return \`
  <table>
    <thead>
      <tr>
        <th>Sig</th>
        <th>PA</th>
        <th>Symbol</th>
        <th class="right">Price</th>
        <th class="right">Open</th>
        <th class="right">Prev</th>
        <th class="right">Gap%</th>
        <th class="right">VWAP</th>
        <th class="right">Vol</th>
        <th class="right">Float(M)</th>
        <th class="right">Float%</th>
        <th class="right">Score</th>
      </tr>
    </thead>
    <tbody>
      \${rows.map(r=>{
        const sym=String(r.symbol||"");
        const safeSym=sym.replace(/'/g,"");
        const label = sec.hideSymbol ? "•" : sym;
        return \`
        <tr>
          <td>\${r.signalIcon||""}</td>
          <td>\${r.paIcon||""}</td>
          <td class="mono">
            <a class="symLink" data-sym="\${safeSym}" href="javascript:void(0)" onclick="handleTickerClick(event,'\${safeSym}')">\${label}</a>
          </td>
          <td class="right mono">\${fmtNum(r.price)}</td>
          <td class="right mono">\${fmtNum(r.open)}</td>
          <td class="right mono">\${fmtNum(r.prevClose)}</td>
          <td class="right mono">\${fmtNum(r.gapPct)}%</td>
          <td class="right mono">\${fmtNum(r.vwap_5m)}</td>
          <td class="right mono">\${fmtInt(r.volume)}</td>
          <td class="right mono">\${fmtNum(r.floatM)}</td>
          <td class="right mono">\${fmtNum(r.floatTurnoverPct)}%</td>
          <td class="right mono">\${r.score!=null?r.score:"-"}</td>
        </tr>\`;
      }).join("")}
    </tbody>
  </table>\`;
}

function haltsTable(rows){
  const top = rows.slice(0, 200);
  return \`
  <table>
    <thead><tr><th>Symbol</th><th>Time</th><th>Status</th></tr></thead>
    <tbody>
      \${top.map(x=>{
        const t = x.tsMs ? new Date(x.tsMs).toLocaleTimeString() : "-";
        const desc = x.halted ? "HALT" : "RESUME";
        return \`<tr><td class="mono">\${x.symbol||""}</td><td class="mono">\${t}</td><td>\${desc}</td></tr>\`;
      }).join("")}
    </tbody>
  </table>\`;
}

function renderRoller(symbols){
  const list = String(symbols||"")
    .replace(/\\n/g,",")
    .split(",")
    .map(s=>s.trim().toUpperCase())
    .filter(Boolean);

  roller.innerHTML = list.slice(0, 2000).map(sym => {
    const safe = sym.replace(/'/g,"");
    return \`<div class="chip" data-sym="\${safe}">\${safe} <small>hover</small></div>\`;
  }).join("");

  roller.querySelectorAll(".chip").forEach(ch => {
    const sym = ch.getAttribute("data-sym");
    ch.addEventListener("mouseenter",(ev)=>{
      clearTimeout(hoverTimer);
      hoverTimer=setTimeout(()=>showMini(ev, sym),120);
    });
    ch.addEventListener("mousemove",(ev)=>{
      if (miniBox && miniBox.style.display==="block") posMini(ev);
    });
    ch.addEventListener("mouseleave",()=>{
      clearTimeout(hoverTimer);
      hideMini();
    });
    ch.addEventListener("click",()=> {
      trackEvent("click_tradingview", { symbol: sym, meta: { symbol: sym, source: "chip_roller" } });
      window.open(tvUrlFor(sym), "_blank", "noopener,noreferrer");
    });
  });
}

async function loadSection(sec){
  const meta = byId("meta_"+sec.id);
  const body = byId("body_"+sec.id);

  const tier = String(userInfo?.tier || "FREE").toUpperCase();
  const mode = String(userInfo?.mode || "EXPIRED").toUpperCase();
  const isPaid = mode === "PAID" && Number(userInfo?.totalHoursLeft || 0) > 0;

  // Check if user has access based on tier hierarchy
  const userTierLevel = TIER_HIERARCHY[tier] ?? 0;
  const requiredTierLevel = TIER_HIERARCHY[String(sec.minTier || "BASIC").toUpperCase()] ?? 0;
  const hasAccess = isPaid && userTierLevel >= requiredTierLevel;

  // -------------------------------------------------
  // 1) UI GATING — TIER CHECK
  // -------------------------------------------------
  if (!hasAccess) {
    const requiredTier = String(sec.minTier || "BASIC").toUpperCase();
    const plan = requiredTier === "PRO" ? "pro" : "basic";
    
    meta.textContent = "🔒 Locked";
    const lockMsg = mode === "EXPIRED" ? "Subscription required." : "Upgrade to " + requiredTier + " to access this feature.";
    body.innerHTML = \`
      <div style="padding:20px;text-align:center;color:#ffb4b4;font-size:13px;">
        🔒 <b>\${requiredTier} Feature</b><br>
        <small style="color:#a7adc2;display:block;margin-top:8px;">
          \${lockMsg}
        </small>
        <a href="/stripe/checkout?plan=\${plan}"
           style="display:inline-block;margin-top:12px;padding:8px 16px;background:#121622;border:1px solid rgba(255,255,255,.18);border-radius:12px;color:#e6e8ef;text-decoration:none;font-size:12px;">
          Upgrade Now
        </a>
      </div>\`;
    return;
  }

  // -------------------------------------------------
  // 2) FETCH DATA
  // -------------------------------------------------
  try {
    meta.textContent = "Loading...";
    trackEvent("box_load", { featureId: sec.id, meta: { title: sec.title } });

    // 🚀 Append mode parameters (ECO or TURBO)
    let endpoint = sec.endpoint || sec.url;
    const modeParams = getModeQueryParams();
    if (modeParams) {
      const separator = endpoint.includes('?') ? '&' : '?';
      endpoint = endpoint + separator + modeParams.substring(1); // Remove leading '&'
    }

    const r = await fetch(endpoint, {
      headers: { "Accept": "application/json" },
      credentials: "same-origin"
    });

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const j = ct.includes("application/json") ? await r.json() : null;

    // Handle API errors
    if (!r.ok || !j || !j.ok) {
      meta.textContent = "⚠️ Error";
      body.innerHTML = \`
        <div style="padding:20px;text-align:center;color:#facc15;font-size:13px;">
          ⚠️ <b>Data temporarily unavailable</b><br>
          <small style="color:#a7adc2;display:block;margin-top:8px;">
            \${j?.message || "Please try again later."}
          </small>
        </div>\`;
      return;
    }

    meta.textContent = (j.results?.length ?? j.count ?? 0) + " rows • " + new Date().toLocaleTimeString();

    if (sec.type==="watchlist"){
      const syms = Array.isArray(j.symbols) ? j.symbols : [];
      const chipsHtml = syms.map(s => 
        \`<div class="chip" data-sym="\${s}" style="padding:8px 12px; background:#0f1320; border:1px solid rgba(255,255,255,.12); border-radius:8px; cursor:pointer;">\${s} <small style="opacity:.7; cursor:pointer; margin-left:6px;" data-del="\${s}">✕</small></div>\`
      ).join("");
      
      body.innerHTML = \`
        <div style="padding:10px">
          <div style="display:flex; gap:8px; margin-bottom:10px;">
            <input id="wlInput" placeholder="Add ticker (e.g. AAPL)" style="flex:1; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:#0f1320; color:#e6e8ef;">
            <button id="wlAddBtn" class="btnTiny" style="padding:10px 20px; background:#4ade80; color:#0b0d12; border:none; border-radius:12px; font-weight:600; cursor:pointer;">Add</button>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            \${chipsHtml}
          </div>
          <div style="margin-top:10px; font-size:12px; color:#a7adc2;">
            \${syms.length}/\${j.max} tickers • Scanner will use this list when no symbols are provided.
          </div>
        </div>
      \`;

      // Wire add/remove
      const input = body.querySelector("#wlInput");
      const btn = body.querySelector("#wlAddBtn");

      async function refreshWatchlist(){
        const r2 = await fetch("/watchlist", {
          credentials: "same-origin"
        });
        const j2 = await r2.json();
        // Quick reload this same section
        loadSection(sec);
        // Also cache locally
        try { localStorage.setItem("ALGTP_WATCHLIST", JSON.stringify(j2.symbols||[])); } catch {}
      }

      btn.onclick = async () => {
        const sym = (input.value||"").trim().toUpperCase();
        if (!sym) return;
        trackEvent("watchlist_add", { symbol: sym });
        await fetch("/watchlist/add", { 
          method:"POST", 
          headers:{ "Content-Type":"application/json" }, 
          credentials: "same-origin",
          body: JSON.stringify({ symbol: sym }) 
        });
        input.value = "";
        await refreshWatchlist();
        // Also refresh watchlist_scan box if present
        const scanBox = SECTIONS.find(s => s.id === "watchlist_scan");
        if (scanBox) loadSection(scanBox);
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") btn.click();
      });

      body.querySelectorAll("[data-del]").forEach(x => {
        x.onclick = async (ev) => {
          ev.stopPropagation();
          const sym = x.getAttribute("data-del");
          trackEvent("watchlist_remove", { symbol: sym });
          await fetch("/watchlist/remove", { 
            method:"POST", 
            headers:{ "Content-Type":"application/json" }, 
            credentials: "same-origin",
            body: JSON.stringify({ symbol: sym }) 
          });
          await refreshWatchlist();
          // Also refresh watchlist_scan box if present
          const scanBox = SECTIONS.find(s => s.id === "watchlist_scan");
          if (scanBox) loadSection(scanBox);
        };
      });

      // Optional: click chip => TradingView
      body.querySelectorAll(".chip[data-sym]").forEach(ch => {
        ch.addEventListener("click", (e) => {
          // Don't trigger if clicking X
          if (e.target.hasAttribute("data-del")) return;
          const sym = ch.getAttribute("data-sym");
          trackEvent("click_tradingview", { symbol: sym, meta: { source: "watchlist_chip" } });
          
          // Use same improved method as handleTickerClick
          const url = tvUrlFor(sym);
          const newWindow = window.open(url, "_blank", "noopener,noreferrer");
          if (!newWindow || newWindow.closed || typeof newWindow.closed === "undefined") {
            const a = document.createElement("a");
            a.href = url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.referrerPolicy = "no-referrer";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
        });
      });

      return;
    } else if (sec.type==="halts"){
      const rows = Array.isArray(j.results) ? j.results : [];
      body.innerHTML = haltsTable(rows);
    } else {
      const rows = Array.isArray(j.results) ? j.results : [];
      body.innerHTML = rowsTable(rows, sec);
      bindMiniHover();
    }
  }catch(e){
    meta.textContent="Error";
    body.innerHTML = "<div style='padding:10px;color:#ffb4b4;font-size:12px;'>"+String(e?.message||e)+"</div>";
  }
}

function loadAll(){
  clearError();
  for (const sec of SECTIONS) loadSection(sec);
}

// ===== APPLY IMPORTANT (THIS IS THE LINE YOU COULD NOT FIND) =====
function applyImportant(){
  const input = byId("symbols");
  const maxInput = byId("maxSymbols");

  importantSymbols = String(input.value||"").trim();
  scanMax = Number(maxInput.value || 200);
  if (!Number.isFinite(scanMax)) scanMax = 200;
  scanMax = Math.max(20, Math.min(${hardMax}, Math.floor(scanMax)));

  maxInput.value = String(scanMax);
  renderRoller(importantSymbols);

  const sec = SECTIONS.find(s=>s.id==="important");
  if (!sec) return;

  // ✅ IMPORTANT BOX URL UPDATE (always uses ?symbols= )
  sec.url = "/scan?symbols=" + encodeURIComponent(importantSymbols) + "&max=" + encodeURIComponent(scanMax);

  trackEvent("symbols_update", { meta: { symbolCount: importantSymbols.split(',').filter(Boolean).length, maxSymbols: scanMax } });
  loadSection(sec);

  statusPill.textContent = "Updated";
  setTimeout(()=>statusPill.textContent="Dashboard", 900);
}

(function bindControls(){
  const input = byId("symbols");
  const maxInput = byId("maxSymbols");
  const btnApply = byId("btnApply");
  const btnClear = byId("btnClear");
  const maxUp = byId("maxUp");
  const maxDown = byId("maxDown");

  renderRoller(importantSymbols);

  btnApply.addEventListener("click", applyImportant);

  btnClear.addEventListener("click", ()=>{
    input.value = "";
    input.focus();
    renderRoller("");
    statusPill.textContent = "Cleared";
    setTimeout(()=>statusPill.textContent="Dashboard", 600);
  });

  input.addEventListener("keydown",(e)=>{
    if (e.key === "Enter") applyImportant();
  });

  const step = 20;

  maxUp.addEventListener("click", ()=>{
    let v = Number(maxInput.value || 200);
    if (!Number.isFinite(v)) v = 200;
    v = Math.min(${hardMax}, v + step);
    maxInput.value = String(v);
    applyImportant();
  });

  maxDown.addEventListener("click", ()=>{
    let v = Number(maxInput.value || 200);
    if (!Number.isFinite(v)) v = 200;
    v = Math.max(20, v - step);
    maxInput.value = String(v);
    applyImportant();
  });

  maxInput.addEventListener("change", ()=>{
    applyImportant();
  });
})();

// init
renderGrid();
// loadAll() is now called AFTER userInfo is loaded in loadUserStatus()
renderRoller(importantSymbols);

/* ALGTP™ Access Gate — checkbox required */
(function(){
  const KEY = "ALGTP_ACCEPTED_TERMS_V1";
  const gate = document.getElementById("riskBack");
  const chk = document.getElementById("riskAgree");
  const btn = document.getElementById("riskContinueBtn");
  const err = document.getElementById("riskHint");

  // ✅ Null-check protection to prevent crashes
  if (!gate || !chk || !btn || !err) {
    console.warn("ALGTP popup: missing element id(s). Check HTML IDs.");
    return;
  }

  function openGate(){
    gate.style.display="flex";
    btn.disabled=true;
    err.style.display="none";
    chk.checked=false;
  }
  function closeGate(){
    gate.style.display="none";
    riskAccepted=true;
  }

  try{
    if (localStorage.getItem(KEY)==="true"){
      closeGate();
      return;
    }
  }catch{}

  openGate();

  chk.addEventListener("change",()=>{
    btn.disabled=!chk.checked;
    err.style.display = chk.checked ? "none" : "block";
  });

  btn.addEventListener("click",()=>{
    if (!chk.checked){
      err.style.display="block";
      return;
    }
    try{ localStorage.setItem(KEY,"true"); }catch{}
    closeGate();
  });
})();

// auto refresh
setInterval(()=>{
  if (REFRESH_MS<=0) return;
  if (riskIsOpen()) return;
  if (miniBox && miniBox.style.display==="block") return;
  loadAll();
}, REFRESH_MS);
</script>
</body>
</html>`;
}

// Stub routes for endpoints not yet implemented (PRO features)
app.get("/float-turnover", stub("float-turnover"));
app.get("/low-float-hot", stub("low-float-hot"));
app.get("/filter-rsi", stub("filter-rsi"));
app.get("/filter-rsi-reversal", stub("filter-rsi-reversal"));
app.get("/filter-macd", stub("filter-macd"));
app.get("/filter-ao", stub("filter-ao"));
app.get("/filter-ema-stack", stub("filter-ema-stack"));

// ============================================================================
// BOX 2 — /rank-rovl (composite ranking) — 🔒 PRO FEATURE
// GET /rank-rovl?cap=all&limit=120
// Rank = composite score from: ROVL(5m) + FloatTurn% + Gap% + Volume + PriceMove%
// ============================================================================
app.get("/rank-rovl", async (req, res) => {
  try {
    const cap = String(req.query.cap || "all").toLowerCase();
    const limit = clamp(Number(req.query.limit || 120), 10, 500);

    // Build a universe (choose what exists in your script)
    let out;
    if (typeof ENABLE_SNAPSHOT_ALL !== "undefined" && ENABLE_SNAPSHOT_ALL && typeof buildRowsFromSnapshotAll === "function") {
      out = await buildRowsFromSnapshotAll({ cap, limit: Math.max(250, limit * 6), session: null, sortMode: "active" });
    } else if (typeof buildRowsFromMoversUnion === "function") {
      out = await buildRowsFromMoversUnion({ cap, limit: Math.max(250, limit * 6), sortMode: "active" });
    } else {
      return res.status(500).json({ ok: false, error: "No universe builder available for /rank-rovl" });
    }

    if (!out.ok) return res.status(out.status).json(out.body);

    let rows = Array.isArray(out.body?.results) ? out.body.results : [];

    // Ensure float turnover exists
    rows = rows.map(addFloatTurnoverPct);

    // Add compositeRank using norm01
    rows = rows.map((r) => ({ ...r, compositeRank: computeCompositeRankNorm01(r) }));

    rows.sort((a, b) => (n(b.compositeRank) ?? 0) - (n(a.compositeRank) ?? 0));
    rows = rows.slice(0, limit);

    res.json({ ok: true, box: "rank-rovl", cap, results: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "/rank-rovl failed", detail: String(e?.message || e) });
  }
});

app.get("/ui", (req, res) => res.type("html").send(renderUI()));

// ============================================================================
// /user-guide — Serve User Guide as HTML
// ============================================================================
app.get("/user-guide", (req, res) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const guidePath = join(__dirname, "USER_GUIDE.md");
    const markdown = readFileSync(guidePath, "utf-8");
    
    // Convert markdown to HTML (basic conversion)
    let html = markdown
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^### (.+)$/gm, "<h3>$3</h3>")
      .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/^\\n/gm, "<br>")
      .replace(/```([^```]+)```/gs, "<pre><code>$1</code></pre>");
    
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ALGTP™ User Guide</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-dark: #0f0f1e;
      --bg-darker: #0a0a14;
      --text-light: #e8e9f3;
      --text-muted: #9ca0b4;
      --accent-purple: #9b59fe;
      --accent-cyan: #00d4ff;
      --code-bg: #1a1d2e;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, var(--bg-darker) 0%, var(--bg-dark) 100%);
      color: var(--text-light);
      line-height: 1.7;
      padding: 40px 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: rgba(20, 20, 40, 0.6);
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    h1 { font-size: 2.5rem; margin: 32px 0 24px; color: var(--accent-cyan); }
    h2 { font-size: 2rem; margin: 28px 0 20px; color: var(--accent-purple); border-bottom: 2px solid rgba(155, 89, 254, 0.3); padding-bottom: 8px; }
    h3 { font-size: 1.5rem; margin: 24px 0 16px; color: var(--accent-cyan); }
    h4 { font-size: 1.25rem; margin: 20px 0 12px; color: var(--text-light); }
    p { margin: 16px 0; color: var(--text-light); }
    code {
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
      color: var(--accent-cyan);
    }
    pre {
      background: var(--code-bg);
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 16px 0;
      border: 1px solid rgba(155, 89, 254, 0.2);
    }
    pre code {
      background: none;
      padding: 0;
      color: var(--text-light);
    }
    ul, ol { margin: 16px 0 16px 32px; }
    li { margin: 8px 0; color: var(--text-light); }
    strong { color: var(--accent-purple); font-weight: 700; }
    em { color: var(--accent-cyan); font-style: italic; }
    a { color: var(--accent-cyan); text-decoration: none; border-bottom: 1px dashed; }
    a:hover { color: var(--accent-purple); }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 12px; border: 1px solid rgba(255, 255, 255, 0.1); text-align: left; }
    th { background: rgba(155, 89, 254, 0.2); font-weight: 700; }
    .back-btn {
      display: inline-block;
      padding: 12px 24px;
      background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-cyan) 100%);
      color: white;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-bottom: 24px;
      transition: transform 0.2s;
    }
    .back-btn:hover { transform: translateY(-2px); }
  </style>
</head>
<body>
  <div class="container">
    <a href="/ui" class="back-btn">← Back to Dashboard</a>
    <pre style="white-space: pre-wrap; font-family: inherit; background: none; border: none; padding: 0;">${markdown}</pre>
  </div>
</body>
</html>`);
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load user guide", detail: String(err.message) });
  }
});

// ============================================================================
// /pricing — Pricing Page (SIMPLIFIED: Only $35.99/month)
// ============================================================================
app.get("/pricing", (req, res) => {
  const locked = req.query.locked === "1";
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ALGTP™ Pricing - Choose Your Plan</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --bg-dark: #0f0f1e;
      --bg-darker: #0a0a14;
      --text-light: #e8e9f3;
      --text-muted: #9ca0b4;
      --accent-purple: #9b59fe;
      --accent-cyan: #00d4ff;
      --accent-pink: #ff006b;
      --accent-green: #00ff87;
      --card-bg: rgba(20, 20, 40, 0.8);
      --card-border: rgba(155, 89, 254, 0.2);
      --glass: rgba(255, 255, 255, 0.05);
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, var(--bg-darker) 0%, var(--bg-dark) 50%, #1a0f2e 100%);
      color: var(--text-light);
      min-height: 100vh;
      padding: 40px 20px;
      overflow-x: hidden;
      position: relative;
    }

    /* Animated gradient background orbs */
    body::before {
      content: '';
      position: fixed;
      width: 800px;
      height: 800px;
      background: radial-gradient(circle, rgba(155, 89, 254, 0.15) 0%, transparent 70%);
      top: -200px;
      left: -200px;
      animation: float 20s ease-in-out infinite;
      z-index: 0;
    }

    body::after {
      content: '';
      position: fixed;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(0, 212, 255, 0.15) 0%, transparent 70%);
      bottom: -150px;
      right: -150px;
      animation: float 15s ease-in-out infinite reverse;
      z-index: 0;
    }

    @keyframes float {
      0%, 100% { transform: translate(0, 0); }
      50% { transform: translate(100px, -100px); }
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    header {
      text-align: center;
      margin-bottom: 60px;
    }

    h1 {
      font-size: 3.5rem;
      font-weight: 900;
      background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-cyan) 50%, var(--accent-pink) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 16px;
      letter-spacing: -2px;
    }

    .tagline {
      font-size: 1.25rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    ${locked ? `
    .locked-alert {
      background: linear-gradient(135deg, rgba(255, 0, 107, 0.1) 0%, rgba(155, 89, 254, 0.1) 100%);
      border: 2px solid rgba(255, 0, 107, 0.3);
      border-radius: 16px;
      padding: 24px;
      margin: 0 auto 40px;
      max-width: 700px;
      text-align: center;
      font-size: 1.1rem;
      font-weight: 600;
      color: #ff6b9d;
      box-shadow: 0 8px 32px rgba(255, 0, 107, 0.2);
      animation: pulse-glow 2s ease-in-out infinite;
    }

    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 8px 32px rgba(255, 0, 107, 0.2); }
      50% { box-shadow: 0 12px 48px rgba(255, 0, 107, 0.4); }
    }
    ` : ''}

    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 32px;
      margin-bottom: 60px;
    }

    .pricing-card {
      background: var(--card-bg);
      border: 2px solid var(--card-border);
      border-radius: 24px;
      padding: 40px;
      position: relative;
      backdrop-filter: blur(20px);
      transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }

    .pricing-card:hover {
      transform: translateY(-8px) scale(1.02);
      box-shadow: 0 20px 60px rgba(155, 89, 254, 0.3);
      border-color: var(--accent-purple);
    }

    .pricing-card.featured {
      border-color: var(--accent-cyan);
      box-shadow: 0 12px 48px rgba(0, 212, 255, 0.3);
      background: linear-gradient(135deg, rgba(155, 89, 254, 0.1) 0%, rgba(0, 212, 255, 0.1) 100%);
    }

    .pricing-card.featured:hover {
      box-shadow: 0 24px 72px rgba(0, 212, 255, 0.5);
      border-color: var(--accent-cyan);
    }

    .badge {
      display: inline-block;
      background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-pink) 100%);
      color: white;
      padding: 8px 16px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 20px;
    }

    .pricing-card.featured .badge {
      background: linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-green) 100%);
    }

    .plan-name {
      font-size: 1.75rem;
      font-weight: 800;
      margin-bottom: 12px;
      color: var(--text-light);
    }

    .plan-desc {
      color: var(--text-muted);
      font-size: 0.95rem;
      margin-bottom: 24px;
      line-height: 1.6;
    }

    .price {
      font-size: 3.5rem;
      font-weight: 900;
      margin: 24px 0;
      line-height: 1;
      color: var(--accent-purple);
      background-image: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-cyan) 100%);
      background-size: 100%;
      background-repeat: no-repeat;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .pricing-card.featured .price {
      color: var(--accent-cyan);
      background-image: linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-green) 100%);
      background-size: 100%;
      background-repeat: no-repeat;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .price-period {
      font-size: 1rem;
      color: var(--text-muted);
      font-weight: 600;
    }

    .features {
      list-style: none;
      margin: 32px 0;
    }

    .features li {
      padding: 12px 0;
      font-size: 0.95rem;
      color: var(--text-light);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .features li::before {
      content: '✓';
      display: inline-block;
      width: 24px;
      height: 24px;
      background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-cyan) 100%);
      color: white;
      border-radius: 50%;
      text-align: center;
      line-height: 24px;
      font-weight: 900;
      flex-shrink: 0;
    }

    .pricing-card.featured .features li::before {
      background: linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-green) 100%);
    }

    .cta-button {
      display: block;
      width: 100%;
      padding: 18px;
      border: none;
      border-radius: 16px;
      background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-pink) 100%);
      color: white;
      font-size: 1.1rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 8px 24px rgba(155, 89, 254, 0.4);
      text-decoration: none;
      text-align: center;
    }

    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(155, 89, 254, 0.6);
      background: linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-purple) 100%);
    }

    .pricing-card.featured .cta-button {
      background: linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-green) 100%);
      box-shadow: 0 8px 24px rgba(0, 212, 255, 0.4);
    }

    .pricing-card.featured .cta-button:hover {
      background: linear-gradient(135deg, var(--accent-green) 0%, var(--accent-cyan) 100%);
      box-shadow: 0 12px 32px rgba(0, 255, 135, 0.6);
    }

    footer {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    footer a {
      color: var(--accent-cyan);
      text-decoration: none;
      font-weight: 600;
      transition: color 0.2s ease;
    }

    footer a:hover {
      color: var(--accent-green);
    }

    @media (max-width: 768px) {
      h1 { font-size: 2.5rem; }
      .pricing-grid { grid-template-columns: 1fr; }
      .pricing-card { padding: 32px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🚀 ALGTP™ Pricing</h1>
      <p class="tagline">Real-Time Stock Market Scanner - Choose Your Plan</p>
      ${req.isAuthenticated() ? `
        <p style="margin-top: 20px; color: var(--accent-green); font-weight: 600;">
          ✓ Logged in as ${req.user?.email || 'User'}
          <a href="/logout" style="margin-left: 16px; color: var(--accent-cyan); text-decoration: none;">Logout</a>
        </p>
      ` : `
        <div style="margin-top: 24px;">
          <a href="/auth/google" style="display: inline-block; padding: 14px 32px; background: white; color: #1a1a1a; border-radius: 12px; text-decoration: none; font-weight: 700; box-shadow: 0 4px 16px rgba(255,255,255,0.2); transition: all 0.3s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 24px rgba(255,255,255,0.3)'" onmouseout="this.style.transform=''; this.style.boxShadow='0 4px 16px rgba(255,255,255,0.2)'">
            <span style="font-size: 1.2rem; margin-right: 8px;">🔐</span>
            Sign in with Google
          </a>
          <p style="margin-top: 12px; font-size: 0.9rem; color: var(--text-muted);">Login to start your 14-day free trial</p>
        </div>
      `}
    </header>

    ${locked ? '<div class="locked-alert">🔒 Your access has expired. Please subscribe to continue using ALGTP™.</div>' : ''}

    <div class="pricing-grid">
      <!-- Basic Plan -->
      <div class="pricing-card">
        <span class="badge">Starter</span>
        <h2 class="plan-name">BASIC</h2>
        <p class="plan-desc">Essential features for beginner traders</p>
        <div class="price">
          $35.99
          <span class="price-period">/ month</span>
        </div>
        <ul class="features">
          <li>Real-time market data</li>
          <li>Basic scanners</li>
          <li>Premarket & After-hours data</li>
          <li>Gap % tracking</li>
          <li>Up to 200 symbol scans</li>
          <li>Email support</li>
        </ul>
        <a href="/stripe/checkout?plan=basic" class="cta-button">Get Started</a>
      </div>

      <!-- Pro Plan (Featured) -->
      <div class="pricing-card featured">
        <span class="badge">Most Popular</span>
        <h2 class="plan-name">PRO</h2>
        <p class="plan-desc">Advanced tools for serious traders</p>
        <div class="price">
          $45.99
          <span class="price-period">/ month</span>
        </div>
        <ul class="features">
          <li>Everything in Basic</li>
          <li>Technical indicators (EMA, SMA, VWAP)</li>
          <li>RSI, MACD, Awesome Oscillator</li>
          <li>Float turnover analysis</li>
          <li>Advanced filters</li>
          <li>Trading halt monitoring (LULD)</li>
          <li>Up to 500 symbol scans</li>
          <li>Priority email support</li>
        </ul>
        <a href="/stripe/checkout?plan=pro" class="cta-button">Subscribe Now</a>
      </div>

      <!-- Premium Plan -->
      <div class="pricing-card">
        <span class="badge">Elite</span>
        <h2 class="plan-name">PREMIUM</h2>
        <p class="plan-desc">Ultimate power for professional traders</p>
        <div class="price">
          $55.99
          <span class="price-period">/ month</span>
        </div>
        <ul class="features">
          <li>Everything in Pro</li>
          <li>Composite ranking algorithms</li>
          <li>Custom watchlists</li>
          <li>Multi-timeframe analysis</li>
          <li>Advanced chart overlays</li>
          <li>Unlimited symbol scans</li>
          <li>API access (coming soon)</li>
          <li>Priority support & onboarding</li>
        </ul>
        <a href="/stripe/checkout?plan=premium" class="cta-button">Go Premium</a>
      </div>
    </div>

    <footer>
      <p>🔒 Secure payment powered by Stripe • Cancel anytime, no questions asked</p>
      <p style="margin-top: 16px;">
        <a href="/ui">← Back to Dashboard</a>
      </p>
    </footer>
  </div>
</body>
</html>`);
});

// ============================================================================
// /box/* — PRO Box Endpoints
// ============================================================================
app.get("/box/fmp-intraday-1m-scan", stub("box/fmp-intraday-1m-scan"));
app.get("/box/rank-rovl", stub("box/rank-rovl"));

// ============================================================================
// Analytics API Endpoints
// ============================================================================

// POST /analytics/event - Track user events
app.post("/analytics/event", (req, res) => {
  try {
    const u = req.user;
    const body = req.body || {};

    const evt = {
      ts: Date.now(),
      userId: u?.id || u?.email || null,
      email: u?.email || null,
      tier: getUserTier(u),
      event: String(body.event || "unknown"),
      page: String(body.page || ""),
      featureId: body.featureId ? String(body.featureId) : null,
      symbol: body.symbol ? String(body.symbol) : null,
      meta: body.meta && typeof body.meta === "object" ? body.meta : null,
      ip: req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket.remoteAddress || null,
      ua: req.headers["user-agent"] || null,
    };

    pushEvent(evt);
    
    // Light console logging for debugging
    if (DEBUG) {
      dlog(`📊 Analytics: ${evt.tier} | ${evt.event} | ${evt.featureId || evt.page}`);
    }
    
    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ Analytics event failed:", e.message);
    return res.status(500).json({ ok: false, error: "Failed to log event" });
  }
});

// GET /analytics/recent?limit=200 - View recent events
app.get("/analytics/recent", (req, res) => {
  try {
    const limit = Math.max(10, Math.min(2000, Number(req.query.limit || 200)));
    const out = analyticsEvents.slice(-limit).reverse();
    
    res.json({
      ok: true,
      count: out.length,
      total: analyticsEvents.length,
      results: out,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Failed to fetch events" });
  }
});

// GET /analytics/summary - Analytics dashboard
app.get("/analytics/summary", (req, res) => {
  try {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const last24h = analyticsEvents.filter(e => e.ts >= dayAgo);
    const last7d = analyticsEvents.filter(e => e.ts >= weekAgo);

    // 24-hour aggregations
    const byEvent24h = {};
    const byFeature24h = {};
    const byEmail24h = {};
    const byTier24h = {};

    for (const e of last24h) {
      byEvent24h[e.event] = (byEvent24h[e.event] || 0) + 1;
      if (e.featureId) byFeature24h[e.featureId] = (byFeature24h[e.featureId] || 0) + 1;
      if (e.email) byEmail24h[e.email] = (byEmail24h[e.email] || 0) + 1;
      byTier24h[e.tier] = (byTier24h[e.tier] || 0) + 1;
    }

    // 7-day aggregations
    const byEvent7d = {};
    const byFeature7d = {};

    for (const e of last7d) {
      byEvent7d[e.event] = (byEvent7d[e.event] || 0) + 1;
      if (e.featureId) byFeature7d[e.featureId] = (byFeature7d[e.featureId] || 0) + 1;
    }

    // Top features by usage
    const topFeatures24h = Object.entries(byFeature24h)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([feature, count]) => ({ feature, count }));

    // Top users by activity
    const topUsers24h = Object.entries(byEmail24h)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([email, count]) => ({ email, count }));

    // Most active events
    const topEvents24h = Object.entries(byEvent24h)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([event, count]) => ({ event, count }));

    res.json({
      ok: true,
      summary: {
        last24h: {
          totalEvents: last24h.length,
          uniqueUsers: Object.keys(byEmail24h).length,
          byTier: byTier24h,
          topEvents: topEvents24h,
          topFeatures: topFeatures24h,
          topUsers: topUsers24h,
        },
        last7d: {
          totalEvents: last7d.length,
          topEvents: Object.entries(byEvent7d)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([event, count]) => ({ event, count })),
          topFeatures: Object.entries(byFeature7d)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([feature, count]) => ({ feature, count })),
        },
        allTime: {
          totalEvents: analyticsEvents.length,
          maxCapacity: ANALYTICS_MAX,
        },
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Failed to generate summary" });
  }
});

// ============================================================================
// Google OAuth Routes (only if OAuth is configured)
// ============================================================================
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  app.get('/auth/google', (req, res, next) => {
    console.log("🔵 OAUTH START callbackURL =", GOOGLE_CALLBACK_URL);
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  app.get('/auth/google/callback', (req, res, next) => {
    console.log("🔴 OAUTH CALLBACK callbackURL =", GOOGLE_CALLBACK_URL);
    console.log("🔍 Query params:", req.query);
    console.log("🔍 Full URL:", req.protocol + '://' + req.get('host') + req.originalUrl);
    console.log("🔍 Session ID before auth:", req.sessionID);
    
    passport.authenticate('google', (err, user, info) => {
      if (err) {
        console.error('❌ OAuth callback error:', err);
        console.error('Error details:', JSON.stringify(err, null, 2));
        return res.redirect('/pricing?error=oauth');
      }
      if (!user) {
        console.error('❌ OAuth callback - no user:', info);
        return res.redirect('/pricing?error=auth_failed');
      }
      
      // CRITICAL: Establish session with req.logIn
      req.logIn(user, (e) => {
        if (e) {
          console.error('❌ req.logIn error:', e);
          console.error('Session error stack:', e.stack);
          return res.redirect('/pricing?error=session');
        }
        console.log('✅ User logged in successfully:', user.email);
        console.log('✅ Session ID after login:', req.sessionID);
        console.log('✅ Session user:', req.user?.id, req.user?.email);
        return res.redirect('/ui');
      });
    })(req, res, next);
  });

  app.get('/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.redirect('/ui');
      }
      res.redirect('/pricing');
    });
  });
} else {
  // Fallback routes when OAuth is disabled
  app.get('/auth/google', (req, res) => {
    res.status(503).json({ ok: false, error: 'OAuth not configured' });
  });
  
  app.get('/auth/google/callback', (req, res) => {
    res.redirect('/pricing?error=oauth_disabled');
  });
  
  app.get('/logout', (req, res) => {
    res.redirect('/pricing');
  });
}

// ============================================================================
// Admin Local Login (Bypass Google OAuth)
// ============================================================================
app.get("/admin/login", (req, res) => {
  if (!adminGuard(req, res)) return;

  res.type("html").send(`<!doctype html>
  <html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Admin Login</title></head>
  <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#e6e8ef;font-family:system-ui">
    <form method="POST" action="/admin/login" style="width:min(520px,92vw);background:#121622;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:22px">
      <div style="font-weight:900;font-size:18px">🔐 Admin Login</div>
      <div style="margin-top:8px;font-size:12px;color:#a7adc2">Local admin login (no Google)</div>
      <input name="email" type="email" placeholder="admin email" required
        style="width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#0f1320;color:#e6e8ef;margin-top:12px"/>
      <input name="password" type="password" placeholder="password" required
        style="width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#0f1320;color:#e6e8ef;margin-top:10px"/>
      <button type="submit"
        style="margin-top:12px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#4ade80;color:#0b0d12;font-weight:800;cursor:pointer;width:100%">
        Login
      </button>
      <div style="margin-top:10px;font-size:12px;color:#a7adc2">Disable by setting ENABLE_ADMIN_LOGIN=false</div>
    </form>
  </body></html>`);
});

app.post("/admin/login", express.urlencoded({ extended: false }), async (req, res) => {
  if (!adminGuard(req, res)) return;
  if (!ADMIN_PASSWORD_HASH) return res.status(500).send("ADMIN_PASSWORD_HASH missing");

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (email !== ADMIN_EMAIL) return res.status(401).send("Unauthorized");
  const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!ok) return res.status(401).send("Unauthorized");

  // Ensure admin user exists
  let user = await getUserByEmail(email);
  if (!user) {
    const now = Date.now();
    user = await createUser({
      googleId: `admin-${email}`,
      email,
      name: "Admin",
      avatar: null,
      tier: "PRO",
      freeStartAt: now,
      freeUntil: now + (365 * 24 * 60 * 60 * 1000), // 1 year
    });
    // Mark as paid PRO user
    await updateUser(user.id, {
      isPaid: true,
      paidUntil: now + (365 * 24 * 60 * 60 * 1000),
      tier: "PRO"
    });
    user = await getUserById(user.id);
  }

  // IMPORTANT: Create session same as Google login
  req.login(user, (err) => {
    if (err) {
      console.error("Admin req.login error:", err);
      return res.status(500).send("Login failed");
    }

    // ✅ Mark this session as ADMIN and set expiry time
    req.session.isAdmin = true;
    req.session.adminLoginAt = Date.now();
    req.session.adminUserId = user.id; // Store original admin ID for impersonation restore

    console.log("✅ Admin logged in:", user.email);
    return res.redirect("/ui");
  });
});

app.get("/admin/logout", (req, res) => {
  if (!ENABLE_ADMIN_LOGIN) return res.status(404).send("Not found");
  req.logout((err) => {
    if (err) console.error("Admin logout error:", err);
    req.session?.destroy(() => res.redirect("/pricing"));
  });
});

// ============================================================================
// Admin: Session Info (Countdown to auto-logout)
// ============================================================================
app.get("/admin/session", (req, res) => {
  const isAdmin = Boolean(req.session?.isAdmin);
  const at = Number(req.session?.adminLoginAt || 0);
  const now = Date.now();
  const msLeft = isAdmin && at ? Math.max(0, (at + ADMIN_SESSION_TTL_MS) - now) : 0;
  res.json({ ok: true, isAdmin, msLeft });
});

// ============================================================================
// Admin: Impersonate User (Test BASIC/PRO)
// ============================================================================
app.get("/admin/impersonate", requireAdmin, async (req, res) => {
  if (!ENABLE_ADMIN_IMPERSONATE) return res.status(404).send("Not found");

  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).send("email required");

  const target = await getUserByEmail(email);
  if (!target) return res.status(404).send("user not found");

  // Save original admin user ID before impersonation (if not already impersonating)
  if (!req.session.adminUserId) {
    req.session.adminUserId = req.user.id;
  }

  req.login(target, (err) => {
    if (err) return res.status(500).send("impersonate failed");
    // Keep admin flag and timestamp so session doesn't expire
    req.session.isAdmin = true;
    console.log(`✅ Admin impersonating: ${target.email}`);
    return res.redirect("/ui?impersonated=1");
  });
});

// Admin: Stop impersonation (restore original admin account)
app.get("/admin/stop-impersonate", async (req, res) => {
  const adminUserId = Number(req.session?.adminUserId || 0);
  
  if (!adminUserId) {
    // No saved admin ID, just redirect to admin login
    return res.redirect("/admin/login");
  }

  // Restore original admin user
  const adminUser = await getUserById(adminUserId);
  if (!adminUser) {
    console.error("⚠️  Admin user not found:", adminUserId);
    return res.redirect("/admin/login");
  }

  req.login(adminUser, (err) => {
    if (err) {
      console.error("Stop impersonate error:", err);
      return res.redirect("/admin/login");
    }
    // Restore admin flags
    req.session.isAdmin = true;
    console.log("✅ Admin restored:", adminUser.email);
    return res.redirect("/ui?admin_restored=1");
  });
});

// ============================================================================
// Watchlist API Endpoints
// ============================================================================

// GET /watchlist - Get user's watchlist (no login required - uses session or returns empty)
app.get("/watchlist", async (req, res) => {
  try {
    // No login required - return empty list for guests
    if (!req.user?.id) {
      return res.json({ ok: true, max: WATCHLIST_MAX, count: 0, symbols: [], message: "No watchlist (guest mode)" });
    }
    const userId = Number(req.user.id);
    const list = await getWatchlist(userId);
    res.json({ ok: true, max: WATCHLIST_MAX, count: list.length, symbols: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: "WATCHLIST_GET_FAILED", detail: String(e?.message || e) });
  }
});

// POST /watchlist/add - Add symbol to watchlist (no login required - uses localStorage)
app.post("/watchlist/add", async (req, res) => {
  try {
    // No login required - return success but explain it's client-side only
    if (!req.user?.id) {
      return res.json({ ok: true, message: "Use client-side localStorage for watchlist (no account required)", symbols: [], count: 0, max: WATCHLIST_MAX });
    }
    const userId = Number(req.user.id);
    const symbol = normSym(req.body?.symbol);

    if (!symbol) return res.status(400).json({ ok: false, error: "SYMBOL_REQUIRED" });
    if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return res.status(400).json({ ok: false, error: "INVALID_SYMBOL" });

    const count = await getWatchlistCount(userId);
    if (count >= WATCHLIST_MAX) {
      return res.status(400).json({ ok: false, error: "WATCHLIST_FULL", max: WATCHLIST_MAX });
    }

    await addToWatchlist(userId, symbol);
    const list = await getWatchlist(userId);
    return res.json({ ok: true, symbols: list, count: list.length, max: WATCHLIST_MAX });
  } catch (e) {
    res.status(500).json({ ok: false, error: "WATCHLIST_ADD_FAILED", detail: String(e?.message || e) });
  }
});

// POST /watchlist/remove - Remove symbol from watchlist (no login required)
app.post("/watchlist/remove", async (req, res) => {
  try {
    // No login required - return success but explain it's client-side only
    if (!req.user?.id) {
      return res.json({ ok: true, message: "Use client-side localStorage for watchlist (no account required)", symbols: [], count: 0, max: WATCHLIST_MAX });
    }
    const userId = Number(req.user.id);
    const symbol = normSym(req.body?.symbol);

    if (!symbol) return res.status(400).json({ ok: false, error: "SYMBOL_REQUIRED" });

    await removeFromWatchlist(userId, symbol);
    const list = await getWatchlist(userId);
    return res.json({ ok: true, symbols: list, count: list.length, max: WATCHLIST_MAX });
  } catch (e) {
    res.status(500).json({ ok: false, error: "WATCHLIST_REMOVE_FAILED", detail: String(e?.message || e) });
  }
});

// POST /watchlist/clear - Clear entire watchlist (no login required)
app.post("/watchlist/clear", async (req, res) => {
  try {
    // No login required - return success but explain it's client-side only
    if (!req.user?.id) {
      return res.json({ ok: true, message: "Use client-side localStorage for watchlist (no account required)", symbols: [], count: 0, max: WATCHLIST_MAX });
    }
    const userId = Number(req.user.id);
    await clearWatchlist(userId);
    return res.json({ ok: true, symbols: [], count: 0, max: WATCHLIST_MAX });
  } catch (e) {
    res.status(500).json({ ok: false, error: "WATCHLIST_CLEAR_FAILED", detail: String(e?.message || e) });
  }
});

// GET /watchlist/scan - Scan user's watchlist and return formatted data for UI (no login required)
app.get("/watchlist/scan", async (req, res) => {
  try {
    // No login required - use IMPORTANT_SYMBOLS for guests
    if (!req.user?.id) {
      const defaultSymbols = parseSymbols(IMPORTANT_SYMBOLS || "NVDA,TSLA,AAPL,AMD,META");
      const out = await runScanForSymbols(defaultSymbols, defaultSymbols.length);
      return res.json({ ok: true, count: defaultSymbols.length, results: out.rows, message: "Using default symbols (no account required)" });
    }
    const userId = Number(req.user.id);
    const wl = await getWatchlist(userId);
    
    if (!wl.length) {
      return res.json({ ok: true, count: 0, results: [], message: "Watchlist is empty" });
    }
    
    const symbols = wl.slice(0, 100);
    const out = await runScanForSymbols(symbols, symbols.length);
    
    res.json({
      ok: true,
      count: symbols.length,
      results: out.rows,
      aggsErrors: DEBUG ? out.aggsErrors?.slice(0, 10) : undefined
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "WATCHLIST_SCAN_FAILED", detail: String(e?.message || e) });
  }
});

// ============================================================================
// Stripe Checkout Session Creation
// ============================================================================
app.get("/stripe/checkout", async (req, res) => {
  try {
    // Get plan from query parameter (default to pro)
    const requestedPlan = String(req.query.plan || "pro").toLowerCase();
    const validPlans = ["basic", "pro", "premium"];
    const plan = validPlans.includes(requestedPlan) ? requestedPlan : "pro";
    
    const priceId = PLAN_PRICE_MAP[plan];

    if (!priceId) {
      console.error(`❌ Missing STRIPE priceId for ${plan.toUpperCase()} plan`);
      console.error(`   Available plans:`, Object.keys(PLAN_PRICE_MAP));
      console.error(`   PLAN_PRICE_MAP:`, PLAN_PRICE_MAP);
      return res.redirect(`/pricing?error=price_not_configured&plan=${plan}`);
    }

    // fetch price to detect recurring vs one-time
    let priceObj;
    try {
      priceObj = await stripe.prices.retrieve(priceId);
    } catch (e) {
      console.error("❌ prices.retrieve failed:", e?.message || e);
      return res.redirect("/pricing?error=price_lookup_failed");
    }

    if (!priceObj.active) {
      console.error(`❌ Price inactive: ${priceId}`);
      return res.redirect("/pricing?error=price_inactive");
    }

    const mode = priceObj.recurring ? "subscription" : "payment";

    const session = await stripe.checkout.sessions.create({
      mode,
      customer_email: req.user?.email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/ui?checkout=success&plan=${plan}`,
      cancel_url: `${APP_URL}/pricing?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: {
        userId: req.user?.id || req.user?.email || "unknown",
        plan: plan,
        tier: plan.toUpperCase(),
      },
    });

    // optional analytics log
    try {
      pushEvent({
        ts: Date.now(),
        userId: req.user?.id || req.user?.email || null,
        email: req.user?.email || null,
        tier: getUserTier(req.user),
        event: "checkout_initiated",
        page: "/stripe/checkout",
        featureId: null,
        symbol: null,
        meta: { plan, mode, priceId },
        ip: req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket.remoteAddress || null,
        ua: req.headers["user-agent"] || null,
      });
    } catch {}

    // 🔥 FIX: Use window.open for TradingView embedded browser compatibility
    return res.type("html").send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="referrer" content="no-referrer">
  <title>Redirecting to Stripe Checkout...</title>
  <style>
    body { font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f0f1e; color: #e8e9f3; }
    .loader { text-align: center; }
    .spinner { border: 3px solid rgba(255,255,255,.1); border-top-color: #9b59fe; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .button { margin-top: 20px; padding: 12px 24px; background: #9b59fe; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; text-decoration: none; display: inline-block; }
    .button:hover { background: #8a4ae6; }
    .note { font-size: 14px; color: #888; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>Opening secure checkout...</p>
    <p class="note">If the checkout doesn't open automatically:</p>
    <button class="button" onclick="openCheckout()">Click here to open checkout</button>
  </div>
  <script>
    const checkoutUrl = ${JSON.stringify(session.url)};
    
    function openCheckout() {
      // Try window.open first (works better in embedded browsers like TradingView)
      const win = window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
      if (win) {
        // Check if popup was blocked
        setTimeout(() => {
          if (!win || win.closed || typeof win.closed === 'undefined') {
            // Popup blocked, fall back to direct navigation
            window.location.href = checkoutUrl;
          }
        }, 100);
      } else {
        // Fallback to direct navigation
        window.location.href = checkoutUrl;
      }
    }
    
    // Auto-open after 1 second
    setTimeout(openCheckout, 1000);
  </script>
</body>
</html>`);
  } catch (e) {
    console.error("❌ Stripe Checkout error:", e?.message || e);
    return res.status(500).send(`Checkout error: ${e?.message || e}`);
  }
});

// ============================================================================
// Stripe Customer Portal (Upgrade/Downgrade/Cancel)
// ============================================================================
app.post("/stripe/portal", async (req, res) => {
  try {
    const u = req.user;
    
    // Check if Stripe is initialized
    if (!stripe) {
      console.error("❌ Stripe not initialized. Check STRIPE_SECRET_KEY in .env");
      return res.redirect("/pricing?error=stripe_not_configured");
    }
    
    // Check if user has a Stripe customer ID
    if (!u?.stripe_customer_id) {
      console.warn("⚠️  User has no Stripe customer ID:", u?.email);
      return res.redirect("/pricing?no_customer=1");
    }
    
    // Create Billing Portal session
    const portal = await stripe.billingPortal.sessions.create({
      customer: u.stripe_customer_id,
      return_url: STRIPE_PORTAL_RETURN_URL || `${APP_URL}/pricing`,
    });
    
    // Track portal access
    pushEvent({
      ts: Date.now(),
      userId: u?.id || u?.email || null,
      email: u?.email || null,
      tier: getUserTier(u),
      event: "stripe_portal_accessed",
      page: "/stripe/portal",
      featureId: null,
      symbol: null,
      meta: { customerId: u.stripe_customer_id },
      ip: req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket.remoteAddress || null,
      ua: req.headers["user-agent"] || null,
    });
    
    // Log portal access
    if (DEBUG) {
      dlog(`💳 Stripe Portal: ${u.email} → ${portal.url}`);
    }
    
    // 🔥 FIX: Use window.open for TradingView embedded browser compatibility
    return res.type("html").send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="referrer" content="no-referrer">
  <title>Redirecting to Stripe Portal...</title>
  <style>
    body { font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f0f1e; color: #e8e9f3; }
    .loader { text-align: center; }
    .spinner { border: 3px solid rgba(255,255,255,.1); border-top-color: #9b59fe; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .button { margin-top: 20px; padding: 12px 24px; background: #9b59fe; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; text-decoration: none; display: inline-block; }
    .button:hover { background: #8a4ae6; }
    .note { font-size: 14px; color: #888; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>Opening billing portal...</p>
    <p class="note">If the portal doesn't open automatically:</p>
    <button class="button" onclick="openPortal()">Click here to open portal</button>
  </div>
  <script>
    const portalUrl = ${JSON.stringify(portal.url)};
    
    function openPortal() {
      // Try window.open first (works better in embedded browsers like TradingView)
      const win = window.open(portalUrl, '_blank', 'noopener,noreferrer');
      if (win) {
        // Check if popup was blocked
        setTimeout(() => {
          if (!win || win.closed || typeof win.closed === 'undefined') {
            // Popup blocked, fall back to direct navigation
            window.location.href = portalUrl;
          }
        }, 100);
      } else {
        // Fallback to direct navigation
        window.location.href = portalUrl;
      }
    }
    
    // Auto-open after 1 second
    setTimeout(openPortal, 1000);
  </script>
</body>
</html>`);
  } catch (e) {
    console.error("❌ Stripe Portal error:", e.message);
    res.status(500).send(`Portal error: ${e.message}`);
  }
});

// ============================================================================
// DEBUG: Session Info Endpoint (no auth required for debugging)
// ============================================================================
app.get("/debug/session", (req, res) => {
  res.json({
    ok: true,
    hasUser: Boolean(req.user),
    userEmail: req.user?.email || null,
    userId: req.user?.id || null,
    sessionID: req.sessionID || null,
    cookie: req.headers.cookie || null,
    isAuthenticated: req.isAuthenticated ? req.isAuthenticated() : false,
  });
});

// ============================================================================
// /me — User Info Endpoint (for Feature Toggle System)
// ============================================================================
app.get("/me", (req, res) => {
  // No authentication required - return free access for all
  res.json({
    ok: true,
    email: null,
    name: "Guest",
    avatar: null,
    tier: "FREE",
    mode: "FREE",
    accessUntil: 0,
    msLeft: 0,
    daysLeft: 0,
    hoursLeft: 0,
    totalHoursLeft: 0,
    allowedBoxes: null, // All boxes accessible
    isPaid: true, // Grant full access
    paidUntil: 0,
  });
});

// --------------------------------------------------------------------------
// Random Demo Routes
// --------------------------------------------------------------------------
app.get("/random/fortune", (req, res) => {
  const fortunes = [
    "The market rewards patience and punishes impatience.",
    "A rising tide lifts all boats, but not all boats are seaworthy.",
    "Buy the rumor, sell the news.",
    "The trend is your friend until it ends.",
    "Markets can remain irrational longer than you can remain solvent."
  ];
  const random = fortunes[Math.floor(Math.random() * fortunes.length)];
  res.json({ ok: true, fortune: random, timestamp: Date.now() });
});

app.get("/random/dice", (req, res) => {
  const count = Math.max(1, Math.min(10, Number(req.query.count || 1)));
  const dice = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
  const sum = dice.reduce((a, b) => a + b, 0);
  res.json({ ok: true, count, dice, sum });
});

app.get("/random/color", (req, res) => {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  res.json({ ok: true, rgb: { r, g, b }, hex });
});

app.get("/random/sentiment", (req, res) => {
  const sentiments = ["bullish", "bearish", "neutral", "cautiously optimistic", "extremely volatile"];
  const confidence = Math.floor(Math.random() * 100) + 1;
  const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
  res.json({ ok: true, sentiment, confidence: `${confidence}%`, timestamp: new Date().toISOString() });
});

app.get("/random/emoji", (req, res) => {
  const emojis = ["🚀", "🔥", "💎", "📈", "📉", "💰", "🐻", "🐂", "🌙", "⭐"];
  const count = Math.max(1, Math.min(50, Number(req.query.count || 5)));
  const result = Array.from({ length: count }, () => emojis[Math.floor(Math.random() * emojis.length)]);
  res.json({ ok: true, emojis: result, count: result.length });
});


// ============================================================================
// SECTION 14 — Start WebSockets + Listen
// ============================================================================
startHaltWebSocket();
startAMWebSocket();

// Helper function to try starting server with port fallback
function startServer(port, maxAttempts = 10) {
  const server = app.listen(port)
    .on('listening', () => {
      const actualPort = server.address().port;
      const renderUrl =
        process.env.RENDER_EXTERNAL_URL ||               
        process.env.PUBLIC_URL ||                        
        "";

      const base = renderUrl
        ? renderUrl.replace(/\/+$/, "")
        : `http://localhost:${actualPort}`;

      console.log(`\n✅ ${BRAND.legal} running`);
      if (actualPort !== PORT) {
        console.log(`⚠️  Port ${PORT} was in use, using port ${actualPort} instead`);
      }
      console.log(`🚀 UI: ${base}/ui`);
      console.log(`📈 Mini chart: ${base}/mini-chart?symbol=AAPL&tf=1`);
      console.log(`⛔ Halts: ${base}/halts`);
      console.log(`📌 Movers Premarket: ${base}/movers-premarket?limit=50`);
      console.log(`📌 Movers After-hours: ${base}/movers-afterhours?limit=50`);
      console.log(`ℹ️ API: ${base}/api`);
      console.log("");
    })
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        const nextPort = port + 1;
        if (maxAttempts > 1) {
          console.log(`❌ Port ${port} is in use, trying ${nextPort}...`);
          server.close();
          startServer(nextPort, maxAttempts - 1);
        } else {
          console.error(`\n❌ Unable to find an available port after multiple attempts.`);
          console.error(`💡 To fix: Kill the existing process or specify a different PORT in .env\n`);
          console.error(`   Find process: lsof -ti:${PORT}`);
          console.error(`   Kill process: kill -9 $(lsof -ti:${PORT})\n`);
          process.exit(1);
        }
      } else {
        console.error(`\n❌ Server error:`, err.message);
        process.exit(1);
      }
    });
}

startServer(PORT);
