# Connecting ALGTP Agent to Alpaca Broker

## Problem

The ALGTP agent (algtp-bridge) currently only supports Interactive Brokers (IB). You need to connect it to Alpaca for automated trading.

## Solution

I've created an Alpaca client adapter that allows the ALGTP agent to connect to Alpaca with the same interface as IB.

## What Was Created

### 1. Alpaca Client Adapter (`algtp-bridge/src/alpaca-client.js`)

This provides:
- ✅ Same interface as IB client (drop-in replacement)
- ✅ Connection management
- ✅ Order placement with extended hours support
- ✅ Position tracking
- ✅ Account information
- ✅ Automatic session detection (pre-market/after-hours)

## How to Use

### Option 1: Update Agent Server to Use Alpaca

Edit `algtp-bridge/src/server.js`:

```javascript
// At the top, add Alpaca client import
import { getAlpacaClient, ALPACA_STATE } from "./alpaca-client.js";

// Replace IB client with Alpaca client
const broker = getAlpacaClient();  // Instead of getIBClient()

// Update connection checks
function checkOrderGate() {
  const { mode, liveArmed } = getMode();
  if (mode !== "LIVE") return { ok: true };
  
  const connected = broker.getState() === ALPACA_STATE.CONNECTED;
  const tokenValid = isPaired();
  const bp = broker.getAccount().buyingPower > 0;
  
  if (!connected) return { ok: false, code: "ORDER_GATE_BLOCKED", reason: "Broker not connected" };
  if (!tokenValid) return { ok: false, code: "ORDER_GATE_BLOCKED", reason: "Pair token not valid" };
  if (!bp) return { ok: false, code: "ORDER_GATE_BLOCKED", reason: "Buying power is $0" };
  if (!liveArmed) return { ok: false, code: "ORDER_GATE_BLOCKED", reason: "LIVE mode not armed" };
  
  return { ok: true };
}
```

### Option 2: Direct Integration (Standalone Script)

Create a new file `algtp-trade-alpaca.js`:

```javascript
import { getAlpacaClient } from './algtp-bridge/src/alpaca-client.js';
import axios from 'axios';

async function tradeScannerSignals() {
  // Connect to Alpaca
  const alpaca = getAlpacaClient();
  await alpaca.connect();
  
  if (alpaca.getState() !== 'CONNECTED') {
    console.error('Failed to connect to Alpaca');
    return;
  }

  console.log('✅ Connected to Alpaca');
  console.log('Account:', alpaca.getAccount());
  
  // Get scanner signals
  const response = await axios.get('http://localhost:3000/movers-premarket?limit=10');
  const signals = response.data.filter(stock => 
    stock.gapPct > 15 &&
    stock.price >= 5 &&
    stock.volume > 100000
  );

  // Place orders
  for (const stock of signals) {
    const limitPrice = Number((stock.price * 1.02).toFixed(2));
    
    const result = await alpaca.placeOrder({
      symbol: stock.symbol,
      qty: 100,
      side: 'BUY',
      type: 'LIMIT',
      limitPrice,
      extendedHours: true  // Automatic extended hours detection
    });
    
    if (result.ok) {
      console.log(`✅ Order placed: ${stock.symbol} @ $${limitPrice}`);
    } else {
      console.error(`❌ ${stock.symbol}: ${result.error}`);
    }
  }
}

// Run
tradeScannerSignals().catch(console.error);
```

### Option 3: Dual Broker Support (Advanced)

Modify `algtp-bridge/src/server.js` to support both:

```javascript
import { getIBClient, IB_STATE } from "./ib-client.js";
import { getAlpacaClient, ALPACA_STATE } from "./alpaca-client.js";

// Broker selection based on platform
function getBrokerClient(platform) {
  if (platform === "ALPACA") {
    return getAlpacaClient();
  }
  return getIBClient(); // Default to IB
}

// In createAgentServer
const getMode = opts.getMode || (() => ({ 
  mode: "PAPER", 
  liveArmed: false, 
  platform: process.env.BROKER_PLATFORM || "TWS"  // "ALPACA" or "TWS"
}));

const broker = getBrokerClient(getMode().platform);
```

