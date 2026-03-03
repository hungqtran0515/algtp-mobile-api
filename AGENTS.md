# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview
ALGTP™ (Algorithmic Trading Platform) is a real-time stock market scanner that aggregates data from multiple sources (Polygon/Massive API, Financial Modeling Prep) to identify trading opportunities during premarket, regular hours, and after-hours sessions. The main application is a single-file Node.js Express server (server.js, ~2800 lines) that serves both a web UI and REST API endpoints.

## Development Commands

### Running the Application
```bash
# Start the server (production)
npm start

# Start with auto-reload during development
npm run dev
```

The server runs on PORT 3000 by default (configurable via `.env`).

### Key Testing Endpoints
After starting the server, test these endpoints:
- `http://localhost:3000/ui` - Main dashboard UI
- `http://localhost:3000/api` - Configuration status
- `http://localhost:3000/scan?symbols=NVDA,TSLA,AAPL` - Scan specific symbols
- `http://localhost:3000/movers-premarket?limit=50` - Premarket movers
- `http://localhost:3000/halts` - Trading halts (LULD events)

### Environment Configuration
All configuration is managed through `.env` file. Critical variables:
- `MASSIVE_API_KEY` - Primary data source API key (Polygon/Massive API)
- `POLYGON_API_KEY` - For daily aggregates (Regular Trading Hours open/close)
- `FMP_API_KEY` - Financial Modeling Prep API for float shares enrichment
- `ENABLE_SNAPSHOT_ALL` - Toggle between snapshot-all vs WebSocket fallback modes
- `ENABLE_5M_INDICATORS` - Toggle technical indicators (EMA, SMA, VWAP, Awesome Oscillator)
- `ENABLE_HALT_WS` - Enable/disable LULD halt monitoring via WebSocket

## Architecture

### Core Data Flow
1. **Data Sources (3 primary APIs)**:
   - **Massive API REST**: Movers list, ticker snapshots, snapshot-all, 5-minute aggregates
   - **Polygon API**: Daily aggregates for accurate Regular Trading Hours Gap% calculation
   - **FMP API**: Float shares for Float Turnover % calculation

2. **Data Processing Pipeline**:
   ```
   Raw API → Normalize → Session Filter → Enrich (Gap%, Float) → Indicators (5m) → Finalize → Sort → Return
   ```

3. **Gap% Calculation (Critical)**:
   - Gap% MUST use Regular Trading Hours (RTH) open, NOT premarket/afterhours open
   - Always fetched from Polygon daily aggregates (`/v2/aggs/ticker/{symbol}/range/1/day`)
   - Fallback: uses snapshot open if Polygon unavailable
   - Formula: `((RTH_Open - PreviousClose) / PreviousClose) * 100`

4. **Float Turnover % Calculation**:
   - Float shares fetched from FMP (`/stable/shares-float`)
   - Formula: `(Volume / FloatShares) * 100`
   - Used for ranking movers (Gap% → Float Turnover % → Volume)

5. **Technical Indicators (5-minute timeframe)**:
   - EMA9, EMA34, SMA26, VWAP computed from 5-minute bars
   - Awesome Oscillator: `SMA(5, median) - SMA(34, median)` on high-low median
   - Volume spike detection: `lastVol >= avgVol * VOL_SPIKE_MULT`
   - Optional AO filter modes: `above_zero` or `rising`

### Session Classification (New York Time)
The system filters data by trading session based on timestamp:
- **Premarket**: 04:00 - 09:29 ET
- **Regular Trading Hours**: 09:30 - 15:59 ET  
- **After-hours**: 16:00 - 19:59 ET
- **Off-hours**: All other times

### WebSocket Integrations
1. **HALT WebSocket**: Monitors LULD (Limit Up Limit Down) events for trading halts/resumes
2. **AM WebSocket**: Minute aggregates for real-time premarket/afterhours data (fallback when snapshot-all disabled)

### Key API Endpoints Structure
All endpoints in server.js follow this pattern:
- `/scan` - User watchlist scan (symbols from IMPORTANT_SYMBOLS or query param)
- `/list` - Movers by group (topGainers, topLosers, topGappers) with market cap filter
- `/snapshot-all`, `/premarket`, `/aftermarket` - Session-filtered market snapshots
- `/movers-premarket`, `/movers-afterhours` - Ranked by Gap% → Float Turnover % → Volume
- `/most-active`, `/unusual-volume`, `/most-volatile`, `/most-lately` - Various sorting modes
- `/mini-chart?symbol=AAPL&tf=1` - OHLC data with overlays for UI hover charts

