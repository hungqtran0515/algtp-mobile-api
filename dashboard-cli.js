#!/usr/bin/env node

import axios from 'axios';
import { createInterface } from 'readline';

const BASE_URL = process.env.ALGTP_URL || 'http://localhost:3000';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

// Clear screen
function clearScreen() {
  console.clear();
}

// Format number with color
function formatPrice(value, change) {
  const color = change >= 0 ? colors.green : colors.red;
  return `${color}${value.toFixed(2)}${colors.reset}`;
}

function formatPercent(value) {
  const color = value >= 0 ? colors.green : colors.red;
  const sign = value >= 0 ? '+' : '';
  return `${color}${sign}${value.toFixed(2)}%${colors.reset}`;
}

function formatVolume(vol) {
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`;
  return vol.toString();
}

// Draw simple bar chart
function drawBar(value, max, width = 20) {
  const filled = Math.round((value / max) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return bar;
}

// Fetch data from ALGTP API
async function fetchData(endpoint) {
  try {
    const response = await axios.get(`${BASE_URL}${endpoint}`, { timeout: 5000 });
    return response.data;
  } catch (error) {
    return null;
  }
}

// Display movers
async function displayMovers(session = 'premarket') {
  clearScreen();
  console.log(`${colors.bright}${colors.cyan}=== ALGTP Dashboard - ${session.toUpperCase()} Movers ===${colors.reset}\n`);

  const endpoint = session === 'premarket' ? '/movers-premarket?limit=20' : '/movers-afterhours?limit=20';
  const data = await fetchData(endpoint);

  if (!data || !data.rows || data.rows.length === 0) {
    console.log(`${colors.yellow}No data available${colors.reset}`);
    return;
  }

  // Header
  console.log(`${colors.bright}Symbol    Price      Change    Gap%      Volume      Float%${colors.reset}`);
  console.log('─'.repeat(75));

  // Find max values for bars
  const maxVol = Math.max(...data.rows.map(r => r.volume || 0));

  // Display rows
  data.rows.slice(0, 20).forEach((row, idx) => {
    const symbol = (row.symbol || '').padEnd(10);
    const price = formatPrice(row.price || 0, row.pricePct || 0);
    const change = formatPercent(row.pricePct || 0);
    const gap = formatPercent(row.gapPct || 0);
    const vol = formatVolume(row.volume || 0).padEnd(12);
    const floatTurnover = row.floatTurnoverPct ? `${row.floatTurnoverPct.toFixed(1)}%` : 'N/A';
    
    console.log(`${symbol} ${price.padEnd(15)} ${change.padEnd(15)} ${gap.padEnd(10)} ${vol} ${floatTurnover}`);
  });

  console.log('\n' + '─'.repeat(75));
  console.log(`${colors.dim}Last updated: ${new Date().toLocaleTimeString()}${colors.reset}`);
}

// Display most active
async function displayMostActive() {
  clearScreen();
  console.log(`${colors.bright}${colors.cyan}=== ALGTP Dashboard - Most Active ===${colors.reset}\n`);

  const data = await fetchData('/most-active?limit=20');

  if (!data || !data.rows || data.rows.length === 0) {
    console.log(`${colors.yellow}No data available${colors.reset}`);
    return;
  }

  console.log(`${colors.bright}Symbol    Price      Change    Volume      Chart${colors.reset}`);
  console.log('─'.repeat(75));

  const maxVol = Math.max(...data.rows.map(r => r.volume || 0));

  data.rows.slice(0, 20).forEach(row => {
    const symbol = (row.symbol || '').padEnd(10);
    const price = formatPrice(row.price || 0, row.pricePct || 0);
    const change = formatPercent(row.pricePct || 0);
    const vol = formatVolume(row.volume || 0).padEnd(12);
    const bar = drawBar(row.volume || 0, maxVol, 25);
    
    console.log(`${symbol} ${price.padEnd(15)} ${change.padEnd(15)} ${vol} ${bar}`);
  });

  console.log('\n' + '─'.repeat(75));
  console.log(`${colors.dim}Last updated: ${new Date().toLocaleTimeString()}${colors.reset}`);
}

// Display halts
async function displayHalts() {
  clearScreen();
  console.log(`${colors.bright}${colors.red}=== ALGTP Dashboard - Trading Halts ===${colors.reset}\n`);

  const data = await fetchData('/halts');

  if (!data || !data.halts || data.halts.length === 0) {
    console.log(`${colors.green}No active halts${colors.reset}`);
    return;
  }

  console.log(`${colors.bright}Symbol    Status      Time${colors.reset}`);
  console.log('─'.repeat(60));

  data.halts.forEach(halt => {
    const symbol = (halt.symbol || '').padEnd(10);
    const status = halt.isHalted ? `${colors.bgRed} HALTED ${colors.reset}` : `${colors.bgGreen} RESUMED ${colors.reset}`;
    const time = new Date(halt.timestamp).toLocaleTimeString();
    
    console.log(`${symbol} ${status} ${time}`);
  });

  console.log('\n' + '─'.repeat(60));
  console.log(`${colors.dim}Last updated: ${new Date().toLocaleTimeString()}${colors.reset}`);
}

// Display watchlist scan
async function displayWatchlist(symbols) {
  clearScreen();
  console.log(`${colors.bright}${colors.magenta}=== ALGTP Dashboard - Watchlist ===${colors.reset}\n`);

  const data = await fetchData(`/scan?symbols=${symbols}`);

  if (!data || !data.rows || data.rows.length === 0) {
    console.log(`${colors.yellow}No data available${colors.reset}`);
    return;
  }

  console.log(`${colors.bright}Symbol    Price      Change    Gap%      Volume${colors.reset}`);
  console.log('─'.repeat(70));

  data.rows.forEach(row => {
    const symbol = (row.symbol || '').padEnd(10);
    const price = formatPrice(row.price || 0, row.pricePct || 0);
    const change = formatPercent(row.pricePct || 0);
    const gap = row.gapPct !== null ? formatPercent(row.gapPct) : 'N/A';
    const vol = formatVolume(row.volume || 0);
    
    console.log(`${symbol} ${price.padEnd(15)} ${change.padEnd(15)} ${gap.padEnd(10)} ${vol}`);
  });

  console.log('\n' + '─'.repeat(70));
  console.log(`${colors.dim}Last updated: ${new Date().toLocaleTimeString()}${colors.reset}`);
}

// Main menu
function showMenu() {
  console.log(`\n${colors.bright}${colors.blue}Dashboard Options:${colors.reset}`);
  console.log('  1. Premarket Movers');
  console.log('  2. After-hours Movers');
  console.log('  3. Most Active');
  console.log('  4. Trading Halts');
  console.log('  5. Watchlist (custom symbols)');
  console.log('  6. Auto-refresh (15s)');
  console.log('  q. Quit\n');
  console.log('Enter option: ');
}

// Auto-refresh mode
let refreshInterval = null;
let currentView = null;
let currentSymbols = null;

function startAutoRefresh(viewFunc, ...args) {
  stopAutoRefresh();
  currentView = viewFunc;
  currentSymbols = args;
  
  viewFunc(...args);
  refreshInterval = setInterval(() => {
    viewFunc(...args);
  }, 15000);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);

  // Direct command mode
  if (args.length > 0) {
    const command = args[0];
    
    switch (command) {
      case 'premarket':
        await displayMovers('premarket');
        break;
      case 'afterhours':
        await displayMovers('afterhours');
        break;
      case 'active':
        await displayMostActive();
        break;
      case 'halts':
        await displayHalts();
        break;
      case 'watch':
        if (args[1]) {
          await displayWatchlist(args[1]);
        } else {
          console.log('Usage: dashboard-cli watch AAPL,TSLA,NVDA');
        }
        break;
      case 'auto':
        const autoView = args[1] || 'premarket';
        if (autoView === 'premarket') {
          startAutoRefresh(displayMovers, 'premarket');
        } else if (autoView === 'afterhours') {
          startAutoRefresh(displayMovers, 'afterhours');
        } else if (autoView === 'active') {
          startAutoRefresh(displayMostActive);
        }
        console.log('\nPress Ctrl+C to stop auto-refresh');
        break;
      default:
        console.log('Unknown command. Available: premarket, afterhours, active, halts, watch, auto');
    }
    return;
  }

  // Interactive mode
  clearScreen();
  console.log(`${colors.bright}${colors.cyan}`);
  console.log('╔═══════════════════════════════════════╗');
  console.log('║     ALGTP Dashboard CLI v1.0          ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log(colors.reset);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const prompt = () => {
    showMenu();
    rl.question('', async (answer) => {
      const choice = answer.trim().toLowerCase();

      stopAutoRefresh();

      switch (choice) {
        case '1':
          await displayMovers('premarket');
          prompt();
          break;
        case '2':
          await displayMovers('afterhours');
          prompt();
          break;
        case '3':
          await displayMostActive();
          prompt();
          break;
        case '4':
          await displayHalts();
          prompt();
          break;
        case '5':
          rl.question('Enter symbols (comma-separated): ', async (symbols) => {
            await displayWatchlist(symbols);
            prompt();
          });
          break;
        case '6':
          rl.question('Auto-refresh which view? (1=premarket, 2=afterhours, 3=active): ', (view) => {
            if (view === '1') {
              startAutoRefresh(displayMovers, 'premarket');
            } else if (view === '2') {
              startAutoRefresh(displayMovers, 'afterhours');
            } else if (view === '3') {
              startAutoRefresh(displayMostActive);
            }
            console.log('\nPress Ctrl+C to stop and return to menu');
          });
          break;
        case 'q':
          console.log('\nGoodbye!');
          rl.close();
          process.exit(0);
          break;
        default:
          console.log(`${colors.red}Invalid option${colors.reset}`);
          prompt();
      }
    });
  };

  prompt();
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  stopAutoRefresh();
  console.log('\n\nExiting...');
  process.exit(0);
});

main();
