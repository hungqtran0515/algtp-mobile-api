# Crypto Module Integration Guide

## Step 1: Import the Crypto Module

Add this import near the top of `server.js` (after other imports, around line 50):

```javascript
import { 
  handleCryptoMovers, 
  handleCryptoSymbol, 
  getCryptoStats,
  getCryptoCorrelation 
} from "./crypto-module.js";
```

## Step 2: Add API Routes

Find the section where routes are defined (search for `app.get("/dark-pool"` around line 3345), and add these routes:

```javascript
// ============================================================================
// Crypto API Endpoints
// ============================================================================
app.get("/crypto-movers", handleCryptoMovers);
app.get("/crypto/:symbol", handleCryptoSymbol);
```

## Step 3: Update API Status Endpoint

Find the `/api` endpoint (around line 3589) and add crypto stats:

```javascript
app.get("/api", (req, res) => {
  const cryptoStats = getCryptoStats();
  
  res.json({
    ok: true,
    config: {
      port: PORT,
      // ... existing config fields ...
      
      // Add these lines:
      cryptoCacheSize: cryptoStats.cacheSize,
      cryptoEnabled: cryptoStats.enabled,
      cryptoSymbols: cryptoStats.symbols,
    },
  });
});
```

## Step 4: Update Root Endpoint

Find the `/` endpoint (around line 3554) and add crypto endpoints to the list:

```javascript
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: `${BRAND.legal} running ✅`,
    ui: "/ui",
    endpoints: [
      // ... existing endpoints ...
      "/crypto-movers",
      "/crypto/:symbol",
      // ... rest of endpoints ...
    ],
  });
});
```

## Step 5: Add Crypto Box to Dashboard

Find the `FEATURE_REGISTRY` array (around line 6700) and add the crypto box:

```javascript
const FEATURE_REGISTRY = [
  // ... existing boxes ...
  
  // Add this line (after dark_pool box):
  { id:"crypto_movers", title:"₿ Crypto Market", minTier:"FREE14", endpoint:"/crypto-movers", cols:3, limit:20, sort:"pctDesc", type:"table", defaultOn:true },
  
  // ... rest of boxes ...
];
```

## Step 6: Update .env File

Add these lines to your `.env` file:

```bash
# Crypto Tracking Configuration
ENABLE_CRYPTO=true
CRYPTO_SYMBOLS=BTC,ETH,SOL,DOGE,AVAX,MATIC,XRP
CRYPTO_CACHE_TTL_MS=15000
```

## Step 7: Test the Integration

Start the server:
```bash
npm start
```

Test endpoints:
```bash
# Test crypto movers
curl http://localhost:3000/crypto-movers

# Test specific crypto
curl http://localhost:3000/crypto/BTC

# Check API status
curl http://localhost:3000/api | grep crypto
```

View dashboard:
```
http://localhost:3000/ui
```

You should see a new "₿ Crypto Market" box showing BTC, ETH, SOL, DOGE, AVAX, MATIC, XRP with real-time prices.

## Troubleshooting

**Error: "Crypto tracking disabled"**
- Check `.env` has `ENABLE_CRYPTO=true`
- Restart the server after editing `.env`

**Error: "Polygon API key required"**
- Make sure `POLYGON_API_KEY` is set in `.env`
- The same key used for stocks works for crypto

**Empty crypto box:**
- Test `/crypto-movers` endpoint directly
- Check browser console for errors
- Verify Polygon API key has crypto access

**Alternative: Use CoinGecko (No API Key)**

If Polygon crypto doesn't work, edit `crypto-module.js` to use CoinGecko:

```javascript
// Replace fetchCryptoSnapshot() function:
export async function fetchCryptoSnapshot(symbol) {
  const cryptoSymbol = String(symbol || "").trim().toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoSymbol}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  
  const r = await safeGet(url);
  if (!r.ok) return { ok: false, detail: r.errorDetail };
  
  const data = r.data[cryptoSymbol];
  if (!data) return { ok: false, reason: "no_data" };
  
  return {
    ok: true,
    data: {
      symbol: symbol.toUpperCase(),
      price: round2(data.usd),
      pricePct: round2(data.usd_24h_change),
      volume: Math.round(data.usd_24h_vol),
      isCrypto: true,
      lastUpdate: Date.now(),
    },
  };
}
```

## What You Get

✅ **Separate crypto box** on dashboard  
✅ **Real-time prices** for BTC, ETH, SOL, DOGE, AVAX, MATIC, XRP  
✅ **% change indicators** (green/red)  
✅ **15-second cache** to avoid rate limits  
✅ **Clean modular code** (easy to maintain)  
✅ **BTC/ETH correlation data** available via `getCryptoCorrelation()`  

## Future Enhancements

1. Add crypto mini-charts on hover
2. Add crypto alerts (>5% move)
3. Calculate stock/crypto correlation scores
4. Add crypto dominance tracking
5. Add DeFi metrics (TVL, yield)
