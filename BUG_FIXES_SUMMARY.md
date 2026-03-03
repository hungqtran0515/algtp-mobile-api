# Bug Fixes Summary - Session 2026-02-02

## Executive Summary

**Total Bugs Fixed:** 7  
**Critical Bugs:** 2 (Massive API 401, UI Gating)  
**Files Modified:** 
- `server.js` (primary)
- `.env` (URLs updated)
- New files: `test-massive-auth.sh`, `switch-auth.sh`, `.env.bearer`, `MASSIVE_API_DEBUG.md`, `BUG_FIXES_TEST_PLAN.md`

---

## Bug Fixes Overview

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | Medium | Duplicate stub routes | ✅ Fixed |
| 2 | High | requireAccess() strict is_paid check | ✅ Fixed |
| 3 | Medium | isPaid vs is_paid naming | ✅ Fixed |
| 4 | **CRITICAL** | Massive API 401 (wrong domain) | ✅ Fixed |
| 5 | High | GOOGLE_CALLBACK_URL fallback | ✅ Fixed |
| 6 | Low | Enhanced 401 error logging | ✅ Added |
| 7 | **CRITICAL** | UI Gating allowedBoxes logic | ✅ Fixed |

---

## Detailed Fixes

### Bug #1: Duplicate Stub Routes

**Impact:** Medium  
**Affected Users:** Developers, QA testing  

**Before:**
```javascript
// SECTION 12 (line ~3242)
app.get("/float-turnover", stub("float-turnover"));

// SECTION 13 (line ~4662)  
app.get("/float-turnover", requireLogin, requireAccess, stub("float-turnover"));
```
- Route defined last wins
- Endpoints appeared open but were locked
- Confusing for developers

**After:**
```javascript
// SECTION 12 (line ~3239)
// Stub endpoints moved to SECTION 13 with requireLogin, requireAccess

// SECTION 13 (line ~4662)
app.get("/float-turnover", requireLogin, requireAccess, stub("float-turnover"));
```
- Only one definition per route
- Clear authentication requirements
- Predictable behavior

---

### Bug #2: requireAccess() Strict is_paid Check

**Impact:** High  
**Affected Users:** All paying customers  
**Symptom:** "Paid but locked" - users upgrade but still can't access features

**Before:**
```javascript
const paidActive = (u?.is_paid === 1) && (paidUntil > now);
```
- Requires BOTH `is_paid=1` AND `paidUntil > now`
- Race condition: Stripe webhook may set `tier` before `is_paid`
- Users blocked even after payment

**After:**
```javascript
const isPaidFlag = (u?.is_paid === 1) || (u?.isPaid === true);
const isPaidTier = ["TRIAL7", "BASIC", "PRO"].includes(tier);
const paidActive = (paidUntil > now) && (isPaidFlag || isPaidTier);
```
- Checks tier OR is_paid flag
- Handles webhook race conditions
- More resilient to partial updates

---

### Bug #3: isPaid vs is_paid Naming Inconsistency

**Impact:** Medium  
**Affected Users:** Analytics, tier detection  

**Before:**
```javascript
// getUserTier()
return user.isPaid ? "PAID" : "FREE";  // ❌ isPaid doesn't exist in DB
```
- DB returns `is_paid` (snake_case)
- Code checks `isPaid` (camelCase)
- Wrong tier shown in analytics

**After:**
```javascript
const isPaidFlag = (user.is_paid === 1) || (user.isPaid === true);
return isPaidFlag ? "PAID" : "FREE";
```
- Supports both naming conventions
- Applied to: `getUserTier()`, `computeAccessCountdown()`, `requireBasic()`, `requirePro()`

---

### Bug #4: Massive API 401 - Wrong Domain (ROOT CAUSE)

**Impact:** CRITICAL  
**Affected Users:** All users (no data loading)  
**Symptom:** All movers/scanners return 401 errors

**Root Cause:** API key is **Polygon.io key** but code was calling `api.massive.com` (non-existent domain)

**Before:**
```bash
MASSIVE_MOVER_URL=https://api.massive.com/v2/snapshot/locale/us/markets/stocks
# Result: 401 Unauthorized
```

**After:**
```bash
MASSIVE_MOVER_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks
# Result: 200 OK ✅
```

