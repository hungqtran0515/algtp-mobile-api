# API Configuration Guide

## Overview
ALGTP™ supports multiple market data providers. This guide explains how to configure each provider correctly.

## Supported Providers

### 1. **Polygon.io** (Default & Recommended)

**Authentication:**
- API Key via query parameter `apiKey=YOUR_KEY`

**Configuration (.env):**
```bash
# Auth Settings
MASSIVE_API_KEY=your_polygon_api_key_here
MASSIVE_AUTH_TYPE=query
MASSIVE_QUERY_KEYNAME=apiKey

# REST API URLs
MASSIVE_MOVER_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks
MASSIVE_TICKER_SNAPSHOT_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers
MASSIVE_SNAPSHOT_ALL_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers
MASSIVE_AGGS_URL=https://api.polygon.io/v2/aggs/ticker

# WebSocket URL
MASSIVE_WS_URL=wss://socket.polygon.io/stocks
AM_WS_SUBS=AM.*

# Polygon Daily Aggregates (for accurate Gap%)
POLYGON_BASE_URL=https://api.polygon.io
POLYGON_API_KEY=your_polygon_api_key_here  # same as MASSIVE_API_KEY
```

**Get API Key:**
- Sign up at https://polygon.io
- Free tier: 5 API calls/minute
- Paid tiers: Higher rate limits + real-time data

---

### 2. **Massive API** (If you have their key)

**Authentication Methods:**
Massive API supports 3 auth methods. Choose one:

#### Option A: Query Parameter (Default)
```bash
MASSIVE_AUTH_TYPE=query
MASSIVE_QUERY_KEYNAME=apiKey  # or "token" depending on their docs
```

#### Option B: X-API-KEY Header
```bash
MASSIVE_AUTH_TYPE=xapi
```

#### Option C: Bearer Token
```bash
MASSIVE_AUTH_TYPE=bearer
```

**Configuration (.env):**
```bash
# Auth Settings
MASSIVE_API_KEY=your_massive_api_key_here
MASSIVE_AUTH_TYPE=query  # or xapi or bearer

# REST API URLs
MASSIVE_MOVER_URL=https://api.massive.com/v2/snapshot/locale/us/markets/stocks
MASSIVE_TICKER_SNAPSHOT_URL=https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers
MASSIVE_SNAPSHOT_ALL_URL=https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers
MASSIVE_AGGS_URL=https://api.massive.com/v2/aggs/ticker

# WebSocket URL
MASSIVE_WS_URL=wss://socket.massive.com/stocks
AM_WS_SUBS=AM.*

# Polygon for Gap% (optional, can use Massive if available)
POLYGON_BASE_URL=https://api.polygon.io
POLYGON_API_KEY=your_polygon_key_for_gap_calc
```

**Get API Key:**
- Contact Massive API support
- Check their docs for correct auth method and query param name

---

### 3. **Financial Modeling Prep** (Optional - Float Shares Only)

**Purpose:** Enrich stock data with float shares for Float Turnover % calculation

**Configuration (.env):**
```bash
ENABLE_FLOAT_ENRICH=true
FMP_API_KEY=your_fmp_api_key_here
FLOAT_TTL_MS=86400000  # 24 hours cache
```

**Get API Key:**
- Sign up at https://financialmodelingprep.com/developer/docs/
- Free tier: 250 requests/day

---

## Common Issues & Solutions

### ❌ Issue: 401 Unauthorized

**Symptoms:**
```
🚨 MASSIVE API 401 UNAUTHORIZED:
  URL: https://api.massive.com/v2/snapshot/locale/us/markets/stocks/gainers
  status: 401
  rows: []
```

**Solutions:**
1. **Wrong API provider URL**
   - Check if you're using `api.massive.com` with a Polygon key (or vice versa)
   - Fix: Update `MASSIVE_MOVER_URL` and other URLs to match your API provider

2. **Wrong auth method**
   - Polygon: Use `MASSIVE_AUTH_TYPE=query` with `MASSIVE_QUERY_KEYNAME=apiKey`
   - Massive: Check their docs for correct auth type (query/xapi/bearer)

3. **Wrong query parameter name**
   - Some APIs use `apiKey`, others use `token` or `api_key`
   - Fix: Update `MASSIVE_QUERY_KEYNAME` to match provider's docs

4. **Invalid or expired API key**
   - Verify your key is correct and active
   - Check API dashboard for usage limits

5. **IP-based rate limiting**
   - Some APIs block certain IPs or rate limit by IP
   - Check provider's status page

---

### ❌ Issue: Empty Data (0 rows)

**Symptoms:**
```
[fetchMovers PARSED] { rowCount: 0 }
```

**Solutions:**
1. Check if API returned data:
   ```bash
   # Test API directly with curl
   curl "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=YOUR_KEY"
   ```

