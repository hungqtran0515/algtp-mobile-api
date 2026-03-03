// ============================================================================
// 🔥 ALGTP™ — Single Ticker BoxEngine (5 Domains Check + Rate + History)
// Single-file Node.js (ESM)
// ----------------------------------------------------------------------------
// UI:   /ui
// API:  /check?symbol=AAPL
// ----------------------------------------------------------------------------
// Data Sources:
// - Massive snapshot: price/volume
// - Polygon daily aggs: RTH open + prev close => Gap%
// - FMP shares-float: float shares => Float Turnover %
// - Massive aggs 5m: RSI, MACD, EMA(9/34/50), AO
// ----------------------------------------------------------------------------
// Domains (5):
// 1) Float Turnover %   = (Volume / FloatShares) * 100   >= TURNOVER_MIN_PCT
// 2) Volume Spike       = volRatio_5m                    >= VOLRATIO_MIN
// 3) RSI (len=14)       = RSI_BULL_MIN <= RSI <= RSI_OVERBOUGHT
// 4) MACD               = MACD > SIGNAL
// 5) AO + EMA Stack      AO > 0 & rising AND EMA9>EMA34>EMA50
// ============================================================================

import "dotenv/config";
import express from "express";
import axios from "axios";

// ============================================================================
// SECTION 01 — ENV / CONFIG
// ============================================================================
const PORT = Number(process.env.PORT || 3000);
const DEBUG = String(process.env.DEBUG || "true").toLowerCase() === "true";

// Massive
const MASSIVE_API_KEY = String(process.env.MASSIVE_API_KEY || "").trim();
const MASSIVE_AUTH_TYPE = String(process.env.MASSIVE_AUTH_TYPE || "query").trim(); // query | xapi | bearer
const MASSIVE_QUERY_KEYNAME = String(process.env.MASSIVE_QUERY_KEYNAME || "apiKey").trim();
const MASSIVE_TICKER_SNAPSHOT_URL = String(
  process.env.MASSIVE_TICKER_SNAPSHOT_URL || "https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers"
).trim();
const MASSIVE_AGGS_URL = String(process.env.MASSIVE_AGGS_URL || "https://api.massive.com/v2/aggs/ticker").trim();

// Polygon (for RTH open/prevClose gap)
const POLYGON_BASE_URL = String(process.env.POLYGON_BASE_URL || "https://api.polygon.io").trim();
const POLYGON_API_KEY = String(process.env.POLYGON_API_KEY || "").trim();

// FMP (float)
const FMP_API_KEY = String(process.env.FMP_API_KEY || "").trim();

// Check settings
const CHECK_TF = String(process.env.CHECK_TF || "5").trim(); // default 5m
const CHECK_LIMIT = clamp(Number(process.env.CHECK_LIMIT || 200), 80, 800);

// Thresholds
const TURNOVER_MIN_PCT = Number(process.env.TURNOVER_MIN_PCT || 0.25); // %
const VOLRATIO_MIN = Number(process.env.VOLRATIO_MIN || 1.8);

const RSI_LEN = clamp(Number(process.env.RSI_LEN || 14), 5, 50);
const RSI_BULL_MIN = Number(process.env.RSI_BULL_MIN || 50);
const RSI_OVERBOUGHT = Number(process.env.RSI_OVERBOUGHT || 75);

const MACD_FAST = clamp(Number(process.env.MACD_FAST || 12), 2, 50);
const MACD_SLOW = clamp(Number(process.env.MACD_SLOW || 26), 5, 120);
const MACD_SIGNAL = clamp(Number(process.env.MACD_SIGNAL || 9), 2, 50);

const EMA_1 = 9, EMA_2 = 34, EMA_3 = 50;

// Safety: minimal env checks
if (!MASSIVE_API_KEY) {
  console.error("❌ Missing MASSIVE_API_KEY");
  process.exit(1);
}
if (!MASSIVE_TICKER_SNAPSHOT_URL || !MASSIVE_AGGS_URL) {
  console.error("❌ Missing Massive URLs: MASSIVE_TICKER_SNAPSHOT_URL / MASSIVE_AGGS_URL");
  process.exit(1);
}

