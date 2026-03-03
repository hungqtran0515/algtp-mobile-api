#!/usr/bin/env node

/**
 * ALGTP Backtesting CLI
 * 
 * Usage: node backtest-cli.js [options]
 * 
 * Example: node backtest-cli.js --symbols NVDA,TSLA --days 30 --strategy gap-momentum
 */

import axios from 'axios';
import { config } from 'dotenv';

config();

// Strategy implementations
const strategies = {
  'gap-momentum': {
    name: 'Gap & Momentum Strategy',
    description: 'Buys stocks with gap >= 5% and volume spike, sells on 10% profit or -5% stop loss',
    enter: (data) => {
      return Math.abs(data.gapPct) >= 5 && data.volume > data.avgVolume * 2;
    },
    exit: (entry, current) => {
      const pnlPct = ((current.price - entry.price) / entry.price) * 100;
      return pnlPct >= 10 || pnlPct <= -5; // Take profit or stop loss
    }
  },
  'float-rotation': {
    name: 'Low Float High Turnover',
    description: 'Targets low float stocks with >50% float turnover',
    enter: (data) => {
      return data.floatM < 20 && data.floatTurnoverPct > 50;
    },
    exit: (entry, current) => {
      const pnlPct = ((current.price - entry.price) / entry.price) * 100;
      return pnlPct >= 15 || pnlPct <= -7;
    }
  },
  'indicator-cross': {
    name: 'EMA9/EMA34 Cross',
    description: 'Buy when EMA9 crosses above EMA34, sell when it crosses below',
    enter: (data) => {
      return data.ema9 && data.ema34 && data.ema9 > data.ema34 && data.volume > data.avgVolume;
    },
    exit: (entry, current) => {
      return current.ema9 && current.ema34 && current.ema9 < current.ema34;
    }
  }
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    symbols: ['NVDA', 'TSLA', 'AAPL', 'AMD', 'MSFT'],
    strategy: 'gap-momentum',
    capital: 10000,
    positionSize: 0.1, // 10% of capital per trade
    days: 30,
    server: 'http://localhost:3000'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbols' && args[i + 1]) {
      options.symbols = args[i + 1].split(',').map(s => s.trim().toUpperCase());
      i++;
    } else if (args[i] === '--strategy' && args[i + 1]) {
      options.strategy = args[i + 1];
      i++;
    } else if (args[i] === '--capital' && args[i + 1]) {
      options.capital = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--position' && args[i + 1]) {
      options.positionSize = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--days' && args[i + 1]) {
      options.days = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--server' && args[i + 1]) {
      options.server = args[i + 1];
      i++;
    } else if (args[i] === '--help') {
      printHelp();
      process.exit(0);
    } else if (args[i] === '--list-strategies') {
      listStrategies();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
ALGTP Backtesting CLI
Usage: node backtest-cli.js [options]

Options:
  --symbols <list>      Comma-separated symbols (default: NVDA,TSLA,AAPL,AMD,MSFT)
  --strategy <name>     Strategy to use (default: gap-momentum)
  --capital <amount>    Starting capital (default: 10000)
  --position <ratio>    Position size as decimal (default: 0.1 = 10%)
  --days <number>       Days of historical data (default: 30)
  --server <url>        ALGTP server URL (default: http://localhost:3000)
  --list-strategies     Show available strategies
  --help                Show this help

Examples:
  node backtest-cli.js --symbols NVDA,TSLA --days 30
  node backtest-cli.js --strategy float-rotation --capital 50000
  `);
}

function listStrategies() {
  console.log('\\nAvailable Backtesting Strategies:\\n');
  Object.keys(strategies).forEach(key => {
    const strat = strategies[key];
    console.log(`  ${key}`);
    console.log(`    Name: ${strat.name}`);
    console.log(`    Description: ${strat.description}\\n`);
  });
}

// Fetch historical data from ALGTP scanner
async function fetchHistoricalData(symbols, days, server) {
  console.log(`\\nFetching data for ${symbols.length} symbols over ${days} days...`);
  
  const data = [];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    // Use the scan endpoint with symbols
    const response = await axios.get(`${server}/scan`, {
      params: { symbols: symbols.join(',') },
      timeout: 10000
    });

    if (response.data && response.data.data) {
      return response.data.data;
    }
  } catch (error) {
    console.error(`Error fetching data: ${error.message}`);
  }

  return data;
}

// Run backtest simulation
function runBacktest(data, strategy, capital, positionSize) {
  console.log(`\\nRunning backtest with ${strategy.name}...`);
  console.log(`Starting Capital: $${capital.toLocaleString()}\\n`);

  let currentCapital = capital;
  const trades = [];
  const positions = new Map(); // symbol -> entry data

  // Simulate trading over the data
  data.forEach((tick, index) => {
    const symbol = tick.symbol;

    // Check exit conditions for existing positions
    if (positions.has(symbol)) {
      const entry = positions.get(symbol);
      if (strategy.exit(entry, tick)) {
        const shares = entry.shares;
        const exitValue = shares * tick.price;
        const pnl = exitValue - entry.cost;
        const pnlPct = (pnl / entry.cost) * 100;

        currentCapital += exitValue;
        trades.push({
          symbol,
          action: 'SELL',
          entry: entry.price,
          exit: tick.price,
          shares,
          pnl,
          pnlPct,
          timestamp: new Date().toISOString()
        });

        positions.delete(symbol);
        console.log(`📉 SOLD ${symbol}: ${shares} shares @ $${tick.price.toFixed(2)} | P&L: $${pnl.toFixed(2)} (${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`);
      }
    }

    // Check entry conditions for new positions
    if (!positions.has(symbol) && strategy.enter(tick)) {
      const positionCost = currentCapital * positionSize;
      const shares = Math.floor(positionCost / tick.price);
      const actualCost = shares * tick.price;

      if (shares > 0 && actualCost <= currentCapital) {
        currentCapital -= actualCost;
        positions.set(symbol, {
          symbol,
          price: tick.price,
          shares,
          cost: actualCost,
          timestamp: new Date().toISOString()
        });

        console.log(`📈 BOUGHT ${symbol}: ${shares} shares @ $${tick.price.toFixed(2)} | Cost: $${actualCost.toFixed(2)}`);
      }
    }
  });

  // Close remaining positions at last price
  positions.forEach((entry, symbol) => {
    const lastTick = data.find(t => t.symbol === symbol);
    if (lastTick) {
      const exitValue = entry.shares * lastTick.price;
      const pnl = exitValue - entry.cost;
      const pnlPct = (pnl / entry.cost) * 100;

      currentCapital += exitValue;
      trades.push({
        symbol,
        action: 'CLOSE',
        entry: entry.price,
        exit: lastTick.price,
        shares: entry.shares,
        pnl,
        pnlPct,
        timestamp: new Date().toISOString()
      });

      console.log(`🔒 CLOSED ${symbol}: ${entry.shares} shares @ $${lastTick.price.toFixed(2)} | P&L: $${pnl.toFixed(2)} (${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`);
    }
  });

  return { trades, finalCapital: currentCapital };
}

// Calculate performance metrics
function calculateMetrics(trades, initialCapital, finalCapital) {
  const totalReturn = finalCapital - initialCapital;
  const returnPct = (totalReturn / initialCapital) * 100;
  
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? (winners.length / trades.length) * 100 : 0;
  
  const avgWin = winners.length > 0 ? winners.reduce((sum, t) => sum + t.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losers.length : 0;
  const profitFactor = avgLoss > 0 ? Math.abs(avgWin / avgLoss) : 0;

  return {
    totalTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    winRate,
    totalReturn,
    returnPct,
    avgWin,
    avgLoss,
    profitFactor
  };
}

// Print results
function printResults(metrics, initialCapital, finalCapital) {
  console.log('\\n' + '='.repeat(60));
  console.log('BACKTEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Initial Capital:    $${initialCapital.toLocaleString()}`);
  console.log(`Final Capital:      $${finalCapital.toLocaleString()}`);
  console.log(`Total Return:       $${metrics.totalReturn.toFixed(2)} (${metrics.returnPct > 0 ? '+' : ''}${metrics.returnPct.toFixed(2)}%)`);
  console.log('\\n' + '-'.repeat(60));
  console.log(`Total Trades:       ${metrics.totalTrades}`);
  console.log(`Winners:            ${metrics.winners} (${metrics.winRate.toFixed(1)}%)`);
  console.log(`Losers:             ${metrics.losers} (${(100 - metrics.winRate).toFixed(1)}%)`);
  console.log(`Average Win:        $${metrics.avgWin.toFixed(2)}`);
  console.log(`Average Loss:       $${metrics.avgLoss.toFixed(2)}`);
  console.log(`Profit Factor:      ${metrics.profitFactor.toFixed(2)}`);
  console.log('='.repeat(60) + '\\n');
}

// Main execution
async function main() {
  const options = parseArgs();
  
  const strategy = strategies[options.strategy];
  if (!strategy) {
    console.error(`\\nError: Strategy '${options.strategy}' not found.`);
    console.log('\\nAvailable strategies:');
    listStrategies();
    process.exit(1);
  }

  console.log('\\n🚀 ALGTP Backtesting CLI');
  console.log(`Strategy: ${strategy.name}`);
  console.log(`Symbols: ${options.symbols.join(', ')}`);
  
  // Fetch data
  const data = await fetchHistoricalData(options.symbols, options.days, options.server);
  
  if (data.length === 0) {
    console.error('\\nNo data available. Make sure the ALGTP server is running on ' + options.server);
    process.exit(1);
  }

  console.log(`Loaded ${data.length} data points\\n`);

  // Run backtest
  const { trades, finalCapital } = runBacktest(data, strategy, options.capital, options.positionSize);

  // Calculate and print metrics
  const metrics = calculateMetrics(trades, options.capital, finalCapital);
  printResults(metrics, options.capital, finalCapital);
}

main().catch(error => {
  console.error('\\nBacktest failed:', error.message);
  process.exit(1);
});