**Test Results:**
```bash
# Old domain
curl "https://api.massive.com/v2/.../gainers?apiKey=..." → 401/404

# New domain (Polygon.io)
curl "https://api.polygon.io/v2/.../gainers?apiKey=..." → 200 ✅
```

**Files Changed:**
- `.env` - Updated all MASSIVE_*_URL
- `server.js` lines 109-113 - Updated fallback URLs
- Added comment: `// NOTE: "MASSIVE" is variable name prefix, actual provider is Polygon.io`

---

### Bug #5: GOOGLE_CALLBACK_URL Fallback

**Impact:** High  
**Affected Users:** Production OAuth users  
**Symptom:** OAuth redirects to localhost, login fails

**Before:**
```javascript
const APP_URL = String(process.env.APP_URL || `http://localhost:${PORT}`).trim();
const GOOGLE_CALLBACK_URL = String(process.env.GOOGLE_CALLBACK_URL || `${APP_URL}/auth/google/callback`).trim();
```
- On production without `APP_URL` → defaults to `http://localhost:3000`
- OAuth callback becomes `http://localhost:3000/auth/google/callback`
- Google redirects to localhost → fails!

**After:**
```javascript
const APP_URL = (() => {
  const url = String(process.env.APP_URL || "").trim();
  if (url) return url;
  
  // Auto-detect Render environment
  if (process.env.RENDER) {
    const renderServiceName = process.env.RENDER_SERVICE_NAME || "algtp-app";
    console.warn(`⚠️  APP_URL not set, auto-detecting from RENDER: https://${renderServiceName}.onrender.com`);
    return `https://${renderServiceName}.onrender.com`;
  }
  
  return `http://localhost:${PORT}`;
})();
```
- Auto-detects Render environment via `process.env.RENDER`
- Constructs correct HTTPS URL
- Warns if APP_URL not explicitly set
- Still works for local development

---

### Bug #6: Enhanced 401 Error Logging

**Impact:** Low (developer experience)  
**Affected Users:** Developers debugging issues

**Before:**
- 401 errors had minimal logging
- Hard to debug auth issues

**After:**
```javascript
if (r.status === 401) {
  console.error("\n🚨 MASSIVE API 401 UNAUTHORIZED:");
  console.error("  URL:", url);
  console.error("  Auth Type:", MASSIVE_AUTH_TYPE);
  console.error("  Query Params:", JSON.stringify(a.params, null, 2));
  console.error("  Headers (filtered):", Object.keys(a.headers).filter(k => k !== 'user-agent'));
  console.error("  API Key Preview:", MASSIVE_API_KEY ? `${MASSIVE_API_KEY.substring(0, 12)}...` : "(missing)");
  console.error("  Response Body:", ...);
  console.error("\n💡 Possible causes:");
  console.error("  1. API key invalid or expired");
  console.error("  2. Auth method mismatch");
  console.error("  3. URL endpoint changed");
  console.error("  4. IP-based rate limiting");
}
```
- Applied to: `fetchMovers()`, `fetchTickerSnapshot()`, `fetchSnapshotAll()`, `fetchAggs()`
- Shows full diagnostic information
- Includes troubleshooting hints

**New Debug Tools:**
- `/debug/env` - Check environment variables
- `/debug/massive-api` - Test all API endpoints
- `test-massive-auth.sh` - Test all auth methods
- `switch-auth.sh` - Switch between query/bearer/xapi auth

---

### Bug #7: UI Gating - allowedBoxes Logic

**Impact:** CRITICAL  
**Affected Users:** All users (FREE14 and PAID)  
**Symptom:** Wrong boxes locked/unlocked based on user tier

**Before:**
```javascript
// Backend
allowedBoxes: access.mode === "FREE" ? Array.from(FREE14_ALLOWED_BOXES) : null

// Frontend
const allowedBoxes = Array.isArray(userInfo?.allowedBoxes) ? userInfo.allowedBoxes : [];
```

**Problems:**
1. PAID users got `allowedBoxes: null` → UI converts to `[]`
2. Expired FREE14: `mode=EXPIRED` → `allowedBoxes: null`
3. UI can't distinguish "restricted" vs "full access"

**After:**

**Backend** (lines 5831-5848):
```javascript
const tierUpper = String(access.tier || "").toUpperCase();

