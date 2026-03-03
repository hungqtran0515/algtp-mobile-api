// ============================================================================
// CATALYST HUB — Unified Event System
// ============================================================================

/**
 * @typedef {Object} CatalystEvent
 * @property {string} symbol - Stock symbol
 * @property {number} ts - Unix timestamp (ms)
 * @property {'SEC'|'NEWS'|'EARNINGS'|'TECH'} type - Event category
 * @property {string} subtype - Specific event type (8-K, FDA, Breakout, etc.)
 * @property {string} title - Human-readable title
 * @property {'bullish'|'bearish'|'neutral'} impact - Market impact
 * @property {number} score - Importance score 0-100
 * @property {string} url - Source link
 * @property {string} source - Data source (SEC, Benzinga, FMP, Internal)
 * @property {Object} [metadata] - Additional context
 */

// ============================================================================
// CATALYST SCORING RULES
// ============================================================================

const CATALYST_SCORES = {
  // SEC Events
  SEC: {
    'offering': { score: 70, impact: 'bearish' },
    'dilution': { score: 70, impact: 'bearish' },
    'merger': { score: 80, impact: 'bullish' },
    'acquisition': { score: 80, impact: 'bullish' },
    'contract': { score: 75, impact: 'bullish' },
    'bankruptcy': { score: 95, impact: 'bearish' },
    'delist': { score: 90, impact: 'bearish' },
    'going_concern': { score: 85, impact: 'bearish' },
    'reverse_split': { score: 60, impact: 'bearish' },
    'stock_split': { score: 50, impact: 'bullish' },
    'default': { score: 40, impact: 'neutral' }
  },
  
  // Earnings Events
  EARNINGS: {
    'beat_beat': { score: 85, impact: 'bullish' },      // EPS + Revenue beat
    'beat_miss': { score: 60, impact: 'neutral' },
    'miss_beat': { score: 60, impact: 'neutral' },
    'miss_miss': { score: 90, impact: 'bearish' },
    'guidance_up': { score: 80, impact: 'bullish' },
    'guidance_down': { score: 85, impact: 'bearish' },
    'default': { score: 50, impact: 'neutral' }
  },
  
  // News Events
  NEWS: {
    'fda_approval': { score: 90, impact: 'bullish' },
    'fda_rejection': { score: 85, impact: 'bearish' },
    'analyst_upgrade': { score: 60, impact: 'bullish' },
    'analyst_downgrade': { score: 65, impact: 'bearish' },
    'insider_buying': { score: 55, impact: 'bullish' },
    'insider_selling': { score: 50, impact: 'bearish' },
    'partnership': { score: 70, impact: 'bullish' },
    'lawsuit': { score: 65, impact: 'bearish' },
    'default': { score: 40, impact: 'neutral' }
  },
  
  // Technical Signals
  TECH: {
    'gap_up_high_volume': { score: 75, impact: 'bullish' },     // Gap>20% + FloatTurn>100%
    'gap_down_high_volume': { score: 75, impact: 'bearish' },
    'breakout_hod': { score: 70, impact: 'bullish' },
    'breakdown_lod': { score: 70, impact: 'bearish' },
    'vwap_reclaim': { score: 60, impact: 'bullish' },
    'vwap_breakdown': { score: 60, impact: 'bearish' },
    'volume_spike': { score: 65, impact: 'neutral' },
    'float_rotation': { score: 80, impact: 'bullish' },         // FloatTurn > 200%
    'halt_resume': { score: 85, impact: 'neutral' },
    'default': { score: 40, impact: 'neutral' }
  }
};

/**
 * Score a catalyst event
 * @param {string} type - Event type (SEC, NEWS, EARNINGS, TECH)
 * @param {string} subtype - Event subtype
 * @returns {{ score: number, impact: string }}
 */
function scoreCatalyst(type, subtype) {
  const category = CATALYST_SCORES[type];
  if (!category) return { score: 30, impact: 'neutral' };
  
  const key = String(subtype || 'default').toLowerCase().replace(/\s+/g, '_');
  return category[key] || category.default || { score: 30, impact: 'neutral' };
}

/**
 * Pick primary and secondary catalysts from event list
 * @param {CatalystEvent[]} events - List of events for a symbol
 * @param {number} hoursBack - Only consider events within X hours (default: 24)
 * @param {number} secondaryThreshold - Minimum score for secondary (default: 50)
 * @returns {{ primary: CatalystEvent|null, secondary: CatalystEvent|null }}
 */
function pickCatalysts(events, hoursBack = 24, secondaryThreshold = 50) {
  const now = Date.now();
  const cutoff = now - (hoursBack * 60 * 60 * 1000);
  
  // Filter recent events
  const recent = events
    .filter(e => e.ts >= cutoff)
    .sort((a, b) => b.score - a.score); // Sort by score descending
  
  if (recent.length === 0) return { primary: null, secondary: null };
  
  const primary = recent[0];
  const secondary = recent.length > 1 && recent[1].score >= secondaryThreshold 
    ? recent[1] 
    : null;
  
  return { primary, secondary };
}

