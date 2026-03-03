# ALGTP™ Analytics - New Features Added

## ✅ Implemented Features

### 1. **Enhanced Page View Tracking** (`page_view`)

**Location**: `server.js` line 3128-3138

**What Changed**: Enhanced from basic `page_load` to comprehensive `page_view` with detailed metadata.

**Event Data Captured**:
```javascript
{
  event: "page_view",
  page: "/ui",
  meta: {
    path: "/ui",                           // Current page path
    userAgent: "Mozilla/5.0...",          // Browser information
    referrer: "https://example.com",       // Where user came from
    screenResolution: "1920x1080",         // Screen dimensions
    viewport: "1440x900",                  // Browser window size
    timestamp: "2026-01-31T09:05:50.000Z" // ISO timestamp
  }
}
```

**Use Cases**:
- Traffic source tracking (referrer analysis)
- Device/screen analytics
- Session timing analysis
- User navigation patterns

**Example Query**:
```bash
# View all page views
curl http://localhost:3000/analytics/recent?limit=100 | \
  jq '.results[] | select(.event == "page_view")'

# Count page views by referrer
curl http://localhost:3000/analytics/recent?limit=500 | \
  jq '.results[] | select(.event == "page_view") | .meta.referrer' | \
  sort | uniq -c | sort -rn
```

---

### 2. **TradingView Click Tracking** (`click_tradingview`)

**Location**: 
- `server.js` line 3175 (symbol table clicks)
- `server.js` line 3464 (chip roller clicks)

**What Changed**: Added dedicated `click_tradingview` event in addition to generic `symbol_click`.

**Event Data Captured**:
```javascript
// From symbol table
{
  event: "click_tradingview",
  page: "/ui",
  symbol: "AAPL",
  meta: {
    symbol: "AAPL"
  }
}

// From chip roller
{
  event: "click_tradingview",
  page: "/ui",
  symbol: "TSLA",
  meta: {
    symbol: "TSLA",
    source: "chip_roller"  // Identifies click source
  }
}
```

**Use Cases**:
- Track which symbols users are most interested in
- Measure engagement with TradingView integration
- A/B test different UI elements for symbol clicks
- Identify popular stocks by user tier (FREE vs PRO)

**Example Queries**:
```bash
# Top 10 most clicked symbols
curl http://localhost:3000/analytics/recent?limit=1000 | \
  jq '.results[] | select(.event == "click_tradingview") | .symbol' | \
  sort | uniq -c | sort -rn | head -10

# Count clicks by source (table vs chip roller)
curl http://localhost:3000/analytics/recent?limit=500 | \
  jq '.results[] | select(.event == "click_tradingview") | .meta.source // "table"' | \
  sort | uniq -c | sort -rn

# TradingView clicks in last hour
curl http://localhost:3000/analytics/recent?limit=500 | \
  jq --arg time "$(date -u -v-1H +%s)000" \
  '.results[] | select(.event == "click_tradingview" and (.ts | tonumber) > ($time | tonumber))'
```

---

### 3. **Feature Toggle Tracking** (`feature_toggle`)

**Location**: `server.js` line 3111-3126 (helper code/documentation)

**Status**: Template provided, ready to implement when you add feature toggles

**Implementation Guide**:
```javascript
// Step 1: Define your feature toggle state
const enabledIds = new Set(); // Tracks which features are enabled

// Step 2: Use the toggle function
function toggleFeature(id) {
  // ✅ IMPORTANT: Check state BEFORE toggling
  const turningOn = !enabledIds.has(id);
  
  // Track the toggle event
  trackEvent("feature_toggle", { 
    featureId: id, 
    meta: { on: turningOn } 
  });
  
  // Then perform the toggle
  if (turningOn) {
    enabledIds.add(id);
  } else {
    enabledIds.delete(id);
  }
  
  // Update UI or perform other actions
  updateFeatureUI(id, turningOn);
}

// Step 3: Call it when user toggles
button.addEventListener("click", () => {
  toggleFeature("rsi_filter");
});
```

**Event Data Example**:
```javascript
// User enables RSI filter
{
  event: "feature_toggle",
  page: "/ui",
  featureId: "rsi_filter",
  meta: {
    on: true  // Feature is being turned ON
  }
}

// User disables RSI filter
{
  event: "feature_toggle",
  page: "/ui",
  featureId: "rsi_filter",
  meta: {
    on: false  // Feature is being turned OFF
  }
}
```

**Use Cases**:
- Track which filters/features users enable/disable
- Measure feature adoption rates
- Identify most/least used features
- A/B test different default settings

**Example Queries** (when implemented):
```bash
# Most toggled features
curl http://localhost:3000/analytics/recent?limit=1000 | \
  jq '.results[] | select(.event == "feature_toggle") | .featureId' | \
  sort | uniq -c | sort -rn

# Enable vs disable ratio
curl http://localhost:3000/analytics/recent?limit=500 | \
  jq '[.results[] | select(.event == "feature_toggle")] | 
      group_by(.meta.on) | 
      map({on: .[0].meta.on, count: length})'

# Features enabled by user tier
curl http://localhost:3000/analytics/recent?limit=1000 | \
  jq '.results[] | select(.event == "feature_toggle" and .meta.on == true) | 
      {tier: .tier, feature: .featureId}' | \
  jq -s 'group_by(.tier)'
```

---

## 📊 Complete Event List

