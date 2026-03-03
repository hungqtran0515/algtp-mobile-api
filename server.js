// ============================================================================
// 📱 ALGTP Mobile API Server (No Auth)
// Simple proxy to Massive API for iOS app
// ============================================================================

import "dotenv/config";
import express from "express";
import axios from "axios";

const app = express();
const PORT = Number(process.env.PORT || 3000);

// API Keys
const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY || "";
const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "";
const FMP_API_KEY = process.env.FMP_API_KEY || "";

// CORS for mobile app
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, service: "ALGTP Mobile API", timestamp: new Date().toISOString() });
});

// Helper: Fetch from Massive API
async function fetchMassive(endpoint, params = {}) {
  const url = `https://api.polygon.io${endpoint}`;
  const response = await axios.get(url, {
    params: { ...params, apiKey: MASSIVE_API_KEY },
    timeout: 10000
  });
  return response.data;
}

// Helper: Enrich with Float data from FMP
async function enrichFloat(stocks) {
  if (!FMP_API_KEY || stocks.length === 0) return stocks;
  
  const symbols = stocks.map(s => s.symbol).join(",");
  try {
    const response = await axios.get(`https://financialmodelingprep.com/api/v3/shares_float`, {
      params: { symbol: symbols, apikey: FMP_API_KEY },
      timeout: 5000
    });
    
    const floatMap = {};
    if (response.data) {
      response.data.forEach(item => {
        floatMap[item.symbol] = item.floatShares;
      });
    }
    
    return stocks.map(stock => ({
      ...stock,
      floatShares: floatMap[stock.symbol] || null,
      floatM: floatMap[stock.symbol] ? floatMap[stock.symbol] / 1_000_000 : null,
      floatTurnoverPct: floatMap[stock.symbol] && stock.volume 
        ? (stock.volume / floatMap[stock.symbol]) * 100 
        : null
    }));
  } catch (err) {
    console.error("Float enrich error:", err.message);
    return stocks;
  }
}

// ============================================================================
// API Endpoints
// ============================================================================

// Market Movers (Premarket)
app.get("/movers-premarket", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    
    // Fetch snapshot from Polygon
    const data = await fetchMassive("/v2/snapshot/locale/us/markets/stocks/tickers", {
      "ticker.gte": "A",
      sort: "change_percent",
      order: "desc",
      limit: limit * 3 // Fetch more to filter
    });
    
    if (!data.tickers || data.tickers.length === 0) {
      return res.json({ ok: true, session: "premarket", results: [] });
    }
    
    // Transform to our format
    let stocks = data.tickers.map(t => ({
      symbol: t.ticker,
      price: t.lastTrade?.p || t.day?.c || null,
      open: t.day?.o || null,
      prevClose: t.prevDay?.c || null,
      pricePct: t.todaysChangePerc || null,
      gapPct: t.day?.o && t.prevDay?.c 
        ? ((t.day.o - t.prevDay.c) / t.prevDay.c) * 100 
        : null,
      volume: t.day?.v || 0,
      marketCapB: t.marketCap ? t.marketCap / 1_000_000_000 : null,
      cap: t.marketCap > 10_000_000_000 ? "large" : 
           t.marketCap > 2_000_000_000 ? "mid" : "small"
    }));
    
    // Filter: only stocks with significant gap
    stocks = stocks.filter(s => s.gapPct && Math.abs(s.gapPct) > 5);
    
    // Enrich with float
    stocks = await enrichFloat(stocks);
    
    // Sort by gap
    stocks.sort((a, b) => Math.abs(b.gapPct || 0) - Math.abs(a.gapPct || 0));
    stocks = stocks.slice(0, limit);
    
    res.json({ ok: true, session: "premarket", results: stocks });
  } catch (err) {
    console.error("Movers premarket error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Most Active
app.get("/most-active", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    
    const data = await fetchMassive("/v2/snapshot/locale/us/markets/stocks/tickers", {
      "ticker.gte": "A",
      sort: "volume",
      order: "desc",
      limit
    });
    
    if (!data.tickers || data.tickers.length === 0) {
      return res.json({ ok: true, results: [] });
    }
    
    const stocks = data.tickers.map(t => ({
      symbol: t.ticker,
      price: t.lastTrade?.p || t.day?.c || null,
      prevClose: t.prevDay?.c || null,
      pricePct: t.todaysChangePerc || null,
      volume: t.day?.v || 0,
      marketCapB: t.marketCap ? t.marketCap / 1_000_000_000 : null
    }));
    
    res.json({ ok: true, results: stocks });
  } catch (err) {
    console.error("Most active error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Unusual Volume
app.get("/unusual-volume", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    
    const data = await fetchMassive("/v2/snapshot/locale/us/markets/stocks/tickers", {
      "ticker.gte": "A",
      sort: "volume",
      order: "desc",
      limit: limit * 2
    });
    
    if (!data.tickers || data.tickers.length === 0) {
      return res.json({ ok: true, results: [] });
    }
    
    // Calculate volume ratio vs average (simplified)
    let stocks = data.tickers.map(t => ({
      symbol: t.ticker,
      price: t.lastTrade?.p || t.day?.c || null,
      prevClose: t.prevDay?.c || null,
      pricePct: t.todaysChangePerc || null,
      volume: t.day?.v || 0,
      prevVolume: t.prevDay?.v || 1,
      volumeRatio: (t.day?.v || 0) / (t.prevDay?.v || 1)
    }));
    
    // Filter unusual (2x+ volume)
    stocks = stocks.filter(s => s.volumeRatio > 2);
    stocks.sort((a, b) => b.volumeRatio - a.volumeRatio);
    stocks = stocks.slice(0, limit);
    
    res.json({ ok: true, results: stocks });
  } catch (err) {
    console.error("Unusual volume error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Scan specific symbols (for NQ100)
app.get("/scan", async (req, res) => {
  try {
    const symbols = (req.query.symbols || "").split(",").filter(s => s.trim());
    if (symbols.length === 0) {
      return res.json({ ok: true, results: [] });
    }
    
    // Fetch each symbol (Polygon allows comma-separated tickers)
    const data = await fetchMassive("/v2/snapshot/locale/us/markets/stocks/tickers", {
      tickers: symbols.join(",")
    });
    
    if (!data.tickers || data.tickers.length === 0) {
      return res.json({ ok: true, results: [] });
    }
    
    const stocks = data.tickers.map(t => ({
      symbol: t.ticker,
      price: t.lastTrade?.p || t.day?.c || null,
      prevClose: t.prevDay?.c || null,
      pricePct: t.todaysChangePerc || null,
      volume: t.day?.v || 0,
      marketCapB: t.marketCap ? t.marketCap / 1_000_000_000 : null
    }));
    
    res.json({ ok: true, results: stocks });
  } catch (err) {
    console.error("Scan error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// Start Server
// ============================================================================
app.listen(PORT, () => {
  console.log(`📱 ALGTP Mobile API running on port ${PORT}`);
  console.log(`🔑 API Keys: Massive=${!!MASSIVE_API_KEY} Polygon=${!!POLYGON_API_KEY} FMP=${!!FMP_API_KEY}`);
});