/**
 * Create a CatalystEvent from raw data
 * @param {Object} raw - Raw event data
 * @returns {CatalystEvent}
 */
function createCatalystEvent(raw) {
  const { score, impact } = scoreCatalyst(raw.type, raw.subtype);
  
  return {
    symbol: String(raw.symbol || '').toUpperCase(),
    ts: Number(raw.ts || Date.now()),
    type: raw.type,
    subtype: raw.subtype || 'unknown',
    title: raw.title || `${raw.type} event`,
    impact: raw.impact || impact,
    score: raw.score ?? score,
    url: raw.url || '',
    source: raw.source || 'ALGTP',
    metadata: raw.metadata || {}
  };
}

/**
 * Parse SEC filing to detect catalyst type
 * @param {Object} filing - SEC filing data
 * @returns {string} - Detected subtype
 */
function detectSECCatalyst(filing) {
  const title = String(filing.title || '').toLowerCase();
  const text = String(filing.text || '').toLowerCase();
  const combined = title + ' ' + text;
  
  // Pattern matching for common catalysts
  if (/offering|registration|prospectus/i.test(combined)) return 'offering';
  if (/dilut/i.test(combined)) return 'dilution';
  if (/merger|acquisition|acquire/i.test(combined)) return 'merger';
  if (/bankruptcy|chapter\s*11/i.test(combined)) return 'bankruptcy';
  if (/delist|nasdaq deficiency/i.test(combined)) return 'delist';
  if (/going concern/i.test(combined)) return 'going_concern';
  if (/reverse.*split/i.test(combined)) return 'reverse_split';
  if (/stock split/i.test(combined)) return 'stock_split';
  if (/contract|agreement/i.test(combined)) return 'contract';
  
  return 'default';
}

/**
 * Parse earnings data to detect catalyst type
 * @param {Object} earnings - Earnings data
 * @returns {string} - Detected subtype
 */
function detectEarningsCatalyst(earnings) {
  const epsActual = Number(earnings.eps || 0);
  const epsEst = Number(earnings.epsEstimated || 0);
  const revActual = Number(earnings.revenue || 0);
  const revEst = Number(earnings.revenueEstimated || 0);
  
  const epsBeat = epsActual > epsEst;
  const revBeat = revActual > revEst;
  
  if (epsBeat && revBeat) return 'beat_beat';
  if (epsBeat && !revBeat) return 'beat_miss';
  if (!epsBeat && revBeat) return 'miss_beat';
  if (!epsBeat && !revBeat) return 'miss_miss';
  
  return 'default';
}

/**
 * Parse news headline to detect catalyst type
 * @param {string} headline - News headline
 * @returns {string} - Detected subtype
 */
function detectNewsCatalyst(headline) {
  const text = String(headline || '').toLowerCase();
  
  if (/fda.*approv/i.test(text)) return 'fda_approval';
  if (/fda.*(reject|decline)/i.test(text)) return 'fda_rejection';
  if (/upgrad/i.test(text)) return 'analyst_upgrade';
  if (/downgrad/i.test(text)) return 'analyst_downgrade';
  if (/insider.*buy/i.test(text)) return 'insider_buying';
  if (/insider.*sell/i.test(text)) return 'insider_selling';
  if (/partner|collaboration/i.test(text)) return 'partnership';
  if (/lawsuit|litigation/i.test(text)) return 'lawsuit';
  
  return 'default';
}

/**
 * Detect technical catalyst from market data
 * @param {Object} data - Market data snapshot
 * @returns {string|null} - Detected subtype or null
 */
function detectTechCatalyst(data) {
  const gapPct = Math.abs(Number(data.gapPct || 0));
  const floatTurnPct = Number(data.floatTurnoverPct || 0);
  const volRatio = Number(data.volRatio_5m || 0);
  const price = Number(data.price || 0);
  const vwap = Number(data.vwap_5m || 0);
  
  // Gap up + high volume
  if (gapPct > 20 && floatTurnPct > 100) {
    return data.gapPct > 0 ? 'gap_up_high_volume' : 'gap_down_high_volume';
  }
  
  // Float rotation (super high turnover)
  if (floatTurnPct > 200) return 'float_rotation';
  
  // VWAP reclaim/breakdown
  if (price > 0 && vwap > 0) {
    const vwapDiff = ((price - vwap) / vwap) * 100;
    if (vwapDiff > 2) return 'vwap_reclaim';
    if (vwapDiff < -2) return 'vwap_breakdown';
  }
  
  // Volume spike
  if (volRatio > 5) return 'volume_spike';
  
  return null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  scoreCatalyst,
  pickCatalysts,
  createCatalystEvent,
  detectSECCatalyst,
  detectEarningsCatalyst,
  detectNewsCatalyst,
  detectTechCatalyst,
  CATALYST_SCORES
};
