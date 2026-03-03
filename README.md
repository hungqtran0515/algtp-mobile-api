# ALGTP Mobile API Server

Simple, auth-free API server for ALGTP iOS app.

## Features
- ✅ No authentication required
- ✅ Direct Polygon API proxy
- ✅ Float enrichment (FMP)
- ✅ Mobile-optimized endpoints

## Endpoints

- `GET /` - Health check
- `GET /movers-premarket?limit=20` - Market movers (premarket session)
- `GET /most-active?limit=20` - Most active stocks by volume
- `GET /unusual-volume?limit=20` - Stocks with unusual volume spikes
- `GET /scan?symbols=AAPL,MSFT,TSLA` - Scan specific symbols (for NQ100)

## Deploy to Render

### 1. Create New Web Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New** → **Web Service**
3. Connect to GitHub repo: `hungqtran0515/ALGTP-Mobile`
4. Or use this repo and point to `mobile-server` directory

### 2. Configuration
- **Name**: `algtp-mobile-api`
- **Region**: Oregon (US West)
- **Branch**: `main`
- **Root Directory**: Leave blank (or `mobile-server` if in subdirectory)
- **Runtime**: Node
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: Free

### 3. Environment Variables
Add these in Render Dashboard → Environment:

```
MASSIVE_API_KEY=<your_polygon_api_key>
POLYGON_API_KEY=<your_polygon_api_key>
FMP_API_KEY=<your_fmp_api_key>
```

### 4. Deploy
Click **Create Web Service**. Render will:
1. Clone your repo
2. Run `npm install`
3. Run `npm start`
4. Your API will be live at: `https://algtp-mobile-api.onrender.com`

## Test Deployment

```bash
# Health check
curl https://algtp-mobile-api.onrender.com/

# Market movers
curl https://algtp-mobile-api.onrender.com/movers-premarket?limit=5
```

## Local Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env and add your API keys

# Run server
npm start
```

Server runs on http://localhost:3000

## iOS App Configuration

The app will automatically connect to this server when on cellular. Update the production servers list in `APIService.swift`:

```swift
private let productionServers = [
    "https://algtp-mobile-api.onrender.com",
    "https://algtp-backup.onrender.com",
    "https://algtp-ai.onrender.com"
]
```
