// ============================================================================
// 🪙 ALGTP™ Crypto Tracking Module
// ============================================================================
// Separate module for cryptocurrency price tracking and correlation analysis
// Uses Polygon Crypto API for real-time crypto prices

import axios from "axios";

// ============================================================================
// Configuration (from environment variables)
// ============================================================================
export const ENABLE_CRYPTO = String(process.env.ENABLE_CRYPTO || "true").toLowerCase() === "true";

// Default crypto symbols - Major Index Cryptos (Top 30 by market cap)
// These are the most popular cryptos on major indices like CoinMarketCap, Binance, Coinbase
const DEFAULT_CRYPTO_SYMBOLS = [
  // Top 10 - Blue Chips
  "BTC",   // Bitcoin - #1 market cap
  "ETH",   // Ethereum - #2 market cap
  "BNB",   // Binance Coin - #3
  "XRP",   // Ripple - #4
  "SOL",   // Solana - #5
  "ADA",   // Cardano - #6
  "DOGE",  // Dogecoin - #7
  "TRX",   // Tron - #8
  "AVAX",  // Avalanche - #9
  "LINK",  // Chainlink - #10
  
  // Top 11-20 - Large Cap Alts
  "DOT",   // Polkadot
  "MATIC", // Polygon
  "SHIB",  // Shiba Inu
  "LTC",   // Litecoin
  "UNI",   // Uniswap
  "ATOM",  // Cosmos
  "XLM",   // Stellar
  "ETC",   // Ethereum Classic
  "FIL",   // Filecoin
  "HBAR",  // Hedera
  
  // Top 21-30 - Mid Cap Popular
  "APT",   // Aptos
  "ARB",   // Arbitrum
  "OP",    // Optimism
  "NEAR",  // Near Protocol
  "VET",   // VeChain
  "ALGO",  // Algorand
  "FTM",   // Fantom
  "AAVE",  // Aave
  "MKR",   // Maker
  "INJ",   // Injective
].join(",");

export const CRYPTO_SYMBOLS = String(process.env.CRYPTO_SYMBOLS || DEFAULT_CRYPTO_SYMBOLS).trim();
export const CRYPTO_CACHE_TTL_MS = Math.max(5000, Math.min(300000, Number(process.env.CRYPTO_CACHE_TTL_MS || 10000))); // Faster refresh: 10s
export const POLYGON_API_KEY = String(process.env.POLYGON_API_KEY || "").trim();
export const POLYGON_BASE_URL = String(process.env.POLYGON_BASE_URL || "https://api.polygon.io").trim();

// ============================================================================
// Cache
// ============================================================================
const cryptoCache = new Map(); // sym -> {ts, data}
let cryptoCorrelationCache = null;
let cryptoCorrelationCacheTs = 0;

// ============================================================================
// Helper Functions
// ============================================================================
function n(val) {
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function round2(val) {
  const num = n(val);
  return num !== null ? Math.round(num * 100) / 100 : null;
}

async function safeGet(url, config = {}) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      ...config,
    });
    return {
      ok: true,
      status: response.status,
      data: response.data,
      errorDetail: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: error.response?.status || 500,
      data: null,
      errorDetail: error.message || String(error),
    };
  }
}

// ============================================================================
// Crypto Data Fetching
// ============================================================================

/**
 * Fetch crypto ticker snapshot from Polygon Crypto API
 * @param {string} symbol - Crypto symbol (e.g., "BTC", "ETH")
 * @returns {Promise<{ok: boolean, data?: object, cached?: boolean}>}
 */
export async function fetchCryptoSnapshot(symbol) {
  if (!ENABLE_CRYPTO) return { ok: false, reason: "disabled" };
  
  const cryptoSymbol = String(symbol || "").trim().toUpperCase();
  if (!cryptoSymbol) return { ok: false, reason: "no_symbol" };
  
  // Check cache first
  const cacheKey = `crypto:${cryptoSymbol}`;
  const hit = cryptoCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CRYPTO_CACHE_TTL_MS) {
    return { ok: true, data: hit.data, cached: true };
  }
  
  // Polygon uses X:BTCUSD format for crypto pairs
  const pair = `X:${cryptoSymbol}USD`;
  const base = POLYGON_BASE_URL.replace(/\/+$/, "");
  const url = `${base}/v2/snapshot/locale/global/markets/crypto/tickers/${encodeURIComponent(pair)}`;
  
  const r = await safeGet(url, {
    params: { apiKey: POLYGON_API_KEY },
    headers: { "user-agent": "ALGTP" },
  });
  
  if (!r.ok || !r.data) {
    return { ok: false, status: r.status, detail: r.errorDetail };
  }
  
  // Cache the result
  const data = normalizeCryptoSnapshot(cryptoSymbol, r.data);
  cryptoCache.set(cacheKey, { ts: Date.now(), data });
  
  return { ok: true, data, cached: false };
}

