#!/bin/bash

# ============================================================================
# DEPLOY TO RENDER - TradingView Blocking Fix
# ============================================================================

echo "🚀 Deploying TradingView blocking fix to Render..."
echo ""

# Check if we're in git repo
if [ ! -d .git ]; then
  echo "❌ Error: Not in a git repository"
  exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "📝 You have uncommitted changes. Committing them now..."
  
  # Add changes
  git add server.js RENDER_TRADINGVIEW_FIX.md deploy-to-render.sh
  
  # Commit with descriptive message
  git commit -m "Fix TradingView blocking on Render

- Replace meta-refresh with window.open() for Stripe redirects
- Add security headers middleware for better compatibility
- Add fallback button for blocked popups
- Improve embedded browser support (TradingView, etc.)

Co-Authored-By: Warp <agent@warp.dev>"
  
  echo "✅ Changes committed"
else
  echo "✅ No uncommitted changes"
fi

# Push to main branch (Render will auto-deploy)
echo ""
echo "📤 Pushing to GitHub..."
git push origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Successfully pushed to GitHub!"
  echo ""
  echo "🔄 Render will automatically deploy your changes."
  echo "   This usually takes 2-5 minutes."
  echo ""
  echo "📊 Monitor deployment:"
  echo "   https://dashboard.render.com"
  echo ""
  echo "🧪 After deployment, test:"
  echo "   1. Visit: https://algtp-ai.onrender.com/pricing"
  echo "   2. Click any subscribe button"
  echo "   3. Verify Stripe checkout opens (not blocked)"
  echo ""
  echo "📝 Check logs for webhook events:"
  echo "   Render Dashboard → algtp-ai → Logs"
  echo ""
else
  echo "❌ Failed to push to GitHub"
  exit 1
fi