### Caching Strategy
Multiple in-memory caches to minimize API calls:
- `aggsCache` - 5-minute aggregates (15 second TTL)
- `dailyOpenCache` - Polygon daily data (6 hour TTL)
- `floatCache` - FMP float shares (24 hour TTL, configurable)
- `amSnapCache` - AM WebSocket snapshots (60 second TTL)
- `miniCache` - Mini chart data (15 second TTL)

### Data Normalization
`normalizeSnapshotAuto()` function (line ~400-500) handles multiple API response shapes:
- Searches nested objects for price/open/prevClose/volume/floatShares
- Handles both camelCase and snake_case field names
- Computes derived fields (pricePct, gapPct, floatM, marketCapB, cap category)

## Authentication Subsystem
The `algtp-auth/` directory contains a separate authentication layer:
- Google OAuth via Passport.js
- Stripe subscription management with webhooks
- SQLite database (better-sqlite3) for user/premium status
- Middleware: `requireLogin`, `requirePremium`
- Note: Currently separate from main server.js - integration may be needed

## Code Patterns to Follow

### Error Handling
- Use `safeGet()` wrapper for all axios calls (returns `{ok, status, data, errorDetail}`)
- Never throw errors that crash the server - return error objects to client
- Include `DEBUG` mode for verbose error details in responses

### Async Concurrency
- Use `mapPool()` helper for controlled parallelism (default: SNAP_CONCURRENCY = 4)
- Example: `await mapPool(symbols, 4, async (sym) => fetchData(sym))`

### Number Safety
- Always use `n()` helper to safely convert to number or null
- Use `round2()` for prices/percentages, `Math.round()` for volume/shares

### ENV Variable Access Pattern
```javascript
const SETTING = String(process.env.SETTING || "default").toLowerCase() === "true";
const NUMBER_SETTING = Math.max(min, Math.min(max, Number(process.env.NUMBER_SETTING || default)));
```

## Important Implementation Notes

1. **Session Filtering Behavior**: When snapshot timestamp is missing, DO NOT drop the ticker - keep it to avoid empty results (see line ~1555-1563)

2. **Movers Ranking**: For `/movers-premarket` and `/movers-afterhours`, always use this sort priority:
   - Absolute Gap% (descending)
   - Float Turnover % (descending)  
   - Volume (descending)

3. **Gap% Enrichment Order**: Always call `enrichRowsWithDailyOpen()` BEFORE any filtering by minGap threshold, because snapshot gap may be inaccurate (premarket open instead of RTH open)

4. **Float Enrichment**: Call `enrichRowsWithFloat()` after snapshot normalization but before final sorting

5. **Indicators Performance**: Reduce dataset size before calling `attachIndicatorsIfEnabled()` to minimize API calls (5m aggregates endpoint)

6. **Market Cap Categories**: 
   - Large: >= $10B
   - Mid: $2B - $10B  
   - Small: $300M - $2B
   - Micro: $50M - $300M
   - Nano: < $50M

7. **Float Categories**:
   - HighFloat: >= 100M shares
   - MidFloat: 20M - 100M shares
   - LowFloat: < 20M shares

## UI Dashboard Features
The `/ui` endpoint serves a single-page dashboard with:
- Symbol roller display (horizontal scrolling ticker list)
- Box matrix grid showing multiple market views simultaneously
- Max symbols stepper (20-1000, step 20) for scan size control
- Auto-refresh every 15 seconds (configurable via UI_AUTO_REFRESH_MS)
- Mini chart hover popup with EMA9/EMA34/SMA26/VWAP overlays
- Risk disclosure notice

## File Organization
- `server.js` - Main application (all-in-one monolith)
- `algtp-auth/` - Authentication subsystem (separate Express app)
- `public/index.html` - Static HTML (if needed; UI is inline in server.js)
- `.env` - All configuration (never commit this file)
- `package.json` - Dependencies: express, axios, ws, dotenv, passport, twilio

