# 🚀 Deploy ALGTP Mobile API to Render

This guide will help you deploy the auth-free mobile API server to Render.

## ✅ What You Need
1. GitHub account
2. Render account (free tier works!)
3. API keys: MASSIVE_API_KEY, POLYGON_API_KEY, FMP_API_KEY

## 📦 Step 1: Push to GitHub

```bash
# Go to mobile-server directory
cd "/Users/hungtran/Documents/ALGTP-AI/AI/ALGTP-AI/algtp-mobile/ALGTP STOCK Screener/mobile-server"

# Create GitHub repo (if you don't have gh CLI, do this manually on GitHub.com)
gh repo create algtp-mobile-api --public --source=. --remote=origin --push

# Or manually:
# 1. Go to github.com/new
# 2. Create repo named "algtp-mobile-api"
# 3. Then run:
git remote add origin https://github.com/hungqtran0515/algtp-mobile-api.git
git branch -M main
git push -u origin main
```

## 🌐 Step 2: Deploy to Render

### Option A: Using Render Dashboard (Easiest)

1. **Go to Render**: https://dashboard.render.com

2. **Create New Web Service**:
   - Click **New +** → **Web Service**
   - Click **Connect GitHub** (authorize if needed)
   - Find and select your `algtp-mobile-api` repository
   - Click **Connect**

3. **Configure Service**:
   ```
   Name: algtp-mobile-api
   Region: Oregon (US West)
   Branch: main
   Root Directory: (leave blank)
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free
   ```

4. **Add Environment Variables**:
   Click **Advanced** → **Add Environment Variable**:
   
   ```
   MASSIVE_API_KEY = <paste your Polygon API key>
   POLYGON_API_KEY = <paste your Polygon API key>
   FMP_API_KEY = <paste your FMP API key>
   ```

5. **Create Web Service**:
   - Click **Create Web Service**
   - Wait 2-3 minutes for deployment
   - Your API will be live at: `https://algtp-mobile-api.onrender.com`

### Option B: Using render.yaml (Advanced)

Create `render.yaml` in the repo:

```yaml
services:
  - type: web
    name: algtp-mobile-api
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: MASSIVE_API_KEY
        sync: false
      - key: POLYGON_API_KEY
        sync: false
      - key: FMP_API_KEY
        sync: false
```

Then connect repo as "Blueprint" in Render.

## ✅ Step 3: Test Deployment

```bash
# Health check (should return JSON with timestamp)
curl https://algtp-mobile-api.onrender.com/

# Market movers (should return stock data)
curl "https://algtp-mobile-api.onrender.com/movers-premarket?limit=3"

# Most active
curl "https://algtp-mobile-api.onrender.com/most-active?limit=3"
```

## 📱 Step 4: Update iOS App

Edit `APIService.swift` and update the production servers list:

```swift
private let productionServers = [
    "https://algtp-mobile-api.onrender.com",  // ← Add this first!
    "https://algtp-backup.onrender.com",
    "https://algtp-ai.onrender.com"
]
```

Then rebuild and install the app.

## 🎉 Done!

Your app will now:
- ✅ Use local server (`10.0.0.230:3000`) when on WiFi
- ✅ Use production server (`algtp-mobile-api.onrender.com`) when on Cellular
- ✅ No authentication required!

## 🔧 Troubleshooting

### Deployment fails with "Module not found"
- Check that `package.json` has `"type": "module"`
- Verify all files are committed and pushed

### API returns 500 errors
- Check Render logs: Dashboard → Your Service → Logs
- Verify environment variables are set correctly
- Make sure API keys are valid

### App still shows "no data" on cellular
- Test the endpoint directly: `curl https://algtp-mobile-api.onrender.com/movers-premarket?limit=1`
- Check if Render service is sleeping (free tier sleeps after 15 min)
- First request after sleep takes 30-60 seconds

### Free tier limitations
- Service sleeps after 15 minutes of inactivity
- 750 hours/month free (upgrade to stay always-on)
- Cold start: first request takes 30-60 seconds
