# Dark Pool Activity Tracking Feature

## Overview
The Dark Pool Activity Tracking feature monitors institutional trading activity that occurs off public exchanges. This provides insights into large block trades and institutional buying/selling pressure, which can signal significant price movements.

## Features
- **Real-time Dark Pool Monitoring**: Track dark pool volume percentage for active stocks
- **Block Trade Detection**: Identify large institutional trades (>10K shares or >$100K value)
- **Dark vs Lit Volume Ratio**: Compare off-exchange vs on-exchange trading activity
- **Unusual Activity Alerts**: Detect spikes and anomalies in dark pool trading
- **Multi-Venue Tracking**: Monitor trades across major dark pool venues (FINRA ADF, BATS Y, CSE, etc.)

## Data Sources
Uses **Polygon.io Trades API** to fetch individual trade-level data and parse by exchange codes:
- `D` - FINRA ADF (Dark Pool)
- `Y` - BATS Y-Exchange (Dark)
- `M` - Chicago Stock Exchange (Dark Pool)
- `J` - Direct Edge A (Dark)
- `K` - Direct Edge X (Dark)

## API Endpoints

### 1. GET /dark-pool
Returns top symbols by dark pool activity percentage.

**Query Parameters:**
- `limit` (number, default: 100) - Maximum results to return (10-500)
- `minDarkPct` (number, default: 0) - Minimum dark pool percentage filter

**Response:**
```json
{
  "ok": true,
  "count": 50,
  "lookbackHours": 24,
  "results": [
    {
      "symbol": "NVDA",
      "darkPoolPct": 45.23,
      "blockTrades": 15,
      "avgBlockSize": 125000,
      "totalDarkVolume": 5000000,
      "litVolume": 6000000,
      "darkVsLitRatio": 0.83,
      "largestBlock": 500000,
      "darkPoolScore": 0.7854,
      "lastUpdate": 1675634400000
    }
  ]
}
```

### 2. GET /dark-pool/:symbol
Returns detailed dark pool activity for a specific symbol.

**Example:** `GET /dark-pool/NVDA`

**Response:**
```json
{
  "ok": true,
  "symbol": "NVDA",
  "metrics": {
    "symbol": "NVDA",
    "darkPoolPct": 45.23,
    "blockTrades": 15,
    "avgBlockSize": 125000,
    "totalDarkVolume": 5000000,
    "litVolume": 6000000,
    "darkVsLitRatio": 0.83,
    "largestBlock": 500000,
    "lastUpdate": 1675634400000
  },
  "darkPoolScore": 0.7854,
  "cached": false,
  "tradeCount": 1523,
  "lookbackHours": 24
}
```

### 3. GET /dark-pool-alerts
Returns unusual dark pool activity alerts.

**Alert Types:**
- `HIGH_DARK_PCT` - Dark pool volume >40% (heavy institutional interest)
- `LARGE_BLOCK` - Single block trade >1M shares
- `MULTIPLE_BLOCKS` - 10+ block trades detected
- `DARK_DOMINANCE` - Dark volume >1.5x lit volume

**Response:**
```json
{
  "ok": true,
  "count": 25,
  "lookbackHours": 24,
  "timestamp": 1675634400000,
  "alerts": [
    {
      "symbol": "TSLA",
      "type": "HIGH_DARK_PCT",
      "severity": "high",
      "darkPoolPct": 52.34,
      "message": "TSLA: 52.34% dark pool activity (heavy institutional interest)"
    },
    {
      "symbol": "AAPL",
      "type": "LARGE_BLOCK",
      "severity": "medium",
      "blockSize": 1500000,
      "blockCount": 3,
      "message": "AAPL: Large block trade 1500K shares"
    }
  ]
}
```

## Integration with Existing Endpoints

### /scan Endpoint Enhancement
The `/scan` endpoint now includes dark pool metrics for all scanned symbols:

```json
{
  "ok": true,
  "results": [
    {
      "symbol": "NVDA",
      "price": 450.25,
      "gapPct": 5.23,
      // ... existing fields ...
      "darkPoolPct": 45.23,
      "darkBlockTrades": 15,
      "darkAvgBlockSize": 125000,
      "darkTotalVolume": 5000000,
      "darkLitVolume": 6000000,
      "darkVsLitRatio": 0.83,
      "darkLargestBlock": 500000,
      "darkPoolSource": "polygon_trades_api"
    }
  ]
}
```

## Configuration

### Environment Variables
Add these to your `.env` file:

```bash
# Enable/disable dark pool tracking
ENABLE_DARK_POOL=true

# Cache TTL (default: 5 minutes)
DARK_POOL_CACHE_TTL_MS=300000

# Minimum block size to track (default: 10,000 shares)
DARK_POOL_MIN_SIZE=10000

# Minimum block trade value (default: $100,000 USD)
DARK_POOL_MIN_VALUE=100000

# Lookback window (default: 24 hours)
DARK_POOL_LOOKBACK_HOURS=24
```

