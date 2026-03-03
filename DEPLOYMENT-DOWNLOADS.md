# Deployment Instructions: Application Downloads

## Problem
GitHub rejects files larger than 100MB. Our download files are:
- `ALGTP-Agent-Setup-macOS.dmg` - 100MB ✅
- `ALGTP-Agent-Setup-Windows.exe` - 77MB ✅
- `ALGTP-Trading-Desktop-macOS.dmg` - 517MB ⚠️ (too large)
- `ALGTP-Trading-Desktop-Windows.exe` - 1.8GB ⚠️ (too large)

## Solution
Host download files on Render using **Persistent Disk Storage** instead of Git.

## Steps to Deploy Downloads on Render

### Option 1: Render Persistent Disk (Recommended)

**Step 1: Add Persistent Disk**
- Go to Render Dashboard → Your Service → Settings
- Scroll to "Disks" section
- Click "Add Disk"
- Mount Path: `/opt/render/project/downloads`
- Size: At least 3GB (2.5GB files + buffer)
- Click "Save"

**Step 2: Upload to Temporary Hosting**

Use **transfer.sh** (free, no account needed):
```bash
# From your local machine
cd /Users/hungtran/Documents/ALGTP-AI/AI/ALGTP-AI/algtp-trading-desktop/server/public/downloads

# Upload Agent files (small, quick)
curl --upload-file ALGTP-Agent-Setup-macOS.dmg https://transfer.sh/ALGTP-Agent-Setup-macOS.dmg
curl --upload-file ALGTP-Agent-Setup-Windows.exe https://transfer.sh/ALGTP-Agent-Setup-Windows.exe

# Upload Trading Desktop files (large, takes time)
curl --upload-file ALGTP-Trading-Desktop-macOS.dmg https://transfer.sh/ALGTP-Trading-Desktop-macOS.dmg
curl --upload-file ALGTP-Trading-Desktop-Windows.exe https://transfer.sh/ALGTP-Trading-Desktop-Windows.exe

# Save the URLs returned by transfer.sh
```

**Step 3: Download to Render via Shell**
```bash
# Open Render Shell (Dashboard → Service → Shell tab)
mkdir -p /opt/render/project/src/algtp-trading-desktop/server/public/downloads
cd /opt/render/project/src/algtp-trading-desktop/server/public/downloads

# Download from transfer.sh URLs (replace with your actual URLs)
curl -L -o ALGTP-Agent-Setup-macOS.dmg "https://transfer.sh/xxxxx/ALGTP-Agent-Setup-macOS.dmg"
curl -L -o ALGTP-Agent-Setup-Windows.exe "https://transfer.sh/xxxxx/ALGTP-Agent-Setup-Windows.exe"
curl -L -o ALGTP-Trading-Desktop-macOS.dmg "https://transfer.sh/xxxxx/ALGTP-Trading-Desktop-macOS.dmg"
curl -L -o ALGTP-Trading-Desktop-Windows.exe "https://transfer.sh/xxxxx/ALGTP-Trading-Desktop-Windows.exe"

# Verify all files downloaded
ls -lh
du -sh .
```

3. **Update Server Code**:
   Update `algtp-trading-desktop/server/server.js` to serve from persistent disk:
   ```javascript
   // Change this line:
   app.use("/downloads", express.static(join(__dirname, "public", "downloads"), {
   
   // To this:
   app.use("/downloads", express.static("/opt/render/project/downloads", {
   ```

### Option 2: Upload via SCP (If SSH Access Available)

If you have SSH access to Render:
```bash
# From local machine
scp algtp-bridge/dist/ALGTP\ Agent\ Live\ TradeBot\ \(Bridge\)-1.0.0.dmg \
    render:/opt/render/project/src/algtp-trading-desktop/server/public/downloads/ALGTP-Agent-Setup-macOS.dmg

scp algtp-trading-desktop/dist/ALGTP\ Trading\ Terminal-1.0.0.dmg \
    render:/opt/render/project/src/algtp-trading-desktop/server/public/downloads/ALGTP-Trading-Desktop-macOS.dmg
```

### Option 3: Cloud Storage + CDN (Best Performance)

Host files on external storage and proxy through server:

1. Upload to AWS S3, DigitalOcean Spaces, or Cloudflare R2
2. Update download URLs to point to CDN:
   ```javascript
   const DOWNLOAD_BASE_URL = process.env.DOWNLOAD_CDN_URL || "https://cdn.algtp.com/downloads";
   
   function downloadDesktopMac() {
     const url = `${DOWNLOAD_BASE_URL}/ALGTP-Trading-Desktop-macOS.dmg`;
     window.open(url, "_blank");
   }
   ```

## Current Setup

### Localhost ✅ Working
Download files are served from:
```
algtp-trading-desktop/server/public/downloads/
├── ALGTP-Agent-Setup-macOS.dmg (100MB)
├── ALGTP-Agent-Setup-Windows.exe (77MB)
├── ALGTP-Trading-Desktop-macOS.dmg (517MB)
└── ALGTP-Trading-Desktop-Windows.exe (1.8GB)
```

Accessible at:
- http://localhost:3000/downloads/ALGTP-Agent-Setup-macOS.dmg ✅
- http://localhost:3000/downloads/ALGTP-Agent-Setup-Windows.exe ✅
- http://localhost:3000/downloads/ALGTP-Trading-Desktop-macOS.dmg ✅
- http://localhost:3000/downloads/ALGTP-Trading-Desktop-Windows.exe ✅

### Agent App ✅ Dynamic URLs
Agent download buttons automatically detect environment:
- **Localhost**: Uses `http://localhost:3000/downloads/`
- **Production**: Uses `https://algtp-ai.onrender.com/downloads/`

Implementation in `algtp-bridge/renderer/index.html`:
```javascript
function getDownloadBaseURL() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocal ? 'http://localhost:3000' : 'https://algtp-ai.onrender.com';
}
```

## Verification

After deployment, test download links:
```bash
# Test Agent download
curl -I https://your-render-domain.onrender.com/downloads/ALGTP-Agent-Setup-macOS.dmg

# Test Trading Desktop download
curl -I https://your-render-domain.onrender.com/downloads/ALGTP-Trading-Desktop-macOS.dmg
```

Both should return `HTTP/1.1 200 OK` with correct `Content-Length` headers.

## Important Notes

- Download files are NOT committed to Git (too large for GitHub)
- Files must be uploaded manually after each Render deployment
- Consider using Render Persistent Disk to avoid re-uploading after each deploy
- Update download URLs in both:
  - `algtp-bridge/renderer/index.html` (Agent app)
  - `algtp-trading-desktop/server/server.js` (/guide page)

## Troubleshooting

**404 Not Found on downloads**:
- Check files exist in downloads directory
- Verify static file serving middleware is enabled
- Check file permissions (should be readable)

**Downloads slow**:
- Consider using CDN (Cloudflare, AWS CloudFront)
- Enable gzip compression in Express
- Use HTTP/2 for better performance

**Render disk full**:
- Increase persistent disk size
- Remove old versions of downloads
- Consider external CDN storage
