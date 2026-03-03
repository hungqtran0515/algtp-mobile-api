# Catalyst Hub Endpoint Implementation

Add this code to `server.js` after the existing API endpoints (around line 5000):

```javascript
// ============================================================================
// 🔥 CATALYST HUB — Unified Symbol Intelligence
// GET /hub?symbol=AAPL
// ============================================================================

import {
  scoreCatalyst,
  pickCatalysts,
  createCatalystEvent,
  detectSECCatalyst,
  detectEarningsCatalyst,
  detectNewsCatalyst,
  detectTechCatalyst
} from "./catalyst-hub.js";

// Hub cache (5 minute TTL)
const hubCache = new Map();
const HUB_CACHE_TTL_MS = 5 * 60 * 1000;

app.get("/hub", requireLogin, async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Missing required parameter: symbol" });
    }

    // Check cache
    const cacheKey = `hub_${symbol}`;
    const cached = hubCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < HUB_CACHE_TTL_MS) {
      return res.json({ ...cached.data, cached: true });
    }

    // =========================================================================
    // STEP 1: Fetch Market Snapshot
    // =========================================================================
    let snapshot = {
      symbol,
      session: "Off-hours",
      price: null,
      changePct: null,
      gapPct: null,
      volume: null,
      floatM: null,
      floatTurnoverPct: null
    };

    try {
      const snapResult = await fetchTickerSnapshot(symbol);
      if (snapResult && snapResult.length > 0) {
        const row = snapResult[0];
        
        // Enrich with gap% and float
        const enriched = await enrichRowsWithDailyOpen([row]);
        const withFloat = await enrichRowsWithFloat(enriched);
        const final = withFloat[0] || row;

        // Detect session
        const ts = final.updated || final.timestamp || Date.now();
        const session = detectSession(ts);

        snapshot = {
          symbol,
          session,
          price: n(final.price),
          changePct: n(final.pricePct),
          gapPct: n(final.gapPct),
          volume: Math.round(n(final.volume) || 0),
          floatM: round2(n(final.floatM) || 0),
          floatTurnoverPct: round2(n(final.floatTurnoverPct) || 0)
        };
      }
    } catch (e) {
      console.warn(`Hub: snapshot failed for ${symbol}:`, e.message);
    }

    // =========================================================================
    // STEP 2: Collect Events
    // =========================================================================
    const events = [];
    const now = Date.now();

    // SEC Filings (last 7 days)
    if (FMP_API_KEY) {
      try {
        const secUrl = `https://financialmodelingprep.com/api/v3/sec_filings/${symbol}`;
        const secResult = await safeGet(secUrl, {
          params: { apikey: FMP_API_KEY, limit: 20 },
          headers: { "user-agent": "ALGTP" }
        });

        if (secResult.ok && Array.isArray(secResult.data)) {
          const recentFilings = secResult.data.filter(f => {
            const filingDate = new Date(f.fillingDate || f.acceptedDate || 0);
            const daysAgo = (now - filingDate.getTime()) / (1000 * 60 * 60 * 24);
            return daysAgo <= 7;
          }).slice(0, 10);

          for (const filing of recentFilings) {
            const subtype = detectSECCatalyst(filing);
            const filTs = new Date(filing.fillingDate || filing.acceptedDate || 0).getTime();
            
            events.push(createCatalystEvent({
              symbol,
              ts: filTs,
              type: "SEC",
              subtype,
              title: `${filing.type || "Filing"}: ${filing.title || "SEC filing"}`.substring(0, 120),
              detail: `Form ${filing.type || "N/A"} filed on ${new Date(filTs).toLocaleDateString()}`,
              url: filing.finalLink || filing.link || "",
              source: "SEC"
            }));
          }
        }
      } catch (e) {
        console.warn(`Hub: SEC filings failed for ${symbol}:`, e.message);
      }
    }

    // Earnings Calendar (next/past event)
    if (FMP_API_KEY) {
      try {
        const earnUrl = `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${symbol}`;
        const earnResult = await safeGet(earnUrl, {
          params: { apikey: FMP_API_KEY, limit: 5 },
          headers: { "user-agent": "ALGTP" }
        });

        if (earnResult.ok && Array.isArray(earnResult.data)) {
          const recentEarnings = earnResult.data.filter(e => {
            const earnDate = new Date(e.date || 0);
            const daysAgo = (now - earnDate.getTime()) / (1000 * 60 * 60 * 24);
            return Math.abs(daysAgo) <= 14; // +/- 14 days
          }).slice(0, 3);

          for (const earn of recentEarnings) {
            const subtype = detectEarningsCatalyst(earn);
            const earnTs = new Date(earn.date || 0).getTime();
            
            const epsSurprise = earn.eps && earn.epsEstimated 
              ? round2(((n(earn.eps) - n(earn.epsEstimated)) / Math.abs(n(earn.epsEstimated))) * 100)
              : null;

            const detail = epsSurprise !== null 
              ? `EPS: ${earn.eps} vs ${earn.epsEstimated} est (${epsSurprise > 0 ? '+' : ''}${epsSurprise}%)`
              : `Earnings ${earnTs > now ? 'upcoming' : 'reported'}`;

            events.push(createCatalystEvent({
              symbol,
              ts: earnTs,
              type: "EARNINGS",
              subtype,
              title: `Earnings ${earnTs > now ? 'Scheduled' : 'Report'}: Q${earn.quarter || '?'} ${earn.year || ''}`,
              detail,
              url: "",
              source: "Calendar"
            }));
          }
        }
      } catch (e) {
        console.warn(`Hub: Earnings failed for ${symbol}:`, e.message);
      }
    }

    // News (last 24 hours)
    if (FMP_API_KEY) {
      try {
        const newsUrl = `https://financialmodelingprep.com/api/v3/stock_news`;
        const newsResult = await safeGet(newsUrl, {
          params: { tickers: symbol, limit: 10, apikey: FMP_API_KEY },
          headers: { "user-agent": "ALGTP" }
        });

        if (newsResult.ok && Array.isArray(newsResult.data)) {
          const recentNews = newsResult.data.filter(n => {
            const pubDate = new Date(n.publishedDate || 0);
            const hoursAgo = (now - pubDate.getTime()) / (1000 * 60 * 60);
            return hoursAgo <= 24;
          }).slice(0, 5);

          for (const article of recentNews) {
            const subtype = detectNewsCatalyst(article.title || "");
            const newsTs = new Date(article.publishedDate || 0).getTime();

            events.push(createCatalystEvent({
              symbol,
              ts: newsTs,
              type: "NEWS",
              subtype,
              title: (article.title || "News article").substring(0, 120),
              detail: (article.text || "").substring(0, 200),
              url: article.url || "",
              source: article.site || "News"
            }));
          }
        }
      } catch (e) {
        console.warn(`Hub: News failed for ${symbol}:`, e.message);
      }
    }

    // Technical Signals (from current snapshot)
    const techSubtype = detectTechCatalyst(snapshot);
    if (techSubtype) {
      events.push(createCatalystEvent({
        symbol,
        ts: now,
        type: "TECH",
        subtype: techSubtype,
        title: `Technical: ${techSubtype.replace(/_/g, ' ').toUpperCase()}`,
        detail: `Gap: ${snapshot.gapPct}%, Float TO: ${snapshot.floatTurnoverPct}%, Vol: ${fmt.num(snapshot.volume)}`,
        url: "",
        source: "ALGTP"
      }));
    }

    // =========================================================================
    // STEP 3: Score & Pick Catalysts
    // =========================================================================
    const { primary, secondary } = pickCatalysts(events, 24, 50);

    const summary = {
      score: primary ? primary.score : 0,
      primary: primary ? {
        title: primary.title,
        detail: primary.detail || "",
        impact: primary.impact
      } : null,
      secondary: secondary ? {
        title: secondary.title,
        detail: secondary.detail || "",
        impact: secondary.impact
      } : null
    };

    // =========================================================================
    // STEP 4: Company Profile
    // =========================================================================
    let company = { name: symbol };
    if (FMP_API_KEY) {
      try {
        const profileUrl = `https://financialmodelingprep.com/api/v3/profile/${symbol}`;
        const profileResult = await safeGet(profileUrl, {
          params: { apikey: FMP_API_KEY },
          headers: { "user-agent": "ALGTP" }
        });

        if (profileResult.ok && Array.isArray(profileResult.data) && profileResult.data[0]) {
          const prof = profileResult.data[0];
          company = {
            name: prof.companyName || symbol,
            sector: prof.sector || null,
            industry: prof.industry || null,
            website: prof.website || null
          };
        }
      } catch (e) {
        console.warn(`Hub: Profile failed for ${symbol}:`, e.message);
      }
    }

    // =========================================================================
    // STEP 5: Build Response
    // =========================================================================
    const hubData = {
      ok: true,
      symbol,
      updatedAt: new Date(now).toISOString(),
      snapshot,
      company,
      summary,
      links: {
        company: `/company?symbol=${symbol}`,
        sec: `/sec-filings?symbol=${symbol}`,
        news: `/news?symbol=${symbol}`,
        earnings: `/earnings-calendar?symbol=${symbol}`
      },
      events: events.sort((a, b) => b.ts - a.ts) // Most recent first
    };

    // Cache result
    hubCache.set(cacheKey, { ts: now, data: hubData });

    res.json(hubData);

  } catch (e) {
    console.error(`/hub error for ${req.query.symbol}:`, e);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to load catalyst hub", 
      detail: String(e?.message || e) 
    });
  }
});

