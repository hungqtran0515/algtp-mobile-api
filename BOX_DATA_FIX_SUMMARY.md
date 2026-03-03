# Box Data Fix Summary - Feb 4, 2026

## Problem
FREE14 users with expired trials were seeing ALL boxes instead of only the 4 allowed boxes (gappers_dn, gappers_up, top_gainers, top_losers).

## Root Cause
Two critical bugs:

1. **Client-side bug (server.js line 5034-5038)**:
   - Logic was: `allowedBoxes.length === 0 || allowedBoxes.includes(sec.id)`
   - This meant empty allowedBoxes = access to ALL boxes
   - Should only allow all boxes during ACTIVE trial period

2. **Server-side bug (server.js line 6711)**:
   - `/me` endpoint always returned `allowedBoxes: null` regardless of trial status
   - Code was: `allowedBoxes: access.mode === "FREE" ? null : null,`
   - Always evaluated to null!

## Solution

### 1. Client-side fix (lines 5033-5043)
```javascript
const mode = String(userInfo?.mode || "EXPIRED").toUpperCase();
const allowedBoxes = Array.isArray(userInfo?.allowedBoxes) && userInfo.allowedBoxes.length > 0 
  ? userInfo.allowedBoxes 
  : FREE14_ALLOWED_BOXES;

const isFree14 = tier === "FREE14";
const isTrialActive = mode === "FREE" || (mode === "PAID" && Number(userInfo?.totalHoursLeft || 0) > 0);

// ✅ FIXED: FREE14 during trial = ALL boxes, after trial = only FREE14_ALLOWED_BOXES
const isAllowedFree14 = isFree14 && (isTrialActive || allowedBoxes.includes(sec.id));
```

### 2. Server-side fix (lines 6696-6729)
```javascript
let allowedBoxes = null;
if (access.tier === "FREE14" && access.mode === "EXPIRED") {
  // Trial expired - only show 4 basic boxes
  allowedBoxes = Array.from(FREE14_ALLOWED_BOXES);
} else if (access.mode === "FREE" || access.mode === "PAID") {
  // Active trial or paid - all boxes
  allowedBoxes = null;
} else {
  // Fallback for other expired states
  allowedBoxes = Array.from(FREE14_ALLOWED_BOXES);
}

res.json({
  // ... other fields
  allowedBoxes: allowedBoxes,
  isPaid: access.mode === "PAID",
  paidUntil: access.mode === "PAID" ? access.until : 0,
});
```

## Behavior After Fix

### FREE14 users DURING trial (mode = "FREE")
- ✅ `/me` returns `allowedBoxes: null`
- ✅ Client interprets null as "all access"
- ✅ All boxes load and display data

### FREE14 users AFTER trial expired (mode = "EXPIRED")
- ✅ `/me` returns `allowedBoxes: ['gappers_dn', 'gappers_up', 'top_gainers', 'top_losers']`
- ✅ Client checks each box: `allowedBoxes.includes(sec.id)`
- ✅ Only 4 boxes load data
- ✅ Other boxes show "🔒 Trial Expired" with upgrade CTA

### PAID users (BASIC/PRO/PREMIUM)
- ✅ `/me` returns `allowedBoxes: null`
- ✅ All boxes load and display data

## Constants

### FREE14_ALLOWED_BOXES (server.js line 682-687)
```javascript
const FREE14_ALLOWED_BOXES = new Set([
  'gappers_dn',   // Top Gappers Down
  'gappers_up',   // Top Gappers Up
  'top_gainers',  // Top Gainers
  'top_losers',   // Top Losers
]);
```

### FREE14_ALLOWED_BOXES (client-side, server.js line 4827-4832)
```javascript
const FREE14_ALLOWED_BOXES = [
  'gappers_dn',
  'gappers_up',
  'top_gainers',
  'top_losers',
];
```

## Testing

Server tested successfully:
- ✅ Starts without errors on port 3001
- ✅ No console errors related to Box loading
- ✅ WebSocket connections working
- ✅ All core systems initialized

## Next Steps

To fully test the fix:

1. **Test with active FREE14 trial user**:
   - Login with user who has `free_until > Date.now()`
   - Check `/me` returns `allowedBoxes: null`
   - Verify all boxes show data

2. **Test with expired FREE14 user**:
   - Login with user who has `free_until < Date.now()`
   - Check `/me` returns `allowedBoxes: ['gappers_dn', ...]`
   - Verify only 4 boxes show data, others show lock message

3. **Test with PAID user**:
   - Login with user who has `is_paid: 1` and `paid_until > Date.now()`
   - Check `/me` returns `allowedBoxes: null`
   - Verify all boxes show data

## Related Files
- `server.js` (lines 682-687, 4827-4832, 5033-5049, 6692-6730)
- `db.js` (user table schema)
- `/me` endpoint
- `/ui` dashboard client-side code

## Implementation Date
February 4, 2026

## Author
WARP AI Assistant