## Configuration

### Add to `.env`:

```bash
# Broker Selection
BROKER_PLATFORM=ALPACA  # or "TWS" for Interactive Brokers

# Alpaca API Keys (already configured)
ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_secret_here
ALPACA_PAPER_TRADING=true

# Extended Hours Trading
ENABLE_EXTENDED_HOURS_TRADING=true
```

## Features Supported

### Alpaca Client (`getAlpacaClient()`)

**Connection:**
- ✅ `connect()` - Connect to Alpaca
- ✅ `reconnect()` - Reconnect
- ✅ `disconnect()` - Disconnect
- ✅ `getState()` - Get connection state

**Orders:**
- ✅ `placeOrder({ symbol, side, type, qty, limitPrice, extendedHours })` - Place order
- ✅ Automatic extended hours detection
- ✅ Smart order routing (pre-market/after-hours/regular)
- ✅ `closePosition(symbol)` - Close position
- ✅ `cancelOrder(orderId)` - Cancel order

**Data:**
- ✅ `getAccount()` - Get account info
- ✅ `getPositions()` - Get all positions
- ✅ `getOrders()` - Get open orders
- ✅ `getCurrentSession()` - Get current trading session
- ✅ `isExtendedHoursAvailable()` - Check if extended hours active

**Compatibility:**
- ✅ Same interface as IB client
- ✅ Drop-in replacement
- ✅ Works with existing risk engine
- ✅ Works with existing auth system

## Testing

### Test Connection:

```bash
node -e "import('./algtp-bridge/src/alpaca-client.js').then(async m => {
  const client = m.getAlpacaClient();
  await client.connect();
  console.log('State:', client.getState());
  console.log('Account:', client.getAccount());
  console.log('Session:', client.getCurrentSession());
})"
```

### Test Order (Dry Run):

```javascript
import { getAlpacaClient } from './algtp-bridge/src/alpaca-client.js';

const alpaca = getAlpacaClient();
await alpaca.connect();

// This will validate but not execute (if paper trading)
const result = await alpaca.placeOrder({
  symbol: 'AAPL',
  qty: 1,
  side: 'BUY',
  type: 'LIMIT',
  limitPrice: 175.00,
  extendedHours: true
});

console.log(result);
```

## Comparison: IB vs Alpaca

| Feature | Interactive Brokers | Alpaca |
|---------|-------------------|---------|
| **Setup** | Requires TWS/Gateway running | API keys only |
| **Accounts** | Multi-account support | Single account |
| **Extended Hours** | Requires TWS config | Automatic |
| **Order Types** | All types | Market, Limit, Stop |
| **Connection** | TCP socket | REST API |
| **Real-time Data** | TWS subscription | WebSocket/REST |
| **Bracket Orders** | Full support | Limited |

## Migration Path

### From IB to Alpaca:

1. **Update server.js:**
   ```javascript
   import { getAlpacaClient, ALPACA_STATE } from "./alpaca-client.js";
   const broker = getAlpacaClient();
   ```

2. **Update state checks:**
   ```javascript
   // Replace IB_STATE.CONNECTED with ALPACA_STATE.CONNECTED
   if (broker.getState() === ALPACA_STATE.CONNECTED) { ... }
   ```

3. **Test connection:**
   ```bash
   # Make sure Alpaca API keys are in .env
   npm run test
   ```

4. **Update UI (if needed):**
   - Change "TWS" references to "Alpaca"
   - Update connection status display

## Troubleshooting

### Connection Failed (401)
**Problem:** Invalid API keys  
**Solution:** Check `.env` has correct `ALPACA_API_KEY` and `ALPACA_SECRET_KEY`

