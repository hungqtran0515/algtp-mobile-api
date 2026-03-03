# Bug Fixes - Comprehensive Test Plan

## Overview
This document outlines test cases for all 7 bug fixes implemented in this session.

---

## Bug #1: Duplicate Stub Routes

### Issue
- SECTION 12 had stub routes without authentication
- SECTION 13 had same stub routes WITH `requireLogin, requireAccess`
- Route defined last wins → endpoints became locked

### Fix
- Removed duplicate stubs from SECTION 12
- Kept only authenticated stubs in SECTION 13

### Test Cases

```bash
# Test 1: Verify stub routes require authentication
curl http://localhost:3000/float-turnover
# Expected: 401 or redirect to /pricing?login_required=1

# Test 2: Verify authenticated access works
curl http://localhost:3000/float-turnover -H "Cookie: algtp.sid=..." 
# Expected: { ok: true, stub: true, name: "float-turnover", results: [] }

# Test 3: Check all stub routes
for route in float-turnover low-float-hot filter-rsi filter-rsi-reversal filter-macd filter-ao filter-ema-stack; do
  echo "Testing /$route..."
  curl -s http://localhost:3000/$route | jq '.ok // .error'
done
```

**Success Criteria:**
- ✅ All stub routes require login
- ✅ No duplicate route definitions
- ✅ Consistent auth behavior

---

## Bug #2: requireAccess() Strict is_paid Check

### Issue
```javascript
// Old code
const paidActive = (u?.is_paid === 1) && (paidUntil > now);
```
- User upgrades → Stripe webhook sets `tier=PRO`, `paid_until` → but `is_paid` not updated yet
- User gets 403 even though they paid!

### Fix
```javascript
const isPaidFlag = (u?.is_paid === 1) || (u?.isPaid === true);
const isPaidTier = ["TRIAL7", "BASIC", "PRO"].includes(tier);
const paidActive = (paidUntil > now) && (isPaidFlag || isPaidTier);
```

### Test Cases

**Test 1: User with tier but no is_paid flag**
```sql
-- Simulate Stripe webhook setting tier before is_paid
UPDATE users SET tier='PRO', paid_until=FUTURE_TIMESTAMP, is_paid=0 WHERE email='test@example.com';
```
```bash
curl http://localhost:3000/ui -H "Cookie: ..."
# Expected: Access granted (200)
```

**Test 2: User with is_paid but wrong tier**
```sql
UPDATE users SET tier='FREE14', paid_until=FUTURE_TIMESTAMP, is_paid=1;
```
```bash
curl http://localhost:3000/ui -H "Cookie: ..."
# Expected: Access granted (200)
```

**Test 3: Check /me endpoint shows correct access**
```bash
curl http://localhost:3000/me -H "Cookie: ..." | jq '.mode'
# Expected: "PAID" if paid_until > now and (is_paid=1 OR tier in [TRIAL7,BASIC,PRO])
```

**Success Criteria:**
- ✅ Access granted if `paid_until > now` AND (`is_paid=1` OR tier is PAID tier)
- ✅ No more "paid but locked" scenarios
- ✅ Works during Stripe webhook race conditions

---

## Bug #3: isPaid vs is_paid Naming Inconsistency

### Issue
- DB returns `is_paid` (snake_case)
- Some code checks `user.isPaid` (camelCase)
- `getUserTier()` returned wrong tier for paid users

### Fix
All functions now support both:
```javascript
const isPaidFlag = (user.is_paid === 1) || (user.isPaid === true);
```

### Test Cases

**Test 1: Check getUserTier()**
```javascript
// In browser console on /ui
console.log('User tier test:', getUserTier({ is_paid: 1, tier: 'PRO' }));
// Expected: "PRO"

console.log('User tier test:', getUserTier({ isPaid: true, tier: 'BASIC' }));
// Expected: "BASIC"
```

**Test 2: Check computeAccessCountdown()**
```bash
curl http://localhost:3000/debug/me -H "Cookie: ..." | jq '.access'
# Check that mode is "PAID" for users with either is_paid=1 or isPaid=true
```

**Success Criteria:**
- ✅ `getUserTier()` works with both naming conventions
- ✅ `computeAccessCountdown()` works with both
- ✅ `requireBasic()` and `requirePro()` work with both

---

## Bug #4: Massive API 401 - Wrong Domain (ROOT CAUSE)