/**
 * Normalize crypto snapshot data to common format
 * @param {string} symbol - Crypto symbol
 * @param {object} snap - Raw snapshot data from Polygon
 * @returns {object} Normalized crypto data
 */
function normalizeCryptoSnapshot(symbol, snap) {
  const ticker = snap?.ticker || {};
  const day = ticker?.day || {};
  const prevDay = ticker?.prevDay || {};
  const lastTrade = ticker?.lastTrade || {};
  
  const price = n(lastTrade?.p) ?? n(day?.c) ?? null;
  const open = n(day?.o) ?? null;
  const high = n(day?.h) ?? null;
  const low = n(day?.l) ?? null;
  const prevClose = n(prevDay?.c) ?? null;
  const volume = n(day?.v) ?? null;
  
  const pricePct = price !== null && prevClose !== null && prevClose > 0
    ? ((price - prevClose) / prevClose) * 100
    : null;
  
  const gapPct = price !== null && open !== null && open > 0
    ? ((price - open) / open) * 100
    : null;
  
  return {
    symbol,
    isCrypto: true,
    price: price !== null ? round2(price) : null,
    open: open !== null ? round2(open) : null,
    high: high !== null ? round2(high) : null,
    low: low !== null ? round2(low) : null,
    prevClose: prevClose !== null ? round2(prevClose) : null,
    pricePct: pricePct !== null ? round2(pricePct) : null,
    gapPct: gapPct !== null ? round2(gapPct) : null,
    volume: volume !== null ? Math.round(volume) : null,
    marketCap: null, // Crypto market cap needs different API
    lastUpdate: Date.now(),
  };
}

/**
 * Fetch multiple crypto symbols in parallel
 * @returns {Promise<{ok: boolean, results: Array}>}
 */
export async function fetchCryptoMovers() {
  if (!ENABLE_CRYPTO) return { ok: false, results: [], reason: "disabled" };
  
  const symbols = CRYPTO_SYMBOLS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return { ok: false, results: [], reason: "no_symbols" };
  
  // Fetch all symbols in parallel (with higher concurrency for speed)
  const results = [];
  const concurrency = 6; // Increased from 3 for faster fetching
  
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const promises = batch.map(sym => fetchCryptoSnapshot(sym));
    const batchResults = await Promise.all(promises);
    
    for (const result of batchResults) {
      if (result.ok && result.data) {
        results.push(result.data);
      }
    }
  }
  
  return { ok: true, results, totalSymbols: symbols.length };
}

/**
 * Get BTC/ETH prices for correlation display (cached)
 * @returns {Promise<{btc: object|null, eth: object|null, timestamp: number}|null>}
 */
export async function getCryptoCorrelation() {
  if (!ENABLE_CRYPTO) return null;
  
  // Use cache if fresh (within 15 seconds)
  if (cryptoCorrelationCache && Date.now() - cryptoCorrelationCacheTs < 15000) {
    return cryptoCorrelationCache;
  }
  
  try {
    const btcResult = await fetchCryptoSnapshot('BTC');
    const ethResult = await fetchCryptoSnapshot('ETH');
    
    const correlation = {
      btc: btcResult.ok ? btcResult.data : null,
      eth: ethResult.ok ? ethResult.data : null,
      timestamp: Date.now(),
    };
    
    cryptoCorrelationCache = correlation;
    cryptoCorrelationCacheTs = Date.now();
    
    return correlation;
  } catch (e) {
    console.error('[getCryptoCorrelation] Error:', e.message);
    return null;
  }
}

/**
 * Get crypto cache stats
 * @returns {object} Cache statistics
 */
export function getCryptoStats() {
  return {
    cacheSize: cryptoCache.size,
    enabled: ENABLE_CRYPTO,
    symbols: CRYPTO_SYMBOLS,
    cacheTTL: CRYPTO_CACHE_TTL_MS,
  };
}

/**
 * Clear crypto cache (useful for testing)
 */
export function clearCryptoCache() {
  cryptoCache.clear();
  cryptoCorrelationCache = null;
  cryptoCorrelationCacheTs = 0;
}

// ============================================================================
// Express Route Handlers
// ============================================================================

/**
 * Generate mock crypto data when API is not available
 * Uses realistic price ranges and random % changes
 */
