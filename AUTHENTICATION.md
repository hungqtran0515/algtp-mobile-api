# ALGTP™ Authentication & Feature Toggle System

## Overview
The authentication system allows you to lock premium features behind a PRO subscription. Free users are redirected to the pricing page, while PRO users can access all features.

## Implementation Status

### ✅ Step 4 — UI Crash Prevention (COMPLETE)
The `loadSection()` function in the UI now properly handles authentication redirects:
- Detects HTML responses (redirects to `/pricing`)
- Detects JSON error responses with `PRO_REQUIRED` error code
- Shows a user-friendly "🔒 PRO Feature" message with upgrade link
- Prevents "Unexpected token '<'" errors

### ✅ Step 5 — Feature Toggle System (COMPLETE)
- **User Status Display**: Shows "FREE" or "PRO (Xd left)" in the top header
- **localStorage Persistence**: User status cached and persists across page reloads
- **API Integration**: `/me` endpoint provides user subscription info
- **Auto-refresh**: Status updates on every page load

### ✅ Step 6 — Polish & Finalization (COMPLETE)
- ⏱ **Days Left Display**: Shows remaining subscription days (e.g., "PRO (30d left)")
- 🎨 **Color-coded Status**: 
  - FREE = Red background (#1a1622)
  - PRO Active = Green background (#0d3320)
  - PRO Expired = Dark red (#3a1a1a)
- 🔐 **Pricing Page**: Beautiful responsive `/pricing` page with 3 plans (FREE, PRO, TRIAL)

## Protected Endpoints (PRO Features)

### ❌ FREE Users CANNOT Access:
- `/rank-rovl` - Composite ROVL ranking
- `/box/fmp-intraday-1m-scan` - FMP 1-minute intraday scan
- `/box/rank-rovl` - Box ROVL ranking
- `/float-turnover` - Float turnover leaders
- `/low-float-hot` - Low float hotlist
- `/filter-rsi` - RSI bull zone filter
- `/filter-rsi-reversal` - RSI reversal filter
- `/filter-macd` - MACD cross filter
- `/filter-ao` - Awesome Oscillator filter
- `/filter-ema-stack` - EMA stack filter

### ✅ FREE Users CAN Access:
- `/ui` - Main dashboard
- `/scan` - Symbol scanning
- `/list` - Movers by group (gainers/losers/gappers)
- `/movers-premarket` - Premarket movers
- `/movers-afterhours` - After-hours movers
- `/most-active` - Most active stocks
- `/unusual-volume` - Unusual volume detection
- `/most-volatile` - Most volatile stocks
- `/most-lately` - Latest updates
- `/halts` - Trading halts (LULD)
- `/mini-chart` - Hover mini charts
- `/api` - Configuration status
- All TradingView external links

## Testing the System

### Test as FREE User (Default):
1. Open `server.js`
2. Find line ~148: `isPaid: false` (currently set to false)
3. Start server: `npm start`
4. Visit `http://localhost:3000/ui`
5. You should see:
   - "FREE" badge in top-right header (red background)
   - PRO boxes show "🔒 PRO Feature" with upgrade link
   - Clicking upgrade link goes to `/pricing`

### Test as PRO User:
1. Open `server.js`
2. Change line ~148 to: `isPaid: true`
3. Restart server: `npm start`
4. Visit `http://localhost:3000/ui`
5. You should see:
   - "PRO (365d left)" badge in top-right header (green background)
   - All boxes load successfully (no locks)

## Middleware Functions

### `requireLogin(req, res, next)`
Stub middleware that simulates user authentication. Currently sets a demo user.
- **TODO**: Replace with real authentication when `algtp-auth` is integrated

### `requireAccess(req, res, next)`
Checks if user has active PRO subscription:
- Validates `isPaid` and `paidUntil` timestamp
- Returns 403 JSON error for API requests
- Redirects to `/pricing?locked=1` for browser requests

## Frontend Feature Detection

The UI automatically detects PRO features via:
1. **Status Code**: Non-200 responses → Show lock screen
2. **Content-Type**: HTML response (redirect) → Show lock screen
3. **Error Code**: JSON with `error: "PRO_REQUIRED"` → Show lock screen

## Integration Checklist

When ready to integrate with real authentication:

1. **Replace `requireLogin` middleware** in `server.js` (~line 144):
   ```javascript
   function requireLogin(req, res, next) {
     // Replace this stub with real session/JWT validation
     // Check algtp-auth for Passport.js integration
     if (!req.session?.user) {
       return res.redirect('/login');
     }
     req.user = req.session.user;
     next();
   }
   ```

2. **Add Stripe webhook handler** (if not already done):
   - Webhook endpoint should update user's `isPaid` and `paidUntil` in database
   - See `algtp-auth/` directory for existing implementation

3. **Connect to user database**:
   - SQLite database at `algtp-auth/algtp-auth.db` (better-sqlite3)
   - Update middleware to query real user status

4. **Enable login/logout routes**:
   - Add links to header: "Login" (if not logged in) or "Logout" (if logged in)
   - See `algtp-auth/` for Google OAuth implementation

## Webhook Logging (Best Practice)

Add this to your Stripe webhook handler:
```javascript
app.post('/stripe/webhook', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    console.log(`✅ Webhook received: ${event.type}`); // Light logging
    
    // Handle subscription events
    // ...
  } catch (err) {
    console.error(`❌ Webhook error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  res.json({received: true});
});
```

## Security Best Practices

1. **Never expose API keys** in client-side code
2. **Validate subscription server-side** - Client localStorage is NOT trusted
3. **Use HTTPS** in production for all API calls
4. **Rotate Stripe keys** after testing completes
5. **Set CORS headers** appropriately for production domain

## Status: COMPLETE ✅

All 3 steps are implemented and tested:
- ✅ Step 4: UI crash prevention
- ✅ Step 5: Feature toggle with localStorage
- ✅ Step 6: Days left display and pricing page

**Next Steps**: 
- Test with real users
- Deploy to production
- Integrate with real Stripe payments (algtp-auth)
