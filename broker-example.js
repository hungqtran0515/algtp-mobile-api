/**
 * ALGTP™ Broker Integration Example
 * Demo script showing how to use Alpaca broker with ALGTP scanner
 */

const { getBroker } = require('./broker');

async function example() {
  const broker = getBroker();

  console.log('=== ALPACA BROKER INTEGRATION DEMO ===\n');

  // 1. Initialize connection
  console.log('1. Connecting to Alpaca...');
  const initResult = await broker.initialize();
  if (!initResult.ok) {
    console.error('Failed to connect:', initResult.error);
    process.exit(1);
  }

  // 2. Get account info
  console.log('\n2. Getting account information...');
  const accountResult = await broker.getAccount();
  if (accountResult.ok) {
    console.log('Account Details:');
    console.log(`  Status: ${accountResult.data.status}`);
    console.log(`  Cash: $${accountResult.data.cash.toFixed(2)}`);
    console.log(`  Buying Power: $${accountResult.data.buyingPower.toFixed(2)}`);
    console.log(`  Portfolio Value: $${accountResult.data.portfolioValue.toFixed(2)}`);
    console.log(`  Daytrade Count: ${accountResult.data.daytradeCount}`);
  }

  // 3. Check market status
  console.log('\n3. Checking market status...');
  const clockResult = await broker.getClock();
  if (clockResult.ok) {
    console.log(`  Market is ${clockResult.data.isOpen ? 'OPEN' : 'CLOSED'}`);
    console.log(`  Next Open: ${clockResult.data.nextOpen}`);
    console.log(`  Next Close: ${clockResult.data.nextClose}`);
  }

  // 4. Get current positions
  console.log('\n4. Getting current positions...');
  const positionsResult = await broker.getPositions();
  if (positionsResult.ok) {
    if (positionsResult.data.length === 0) {
      console.log('  No open positions');
    } else {
      positionsResult.data.forEach(pos => {
        console.log(`  ${pos.symbol}: ${pos.qty} shares @ $${pos.avgEntryPrice.toFixed(2)}`);
        console.log(`    Current: $${pos.currentPrice.toFixed(2)} | P/L: $${pos.unrealizedPL.toFixed(2)} (${pos.unrealizedPLPct.toFixed(2)}%)`);
      });
    }
  }

  // 5. Get open orders
  console.log('\n5. Getting open orders...');
  const ordersResult = await broker.getOrders('open');
  if (ordersResult.ok) {
    if (ordersResult.data.length === 0) {
      console.log('  No open orders');
    } else {
      ordersResult.data.forEach(order => {
        console.log(`  ${order.symbol}: ${order.side} ${order.qty} @ ${order.type}`);
        console.log(`    Status: ${order.status} | Filled: ${order.filledQty}`);
      });
    }
  }

  // EXAMPLE: Place a test order (COMMENTED OUT FOR SAFETY)
  // Uncomment to test placing orders
  /*
  console.log('\n6. Placing test order (10 shares of AAPL)...');
  const orderResult = await broker.placeOrder({
    symbol: 'AAPL',
    qty: 10,
    side: 'buy',
    type: 'limit',
    limitPrice: 150.00,
    timeInForce: 'day'
  });
  
  if (orderResult.ok) {
    console.log('  Order placed successfully!');
    console.log(`  Order ID: ${orderResult.data.orderId}`);
    console.log(`  Status: ${orderResult.data.status}`);
  } else {
    console.error('  Order failed:', orderResult.error);
  }
  */

  console.log('\n=== DEMO COMPLETE ===');
}

// Run the example
example().catch(console.error);