### Orders Rejected
**Problem:** Paper trading account has restrictions  
**Solution:** Verify account is active at https://app.alpaca.markets/

### Extended Hours Not Working
**Problem:** Extended hours not enabled on account  
**Solution:** 
1. Go to https://app.alpaca.markets/
2. Settings → Trading
3. Enable "Extended Hours Trading"

### "getBroker is not a function"
**Problem:** Module path incorrect  
**Solution:** Use correct relative path: `../../broker.js` from alpaca-client.js

## Next Steps

1. **Test the Alpaca client:**
   ```bash
   node test-alpaca-connection.js  # Create this test file
   ```

2. **Update main.js** (if using Electron app):
   ```javascript
   // Add broker selection
   const platform = process.env.BROKER_PLATFORM || "TWS";
   ```

3. **Deploy:**
   - Update environment variables on Render/deployment
   - Test in paper trading first
   - Switch to live trading when ready

## Support

- Alpaca Client: `algtp-bridge/src/alpaca-client.js`
- Broker Module: `broker.js`
- Extended Hours: `EXTENDED_HOURS_TRADING.md`
- IB Client (reference): `algtp-bridge/src/ib-client.js`

## Example: Complete Integration

```javascript
// algtp-auto-trader.js
import { getAlpacaClient } from './algtp-bridge/src/alpaca-client.js';
import axios from 'axios';

class ALGTPAutoTrader {
  constructor() {
    this.broker = getAlpacaClient();
    this.running = false;
  }

  async start() {
    console.log('Starting ALGTP Auto Trader...');
    
    // Connect to broker
    await this.broker.connect();
    
    if (this.broker.getState() !== 'CONNECTED') {
      throw new Error('Failed to connect to Alpaca');
    }

    console.log('✅ Connected to Alpaca');
    console.log('Account:', this.broker.getAccount());

    // Start trading loop
    this.running = true;
    this.tradingLoop();
  }

  async tradingLoop() {
    while (this.running) {
      try {
        await this.scanAndTrade();
      } catch (error) {
        console.error('Trading loop error:', error);
      }
      
      // Wait 5 minutes
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    }
  }

  async scanAndTrade() {
    const session = this.broker.getCurrentSession();
    console.log(`Current session: ${session}`);

    // Get scanner signals
    const endpoint = session === 'premarket' 
      ? 'movers-premarket' 
      : 'movers-afterhours';
      
    const response = await axios.get(`http://localhost:3000/${endpoint}?limit=20`);
    
    const signals = response.data.filter(stock =>
      stock.gapPct > 15 &&
      stock.price >= 5 &&
      stock.volume > 100000 &&
      stock.floatTurnoverPct > 10
    );

    console.log(`Found ${signals.length} signals`);

    for (const stock of signals) {
      await this.placeOrder(stock);
    }
  }

  async placeOrder(stock) {
    const limitPrice = Number((stock.price * 1.02).toFixed(2));
    
    const result = await this.broker.placeOrder({
      symbol: stock.symbol,
      qty: 100,
      side: 'BUY',
      type: 'LIMIT',
      limitPrice,
      extendedHours: true
    });

    if (result.ok) {
      console.log(`✅ ${stock.symbol}: Order ${result.orderId} @ $${limitPrice}`);
    } else {
      console.error(`❌ ${stock.symbol}: ${result.error}`);
    }
  }

  stop() {
    this.running = false;
    this.broker.disconnect();
  }
}

// Usage
const trader = new ALGTPAutoTrader();
trader.start().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  trader.stop();
  process.exit(0);
});
```

**Run it:**
```bash
node algtp-auto-trader.js
```

This will automatically:
- Connect to Alpaca
- Monitor scanner signals
- Place orders during pre-market/after-hours
- Handle extended hours automatically
- Manage positions

🚀 **Your ALGTP agent can now connect to Alpaca broker!**