## Alternative Data Sources

If primary data sources (Polygon/Massive API, FMP) are unavailable or blocked, consider these alternatives:

### TradingView Issues
If TradingView is blocked or rate-limited:
- **Root causes**: Rate limiting, geo-blocking, Cloudflare protection, ISP restrictions
- **Quick check**: `curl -I https://www.tradingview.com`
- **Solutions**: 
  - **Client-side fetching** (Recommended): Let user's browser fetch from TradingView directly
  - See `CLIENT_SIDE_TRADINGVIEW.md` for complete implementation guide
  - Use TradingView official widgets (no API key needed, won't be blocked)
  - Server-side alternatives: Use VPN/proxy, rotate IPs, add request delays, implement proper headers

### Alternative APIs
1. **Yahoo Finance API**
   - Free and reliable
   - Good for historical and real-time data
   - Libraries: `yahoo-finance2` (Node.js), `yfinance` (Python)

2. **Alpha Vantage**
   - Free tier: 5 API calls/minute, 500 calls/day
   - Comprehensive technical indicators
   - Good for intraday data
   - URL: `https://www.alphavantage.co/`

3. **IEX Cloud**
   - Excellent for US stocks
   - Free tier available
   - Real-time and historical data
   - URL: `https://iexcloud.io/`

4. **Finnhub**
   - Free API key with 60 calls/minute
   - Real-time data, news, fundamentals
   - WebSocket support
   - URL: `https://finnhub.io/`

5. **Twelve Data**
   - Free tier: 800 calls/day
   - Technical indicators built-in
   - Good alternative to Alpha Vantage
   - URL: `https://twelvedata.com/`

### Implementation Notes
- Always implement proper rate limiting and caching
- Use exponential backoff for failed requests
- Rotate between multiple data sources for redundancy
- Store API keys in `.env` file, never hardcode
- Test with different market conditions (premarket, regular hours, after-hours)

## Troubleshooting

### 502 Bad Gateway Errors on Render
Common causes and solutions:

1. **Memory Issues (Free Tier: 512MB limit)**
   - Monitor memory via logs: `📊 Memory: Heap=XMB RSS=XMB`
   - Reduce cache sizes in `.env`:
     - `SNAP_CONCURRENCY=2` (down from 4)
     - `AM_CACHE_MAX=5000` (down from 8000)
     - `AGGS_5M_LIMIT=100` (down from 120)
     - `FLOAT_TTL_MS=43200000` (12 hours instead of 24)

2. **Service Timeout**
   - Check Render dashboard for service restarts
   - Health check endpoint `/api` should respond quickly
   - Verify `render.yaml` has proper health check configuration

3. **Cold Start Issues**
   - Free tier instances spin down after inactivity
   - First request after spin-down takes 30-60 seconds
   - Solution: Implement ping service or upgrade to paid tier

4. **API Rate Limiting**
   - Polygon/Massive API may return 429 errors
   - Implement exponential backoff in `safeGet()`
   - Increase cache TTLs to reduce API calls

5. **Deployment Issues**
   - Clear build cache: Render dashboard → Manual Deploy → Clear cache
   - Check build logs for npm install errors
   - Verify all environment variables are set correctly

### Immediate Fixes Checklist
```bash
# 1. Check service status
curl -I https://algtp-s1.onrender.com/api

# 2. Review Render logs for errors
# (via Render dashboard)

# 3. Restart service
# Render dashboard → Manual Deploy

# 4. Test locally first
npm start
curl http://localhost:3000/api
```

### Monitoring Commands
```bash
# Check memory usage (add to server.js)
setInterval(() => {
  const used = process.memoryUsage();
  console.log(`Memory: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);
}, 60000);

# Check cache sizes
curl http://localhost:3000/api | jq '.caches'
```

## Development Tips
- When modifying data processing, test with multiple market cap filters (small, mid, large)
- Always test both ENABLE_SNAPSHOT_ALL modes (true/false) as they use different code paths
- Check session filtering with `/premarket` and `/aftermarket` during appropriate market hours
- Monitor cache sizes via `/api` endpoint (amCacheSize, miniCacheSize, etc.)
- Use DEBUG=true for verbose error details in API responses
- Monitor memory usage regularly to prevent 502 errors on free tier deployments
