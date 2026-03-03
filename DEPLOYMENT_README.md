# ALGTP™ Deployment & Webhook Fix - Complete Package

## 📦 What's Included

This package contains everything you need to deploy ALGTP™ to Render with fully working Stripe webhooks and commission tracking.

## 🆕 New Files Created

### Configuration
1. **`.env.render`** - Production-ready environment template
   - All environment variables needed for Render
   - Placeholder values to replace with your credentials
   - Optimized for 4GB RAM Render plan

### Documentation
2. **`STRIPE_WEBHOOK_FIX_2026.md`** - Complete webhook fix documentation
   - Technical details of all changes
   - Webhook event handling
   - Commission rules and calculations
   - Troubleshooting guide

3. **`WEBHOOK_QUICK_START.md`** - Quick reference guide
   - 3-step testing process
   - Common issues and fixes
   - Commission rules summary
   - Testing commands

4. **`RENDER_DEPLOYMENT_CHECKLIST.md`** - Step-by-step deployment guide
   - Pre-deployment checklist
   - Render configuration steps
   - External service setup (Google OAuth, Stripe)
   - Post-deployment verification
   - Troubleshooting

5. **`DEPLOYMENT_README.md`** - This file
   - Overview of all new files
   - Quick links and next steps

### Testing
6. **`test-stripe-webhook-complete.js`** - Comprehensive webhook testing
   - Tests all 5 pricing tiers
   - Validates commission calculations
   - Checks webhook endpoint health
   - Includes setup instructions

## ✅ Code Changes Made

### `server.js` (Lines 837-930, 977-986)
- Enhanced metadata extraction (supports both `salerId` and `saler_id`)
- Smart plan-to-tier mapping for all pricing tiers
- Annual plan support (365 days vs 30 days)
- Improved logging for debugging
- Better error messages

### `commission-webhooks.js` (Lines 81-120)
- Multiple metadata source extraction (4 different locations)
- Detailed commission logging
- Shows which metadata source was used

## 🚀 Quick Start

### For Local Development
```bash
# 1. Start server
npm start

# 2. Start Stripe CLI (new terminal)
stripe listen --forward-to localhost:3000/stripe/webhook

# 3. Run tests (new terminal)
node test-stripe-webhook-complete.js
```

### For Render Deployment
```bash
# 1. Read the checklist
cat RENDER_DEPLOYMENT_CHECKLIST.md

# 2. Use .env.render as template
# Copy content to Render Dashboard → Environment Variables

# 3. Configure external services
# - Google OAuth redirect URI
# - Stripe webhook endpoint

# 4. Deploy and verify
```

## 📚 Documentation Map

```
DEPLOYMENT_README.md (you are here)
    ↓
RENDER_DEPLOYMENT_CHECKLIST.md
    ↓
.env.render (use as template)
    ↓
[Deploy to Render]
    ↓
STRIPE_WEBHOOK_FIX_2026.md (reference if issues)
    ↓
WEBHOOK_QUICK_START.md (quick fixes)
```

## 🎯 What Got Fixed

### 1. Stripe Webhook Handler
**Before**: Basic webhook handling, hardcoded 30-day duration
**After**: 
- ✅ Supports all 5 pricing tiers (Verified, DayTrader, Swing, Pro, Annual)
- ✅ Annual plan gets 365 days (not 30)
- ✅ Better metadata extraction for `salerId`
- ✅ Detailed logging for debugging
- ✅ Better error messages

### 2. Commission Tracking
**Before**: Limited metadata extraction from one source
**After**:
- ✅ Checks 4 different metadata sources
- ✅ Detailed logging showing which source worked
- ✅ 65% commission for monthly plans
- ✅ 40% commission for annual plan
- ✅ Trial plan excluded from commission
- ✅ 14-day hold before release

### 3. Plan-to-Tier Mapping
**Before**: Simple uppercase conversion
**After**:
- ✅ Recognizes plan names: verified, daytrader, swing, pro, annual
- ✅ Recognizes prices: 4.95, 35.99, 45.99, 55.99, 350
- ✅ Handles variations: trial, year, yearly

## 💰 Pricing Tiers & Commission

| Tier | Price | Duration | Commission | Released |
|------|-------|----------|------------|----------|
| Verified | $4.95/mo | 30 days | None | N/A |
| DayTrader | $35.99/mo | 30 days | 65% ($23.39) | 14 days |
| Swing | $45.99/mo | 30 days | 65% ($29.89) | 14 days |
| Pro | $55.99/mo | 30 days | 65% ($36.39) | 14 days |
| Annual | $350/yr | 365 days | 40% ($140) | 14 days |

## 📋 Required Environment Variables