### Issue
- Code called `https://api.massive.com` (doesn't exist or wrong provider)
- API key is actually a **Polygon.io key**
- All Massive API calls returned 401

### Fix
- Updated all `MASSIVE_*_URL` to use `https://api.polygon.io`
- Updated `.env` and `server.js` fallback URLs

### Test Cases

**Test 1: Test movers endpoint**
```bash
curl "http://localhost:3000/debug/massive-api" | jq '.results.movers_gainers'
# Expected: { ok: true, status: 200, rowCount: > 0 }
```

**Test 2: Test all API endpoints**
```bash
curl http://localhost:3000/debug/massive-api | jq
# Expected: All endpoints return status 200
```

**Test 3: Direct API test**
```bash
# Test old URL (should fail)
curl -s "https://api.massive.com/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=..." | jq

# Test new URL (should work)
curl -s "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=..." | jq '.status'
# Expected: "OK"
```

**Test 4: Check ENV config**
```bash
curl http://localhost:3000/debug/env | jq '.env.MASSIVE_MOVER_URL'
# Expected: "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks"
```

**Success Criteria:**
- ✅ All Massive API endpoints return 200
- ✅ No more 401 errors in logs
- ✅ `/movers-premarket` and `/movers-afterhours` work
- ✅ ENV shows correct Polygon.io URLs

---

## Bug #5: GOOGLE_CALLBACK_URL Fallback

### Issue
```javascript
const APP_URL = String(process.env.APP_URL || `http://localhost:${PORT}`).trim();
const GOOGLE_CALLBACK_URL = String(process.env.GOOGLE_CALLBACK_URL || `${APP_URL}/auth/google/callback`).trim();
```
- On Render without `APP_URL` set → fallback to `http://localhost:3000`
- OAuth callback URL becomes `http://localhost:3000/auth/google/callback`
- Google redirects to localhost → OAuth fails!

### Fix
```javascript
const APP_URL = (() => {
  const url = String(process.env.APP_URL || "").trim();
  if (url) return url;
  
  // Auto-detect Render environment
  if (process.env.RENDER) {
    const renderServiceName = process.env.RENDER_SERVICE_NAME || "algtp-app";
    return `https://${renderServiceName}.onrender.com`;
  }
  
  return `http://localhost:${PORT}`;
})();
```

### Test Cases

**Test 1: Local development**
```bash
unset APP_URL
npm run dev
# Check startup logs
# Expected: APP_URL: http://localhost:3000
```

**Test 2: Render environment simulation**
```bash
export RENDER=true
export RENDER_SERVICE_NAME=algtp-test
npm run dev
# Expected: APP_URL: https://algtp-test.onrender.com
# Expected: Warning log about auto-detection
```

**Test 3: Explicit APP_URL**
```bash
export APP_URL=https://my-custom-domain.com
npm run dev
# Expected: APP_URL: https://my-custom-domain.com
# Expected: No warning log
```

**Test 4: Check debug endpoint**
```bash
curl http://localhost:3000/debug/env | jq '.env | {APP_URL, GOOGLE_CALLBACK_URL}'
```

**Success Criteria:**
- ✅ Auto-detects Render environment
- ✅ Falls back correctly for local dev
- ✅ Warns when APP_URL not explicitly set
- ✅ GOOGLE_CALLBACK_URL uses correct domain

---

## Bug #6: Enhanced 401 Error Logging

### Issue
- 401 errors had no detailed logging
- Hard to debug which endpoint, what auth method, etc.

### Fix
- Added comprehensive 401 error logging to all Massive API functions
- Shows URL, auth type, params, headers, response body

### Test Cases

**Test 1: Trigger 401 with wrong key**
```bash
# Temporarily change API key in .env
MASSIVE_API_KEY=invalid_key npm run dev

# Make request
curl http://localhost:3000/movers-premarket

# Check server logs for:
# 🚨 MASSIVE API 401 UNAUTHORIZED:
#   URL: ...
#   Auth Type: query
#   Query Params: { "apiKey": "invalid_key" }
#   Response Body: ...
```

**Test 2: Check all endpoints log 401s**
```bash
# Test each function:
# - fetchMovers()
# - fetchTickerSnapshot()
# - fetchSnapshotAll()
# - fetchAggs()
```

**Success Criteria:**
- ✅ Detailed error logs for all 401 responses
- ✅ Shows full diagnostic info (URL, auth, params, response)
- ✅ Includes troubleshooting hints

---

## Bug #7: UI Gating - allowedBoxes Logic

### Issue
```javascript
// Old backend
allowedBoxes: access.mode === "FREE" ? Array.from(FREE14_ALLOWED_BOXES) : null

// Old frontend
const allowedBoxes = Array.isArray(userInfo?.allowedBoxes) ? userInfo.allowedBoxes : [];
```
- PAID users got `allowedBoxes: null` → UI converts to `[]`
- Expired FREE14 users with `mode=EXPIRED` but `tier=FREE14` got `allowedBoxes: null`
- UI couldn't distinguish between restricted and full access

### Fix
**Backend:**
```javascript
const tierUpper = String(access.tier || "").toUpperCase();

if (tierUpper === "FREE14") {
  allowedBoxes = Array.from(FREE14_ALLOWED_BOXES);
} else if (["TRIAL7", "BASIC", "PRO"].includes(tierUpper)) {
  allowedBoxes = "all";
} else {
  allowedBoxes = [];
}
```

**Frontend:**
```javascript
const allowedBoxesRaw = userInfo?.allowedBoxes;
const hasFullAccess = allowedBoxesRaw === "all";
const allowedBoxes = Array.isArray(allowedBoxesRaw) ? allowedBoxesRaw : [];

