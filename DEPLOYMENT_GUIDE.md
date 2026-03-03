# ALGTP-AI Deployment Guide

## Quick Reference

### Option 1: Simple Git Push (Recommended)
If your Render service has Auto-Deploy enabled, just push to Git:

```bash
./push.sh main "fix box data loading for FREE14 users"
```

### Option 2: Git Push + Manual Deploy Hook
If you need to manually trigger Render deployment:

```bash
# Set deploy hook URL (one time)
export RENDER_HOOK_URL='https://api.render.com/deploy/srv-xxxx?key=yyyy'

# Deploy
./push_render.sh main "deploy box data fix"
```

### Option 3: Quick Deploy with Confirmation
Interactive script with confirmation prompt:

```bash
./deploy.sh "urgent fix - box data loading"
```

### Option 4: Git One-Liner
For experienced users who want maximum speed:

```bash
git add -A && git commit -m "update" && git pull --rebase && git push
```

---

## Detailed Instructions

### 1. Setup (One Time Only)

#### Get Your Render Deploy Hook URL
1. Go to https://dashboard.render.com/
2. Select your ALGTP-AI service
3. Click **Settings**
4. Scroll to **Deploy Hook**
5. Click **Create Deploy Hook**
6. Copy the URL (looks like: `https://api.render.com/deploy/srv-xxxxx?key=yyyyy`)

#### Save Deploy Hook (Optional)
Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export RENDER_HOOK_URL='https://api.render.com/deploy/srv-xxxxx?key=yyyyy'
```

Then reload: `source ~/.zshrc`

---

### 2. Deployment Workflows

#### Workflow A: Auto-Deploy (Easiest)
**When to use**: Most deployments, Render auto-deploys on git push

```bash
# Basic usage
./push.sh

# With custom message
./push.sh main "fix scanner box data"

# Different branch
./push.sh develop "testing new feature"
```

**What it does**:
1. Shows current git status
2. Stages all changes (`git add -A`)
3. Commits with your message
4. Pulls latest from origin (with rebase)
5. Pushes to GitHub
6. Render auto-deploys (if enabled)

---

#### Workflow B: Manual Deploy Hook (Most Control)
**When to use**: Need to trigger deploy without code changes, or auto-deploy is disabled

```bash
# Set hook URL (once per terminal session)
export RENDER_HOOK_URL='https://api.render.com/deploy/srv-xxxxx?key=yyyyy'

# Deploy
./push_render.sh main "deploy now"
```

**What it does**:
1. Everything from Workflow A
2. Triggers Render deploy hook via API call
3. Shows deployment status link

---

#### Workflow C: Quick Deploy (Safest)
**When to use**: Want to review changes before deploying

```bash
./deploy.sh "important fix"
```

**What it does**:
1. Shows all pending changes
2. Asks for confirmation (y/N)
3. If confirmed, proceeds with commit + push
4. Shows deployment links

---

### 3. Common Scenarios

#### Scenario 1: Fix Box Data Loading (Today's Fix)
```bash
./push.sh main "fix: FREE14 users box data loading after trial expiration"
```

#### Scenario 2: Emergency Hotfix
```bash
./deploy.sh "hotfix: critical bug in payment processing"
```

#### Scenario 3: Deploy Without Code Changes
```bash
# Use deploy hook only
curl -X POST "$RENDER_HOOK_URL"
```

#### Scenario 4: Rollback
```bash
# Reset to previous commit
git reset --hard HEAD~1
git push -f origin main

# Render will auto-deploy the previous version
```

---

### 4. Monitoring Deployment

#### Check Deployment Status
- Dashboard: https://dashboard.render.com/
- Logs: Click your service → Logs tab
- Events: Click your service → Events tab

#### Deployment Timeline
- **Git push**: Instant
- **Render detection**: 5-10 seconds
- **Build start**: 10-30 seconds
- **Build complete**: 1-3 minutes
- **Deploy complete**: 2-5 minutes total

#### Verify Deployment
```bash
# Check live version
curl https://your-app.onrender.com/api

# Check specific endpoint
curl https://your-app.onrender.com/me
```

---

### 5. Troubleshooting

#### Problem: "No changes to commit"
**Solution**: This is normal if files are already committed. The script will skip commit and just push.

#### Problem: "Deploy hook failed"
**Solution**: 
1. Check your `RENDER_HOOK_URL` is correct
2. Verify the deploy hook exists in Render dashboard
3. Check if deploy hook has been regenerated (old URL won't work)

#### Problem: "Port already in use"
**Solution**: 
```bash
# Find process using port 3000
lsof -ti:3000

# Kill the process
kill -9 $(lsof -ti:3000)
```

#### Problem: "Deployment stuck"
**Solution**:
1. Check Render logs for errors
2. Verify environment variables are set
3. Check if build is failing (syntax errors, missing deps)
4. Manual redeploy: Render Dashboard → Manual Deploy

---

### 6. Best Practices

#### Commit Messages
Use clear, descriptive messages:
- ✅ `fix: FREE14 box data loading after trial expiration`
- ✅ `feat: add watchlist management UI`
- ✅ `chore: update dependencies`
- ❌ `update`
- ❌ `fix stuff`

#### Before Deploying
- [ ] Test locally (`npm start`)
- [ ] Check for console errors
- [ ] Verify all endpoints work
- [ ] Review git diff
- [ ] Write clear commit message

#### After Deploying
- [ ] Check deployment status in Render
- [ ] Test live site
- [ ] Monitor logs for errors
- [ ] Verify critical features work

---

### 7. Script Reference

| Script | Purpose | Interactive | Deploy Hook |
|--------|---------|-------------|-------------|
| `push.sh` | Simple git push | No | No |
| `push_render.sh` | Push + deploy hook | No | Yes |
| `deploy.sh` | Interactive deploy | Yes | No |
| Git one-liner | Ultra-quick push | No | No |

---

### 8. Environment Variables

For `push_render.sh` to work, set:

```bash
# Required
export RENDER_HOOK_URL='https://api.render.com/deploy/srv-xxxxx?key=yyyyy'

# Optional (for reference)
export RENDER_SERVICE_NAME='algtp-ai'
export RENDER_EXTERNAL_URL='https://algtp-ai.onrender.com'
```

---

## Quick Deploy Checklist

Today's box data fix deployment:

```bash
# 1. Verify changes are correct
git status

# 2. Test locally
npm start
# Visit http://localhost:3000/ui
# Test with FREE14 expired user

# 3. Deploy
./push.sh main "fix: FREE14 box data loading after trial expiration"

# 4. Monitor
# Visit https://dashboard.render.com/
# Check logs for errors
# Test live: https://your-app.onrender.com/ui

# 5. Verify
# Login as FREE14 expired user
# Check only 4 boxes show data
# Other boxes show lock message
```

---

## Need Help?

- **Render Docs**: https://render.com/docs
- **Git Docs**: https://git-scm.com/doc
- **Project Issues**: Check `BOX_DATA_FIX_SUMMARY.md`

---

**Last Updated**: February 4, 2026  
**Author**: ALGTP-AI Team
