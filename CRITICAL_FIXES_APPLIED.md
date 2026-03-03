# Critical Fixes Applied - Stripe Integration & User Access

## Date: 2026-02-03

## Issues Fixed

### ✅ 1. Duplicate `/me` API Endpoint
**Problem**: The application defined `/me` endpoint twice (lines 2661 and 5858), causing only the first definition to be used. Frontend received incomplete user access data.

**Solution**: Removed duplicate at line 2661. Kept the better implementation at line 5858 that includes:
- `allowedBoxes` for FREE14 tier restrictions
- Complete access countdown data
- Proper tier/mode information

**Impact**: Frontend now receives correct user access state including tier, mode (PAID/FREE/EXPIRED), and allowed features.

---

### ✅ 2. Stripe Webhook Request Body Handling
**Problem**: Stripe webhook endpoint was defined AFTER `express.json()` middleware, which parsed the body before signature verification could access the raw buffer. This caused ALL webhook signature verifications to fail.

**Solution**: 
- Moved webhook handler to line 371 (BEFORE `express.json()` at line 485)
- Webhook uses `express.raw({ type: 'application/json' })` to preserve raw body
- Removed duplicate webhook handler that was at line ~5687

**Impact**: Stripe webhooks now verify correctly and process payment events.

---

### ✅ 3. Subscription Duration Handling
**Problem**: Webhook hardcoded 40-day subscription duration instead of using monthly recurring billing.

**Solution**: Changed to 30-day billing cycles to match monthly subscriptions:
```javascript
const paidUntilMs = now + (30 * 24 * 60 * 60 * 1000);  // 30 days
```

**Impact**: User subscriptions now correctly expire after one month and renew properly via `customer.subscription.updated` webhook.

---

### ✅ 4. Multi-Tier Pricing Support
**Problem**: System only supported single PRO plan at $35.99, but pricing page showed 3 tiers.

**Solution**: 
- Updated `PLAN_PRICE_MAP` to include all three tiers (BASIC, PRO, PREMIUM)
- Modified `/stripe/checkout` to read `?plan=` query parameter
- Added Stripe Price IDs to `.env` for all three tiers
- Updated pricing page with correct prices ($35.99, $45.99, $55.99)

**Impact**: Users can now subscribe to different pricing tiers with correct features.

---

## Testing Checklist

### ✅ Server Startup
```bash
npm start
```
Verify:
- [x] ✅ Stripe initialized
- [x] ✅ Google OAuth configured
- [x] ✅ No duplicate endpoint warnings
- [x] ✅ Server listens on port 3000

### Test User Flow

#### 1. **New User Registration (FREE14 Trial)**
```bash
# Visit http://localhost:3000/pricing
# Click "Login with Google"
# After OAuth redirect
curl http://localhost:3000/me

# Expected response:
{
  "ok": true,
  "email": "user@example.com",
  "tier": "FREE14",
  "mode": "FREE",
  "daysLeft": 14,
  "allowedBoxes": ["gappers_dn", "gappers_up", "top_gainers", "top_losers"]
}
```

#### 2. **Stripe Checkout - Basic Plan**
```bash
# Navigate to /pricing
# Click "Get Started" on BASIC plan
# Should redirect to: /stripe/checkout?plan=basic
# Then redirect to Stripe hosted checkout page
```

#### 3. **Webhook Processing** (Test with Stripe CLI)
```bash
stripe listen --forward-to localhost:3000/stripe/webhook

# In another terminal, trigger test webhook:
stripe trigger checkout.session.completed

# Check server logs for:
# ✅ Webhook signature verified
# ✅ User upgraded to BASIC
# ✅ is_paid: 1, paid_until: [timestamp]
```

#### 4. **Verify Paid Access**
```bash
curl http://localhost:3000/me

# Expected response after payment:
{
  "ok": true,
  "email": "user@example.com",
  "tier": "BASIC",  # or PRO, PREMIUM
  "mode": "PAID",
  "daysLeft": 30,
  "allowedBoxes": null  # null = all boxes allowed
}
```

#### 5. **Dashboard Access**
```bash
# Visit http://localhost:3000/ui
# Should show full dashboard with all data boxes
# No "LOCKED" messages
```

---

## Architecture Changes