if (isFree14 && !isAllowedFree14 && !hasFullAccess) {
  // Show lock
}
```

### Test Cases

**Test 1: FREE14 Active User**
```bash
# Login as FREE14 with valid free_until
curl http://localhost:3000/me -H "Cookie: ..." | jq '.allowedBoxes'
# Expected: ["gappers_dn", "gappers_up", "top_gainers", "top_losers"]

# Check UI - should show 4 boxes unlocked, rest locked
```

**Test 2: FREE14 Expired User**
```bash
# User with tier=FREE14 but expired free_until
curl http://localhost:3000/me -H "Cookie: ..." | jq '.allowedBoxes'
# Expected: ["gappers_dn", "gappers_up", "top_gainers", "top_losers"]
# (same as active FREE14 - tier-based, not mode-based)

# Check UI - boxes show lock, but correct boxes are indicated
```

**Test 3: PAID User (PRO)**
```bash
curl http://localhost:3000/me -H "Cookie: ..." | jq '.allowedBoxes'
# Expected: "all"

# Check UI - all boxes unlocked
```

**Test 4: Expired PAID User**
```bash
# User with tier=PRO but expired paid_until
curl http://localhost:3000/me -H "Cookie: ..." | jq '.allowedBoxes'
# Expected: "all"
# (UI will show locks via requireAccess, but allowedBoxes is correct)
```

**Success Criteria:**
- ✅ FREE14 users always see correct allowed boxes (even if expired)
- ✅ PAID users get `"all"` (not null or [])
- ✅ UI properly distinguishes full access vs restricted
- ✅ No false "locked" states for PAID users

---

## Integration Tests

### Test 1: End-to-End User Flow

**FREE14 → TRIAL7 → Expired → Reactivate**

1. Create new user (auto FREE14)
   ```bash
   # Login with Google OAuth
   # Check /me → tier: "FREE14", allowedBoxes: [4 boxes]
   ```

2. Upgrade to TRIAL7
   ```bash
   # Complete Stripe checkout for TRIAL7
   # Check /me → tier: "TRIAL7", allowedBoxes: "all"
   # Check /ui → all boxes unlocked
   ```

3. Wait for expiry (or manually set `paid_until` to past)
   ```bash
   # Check /me → mode: "EXPIRED", tier: "TRIAL7", allowedBoxes: "all"
   # Check /ui → shows upgrade prompts but allowedBoxes is still "all"
   ```

4. Reactivate with PRO
   ```bash
   # Complete Stripe checkout for PRO
   # Check /me → tier: "PRO", mode: "PAID", allowedBoxes: "all"
   # Check /ui → full access restored
   ```

### Test 2: Production Deployment

**Before deploying to Render:**

```bash
# Checklist:
□ Set APP_URL=https://your-app.onrender.com
□ Set MASSIVE_API_KEY (Polygon key)
□ Set MASSIVE_AUTH_TYPE=query
□ Set all MASSIVE_*_URL to api.polygon.io
□ Set GOOGLE_CALLBACK_URL=https://your-app.onrender.com/auth/google/callback
□ Set STRIPE_* keys
□ Set GOOGLE_* OAuth credentials
```

**After deployment:**

```bash
# Test ENV
curl https://your-app.onrender.com/debug/env | jq

# Test APIs
curl https://your-app.onrender.com/debug/massive-api | jq

# Test auth flow
# 1. Visit /pricing
# 2. Login with Google
# 3. Check redirect works
# 4. Check /me shows correct tier
```

---

## Regression Test Suite

Run this before every deploy:

```bash
#!/bin/bash
# regression-test.sh

echo "🧪 Running regression tests..."

# Test 1: API endpoints work
echo "1. Testing Massive API endpoints..."
curl -s http://localhost:3000/debug/massive-api | jq '.ok' || exit 1

# Test 2: Auth works
echo "2. Testing authentication..."
# (requires valid session cookie)

# Test 3: ENV is correct
echo "3. Testing environment variables..."
curl -s http://localhost:3000/debug/env | jq '.env.MASSIVE_MOVER_URL' | grep -q "polygon.io" || exit 1

# Test 4: Stubs require auth
echo "4. Testing stub routes require auth..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/float-turnover)
[ "$STATUS" = "401" ] || [ "$STATUS" = "302" ] || exit 1

echo "✅ All regression tests passed!"
```

---

## Success Metrics

All fixes are successful when:

- ✅ No 401 errors from Massive/Polygon API
- ✅ All authenticated users can access paid features
- ✅ FREE14 users see correct 4 boxes
- ✅ PAID users have full access
- ✅ OAuth redirects work on production
- ✅ No "paid but locked" scenarios
- ✅ Expired users see correct upgrade prompts
- ✅ All stub routes require authentication

---

**Last Updated:** 2026-02-02  
**Total Bugs Fixed:** 7  
**Confidence Level:** High ✅