2. Enable DEBUG mode to see raw responses:
   ```bash
   DEBUG=true
   ```

3. Verify market hours:
   - Some endpoints return empty during off-hours
   - Use `/premarket` or `/aftermarket` during extended hours

---

### ❌ Issue: WebSocket Connection Failed

**Symptoms:**
```
WebSocket error: connection failed
```

**Solutions:**
1. **Wrong WebSocket URL**
   - Polygon: `wss://socket.polygon.io/stocks`
   - Massive: `wss://socket.massive.com/stocks`
   - Fix: Update `MASSIVE_WS_URL` to match your provider

2. **Auth issue**
   - WebSocket auth is different from REST API
   - Check provider's WebSocket docs for auth flow

3. **Disable WebSocket if not needed**
   ```bash
   ENABLE_HALT_WS=false
   ENABLE_AM_WS=false
   ```

---

## Testing Your Configuration

### 1. Test REST API
```bash
npm start
# Open http://localhost:3000/api
# Check for "ok: true" and no 401 errors in logs
```

### 2. Test Movers Endpoint
```bash
# Open http://localhost:3000/movers-premarket?limit=10
# Should return data (not empty array)
```

### 3. Test WebSocket (if enabled)
```bash
# Check server logs for:
# ✅ WebSocket connected
# ❌ WebSocket error (if fails, disable or fix URL)
```

---

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MASSIVE_API_KEY` | ✅ Yes | - | API key for primary data source |
| `MASSIVE_AUTH_TYPE` | No | `query` | Auth method: `query`, `xapi`, or `bearer` |
| `MASSIVE_QUERY_KEYNAME` | No | `apiKey` | Query param name for API key |
| `MASSIVE_MOVER_URL` | No | Polygon URL | Movers endpoint |
| `MASSIVE_TICKER_SNAPSHOT_URL` | No | Polygon URL | Ticker snapshot endpoint |
| `MASSIVE_SNAPSHOT_ALL_URL` | No | Polygon URL | All tickers snapshot endpoint |
| `MASSIVE_AGGS_URL` | No | Polygon URL | Aggregates endpoint |
| `MASSIVE_WS_URL` | No | Polygon WS | WebSocket URL |
| `POLYGON_API_KEY` | No | Same as MASSIVE | For Gap% calculation |
| `FMP_API_KEY` | No | - | Financial Modeling Prep key |
| `ENABLE_FLOAT_ENRICH` | No | `false` | Enable float shares enrichment |
| `ENABLE_HALT_WS` | No | `true` | Enable halt monitoring WebSocket |
| `ENABLE_AM_WS` | No | `true` | Enable minute aggregates WebSocket |

---

## Migration Guide

### Switching from Massive to Polygon
1. Get Polygon API key from https://polygon.io
2. Update `.env`:
   ```bash
   MASSIVE_API_KEY=your_polygon_key
   MASSIVE_AUTH_TYPE=query
   MASSIVE_QUERY_KEYNAME=apiKey
   MASSIVE_MOVER_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks
   MASSIVE_TICKER_SNAPSHOT_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers
   MASSIVE_SNAPSHOT_ALL_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers
   MASSIVE_AGGS_URL=https://api.polygon.io/v2/aggs/ticker
   MASSIVE_WS_URL=wss://socket.polygon.io/stocks
   POLYGON_API_KEY=your_polygon_key
   ```
3. Restart server: `npm start`

### Switching from Polygon to Massive
1. Get Massive API key from provider
2. Check Massive docs for auth method (query/xapi/bearer)
3. Update `.env`:
   ```bash
   MASSIVE_API_KEY=your_massive_key
   MASSIVE_AUTH_TYPE=bearer  # or query/xapi based on docs
   MASSIVE_MOVER_URL=https://api.massive.com/v2/snapshot/locale/us/markets/stocks
   MASSIVE_TICKER_SNAPSHOT_URL=https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers
   MASSIVE_SNAPSHOT_ALL_URL=https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers
   MASSIVE_AGGS_URL=https://api.massive.com/v2/aggs/ticker
   MASSIVE_WS_URL=wss://socket.massive.com/stocks
   ```
4. Restart server: `npm start`

---

## Debug Mode

Enable verbose logging to troubleshoot API issues:

```bash
DEBUG=true
```

This will log:
- ✅ Auth method and headers sent
- ✅ API URLs being called
- ✅ Response status codes
- ✅ Parsed data row counts
- ❌ 401 errors with full details
- ❌ Network errors

---

## Support

If you continue to have issues:
1. Check server logs for error details
2. Test API with `curl` directly
3. Verify API key is active in provider dashboard
4. Check provider's status page for outages
5. Review provider's documentation for auth requirements