### Requirements
- **Polygon API Key**: Required for trade-level data access
- Feature automatically disabled if `POLYGON_API_KEY` is missing or `ENABLE_DARK_POOL=false`

## Metrics Explained

### darkPoolPct
**Definition**: Percentage of total volume traded on dark pools
```
darkPoolPct = (darkVolume / totalVolume) * 100
```
**Interpretation:**
- <20%: Mostly lit exchange trading (retail/transparent)
- 20-40%: Moderate institutional interest
- >40%: Heavy institutional activity (significant position building/unwinding)

### darkVsLitRatio
**Definition**: Ratio of dark pool volume to lit exchange volume
```
darkVsLitRatio = darkVolume / litVolume
```
**Interpretation:**
- <0.5: Retail-dominated
- 0.5-1.0: Mixed retail/institutional
- >1.0: Institutional-dominated
- >1.5: Heavy dark pool dominance (alert level)

### blockTrades
**Definition**: Count of trades meeting block criteria:
- Size >= `DARK_POOL_MIN_SIZE` (default: 10K shares)
- Value >= `DARK_POOL_MIN_VALUE` (default: $100K)

### darkPoolScore
**Composite score** (0-1 scale) for ranking symbols:
- 50% weight: Dark pool percentage
- 25% weight: Block trade count
- 25% weight: Dark vs lit ratio

## Performance Considerations

### Caching Strategy
- **5-minute TTL** on dark pool metrics (configurable)
- Aggressive caching to minimize API calls
- Cache warm-up on first request per symbol

### Concurrency Control
- Parallel fetching with `mapPool()` helper
- Limit controlled by `SNAP_CONCURRENCY` setting (default: 4)
- Max enrichment: 200 symbols per request

### Rate Limiting
- Respects Polygon API rate limits
- Graceful degradation if API unavailable
- Returns data without dark pool metrics on failure

## Use Cases

### 1. Institutional Activity Detection
Identify stocks with heavy institutional trading:
```bash
GET /dark-pool?minDarkPct=40&limit=20
```

### 2. Block Trade Monitoring
Watch for large institutional positions:
```bash
GET /dark-pool-alerts
```

### 3. Smart Money Following
Track symbols where institutions are accumulating:
```bash
GET /dark-pool/:symbol
```

### 4. Watchlist Enrichment
Add dark pool context to your scanned symbols:
```bash
GET /scan?symbols=NVDA,TSLA,AAPL
```

## Trading Signals

### Bullish Signals
- ✅ High dark pool % (>40%) + rising price = Institutional accumulation
- ✅ Multiple block trades + low lit volume = Smart money buying quietly
- ✅ Dark pool spike during consolidation = Potential breakout setup

### Bearish Signals
- ⚠️ High dark pool % + falling price = Institutional distribution
- ⚠️ Large blocks near resistance = Smart money selling into strength
- ⚠️ Dark pool dominance fading = Institutional interest waning

### Neutral/Watch
- 📊 Consistent 20-40% dark pool = Normal institutional participation
- 📊 Sudden spike then drop = One-time block, not sustained interest
- 📊 Dark pool % matching historical average = No unusual activity

## Security & Privacy
- **No PII tracking**: Only aggregates anonymous trade data
- **Public data only**: Uses publicly available market data
- **Rate limited**: Respects API provider limits
- **Error handling**: Graceful fallback if data unavailable

## Testing
Test endpoints with real symbols:
```bash
# Test all dark pool activity
curl http://localhost:3000/dark-pool?limit=10

# Test specific symbol
curl http://localhost:3000/dark-pool/NVDA

# Test alerts
curl http://localhost:3000/dark-pool-alerts

# Test integration with scan
curl http://localhost:3000/scan?symbols=NVDA,TSLA,AAPL
```

## Troubleshooting

### Issue: "Dark pool tracking disabled"
**Solution**: Set `ENABLE_DARK_POOL=true` in `.env`

### Issue: "Polygon API key required"
**Solution**: Set `POLYGON_API_KEY` in `.env`

### Issue: No dark pool data returned
**Possible causes:**
- Symbol has low trading volume (no dark pool trades in lookback window)
- API rate limit exceeded (wait and retry)
- Symbol not traded on dark pools recently
- Cache expired (automatic refresh on next request)

### Issue: Slow response times
**Solutions:**
- Increase `DARK_POOL_CACHE_TTL_MS` for longer cache
- Reduce `DARK_POOL_LOOKBACK_HOURS` for smaller data window
- Limit symbols scanned per request
- Enable turbo mode: `GET /scan?turbo=1`

## Future Enhancements
Potential improvements for future versions:
- [ ] Venue-specific breakdown (UBS, Credit Suisse, Goldman, etc.)
- [ ] Historical dark pool trend charts
- [ ] Correlation with price movement analysis
- [ ] Dark pool vs insider buying correlation
- [ ] Intraday dark pool flow (hourly buckets)
- [ ] Dark pool footprint visualization
- [ ] Machine learning models for pattern detection

## Credits
- **Data Provider**: Polygon.io
- **Feature Design**: ALGTP Development Team
- **Implementation Date**: February 2026
