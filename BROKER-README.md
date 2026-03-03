# ALGTP™ Alpaca Broker Integration

This module integrates Alpaca trading API with ALGTP scanner for automated trading execution.

## Setup Instructions

### 1. Get Alpaca API Keys

1. Go to [Alpaca](https://app.alpaca.markets/)
2. Sign up for a free account
3. Navigate to "Paper Trading" section
4. Generate API keys (Key ID + Secret Key)

### 2. Configure Environment Variables

Add your Alpaca credentials to `.env`:

```bash
# Alpaca Trading Broker
ALPACA_API_KEY=your_actual_key_id_here
ALPACA_SECRET_KEY=your_actual_secret_key_here
ALPACA_PAPER_TRADING=true  # Set to false for live trading (be careful!)
```

### 3. Test Connection

Run the example script to verify your setup:

```bash
node broker-example.js
```

You should see your account details, market status, and current positions.

## Usage Examples

### Import the Broker

```javascript
const { getBroker } = require('./broker');
const broker = getBroker();
```

### Initialize Connection

```javascript
await broker.initialize();
```

### Get Account Information

```javascript
const result = await broker.getAccount();
console.log(result.data.buyingPower);
console.log(result.data.cash);
```

### Place a Market Order

```javascript
const order = await broker.placeOrder({
  symbol: 'AAPL',
  qty: 10,
  side: 'buy',
  type: 'market'
});
```

### Place a Limit Order

```javascript
const order = await broker.placeOrder({
  symbol: 'TSLA',
  qty: 5,
  side: 'buy',
  type: 'limit',
  limitPrice: 250.00,
  timeInForce: 'day'
});
```

### Place an Extended Hours Order (Pre-Market / After-Hours)

```javascript
// Pre-market or after-hours limit order
const order = await broker.placeOrder({
  symbol: 'AAPL',
  qty: 100,
  side: 'buy',
  type: 'limit',
  limitPrice: 175.50,
  timeInForce: 'day',
  extendedHours: true  // Enable extended hours trading
});

// Or use session-specific helpers:
const preMarketOrder = await broker.placePreMarketOrder({
  symbol: 'NVDA',
  qty: 50,
  side: 'buy',
  limitPrice: 880.00
});

const afterHoursOrder = await broker.placeAfterHoursOrder({
  symbol: 'TSLA',
  qty: 25,
  side: 'sell',
  limitPrice: 250.00
});

// Smart order - automatically detects session
const smartOrder = await broker.placeSmartOrder({
  symbol: 'META',
  qty: 30,
  side: 'buy',
  limitPrice: 485.00
});
```

### Buy with Dollar Amount

```javascript
// Buy $1000 worth of NVDA
const order = await broker.buyDollars('NVDA', 1000);
```

### Get Current Positions

```javascript
const positions = await broker.getPositions();
positions.data.forEach(pos => {
  console.log(`${pos.symbol}: ${pos.qty} shares`);
  console.log(`P/L: $${pos.unrealizedPL} (${pos.unrealizedPLPct}%)`);
});
```

### Close a Position

```javascript
await broker.closePosition('AAPL');
```

### Cancel an Order

```javascript
await broker.cancelOrder(orderId);
```

### Check Market Status

```javascript
const clock = await broker.getClock();
console.log(`Market is ${clock.data.isOpen ? 'OPEN' : 'CLOSED'}`);
```

## Integration with ALGTP Scanner

You can integrate automated trading based on scanner signals:

```javascript
const { getBroker } = require('./broker');
const axios = require('axios');

async function autoTrade() {
  const broker = getBroker();
  await broker.initialize();

  // Get movers from ALGTP scanner
  const response = await axios.get('http://localhost:3000/movers-premarket?limit=10');
  const movers = response.data;

  // Filter by your criteria
  const signals = movers.filter(stock => 
    stock.gapPct > 10 &&           // Gap > 10%
    stock.floatTurnoverPct > 5 &&  // Float turnover > 5%
    stock.cap === 'small'          // Small cap
  );

  // Execute trades
  for (const stock of signals) {
    console.log(`Signal: ${stock.symbol} | Gap: ${stock.gapPct}%`);
    
    // Place order (example: buy $500 worth)
    const order = await broker.buyDollars(stock.symbol, 500);
    
    if (order.ok) {
      console.log(`Bought ${stock.symbol}: Order ID ${order.data.orderId}`);
    }
  }
}
```

## API Methods Reference

### Account Management
- `initialize()` - Connect and verify API credentials
- `getAccount()` - Get account details (cash, buying power, etc.)
- `getPositions()` - Get all current positions
- `getClock()` - Get market open/close status

### Order Management
- `placeOrder({ symbol, qty, side, type, limitPrice, timeInForce })` - Place an order
- `buyDollars(symbol, dollarAmount)` - Buy with dollar amount
- `getOrders(status)` - Get orders (status: 'open', 'closed', 'all')
- `cancelOrder(orderId)` - Cancel a specific order

### Position Management
- `closePosition(symbol)` - Close specific position
- `closeAllPositions()` - Close all positions

## Response Format

All methods return an object with this structure:

```javascript
{
  ok: true/false,
  data: { ... },      // Present if ok: true
  error: "message"    // Present if ok: false
}
```

## Safety Features

1. **Paper Trading Default**: The `.env` is configured for paper trading by default
2. **Error Handling**: All methods return error objects instead of throwing
3. **Order Validation**: Symbol is uppercased, quantities are validated
4. **Example Safety**: The example script has order placement commented out

## Important Notes

⚠️ **Risk Warning**: 
- Start with paper trading (ALPACA_PAPER_TRADING=true)
- Test thoroughly before switching to live trading
- Never risk more than you can afford to lose
- This is for educational purposes only

⚠️ **Pattern Day Trader Rule**:
- If you make 4+ day trades in 5 days, you need $25,000 minimum account balance
- Check `daytradeCount` in account info

⚠️ **Market Hours**:
- Regular hours: 9:30 AM - 4:00 PM ET
- Pre-market: 4:00 AM - 9:29 AM ET (extended hours)
- After-hours: 4:00 PM - 8:00 PM ET (extended hours)
- Extended hours only support limit orders (no market orders)
- Use `getClock()` to check market status or `getCurrentSession()` for session detection

## Extended Hours Trading

ALGTP now supports pre-market (4:00 AM - 9:29 AM ET) and after-hours (4:00 PM - 8:00 PM ET) trading.

### Quick Start

1. **Enable in your Alpaca account**: Settings → Trading → Enable Extended Hours
2. **Update `.env`**: Set `ENABLE_EXTENDED_HOURS_TRADING=true`
3. **Use limit orders only**: Extended hours don't support market orders

### Session Detection

```javascript
const session = broker.getCurrentSession();
// Returns: 'premarket', 'regular', 'afterhours', or 'closed'

const isExtended = broker.isExtendedHoursAvailable();
// Returns: true during pre-market or after-hours
```

### Scanner Integration Example

```javascript
const axios = require('axios');
const { getBroker } = require('./broker');

async function tradePreMarketSignals() {
  const broker = getBroker();
  await broker.initialize();

  // Get pre-market movers
  const response = await axios.get('http://localhost:3000/movers-premarket?limit=20');
  const signals = response.data.filter(s => s.gapPct > 15 && s.price >= 5);

  for (const stock of signals) {
    const limitPrice = (stock.price * 1.02).toFixed(2); // 2% buffer
    
    const order = await broker.placePreMarketOrder({
      symbol: stock.symbol,
      qty: 100,
      side: 'buy',
      limitPrice: Number(limitPrice)
    });
    
    if (order.ok) {
      console.log(`✅ Bought ${stock.symbol}`);
    }
  }
}
```

### Important Notes

⚠️ **Extended Hours Risks**:
- Lower liquidity and wider spreads
- Higher volatility
- Only limit orders supported
- Not all stocks available

📖 **Full Documentation**: See `EXTENDED_HOURS_TRADING.md` for complete guide with examples, risk management, and automated trading strategies.

## Support

For Alpaca API documentation: https://alpaca.markets/docs/

For Alpaca Extended Hours: https://alpaca.markets/docs/trading/orders/#extended-hours

For ALGTP scanner endpoints: Check `server.js` or visit http://localhost:3000/api

For Extended Hours guide: See `EXTENDED_HOURS_TRADING.md`