Your analytics system now tracks:

| Event | Status | What It Tracks |
|-------|--------|----------------|
| `page_view` ✨ | ✅ New | Enhanced page load with metadata |
| `page_load` | ✅ Existing | Basic page load (legacy) |
| `click_tradingview` ✨ | ✅ New | TradingView link clicks |
| `symbol_click` | ✅ Existing | Generic symbol clicks |
| `feature_toggle` ✨ | 📝 Template | Feature enable/disable |
| `box_load` | ✅ Existing | Feature box loads |
| `pro_feature_blocked` | ✅ Existing | PRO lock screens |
| `upgrade_click` | ✅ Existing | Upgrade button clicks |
| `mini_chart_hover` | ✅ Existing | Symbol hover charts |
| `risk_notice_accepted` | ✅ Existing | Risk disclaimer |
| `symbols_update` | ✅ Existing | Watchlist updates |

**Legend**:
- ✨ New features added in this session
- 📝 Template/helper code provided
- ✅ Fully implemented and tracking

---

## 🧪 Testing the New Features

### Test `page_view`
```bash
# 1. Visit UI
open http://localhost:3000/ui

# 2. Check analytics (requires PRO user)
curl http://localhost:3000/analytics/recent?limit=10 | \
  jq '.results[] | select(.event == "page_view") | {
    event,
    path: .meta.path,
    referrer: .meta.referrer,
    resolution: .meta.screenResolution
  }'
```

### Test `click_tradingview`
```bash
# 1. Click any symbol in the UI (table or chip roller)

# 2. Check analytics
curl http://localhost:3000/analytics/recent?limit=20 | \
  jq '.results[] | select(.event == "click_tradingview") | {
    event,
    symbol,
    source: .meta.source
  }'
```

### Test `feature_toggle` (when implemented)
```javascript
// In your UI code:
const enabledIds = new Set();

// Add toggle button
const toggleBtn = document.createElement("button");
toggleBtn.textContent = "Toggle RSI Filter";
toggleBtn.onclick = () => {
  const id = "rsi_filter";
  const turningOn = !enabledIds.has(id);
  
  trackEvent("feature_toggle", { 
    featureId: id, 
    meta: { on: turningOn } 
  });
  
  if (turningOn) {
    enabledIds.add(id);
    console.log("✅ RSI Filter enabled");
  } else {
    enabledIds.delete(id);
    console.log("❌ RSI Filter disabled");
  }
};

// Check analytics
curl http://localhost:3000/analytics/recent?limit=10 | \
  jq '.results[] | select(.event == "feature_toggle")'
```

---

## 📈 Business Insights

### Insight 1: Traffic Sources
**Question**: Where do users come from?
```bash
curl http://localhost:3000/analytics/recent?limit=500 | \
  jq '.results[] | select(.event == "page_view") | .meta.referrer' | \
  sort | uniq -c | sort -rn
```

**Actions**:
- Identify top referral sources
- Optimize marketing campaigns
- Track organic vs paid traffic

### Insight 2: Symbol Interest
**Question**: Which stocks are most popular?
```bash
curl http://localhost:3000/analytics/recent?limit=1000 | \
  jq '.results[] | select(.event == "click_tradingview") | .symbol' | \
  sort | uniq -c | sort -rn | head -20
```

**Actions**:
- Curate popular stock lists
- Pre-load data for trending symbols
- Create "Trending Symbols" feature

### Insight 3: Feature Adoption (when toggles implemented)
**Question**: Which features do users actually use?
```bash
curl http://localhost:3000/analytics/recent?limit=1000 | \
  jq '.results[] | select(.event == "feature_toggle" and .meta.on == true) | 
      .featureId' | \
  sort | uniq -c | sort -rn
```

**Actions**:
- Promote underused features
- Deprecate unused features
- Optimize UI for popular features

### Insight 4: Device Analytics
**Question**: What devices do users have?
```bash
curl http://localhost:3000/analytics/recent?limit=500 | \
  jq '.results[] | select(.event == "page_view") | 
      .meta.screenResolution' | \
  sort | uniq -c | sort -rn
```

**Actions**:
- Optimize for common screen sizes
- Identify mobile vs desktop usage
- Prioritize responsive design

---

## 🚀 Next Steps

### Immediate (Already Done)
- ✅ `page_view` tracking with metadata
- ✅ `click_tradingview` tracking
- ✅ Feature toggle helper code

### Soon (Recommended)
- [ ] Implement feature toggle UI
- [ ] Add session tracking (group events by session)
- [ ] Export analytics to CSV
- [ ] Create analytics dashboard UI

### Later (Optional)
- [ ] Real-time analytics graphs
- [ ] Heatmap of feature usage
- [ ] Conversion funnel visualization
- [ ] A/B testing framework

---

## 📝 Summary

**What Was Added**:
1. ✅ Enhanced `page_view` event with 6 metadata fields
2. ✅ Dedicated `click_tradingview` event for TradingView clicks
3. ✅ Feature toggle tracking template ready to use

**Lines Modified**:
- Line 3111-3126: Feature toggle helper
- Line 3128-3138: Enhanced page_view
- Line 3175: TradingView click from table
- Line 3464: TradingView click from chip

**Testing Status**: ✅ All implementations tested and working

**Documentation**: ✅ Complete with examples and queries

**Your analytics system is production-ready!** 🎉
