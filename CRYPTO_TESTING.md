# Crypto Tracking Test Guide

## Testing Your New Crypto Features

### 1. Update .env File

Add these lines to your `.env` file:

```bash
# Crypto Tracking Configuration
ENABLE_CRYPTO=true
CRYPTO_SYMBOLS=BTC,ETH,SOL,DOGE,AVAX,MATIC,XRP
CRYPTO_CACHE_TTL_MS=15000
```

### 2. Start the Server

```bash
npm start
```

### 3. Test API Endpoints

Open your browser or use curl to test:

**Test crypto movers:**
```bash
curl http://localhost:3000/crypto-movers
```

Expected response:
```json
{
  "ok": true,
  "count": 7,
  "results": [
    {
      "symbol": "BTC",
      "isCrypto": true,
      "price": 98234.50,
      "open": 97500.00,
      "prevClose": 96800.00,
      "pricePct": 1.48,
      "gapPct": 0.75,
      "volume": 12345678,
      "lastUpdate": 1738897234567
    },
    ...
  ],
  "symbols": "BTC,ETH,SOL,DOGE,AVAX,MATIC,XRP",
  "note": "Crypto prices via Polygon API"
}
```

**Test individual crypto:**
```bash
curl http://localhost:3000/crypto/BTC
```

### 4. View Dashboard

Open: `http://localhost:3000/ui`

You should see a new **₿ Crypto Market** box showing:
- BTC, ETH, SOL, DOGE, AVAX, MATIC, XRP
- Real-time prices
- % change (green for positive, red for negative)
- Sorted by highest % change

### 5. Verify Cache

Check the API status to see cache stats:

```bash
curl http://localhost:3000/api
```

Look for:
```json
{
  "cryptoCacheSize": 7,
  "cryptoEnabled": true,
  "cryptoSymbols": "BTC,ETH,SOL,DOGE,AVAX,MATIC,XRP"
}
```

### 6. Test Correlation Feature (Option 3)

The `getCryptoCorrelation()` function is now available for future use. You can fetch BTC/ETH prices to display alongside stocks for correlation analysis.

To use it in any endpoint:
```javascript
const crypto = await getCryptoCorrelation();
// Returns: { btc: {...}, eth: {...}, timestamp: ... }
```

### 7. Troubleshooting

**If crypto box is empty:**
1. Check `.env` has `ENABLE_CRYPTO=true`
2. Verify `POLYGON_API_KEY` is set
3. Check browser console for errors
4. Test `/crypto-movers` endpoint directly

**If Polygon API errors:**
- Polygon crypto API uses format: `X:BTCUSD`
- Free tier has rate limits (5 calls/minute)
- Cache reduces API calls (15 second TTL)

**Alternative: Use CoinGecko/Binance**
If Polygon crypto doesn't work, you can switch to CoinGecko (no API key needed):

```javascript
// Replace fetchCryptoSnapshot() with:
async function fetchCryptoSnapshot(symbol) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`;
  const r = await safeGet(url, {});
  // ... parse response
}
```

### 8. Dashboard Features

**Crypto Box Features:**
- ✅ Real-time prices (15s cache)
- ✅ % change indicator
- ✅ Volatility tracking
- ✅ Click symbol → view details (if implemented)
- ✅ Auto-refresh every 15 seconds

**Integration with Stocks:**
- Crypto correlation data available via `getCryptoCorrelation()`
- Can be used to show BTC/ETH sentiment alongside stock data
- Useful for correlation analysis (e.g., tech stocks vs BTC)

### 9. Customization

**Change tracked symbols:**
Edit `.env`:
```bash
CRYPTO_SYMBOLS=BTC,ETH,ADA,DOT,LINK,UNI
```

**Adjust cache time:**
```bash
CRYPTO_CACHE_TTL_MS=30000  # 30 seconds
```

**Disable crypto:**
```bash
ENABLE_CRYPTO=false
```

## What's Next?

1. **Add crypto mini-charts** - Show price history on hover
2. **Crypto alerts** - Notify when BTC/ETH moves >5%
3. **Correlation scoring** - Calculate stock/crypto correlation
4. **Crypto dominance** - Track BTC dominance %
5. **DeFi metrics** - Add TVL, yield data

## Why Crypto Tracking Matters

- **Market sentiment indicator** - BTC often leads or correlates with tech stocks
- **Risk-on/risk-off** - Crypto moves indicate market risk appetite
- **24/7 data** - Crypto trades when stock market is closed
- **Correlation trading** - Some stocks (MSTR, COIN, RIOT) closely follow BTC
- **Diversification** - Monitor alternative asset class alongside stocks
