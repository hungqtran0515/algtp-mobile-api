#!/usr/bin/env bash
# Quick deploy: Add all changes, commit, push, and deploy to Render
set -euo pipefail

MSG="${1:-quick deploy}"

echo "🚀 Quick Deploy Script"
echo "====================="
echo ""
echo "📝 Commit message: $MSG"
echo ""

# Show current changes
echo "📋 Current changes:"
git status --short
echo ""

# Confirm before proceeding
read -p "Continue with deploy? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Deploy cancelled."
  exit 0
fi

# Add all changes
echo "📦 Adding files..."
git add -A

# Commit
echo "💾 Committing..."
if git commit -m "$MSG"; then
  echo "✅ Committed successfully"
else
  echo "⚠️  No changes to commit (or commit failed)"
fi

# Pull latest
echo "⬇️  Pulling latest from origin..."
git pull --rebase origin main

# Push
echo "⬆️  Pushing to origin..."
git push origin main

echo ""
echo "✅ Deploy complete!"
echo ""
echo "📊 Check deployment status:"
echo "   https://dashboard.render.com/"
echo ""
echo "🌐 Your app will be live at:"
echo "   https://your-app-name.onrender.com"
