/**
 * ALGTP™ Broker Integration Module
 * Alpaca Trading API wrapper for executing trades based on scanner signals
 */

import 'dotenv/config';
import Alpaca from '@alpacahq/alpaca-trade-api';

class AlpacaBroker {
  constructor() {
    this.alpaca = new Alpaca({
      keyId: process.env.ALPACA_API_KEY,
      secretKey: process.env.ALPACA_SECRET_KEY,
      paper: process.env.ALPACA_PAPER_TRADING === 'true',
      usePolygon: false // We're already using Polygon directly
    });
    
    this.isInitialized = false;
  }

  /**
   * Initialize and verify connection
   */
  async initialize() {
    try {
      const account = await this.alpaca.getAccount();
      this.isInitialized = true;
      console.log('[Alpaca] Connected successfully');
      console.log(`[Alpaca] Account Status: ${account.status}`);
      console.log(`[Alpaca] Buying Power: $${parseFloat(account.buying_power).toFixed(2)}`);
      console.log(`[Alpaca] Cash: $${parseFloat(account.cash).toFixed(2)}`);
      return { ok: true, account };
    } catch (error) {
      console.error('[Alpaca] Failed to initialize:', error.message);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Get account information
   */
  async getAccount() {
    try {
      const account = await this.alpaca.getAccount();
      return {
        ok: true,
        data: {
          status: account.status,
          buyingPower: parseFloat(account.buying_power),
          cash: parseFloat(account.cash),
          portfolioValue: parseFloat(account.portfolio_value),
          equity: parseFloat(account.equity),
          daytradeCount: account.daytrade_count,
          patternDayTrader: account.pattern_day_trader
        }
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Get current positions
   */
  async getPositions() {
    try {
      const positions = await this.alpaca.getPositions();
      return {
        ok: true,
        data: positions.map(p => ({
          symbol: p.symbol,
          qty: parseFloat(p.qty),
          avgEntryPrice: parseFloat(p.avg_entry_price),
          currentPrice: parseFloat(p.current_price),
          marketValue: parseFloat(p.market_value),
          costBasis: parseFloat(p.cost_basis),
          unrealizedPL: parseFloat(p.unrealized_pl),
          unrealizedPLPct: parseFloat(p.unrealized_plpc) * 100,
          side: p.side
        }))
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Place a market order
   * @param {string} symbol - Stock symbol
   * @param {number} qty - Quantity (positive for buy, negative for sell)
   * @param {string} side - 'buy' or 'sell'
   * @param {string} type - 'market' or 'limit'
   * @param {number} limitPrice - Limit price (for limit orders)
   * @param {string} timeInForce - 'day', 'gtc', 'ioc', 'fok'
   * @param {boolean} extendedHours - Enable pre-market and after-hours trading (limit orders only)
   */
  async placeOrder({ symbol, qty, side, type = 'market', limitPrice = null, timeInForce = 'day', extendedHours = false }) {
    try {
      // Validate extended hours restrictions
      if (extendedHours && type !== 'limit') {
        return { 
          ok: false, 
          error: 'Extended hours trading only supports limit orders. Change type to "limit" or set extendedHours to false.' 
        };
      }

      if (extendedHours && !limitPrice) {
        return { 
          ok: false, 
          error: 'Extended hours trading requires a limit price.' 
        };
      }

      if (extendedHours && timeInForce !== 'day' && timeInForce !== 'gtc') {
        return { 
          ok: false, 
          error: 'Extended hours trading requires timeInForce to be "day" or "gtc".' 
        };
      }

      const orderParams = {
        symbol: symbol.toUpperCase(),
        qty: Math.abs(qty),
        side: side.toLowerCase(),
        type: type.toLowerCase(),
        time_in_force: timeInForce
      };

      if (type === 'limit' && limitPrice) {
        orderParams.limit_price = limitPrice;
      }

      // Enable extended hours trading (pre-market and after-hours)
      if (extendedHours) {
        orderParams.extended_hours = true;
      }

      const order = await this.alpaca.createOrder(orderParams);
      
      return {
        ok: true,
        data: {
          orderId: order.id,
          symbol: order.symbol,
          qty: parseFloat(order.qty),
          side: order.side,
          type: order.type,
          status: order.status,
          filledQty: parseFloat(order.filled_qty),
          filledAvgPrice: order.filled_avg_price ? parseFloat(order.filled_avg_price) : null,
          submittedAt: order.submitted_at
        }
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId) {
    try {
      await this.alpaca.cancelOrder(orderId);
      return { ok: true, message: `Order ${orderId} cancelled` };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Get all orders (open or all)
   */
  async getOrders(status = 'open') {
    try {
      const orders = await this.alpaca.getOrders({ status });
      return {
        ok: true,
        data: orders.map(o => ({
          orderId: o.id,
          symbol: o.symbol,
          qty: parseFloat(o.qty),
          side: o.side,
          type: o.type,
          status: o.status,
          filledQty: parseFloat(o.filled_qty),
          filledAvgPrice: o.filled_avg_price ? parseFloat(o.filled_avg_price) : null,
          limitPrice: o.limit_price ? parseFloat(o.limit_price) : null,
          submittedAt: o.submitted_at
        }))
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Close a position (market sell all shares)
   */
  async closePosition(symbol) {
    try {
      await this.alpaca.closePosition(symbol);
      return { ok: true, message: `Position ${symbol} closed` };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Close all positions
   */
  async closeAllPositions() {
    try {
      await this.alpaca.closeAllPositions();
      return { ok: true, message: 'All positions closed' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Get market clock
   */
  async getClock() {
    try {
      const clock = await this.alpaca.getClock();
      return {
        ok: true,
        data: {
          timestamp: clock.timestamp,
          isOpen: clock.is_open,
          nextOpen: clock.next_open,
          nextClose: clock.next_close
        }
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Quick buy helper - Market order with dollar amount
   */
  async buyDollars(symbol, dollarAmount) {
    try {
      const order = await this.alpaca.createOrder({
        symbol: symbol.toUpperCase(),
        notional: dollarAmount,
        side: 'buy',
        type: 'market',
        time_in_force: 'day'
      });

      return {
        ok: true,
        data: {
          orderId: order.id,
          symbol: order.symbol,
          notional: dollarAmount,
          status: order.status
        }
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Helper: Detect current trading session based on NY time
   * @returns {string} - 'premarket', 'regular', 'afterhours', or 'closed'
   */
  getCurrentSession() {
    const now = new Date();
    const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = nyTime.getHours();
    const minutes = nyTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // Pre-market: 4:00 AM - 9:29 AM ET
    if (totalMinutes >= 240 && totalMinutes < 570) {
      return 'premarket';
    }
    // Regular hours: 9:30 AM - 3:59 PM ET
    else if (totalMinutes >= 570 && totalMinutes < 960) {
      return 'regular';
    }
    // After-hours: 4:00 PM - 8:00 PM ET
    else if (totalMinutes >= 960 && totalMinutes < 1200) {
      return 'afterhours';
    }
    // Closed: 8:00 PM - 3:59 AM ET
    else {
      return 'closed';
    }
  }

  /**
   * Check if extended hours trading is currently available
   * @returns {boolean}
   */
  isExtendedHoursAvailable() {
    const session = this.getCurrentSession();
    return session === 'premarket' || session === 'afterhours';
  }

  /**
   * Place a limit order for pre-market trading (4:00 AM - 9:29 AM ET)
   * @param {string} symbol - Stock symbol
   * @param {number} qty - Quantity
   * @param {string} side - 'buy' or 'sell'
   * @param {number} limitPrice - Limit price
   */
  async placePreMarketOrder({ symbol, qty, side, limitPrice }) {
    const session = this.getCurrentSession();
    if (session !== 'premarket') {
      return { 
        ok: false, 
        error: `Pre-market trading is only available 4:00 AM - 9:29 AM ET. Current session: ${session}` 
      };
    }

    return this.placeOrder({
      symbol,
      qty,
      side,
      type: 'limit',
      limitPrice,
      timeInForce: 'day',
      extendedHours: true
    });
  }

  /**
   * Place a limit order for after-hours trading (4:00 PM - 8:00 PM ET)
   * @param {string} symbol - Stock symbol
   * @param {number} qty - Quantity
   * @param {string} side - 'buy' or 'sell'
   * @param {number} limitPrice - Limit price
   */
  async placeAfterHoursOrder({ symbol, qty, side, limitPrice }) {
    const session = this.getCurrentSession();
    if (session !== 'afterhours') {
      return { 
        ok: false, 
        error: `After-hours trading is only available 4:00 PM - 8:00 PM ET. Current session: ${session}` 
      };
    }

    return this.placeOrder({
      symbol,
      qty,
      side,
      type: 'limit',
      limitPrice,
      timeInForce: 'day',
      extendedHours: true
    });
  }

  /**
   * Smart order placement - automatically uses extended hours if available
   * @param {string} symbol - Stock symbol
   * @param {number} qty - Quantity
   * @param {string} side - 'buy' or 'sell'
   * @param {number} limitPrice - Limit price (required for extended hours)
   */
  async placeSmartOrder({ symbol, qty, side, limitPrice }) {
    const session = this.getCurrentSession();
    const isExtendedHours = session === 'premarket' || session === 'afterhours';

    if (isExtendedHours) {
      if (!limitPrice) {
        return { 
          ok: false, 
          error: `Extended hours (${session}) requires a limit price. Current session detected: ${session}` 
        };
      }

      console.log(`[Alpaca] Placing ${session} order for ${symbol}`);
      return this.placeOrder({
        symbol,
        qty,
        side,
        type: 'limit',
        limitPrice,
        timeInForce: 'day',
        extendedHours: true
      });
    } else {
      // Regular hours - can use market or limit
      console.log(`[Alpaca] Placing regular hours order for ${symbol}`);
      return this.placeOrder({
        symbol,
        qty,
        side,
        type: limitPrice ? 'limit' : 'market',
        limitPrice,
        timeInForce: 'day',
        extendedHours: false
      });
    }
  }
}

// Singleton instance
let brokerInstance = null;

function getBroker() {
  if (!brokerInstance) {
    brokerInstance = new AlpacaBroker();
  }
  return brokerInstance;
}

export { AlpacaBroker, getBroker };