function generateMockCryptoData() {
  const mockPrices = {
    BTC: { price: 97500, range: 5000 },
    ETH: { price: 3200, range: 200 },
    BNB: { price: 680, range: 40 },
    XRP: { price: 2.45, range: 0.15 },
    SOL: { price: 195, range: 15 },
    ADA: { price: 0.78, range: 0.08 },
    DOGE: { price: 0.25, range: 0.03 },
    TRX: { price: 0.24, range: 0.02 },
    AVAX: { price: 38, range: 4 },
    LINK: { price: 18, range: 2 },
    DOT: { price: 7.2, range: 0.8 },
    MATIC: { price: 0.45, range: 0.05 },
    SHIB: { price: 0.000022, range: 0.000003 },
    LTC: { price: 125, range: 10 },
    UNI: { price: 12, range: 1.5 },
    ATOM: { price: 8.5, range: 1 },
    XLM: { price: 0.42, range: 0.05 },
    ETC: { price: 28, range: 3 },
    FIL: { price: 5.2, range: 0.6 },
    HBAR: { price: 0.28, range: 0.03 },
    APT: { price: 9.5, range: 1 },
    ARB: { price: 0.82, range: 0.1 },
    OP: { price: 1.85, range: 0.2 },
    NEAR: { price: 5.4, range: 0.6 },
    VET: { price: 0.045, range: 0.005 },
    ALGO: { price: 0.35, range: 0.04 },
    FTM: { price: 0.72, range: 0.08 },
    AAVE: { price: 285, range: 25 },
    MKR: { price: 1650, range: 150 },
    INJ: { price: 24, range: 3 },
  };
  
  const results = [];
  const symbols = CRYPTO_SYMBOLS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  
  for (const sym of symbols) {
    const mock = mockPrices[sym] || { price: 10, range: 1 };
    const variation = (Math.random() - 0.5) * 2 * mock.range;
    const price = round2(mock.price + variation);
    const pricePct = round2((Math.random() - 0.5) * 10); // -5% to +5%
    const volume = Math.round(Math.random() * 100_000_000 + 10_000_000);
    
    results.push({
      symbol: sym,
      isCrypto: true,
      price,
      pricePct,
      gapPct: round2(pricePct * 0.8),
      volume,
      high: round2(price * 1.02),
      low: round2(price * 0.98),
      open: round2(price * (1 - pricePct/100)),
      prevClose: round2(price * (1 - pricePct/100)),
      lastUpdate: Date.now(),
    });
  }
  
  return results;
}

/**
 * GET /crypto-movers - Cryptocurrency price tracking
 */
export async function handleCryptoMovers(req, res) {
  try {
    if (!ENABLE_CRYPTO) {
      return res.status(400).json({ ok: false, error: "Crypto tracking disabled" });
    }

    let results = [];
    let source = "polygon";
    
    // Try Polygon API first
    if (POLYGON_API_KEY) {
      const result = await fetchCryptoMovers();
      if (result.ok && result.results.length > 0) {
        results = result.results;
      }
    }
    
    // Fallback to mock data if API fails or not authorized
    if (results.length === 0) {
      results = generateMockCryptoData();
      source = "simulated";
      console.log("[crypto-movers] Using simulated data (Polygon API not available or not authorized)");
    }

    // Sort by absolute price change %
    results.sort((a, b) => 
      Math.abs(n(b.pricePct) || 0) - Math.abs(n(a.pricePct) || 0)
    );

    res.json({
      ok: true,
      count: results.length,
      results,
      symbols: CRYPTO_SYMBOLS,
      source,
      note: source === "simulated" 
        ? "⚠️ Simulated data (Polygon crypto API requires paid plan)" 
        : "Crypto prices via Polygon API",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "crypto-movers failed", detail: String(e?.message || e) });
  }
}

/**
 * GET /crypto/:symbol - Get specific crypto ticker
 */
export async function handleCryptoSymbol(req, res) {
  try {
    if (!ENABLE_CRYPTO) {
      return res.status(400).json({ ok: false, error: "Crypto tracking disabled" });
    }

    const sym = String(req.params.symbol || "").trim().toUpperCase();
    if (!sym) return res.json({ ok: false, error: "symbol required" });

    const result = await fetchCryptoSnapshot(sym);
    
    if (!result.ok) {
      return res.json({
        ok: false,
        symbol: sym,
        error: result.reason || "fetch failed",
        detail: result.detail,
      });
    }

    res.json({
      ok: true,
      symbol: sym,
      data: result.data,
      cached: result.cached ?? false,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "crypto-symbol failed", detail: String(e?.message || e) });
  }
}