### Critical (MUST SET for production):
- `APP_URL` - Your Render URL
- `MASSIVE_API_KEY` - Polygon API key
- `POLYGON_API_KEY` - Same as above
- `FMP_API_KEY` - Financial Modeling Prep
- `GOOGLE_CLIENT_ID` - Google OAuth
- `GOOGLE_CLIENT_SECRET` - Google OAuth
- `GOOGLE_CALLBACK_URL` - Your Render URL + /auth/google/callback
- `SESSION_SECRET` - Strong random 32+ char string
- `STRIPE_SECRET_KEY` - Use sk_live_... for production
- `STRIPE_WEBHOOK_SECRET` - From Stripe Dashboard
- `STRIPE_PRICE_VERIFIED` - Price ID from Stripe
- `STRIPE_PRICE_DAYTRADER` - Price ID from Stripe
- `STRIPE_PRICE_SWING` - Price ID from Stripe
- `STRIPE_PRICE_PRO` - Price ID from Stripe
- `STRIPE_PRICE_ANNUAL` - Price ID from Stripe

### Important (Recommended):
- `NODE_ENV=production`
- `DEBUG=false`
- `BYPASS_AUTH=false`
- `SCAN_MAX_SYMBOLS=1000`
- `SNAP_CONCURRENCY=6`
- `AM_CACHE_MAX=10000`

## 🔍 Testing Checklist

### Local Testing
- [ ] Server starts without errors
- [ ] Stripe CLI forwards webhooks
- [ ] Test script runs successfully
- [ ] Database shows correct user updates
- [ ] Commission records created

### Production Testing
- [ ] Health endpoint `/api` returns OK
- [ ] Dashboard loads at `/ui`
- [ ] Google login works
- [ ] Payment flow completes
- [ ] Webhook processes in Stripe Dashboard
- [ ] Commission records tracked

## 🐛 Common Issues

### "Webhook signature verification failed"
➜ See: `WEBHOOK_QUICK_START.md` → Troubleshooting → Webhook signature

### "User not found"
➜ User must login with Google FIRST before making payment

### "No commission created"
➜ Check metadata includes `salerId` field

### "Wrong tier or duration"
➜ Check plan name matches expected formats

## 📞 Support

**For detailed help, see:**
- `STRIPE_WEBHOOK_FIX_2026.md` - Complete technical documentation
- `WEBHOOK_QUICK_START.md` - Quick fixes and commands
- `RENDER_DEPLOYMENT_CHECKLIST.md` - Deployment steps

**For specific issues:**
- Webhook errors → `STRIPE_WEBHOOK_FIX_2026.md` → Troubleshooting
- Deployment issues → `RENDER_DEPLOYMENT_CHECKLIST.md` → Troubleshooting
- Testing → `WEBHOOK_QUICK_START.md` → Testing Commands

## 🎓 Understanding the System

### Webhook Flow
```
User completes checkout
    ↓
Stripe sends: checkout.session.completed
    ↓
server.js webhook handler processes event
    ↓
User record updated (tier, is_paid, paid_until, salerId)
    ↓
(Later) Stripe sends: invoice.paid
    ↓
commission-webhooks.js creates commission record
    ↓
Commission held for 14 days
    ↓
(After 14 days) Commission released to saler
```

### Commission Tracking
```
invoice.paid event received
    ↓
Check metadata for salerId (4 sources checked)
    ↓
Check if plan is eligible (exclude $4.95 trial)
    ↓
Calculate commission (65% monthly, 40% annual)
    ↓
Create commission record (status: PENDING)
    ↓
Set release date (+14 days)
    ↓
(If refund/dispute) Cancel commission
    ↓
(After 14 days) Mark as ready for payout
```

## 🎯 Success Metrics

After successful deployment, you should have:
- ✅ All pricing tiers working correctly
- ✅ Annual plan gives 365 days (not 30)
- ✅ Commission tracking for all eligible plans
- ✅ Detailed webhook logging for debugging
- ✅ No 502/memory errors on Render
- ✅ Smooth payment and login flow

## 📅 Maintenance

### Weekly
- Monitor Render logs for webhook errors
- Check Stripe Dashboard for failed webhooks
- Verify commission records are being created

### Monthly
- Review API usage (Polygon, FMP)
- Check Stripe subscription metrics
- Review commission payouts

## 🚀 Next Steps

1. **Read**: `RENDER_DEPLOYMENT_CHECKLIST.md`
2. **Prepare**: `.env.render` with your credentials
3. **Deploy**: Follow the step-by-step guide
4. **Test**: Use the testing checklist
5. **Monitor**: Check logs and metrics

---

**Last Updated**: February 2026  
**Package Version**: 1.0  
**Includes**: Stripe webhook fix + Commission tracking + Render deployment  

**Questions?** Check the documentation files listed above.