if (tierUpper === "FREE14") {
  // FREE14: always show allowed boxes (even if expired)
  allowedBoxes = Array.from(FREE14_ALLOWED_BOXES);
} else if (["TRIAL7", "BASIC", "PRO"].includes(tierUpper)) {
  // PAID tiers: full access
  allowedBoxes = "all";
} else {
  // Unknown tier
  allowedBoxes = [];
}
```

**Frontend** (lines 4535-4550):
```javascript
const allowedBoxesRaw = userInfo?.allowedBoxes;
const hasFullAccess = allowedBoxesRaw === "all";
const allowedBoxes = Array.isArray(allowedBoxesRaw) ? allowedBoxesRaw : [];

// PAID users (hasFullAccess=true) should NEVER be locked
if (isFree14 && !isAllowedFree14 && !hasFullAccess) {
  // Show lock screen
}
```

**Values:**
- FREE14: `["gappers_dn", "gappers_up", "top_gainers", "top_losers"]`
- PAID (TRIAL7/BASIC/PRO): `"all"`
- EXPIRED/Unknown: `[]`

**Key Improvement:** Uses `tier` instead of `mode` to avoid expired FREE14 getting wrong boxes

---

## Production Deployment Checklist

Before deploying to Render:

```bash
# Environment Variables (REQUIRED)
□ APP_URL=https://your-app-name.onrender.com
□ GOOGLE_CALLBACK_URL=https://your-app-name.onrender.com/auth/google/callback

# API Configuration
□ MASSIVE_API_KEY=<your-polygon-key>
□ MASSIVE_AUTH_TYPE=query
□ MASSIVE_MOVER_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks
□ MASSIVE_TICKER_SNAPSHOT_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers
□ MASSIVE_SNAPSHOT_ALL_URL=https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers
□ MASSIVE_AGGS_URL=https://api.polygon.io/v2/aggs/ticker

# OAuth & Payments
□ GOOGLE_CLIENT_ID=<web-app-client-id>
□ GOOGLE_CLIENT_SECRET=<client-secret>
□ STRIPE_SECRET_KEY=<sk_live_...>
□ STRIPE_WEBHOOK_SECRET=<whsec_...>

# Test After Deploy
□ curl https://your-app.onrender.com/debug/env
□ curl https://your-app.onrender.com/debug/massive-api
□ Test OAuth login flow
□ Test Stripe checkout
```

---

## Quick Test Commands

```bash
# Test Massive API endpoints
curl http://localhost:3000/debug/massive-api | jq

# Test environment variables
curl http://localhost:3000/debug/env | jq

# Test auth methods
./test-massive-auth.sh

# Switch auth type
./switch-auth.sh bearer
./switch-auth.sh query

# Test /me endpoint
curl http://localhost:3000/me -H "Cookie: ..." | jq '.allowedBoxes'

# Test stub routes require auth
curl http://localhost:3000/float-turnover
# Expected: 401 or redirect
```

---

## Migration Notes

**For existing deployments:**

1. **Update .env on Render:**
   ```bash
   # Old (will cause 401)
   MASSIVE_MOVER_URL=https://api.massive.com/...
   
   # New (correct)
   MASSIVE_MOVER_URL=https://api.polygon.io/...
   ```

2. **Set APP_URL explicitly:**
   ```bash
   APP_URL=https://your-app-name.onrender.com
   ```

3. **Redeploy** or restart service for changes to take effect

4. **Verify** using debug endpoints:
   ```bash
   curl https://your-app.onrender.com/debug/env | jq '.env.MASSIVE_MOVER_URL'
   # Should return: "https://api.polygon.io/..."
   ```

---

## Known Issues & Future Improvements

**None blocking deployment.**

Optional enhancements for future:
- Add rate limiting for API endpoints
- Implement caching layer for Polygon API
- Add retry logic for transient API failures
- Create admin dashboard for user management

---

## References

- **Test Plan:** `BUG_FIXES_TEST_PLAN.md`
- **Debug Guide:** `MASSIVE_API_DEBUG.md`
- **Auth Test Script:** `test-massive-auth.sh`
- **Auth Switcher:** `switch-auth.sh`

---

**Session Date:** 2026-02-02  
**Total Bugs Fixed:** 7  
**Lines Changed:** ~200 lines across server.js  
**Status:** ✅ Ready for Production  
**Confidence:** High
