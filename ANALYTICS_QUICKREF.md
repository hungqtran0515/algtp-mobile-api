# ALGTP™ Analytics - Quick Reference

## ✅ Already Implemented!

Your UI already has the `trackEvent()` function and it's tracking events automatically. Here's where:

## 📍 Tracking Function Location

**File**: `server.js` (lines 3088-3112)

```javascript
// ============================================================================
// Analytics Tracking (Client-side)
// ============================================================================
function trackEvent(event, options = {}) {
  try {
    const payload = {
      event,
      page: window.location.pathname,
      featureId: options.featureId || null,
      symbol: options.symbol || null,
      meta: options.meta || null,
    };

    fetch("/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(e => console.warn("Analytics failed:", e));
  } catch (e) {
    // Silently fail - don't break user experience
  }
}

// Track page load
trackEvent("page_load", { meta: { userAgent: navigator.userAgent } });
```

## 📊 Where Events Are Tracked

### 1. **Page Load** (Line 3112)
```javascript
trackEvent("page_load", { meta: { userAgent: navigator.userAgent } });
```
- Fires when `/ui` page loads
- Captures user agent

### 2. **Risk Notice Accepted** (Line 3132)
```javascript
btn.addEventListener("click", () => {
  if (!agree.checked) { hint.style.display = "block"; return; }
  riskAccepted = true;
  back.style.display = "none";
  trackEvent("risk_notice_accepted");
});
```

### 3. **Symbol Click → TradingView** (Line 3161)
```javascript
window.handleTickerClick = function(ev, sym){
  trackEvent("symbol_click", { symbol: sym, featureId: "tradingview_link" });
  window.open(tvUrlFor(sym), "_blank", "noopener,noreferrer");
};
```

### 4. **Mini Chart Hover** (Line 3228)
```javascript
async function showMini(ev, sym){
  ensureMiniBox();
  miniSym=sym;
  posMini(ev);
  miniBox.style.display="block";
  miniBox.querySelector("#miniTitle").textContent = "📈 " + sym + " — mini chart";
  trackEvent("mini_chart_hover", { symbol: sym });
  // ...
}
```

### 5. **Box Load** (Line 3458)
```javascript
async function loadSection(sec){
  const meta = byId("meta_"+sec.id);
  const body = byId("body_"+sec.id);

  try{
    meta.textContent="Loading...";
    trackEvent("box_load", { featureId: sec.id, meta: { title: sec.title } });
    const r = await fetch(sec.endpoint || sec.url);
    // ...
  }
}
```

### 6. **PRO Feature Blocked** (Lines 3464, 3479)
```javascript
// When HTML redirect detected
if (!r.ok || r.headers.get("content-type")?.includes("text/html")) {
  meta.textContent="PRO Only";
  trackEvent("pro_feature_blocked", { featureId: sec.id });
  // ...
}

// When JSON error detected
if (j && j.error === "PRO_REQUIRED") {
  meta.textContent="PRO Only";
  trackEvent("pro_feature_blocked", { featureId: sec.id });
  // ...
}
```

### 7. **Upgrade Click** (Lines 3469, 3484)
```javascript
// In the PRO lock screen HTML
<a href="/pricing" onclick="trackEvent('upgrade_click', {featureId: '${sec.id}'})">
  Upgrade to PRO
</a>
```

### 8. **Symbols Update** (Line 3536)
```javascript
function applyImportant(){
  const input = byId("symbols");
  const maxInput = byId("maxSymbols");
  
  importantSymbols = String(input.value||"").trim();
  scanMax = Number(maxInput.value || 200);
  // ...
  
  trackEvent("symbols_update", { 
    meta: { 
      symbolCount: importantSymbols.split(',').filter(Boolean).length, 
      maxSymbols: scanMax 
    } 
  });
  loadSection(sec);
  // ...
}
```

## 🎯 How to Add More Tracking

### Example 1: Track Button Click
```javascript
btnClear.addEventListener("click", ()=>{
  input.value = "";
  input.focus();
  renderRoller("");
  trackEvent("symbols_cleared"); // ← Add this
  statusPill.textContent = "Cleared";
  setTimeout(()=>statusPill.textContent="Dashboard", 600);
});
```

### Example 2: Track Feature Toggle
```javascript
// When user enables/disables a filter
function toggleFilter(filterName, enabled) {
  trackEvent("filter_toggled", { 
    featureId: filterName, 
    meta: { enabled } 
  });
  // ... rest of toggle logic
}
```

### Example 3: Track Search
```javascript
// When user searches for a symbol
function searchSymbol(query) {
  trackEvent("symbol_search", { 
    meta: { query, resultsCount: results.length } 
  });
  // ... search logic
}
```

## 🔍 How to View Analytics

### 1. Enable PRO User
Edit `server.js` line 148:
```javascript
isPaid: true  // Change from false to true
```

### 2. View Recent Events
```bash
curl http://localhost:3000/analytics/recent?limit=50 | jq
```

### 3. View Summary Dashboard
```bash
curl http://localhost:3000/analytics/summary | jq
```

### 4. Watch Console Logs
When `DEBUG=true` in `.env`, you'll see:
```
📊 Analytics: FREE | page_load | /ui
📊 Analytics: FREE | box_load | pm_movers
📊 Analytics: FREE | symbol_click | tradingview_link
📊 Analytics: FREE | mini_chart_hover | 
```

## 📈 Real-World Example Usage

### Track Custom Business Events
```javascript
// When user completes a specific workflow
trackEvent("workflow_completed", {
  featureId: "premarket_scan_workflow",
  meta: {
    stepsCompleted: 5,
    timeSpent: 120000, // milliseconds
    symbolsScanned: 50,
    symbolsSelected: 3
  }
});

// Track error events
trackEvent("api_error", {
  featureId: "movers_endpoint",
  meta: {
    endpoint: "/movers-premarket",
    statusCode: 500,
    errorMessage: "Timeout"
  }
});

// Track performance metrics
trackEvent("performance_metric", {
  featureId: "box_load_time",
  meta: {
    boxId: "pm_movers",
    loadTime: 1234, // milliseconds
    cacheHit: false
  }
});
```

## 🎯 Common Patterns

### Pattern 1: Track Before Action
```javascript
async function doAction() {
  trackEvent("action_started", { featureId: "my_action" });
  
  try {
    await performAction();
    trackEvent("action_success", { featureId: "my_action" });
  } catch (e) {
    trackEvent("action_failed", { 
      featureId: "my_action", 
      meta: { error: e.message } 
    });
  }
}
```

### Pattern 2: Track User Flow
```javascript
// Step 1
trackEvent("funnel_step_1", { meta: { step: "select_symbols" } });

// Step 2
trackEvent("funnel_step_2", { meta: { step: "configure_filters" } });

// Step 3 (conversion)
trackEvent("funnel_step_3", { meta: { step: "execute_scan", converted: true } });
```

### Pattern 3: Track Time on Task
```javascript
const startTime = Date.now();

// ... user performs task ...

trackEvent("task_completed", {
  featureId: "symbol_analysis",
  meta: {
    symbol: "AAPL",
    duration: Date.now() - startTime
  }
});
```

## ✅ Status

**Everything is already set up and working!** You can:

1. ✅ Track events from anywhere in the UI using `trackEvent()`
2. ✅ View analytics via API endpoints
3. ✅ See real-time logs in console (when DEBUG=true)
4. ✅ Export data for analysis
5. ✅ Add custom tracking as needed

**No additional setup required!** 🎉