// Helper: Detect market session from timestamp
function detectSession(ts) {
  const d = new Date(Number.isInteger(ts) && ts < 1e12 ? ts * 1000 : ts);
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = et.getHours();
  const mins = et.getMinutes();
  const time = hours * 60 + mins;

  if (time >= 4 * 60 && time < 9 * 60 + 30) return "Premarket";
  if (time >= 9 * 60 + 30 && time < 16 * 60) return "Regular Trading Hours";
  if (time >= 16 * 60 && time < 20 * 60) return "After-hours";
  return "Off-hours";
}

// Cleanup old cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of hubCache.entries()) {
    if (now - value.ts > HUB_CACHE_TTL_MS) {
      hubCache.delete(key);
    }
  }
}, 10 * 60 * 1000);
```

## Integration Steps:

1. **Add import at top of server.js** (after line 95):
```javascript
import {
  scoreCatalyst,
  pickCatalysts,
  createCatalystEvent,
  detectSECCatalyst,
  detectEarningsCatalyst,
  detectNewsCatalyst,
  detectTechCatalyst
} from "./catalyst-hub.js";
```

2. **Add the `/hub` endpoint code** after existing API endpoints (around line 5000)

3. **Test the endpoint**:
```bash
curl "http://localhost:3000/hub?symbol=AAPL"
```

## What it does:

1. **Fetches market snapshot** - Price, Gap%, Volume, Float data
2. **Aggregates events** from:
   - SEC filings (last 7 days)
   - Earnings calendar (+/- 14 days)
   - News (last 24 hours)
   - Technical signals (live)
3. **Scores each event** using catalyst-hub.js scoring rules
4. **Picks primary + secondary catalysts** (highest scores)
5. **Returns unified JSON** matching your UI spec
6. **Caches for 5 minutes** to reduce API calls

## Example Response:
```json
{
  "ok": true,
  "symbol": "AAPL",
  "updatedAt": "2026-02-12T23:40:00Z",
  "snapshot": {
    "symbol": "AAPL",
    "session": "Regular Trading Hours",
    "price": 184.21,
    "changePct": 1.23,
    "gapPct": 2.5,
    "volume": 45000000,
    "floatM": 15600,
    "floatTurnoverPct": 0.29
  },
  "company": {
    "name": "Apple Inc",
    "sector": "Technology",
    "industry": "Consumer Electronics"
  },
  "summary": {
    "score": 85,
    "primary": {
      "title": "Earnings Beat: Q1 2026",
      "detail": "EPS: 2.45 vs 2.20 est (+11.4%)",
      "impact": "bullish"
    },
    "secondary": {
      "title": "NEWS: Analyst Upgrade",
      "detail": "Goldman upgrades to Buy",
      "impact": "bullish"
    }
  },
  "links": {
    "company": "/company?symbol=AAPL",
    "sec": "/sec-filings?symbol=AAPL",
    "news": "/news?symbol=AAPL",
    "earnings": "/earnings-calendar?symbol=AAPL"
  },
  "events": [
    {
      "symbol": "AAPL",
      "ts": 1707782400000,
      "type": "EARNINGS",
      "subtype": "beat_beat",
      "title": "Earnings Report: Q1 2026",
      "detail": "EPS: 2.45 vs 2.20 est (+11.4%)",
      "impact": "bullish",
      "score": 85,
      "url": "",
      "source": "Calendar"
    },
    ...
  ]
}
```