### Before (Broken Flow)
```
User Clicks Subscribe
  ↓
/stripe/checkout (always uses PRO plan)
  ↓
Stripe Checkout
  ↓
Payment Success → Webhook
  ↓
express.json() parses body ❌ (breaks signature)
  ↓
Webhook handler fails verification
  ↓
User state NOT updated
  ↓
Dashboard shows LOCKED ❌
```

### After (Fixed Flow)
```
User Clicks Subscribe (BASIC/PRO/PREMIUM)
  ↓
/stripe/checkout?plan=X (reads plan parameter)
  ↓
Stripe Checkout (correct price)
  ↓
Payment Success → Webhook
  ↓
Webhook handler (BEFORE express.json())
  ↓
Raw body available ✅
  ↓
Signature verification succeeds ✅
  ↓
User state updated (is_paid=1, tier=X, paid_until=timestamp)
  ↓
Redirect to /ui
  ↓
/me returns correct access data
  ↓
Dashboard shows full access ✅
```

---

## Database Schema Notes

User table fields used:
```sql
- is_paid (INTEGER 0|1)
- paid_until (INTEGER timestamp ms)
- free_until (INTEGER timestamp ms)
- tier (TEXT: "FREE14" | "BASIC" | "PRO" | "PREMIUM")
- stripe_customer_id (TEXT)
- stripe_subscription_id (TEXT)
```

**Note**: The `updateUser()` function in `db.js` automatically converts camelCase to snake_case:
- `isPaid` → `is_paid`
- `paidUntil` → `paid_until`
- `stripeCustomerId` → `stripe_customer_id`

---

## Environment Variables Required

```env
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Price IDs (all three tiers)
STRIPE_PRICE_BASIC=price_1SudyrJXKDqmellL5oBBAmre
STRIPE_PRICE_PRO=price_1SwcE3JXKDqmellLuWizL81E
STRIPE_PRICE_PREMIUM=price_1SwcFXJXKDqmellL3p1Y0s4M

# Google OAuth
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Session
SESSION_SECRET=your-secret-key
```

---

## Production Deployment Checklist

Before deploying to Render:

1. **Update `.env` on Render**:
   - Set all Stripe keys (live mode)
   - Set `APP_URL=https://yourdomain.onrender.com`
   - Set `GOOGLE_CALLBACK_URL=https://yourdomain.onrender.com/auth/google/callback`
   - Set `NODE_ENV=production`

2. **Configure Stripe Webhooks**:
   - Go to Stripe Dashboard → Developers → Webhooks
   - Add endpoint: `https://yourdomain.onrender.com/stripe/webhook`
   - Select events:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

3. **Google OAuth Console**:
   - Add authorized redirect URI: `https://yourdomain.onrender.com/auth/google/callback`

4. **Test Production Flow**:
   - Sign up with real email
   - Complete real payment (use Stripe test mode first!)
   - Verify webhook delivery in Stripe dashboard
   - Check user access updated in database

---

## Debugging Commands

### Check user state in database
```bash
sqlite3 algtp.db "SELECT id, email, tier, is_paid, paid_until, free_until FROM users WHERE email='user@example.com';"
```

### Check session status
```bash
curl http://localhost:3000/debug/session
```

### Check user access via API
```bash
curl -H "Cookie: algtp.sid=YOUR_SESSION_COOKIE" http://localhost:3000/me
```

### Test webhook locally
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/stripe/webhook

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

---

## Known Issues (Fixed)

- ❌ ~~Duplicate /me endpoints~~ → ✅ Fixed
- ❌ ~~Webhook signature verification failing~~ → ✅ Fixed  
- ❌ ~~User stays in FREE14 after payment~~ → ✅ Fixed
- ❌ ~~Dashboard shows empty boxes~~ → ✅ Fixed (was access issue)
- ❌ ~~Single pricing tier only~~ → ✅ Fixed (now 3 tiers)

---

## Next Steps

1. **Test thoroughly** with all three pricing tiers
2. **Deploy to Render** with production Stripe keys
3. **Monitor webhook delivery** in Stripe dashboard
4. **Set up error alerts** for failed payments
5. **Add subscription management UI** (upgrade/downgrade/cancel)

---

## Support Resources

- Stripe Webhook Testing: https://stripe.com/docs/webhooks/test
- Express middleware order: https://expressjs.com/en/guide/using-middleware.html
- Passport.js session: http://www.passportjs.org/docs/