// ============================================================================
// SECTION 02 — App + Helpers
// ============================================================================
const app = express();
app.use(express.json());

function dlog(...args) {
  if (DEBUG) console.log(...args);
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
  headers["accept"] = headers["accept"] || "application/json";

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
function ymd(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function normalizeSymbol(sym) {
  return String(sym || "").trim().toUpperCase();
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
// SECTION 04 — Massive (Snapshot + Aggs)
// ============================================================================
async function fetchTickerSnapshot(ticker) {
  const base = MASSIVE_TICKER_SNAPSHOT_URL.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(normalizeSymbol(ticker))}`;
  const a = auth({}, {});
  const r = await safeGet(url, { params: a.params, headers: a.headers });
  return { ok: r.ok, url, status: r.status, data: r.data, errorDetail: r.errorDetail };
}

const aggsCache = new Map(); // key -> {ts, bars}
async function fetchAggs(sym, tf = "5", limit = 200, sort = "asc") {
  const ticker = normalizeSymbol(sym);
  const cacheKey = `${ticker}|${tf}|${sort}|${limit}`;
  const now = Date.now();
  const hit = aggsCache.get(cacheKey);
  if (hit && now - hit.ts < 15_000) return { ok: true, cached: true, bars: hit.bars };

  const base = MASSIVE_AGGS_URL.replace(/\/+$/, "");
  const to = ymd(new Date());
  const from = ymd(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
  const url = `${base}/${encodeURIComponent(ticker)}/range/${encodeURIComponent(tf)}/minute/${from}/${to}`;

  const params = { adjusted: "true", sort: String(sort), limit: String(limit), includePrePost: "true" };
  const a = auth(params, {});
  const r = await safeGet(url, { params: a.params, headers: a.headers });
  const bars = Array.isArray(r.data?.results) ? r.data.results : [];
  const ok = r.ok && bars.length > 0;
  if (ok) aggsCache.set(cacheKey, { ts: now, bars });
  return { ok, url, status: r.status, bars, errorDetail: r.errorDetail };
}

// ============================================================================
// SECTION 05 — Normalize Snapshot
// ============================================================================
function findFirstNumberByKeys(obj, candidateKeys, maxNodes = 4000) {
  if (!obj || typeof obj !== "object") return null;
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
        if (num !== null) return num;
      }
      if (val && typeof val === "object") q.push({ v: val });
    }
  }
  return null;
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
  let volume = n(day?.v ?? day?.volume ?? root?.volume ?? root?.dayVolume) ?? null;
  let prevClose = prevClose0;

  if (price === null) price = findFirstNumberByKeys(root, ["price", "last", "p", "c", "close"]);
  if (prevClose === null) prevClose = findFirstNumberByKeys(root, ["prevclose", "previousclose", "pc"]);
  if (volume === null) volume = findFirstNumberByKeys(root, ["volume", "v"]);

  const pricePct =
    (price !== null && prevClose !== null && prevClose > 0) ? round2(((price - prevClose) / prevClose) * 100) : null;

  return {
    symbol: normalizeSymbol(ticker),
    price: price !== null ? round2(price) : null,
    prevClose: prevClose !== null ? round2(prevClose) : null,
    volume: volume !== null ? Math.round(volume) : null,
    pricePct,
    gapPct: null, // overwritten by Polygon
    open: null,   // overwritten by Polygon
    floatShares: null, // enriched by FMP
    floatM: null,
    floatTurnoverPct: null,
  };
}

function addFloatTurnoverPct(row) {
  const volume = n(row?.volume);
  const floatShares = n(row?.floatShares);
  const v = (volume !== null && floatShares !== null && floatShares > 0) ? (volume / floatShares) * 100 : null;
  return { ...row, floatTurnoverPct: v !== null ? round2(v) : null };
}

// ============================================================================
// SECTION 06 — Polygon Daily (RTH Open + Prev Close => Gap%)
// ============================================================================
const dailyCache = new Map(); // sym -> {ymd, open, prevClose, ts}

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

async function fetchDailyOpenPrevClosePolygon(sym) {
  const ticker = normalizeSymbol(sym);
  const ymdNY = todayYMD_NY();

  const hit = dailyCache.get(ticker);
  if (hit && hit.ymd === ymdNY && Date.now() - hit.ts < 6 * 60 * 60 * 1000) {
    return { ok: true, open: hit.open, prevClose: hit.prevClose, cached: true };
  }

  if (!POLYGON_API_KEY) return { ok: false, open: null, prevClose: null, reason: "missing_POLYGON_API_KEY" };

  const base = POLYGON_BASE_URL.replace(/\/+$/, "");
  const to = ymdNY;
  const from = ymd(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)); // weekends buffer
  const url = `${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}`;

  const r = await safeGet(url, {
    params: { adjusted: "true", sort: "asc", limit: "15", apiKey: POLYGON_API_KEY },
    headers: { "user-agent": "ALGTP" },
  });

  const bars = Array.isArray(r.data?.results) ? r.data.results : [];
  if (!r.ok || bars.length < 1) return { ok: false, open: null, prevClose: null, detail: r.errorDetail || r.data };

  const last = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null;

  const open = n(last?.o);
  const prevClose = n(prev?.c) ?? n(last?.c) ?? null;

  dailyCache.set(ticker, { ymd: ymdNY, open: open ?? null, prevClose, ts: Date.now() });
  return { ok: true, open: open ?? null, prevClose, cached: false };
}

async function enrichGapWithPolygon(row) {
  const x = await fetchDailyOpenPrevClosePolygon(row.symbol);
  if (!x.ok) return { ...row, gapSource: x.reason || "polygon_failed" };

  const open = x.open != null ? round2(x.open) : row.open;
  const prevClose = x.prevClose != null ? round2(x.prevClose) : row.prevClose;

  const gapPct =
    open != null && prevClose != null && prevClose > 0 ? round2(((open - prevClose) / prevClose) * 100) : row.gapPct;

  return { ...row, open, prevClose, gapPct, gapSource: "polygon_daily_rth_open_prevclose" };
}

// ============================================================================
// SECTION 07 — FMP Float (shares-float)
// ============================================================================
const floatCache = new Map(); // sym -> {ts, floatShares}
const FLOAT_TTL_MS = Math.max(60_000, Math.min(7 * 86400000, Number(process.env.FLOAT_TTL_MS || 86400000)));

async function fetchFloatSharesFMP(sym) {
  const ticker = normalizeSymbol(sym);
  if (!FMP_API_KEY) return { ok: false, floatShares: null, reason: "missing_FMP_API_KEY" };

  const hit = floatCache.get(ticker);
  if (hit && Date.now() - hit.ts < FLOAT_TTL_MS) return { ok: true, floatShares: hit.floatShares, cached: true };

  const url = "https://financialmodelingprep.com/stable/shares-float";
  const r = await safeGet(url, {
    params: { symbol: ticker, apikey: FMP_API_KEY },
    headers: { "user-agent": "ALGTP" },
  });

  const arr = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : []);
  const row = arr && arr.length ? arr[0] : null;

  const fs =
    n(row?.floatShares) ??
    n(row?.float) ??
    n(row?.sharesFloat) ??
    n(row?.freeFloat) ??
    null;

  if (!r.ok || fs === null) return { ok: false, floatShares: null, detail: r.errorDetail || r.data };

  const val = Math.round(fs);
  floatCache.set(ticker, { ts: Date.now(), floatShares: val });
  return { ok: true, floatShares: val, cached: false };
}

async function enrichFloatWithFMP(row) {
  const x = await fetchFloatSharesFMP(row.symbol);
  if (!x.ok) return { ...row, floatSource: x.reason || "fmp_failed" };

  const floatShares = x.floatShares;
  return {
    ...row,
    floatShares,
    floatM: round2(floatShares / 1_000_000),
    floatSource: "fmp_shares_float",
  };
}

// ============================================================================
// SECTION 08 — Indicators from Aggs (RSI / MACD / EMA 9-34-50 / AO / volRatio)
// ============================================================================
function emaSeries(values, len) {
  const out = Array(values.length).fill(null);
  if (!Array.isArray(values) || values.length < len) return out;
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

function rsiSeries(closes, len = 14) {
  const out = Array(closes.length).fill(null);
  if (!Array.isArray(closes) || closes.length < len + 1) return out;

  let gain = 0, loss = 0;
  for (let i = 1; i <= len; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  gain /= len;
  loss /= len;

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

function macdSeries(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);

  const macd = closes.map((_, i) => {
    if (emaFast[i] == null || emaSlow[i] == null) return null;
    return emaFast[i] - emaSlow[i];
  });

  const macdPoints = [];
  for (let i = 0; i < macd.length; i++) if (macd[i] != null) macdPoints.push({ i, v: macd[i] });

  const signalLine = Array(closes.length).fill(null);
  if (macdPoints.length >= signal) {
    const vals = macdPoints.map((x) => x.v);
    const sigVals = emaSeries(vals, signal);
    for (let k = 0; k < macdPoints.length; k++) {
      const idx = macdPoints[k].i;
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

function computeAOFromBarsHL(barsChrono) {
  if (!Array.isArray(barsChrono) || barsChrono.length < 40) return { ao: null, aoPrev: null };

  const median = barsChrono
    .map((b) => {
      const h = n(b?.h), l = n(b?.l);
      if (h == null || l == null) return null;
      return (h + l) / 2;
    })
    .filter((x) => x != null);

  if (median.length < 40) return { ao: null, aoPrev: null };

  const smaAt = (arr, len, idx) => {
    if (idx < 0 || idx + len > arr.length) return null;
    let s = 0;
    for (let i = idx; i < idx + len; i++) s += arr[i];
    return s / len;
  };

  const end = median.length;
  const aoNow = smaAt(median, 5, end - 5) - smaAt(median, 34, end - 34);
  const aoPrev = smaAt(median, 5, end - 6) - smaAt(median, 34, end - 35);

  return { ao: aoNow != null ? round2(aoNow) : null, aoPrev: aoPrev != null ? round2(aoPrev) : null };
}

function computeIndicatorsFromAggs(barsAsc) {
  const bars = Array.isArray(barsAsc) ? barsAsc : [];
  const barsChrono = bars
    .map((b) => ({
      c: n(b?.c),
      v: n(b?.v) ?? 0,
      h: n(b?.h),
      l: n(b?.l),
    }))
    .filter((x) => x.c != null && x.h != null && x.l != null);

  const closes = barsChrono.map((x) => x.c);
  const vols = barsChrono.map((x) => x.v ?? 0);

  if (closes.length < 60) return { ok: false };

  const last = closes.length - 1;

  const ema9 = emaSeries(closes, EMA_1);
  const ema34 = emaSeries(closes, EMA_2);
  const ema50 = emaSeries(closes, EMA_3);

  const rsi = rsiSeries(closes, RSI_LEN);
  const macd = macdSeries(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
  const ao = computeAOFromBarsHL(barsChrono);

  const avgLen = 20;
  const lastVol = vols[vols.length - 1] ?? null;
  const denomLen = Math.min(avgLen, vols.length);
  const avgVol = denomLen > 0 ? vols.slice(vols.length - denomLen).reduce((a, b) => a + b, 0) / denomLen : null;
  const volRatio = lastVol != null && avgVol != null && avgVol > 0 ? lastVol / avgVol : null;

  return {
    ok: true,
    ema9: ema9[last] != null ? round2(ema9[last]) : null,
    ema34: ema34[last] != null ? round2(ema34[last]) : null,
    ema50: ema50[last] != null ? round2(ema50[last]) : null,
    rsi: rsi[last] != null ? round2(rsi[last]) : null,
    macd: macd.macd[last] != null ? Number(macd.macd[last].toFixed(4)) : null,
    macdSignal: macd.signal[last] != null ? Number(macd.signal[last].toFixed(4)) : null,
    macdHist: macd.hist[last] != null ? Number(macd.hist[last].toFixed(4)) : null,
    ao: ao.ao,
    aoPrev: ao.aoPrev,
    lastVol_5m: lastVol != null ? Math.round(lastVol) : null,
    avgVol_5m: avgVol != null ? Math.round(avgVol) : null,
    volRatio_5m: volRatio != null ? Number(volRatio.toFixed(2)) : null,
  };
}

// ============================================================================
// SECTION 09 — Domain Scoring (5/5 => Rate %)
// ============================================================================
function domainResults(row) {
  const ft = n(row?.floatTurnoverPct);
  const d1Pass = ft != null && ft >= TURNOVER_MIN_PCT;
  const d1 = { name: "FLOAT_TURNOVER", pass: d1Pass, score: d1Pass ? 1 : 0, note: ft == null ? "no floatTurnover" : `turnover ${ft}% >= ${TURNOVER_MIN_PCT}%` };

  const vr = n(row?.volRatio_5m);
  const d2Pass = vr != null && vr >= VOLRATIO_MIN;
  const d2 = { name: "VOLUME_SPIKE", pass: d2Pass, score: d2Pass ? 1 : 0, note: vr == null ? "no volRatio" : `volRatio ${vr} >= ${VOLRATIO_MIN}` };

  const rsi = n(row?.rsi);
  const d3Pass = rsi != null && rsi >= RSI_BULL_MIN && rsi <= RSI_OVERBOUGHT;
  const d3 = { name: "RSI", pass: d3Pass, score: d3Pass ? 1 : 0, note: rsi == null ? "no RSI" : `RSI ${rsi} in [${RSI_BULL_MIN}..${RSI_OVERBOUGHT}]` };

  const macd = n(row?.macd);
  const sig = n(row?.macdSignal);
  const d4Pass = macd != null && sig != null && macd > sig;
  const d4 = { name: "MACD", pass: d4Pass, score: d4Pass ? 1 : 0, note: macd == null || sig == null ? "no MACD" : `macd ${macd} > signal ${sig}` };

  const ao = n(row?.ao);
  const aoPrev = n(row?.aoPrev);
  const e9 = n(row?.ema9);
  const e34 = n(row?.ema34);
  const e50 = n(row?.ema50);
  const emaStackPass = e9 != null && e34 != null && e50 != null ? (e9 > e34 && e34 > e50) : false;
  const aoPassNow = ao != null ? (ao > 0 && (aoPrev == null ? true : ao >= aoPrev)) : false;
  const d5Pass = emaStackPass && aoPassNow;
  const d5 = { name: "AO_EMA", pass: d5Pass, score: d5Pass ? 1 : 0, note: `AO(${ao},${aoPrev}) & EMA9>EMA34>EMA50 => ${d5Pass}` };

  const domains = [d1, d2, d3, d4, d5];
  const passed = domains.reduce((s, d) => s + (d.pass ? 1 : 0), 0);
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
// SECTION 10 — History (Last 20 checks)
// ============================================================================
const HISTORY_MAX = 20;
const history = [];
function pushHistory(item) {
  history.unshift(item);
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
}

// ============================================================================
// SECTION 11 — API
// ============================================================================
app.get("/check", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || req.query.ticker || "");
    if (!symbol) return res.status(400).json({ ok: false, error: "symbol required" });

    const snap = await fetchTickerSnapshot(symbol);
    if (!snap.ok) return res.status(500).json({ ok: false, error: "snapshot failed", detail: snap.errorDetail || snap });

    let row = normalizeSnapshotAuto(symbol, snap.data);
    row = await enrichGapWithPolygon(row);
    row = await enrichFloatWithFMP(row);
    row = addFloatTurnoverPct(row);

    const ag = await fetchAggs(symbol, CHECK_TF, CHECK_LIMIT, "asc");
    if (ag.ok) {
      const ind = computeIndicatorsFromAggs(ag.bars);
      if (ind.ok) row = { ...row, ...ind };
    } else {
      row = { ...row, indicatorsError: ag.errorDetail || "aggs_failed" };
    }

    const result = domainResults(row);
    const passAll = result.passed === 5;

    pushHistory({ ts: Date.now(), symbol, pass: passAll, rate: result.rate, passed: result.passed, failed: result.failed });

    return res.json({ ok: true, symbol, ...row, ...result, passAll, history });
  } catch (e) {
    res.status(500).json({ ok: false, error: "check failed", detail: String(e?.message || e) });
  }
});

app.get("/history", (req, res) => res.json({ ok: true, results: history }));

app.get("/api", (req, res) => {
  res.json({
    ok: true,
    config: {
      port: PORT,
      massiveAuthType: MASSIVE_AUTH_TYPE,
      hasPolygonKey: Boolean(POLYGON_API_KEY),
      hasFmpKey: Boolean(FMP_API_KEY),
      checkTf: CHECK_TF,
      thresholds: {
        TURNOVER_MIN_PCT,
        VOLRATIO_MIN,
        RSI_LEN,
        RSI_BULL_MIN,
        RSI_OVERBOUGHT,
        MACD_FAST,
        MACD_SLOW,
        MACD_SIGNAL,
        EMA_SET: [EMA_1, EMA_2, EMA_3],
      },
    },
  });
});

// ============================================================================
// SECTION 12 — UI
// ============================================================================
function renderUI() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ALGTP™ — 5:5 Request Box</title>
<style>
:root{ color-scheme: dark; }
body{ margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; background:#0b0d12; color:#e6e8ef; }
.wrap{ max-width:980px; margin:0 auto; padding:18px 12px; }
.card{
  background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.015));
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 18px 70px rgba(0,0,0,.45);
}
.h1{ display:flex; align-items:center; gap:10px; font-weight:900; font-size:18px; }
.sub{ color:#a7adc2; font-size:12px; margin-top:6px; line-height:1.35; }
.row{ display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
.input{
  flex:1; min-width:220px;
  background:#0f1320; border:1px solid rgba(255,255,255,.14);
  border-radius:14px; padding:12px 14px; color:#e6e8ef; font-size:14px; outline:none;
}
.btn{
  min-width:160px;
  border-radius:14px; padding:12px 14px;
  background:#121622; border:1px solid rgba(255,255,255,.12);
  color:#e6e8ef; cursor:pointer; font-weight:800;
}
.btn:hover{ border-color: rgba(255,255,255,.22); }
.resultLine{
  margin-top:14px;
  padding:10px 12px;
  border-radius:14px;
  border:1px solid rgba(255,255,255,.10);
  background:#0f1320;
  display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
}
.small{ color:#a7adc2; font-size:12px; }
.ok{ color:#38d17a; font-weight:900; }
.bad{ color:#ff5a5a; font-weight:900; }
.stats{ display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-top:12px; }
.stat{
  border-radius:14px;
  background:#0f1320;
  border:1px solid rgba(255,255,255,.10);
  padding:12px;
  text-align:center;
}
.stat .label{ color:#a7adc2; font-size:12px; letter-spacing:.4px; }
.stat .val{ font-size:28px; font-weight:1000; margin-top:6px; }
.val.ok{ color:#38d17a; }
.val.bad{ color:#ff5a5a; }
.val.blue{ color:#5a86ff; }
.domains{ margin-top:12px; display:grid; grid-template-columns: repeat(2,1fr); gap:10px; }
.dom{
  border-radius:14px;
  background:#0f1320;
  border:1px solid rgba(255,255,255,.10);
  padding:12px;
}
.domTop{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
.domName{ font-weight:900; font-size:12px; color:#c8cde0; letter-spacing:.4px; }
.domTag{ font-size:12px; font-weight:900; }
.note{ color:#a7adc2; font-size:12px; margin-top:6px; line-height:1.35; }
.hist{ margin-top:14px; }
.histHead{ font-weight:900; font-size:14px; margin-bottom:8px; }
.histBox{
  border-radius:14px;
  background:#0f1320;
  border:1px solid rgba(255,255,255,.10);
  overflow:hidden;
}
.hrow{
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 12px;
  border-top:1px solid rgba(255,255,255,.06);
  font-size:12px;
}
.hrow:first-child{ border-top:none; }
.left{ display:flex; align-items:center; gap:8px; }
.pillOk{ color:#38d17a; font-weight:1000; }
.pillBad{ color:#ff5a5a; font-weight:1000; }
.mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
@media (max-width: 720px){
  .stats{ grid-template-columns: repeat(2, 1fr); }
  .domains{ grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="h1">🎲 <span>5:5 REQUEST BOX</span></div>
    <div class="sub">Real check (not random). Massive + Polygon (RTH Gap%) + FMP Float + Indicators.</div>

    <div class="row">
      <input id="sym" class="input" placeholder="Enter ticker (ex: AAPL)" value="AAPL"/>
      <button class="btn" id="runBtn">Request Box (5:5)</button>
    </div>

    <div class="resultLine">
      <div class="small">Result:</div>
      <div id="resultText" class="small">—</div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="label">SUCCESS</div>
        <div id="succ" class="val ok">0</div>
      </div>
      <div class="stat">
        <div class="label">FAIL</div>
        <div id="fail" class="val bad">0</div>
      </div>
      <div class="stat">
        <div class="label">RATE</div>
        <div id="rate" class="val blue">0%</div>
      </div>
      <div class="stat">
        <div class="label">SCORE</div>
        <div id="score" class="val blue">0</div>
      </div>
    </div>

    <div class="domains" id="domains"></div>

    <div class="hist">
      <div class="histHead">History <span class="small">— last 20 requests</span></div>
      <div class="histBox" id="histBox"></div>
    </div>
  </div>
</div>

<script>
const byId = (id)=>document.getElementById(id);

function fmtTime(ms){
  try{ return new Date(ms).toLocaleTimeString(); } catch { return "-"; }
}
function domCard(d){
  const tag = d.pass ? "✅ PASS" : "❌ FAIL";
  const cls = d.pass ? "pillOk" : "pillBad";
  return \`
    <div class="dom">
      <div class="domTop">
        <div class="domName">\${d.name}</div>
        <div class="domTag \${cls}">\${tag}</div>
      </div>
      <div class="note">\${d.note || ""}</div>
    </div>\`;
}
function histRow(h){
  const tag = h.pass ? "✅ SUCCESS" : "❌ FAIL";
  const cls = h.pass ? "pillOk" : "pillBad";
  return \`
    <div class="hrow">
      <div class="left">
        <span class="\${cls}">\${tag}</span>
        <span class="mono">\${h.symbol}</span>
        <span class="small">\${h.rate}%</span>
      </div>
      <div class="small mono">\${fmtTime(h.ts)}</div>
    </div>\`;
}

async function run(){
  const sym = (byId("sym").value || "").trim().toUpperCase();
  if (!sym) return;

  byId("resultText").textContent = "Loading...";
  byId("domains").innerHTML = "";
  const r = await fetch("/check?symbol=" + encodeURIComponent(sym));
  const j = await r.json();

  if (!j.ok){
    byId("resultText").textContent = "❌ Error: " + (j.error || "failed");
    return;
  }

  const pass = Boolean(j.passAll);
  const icon = pass ? "✅" : "❌";
  byId("resultText").innerHTML = \`
    <span class="\${pass ? "ok":"bad"}">\${icon} \${sym} — \${j.rate}% (\${j.passed}/5)</span>
    <span class="small mono">Gap \${j.gapPct ?? "-"}% • Float \${j.floatM ?? "-"}M • Vol \${j.volume ?? "-"}</span>\`;

  byId("succ").textContent = String(j.passed || 0);
  byId("fail").textContent = String(j.failed || 0);
  byId("rate").textContent = String(j.rate || 0) + "%";
  byId("score").textContent = String(j.score || 0);

  byId("domains").innerHTML = (j.domains || []).map(domCard).join("");

  const hist = Array.isArray(j.history) ? j.history : [];
  byId("histBox").innerHTML = hist.map(histRow).join("");
}

byId("runBtn").addEventListener("click", run);
byId("sym").addEventListener("keydown", (e)=>{ if(e.key==="Enter") run(); });
run();
</script>
</body>
</html>`;
}

app.get("/ui", (req, res) => res.type("html").send(renderUI()));
app.get("/", (req, res) => res.json({ ok: true, ui: "/ui", api: ["/check?symbol=AAPL", "/history", "/api"] }));

app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\n✅ ALGTP™ Single Ticker BoxEngine running`);
  console.log(`🚀 UI: ${base}/ui`);
  console.log(`🧪 Check: ${base}/check?symbol=AAPL`);
  console.log(`ℹ️ API: ${base}/api\n`);
});
