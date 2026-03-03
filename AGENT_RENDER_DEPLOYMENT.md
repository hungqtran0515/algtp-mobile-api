# Connecting ALGTP Agent to Render Deployment

## Problem
The ALGTP Agent runs on your local machine (localhost:17840) and cannot be accessed from the Render cloud server.

## Architecture

### Current (Local Only):
```
Browser → http://localhost:3000/trading → http://localhost:17840 (Agent)
         ✅ Works                         ✅ Works
```

### Render Deployment (Broken):
```
Browser → https://algtp-ai.onrender.com/trading → http://localhost:17840 (Agent)
         ✅ Works                                   ❌ Cannot reach
```

## Solutions

### **Option 1: Expose Agent via ngrok (Easiest for Testing)**

#### Step 1: Install ngrok
```bash
# macOS
brew install ngrok

# Or download from https://ngrok.com/download
```

#### Step 2: Expose Agent Port
```bash
# Start ngrok tunnel
ngrok http 17840
```

You'll see output like:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:17840
```

#### Step 3: Update Trading Page Connection
On Render deployment at `https://algtp-ai.onrender.com/trading`:
- **Agent URL**: `https://abc123.ngrok.io` (from ngrok)
- **Token**: `ALGTP-PAIR-D4Q5-QUUBUD3P`

#### Pros:
✅ Simple setup (5 minutes)
✅ Works immediately
✅ Free tier available
✅ HTTPS included

#### Cons:
❌ URL changes on each restart (free tier)
❌ Requires ngrok running continuously
❌ Not suitable for production

---

### **Option 2: Cloudflare Tunnel (Better for Production)**

#### Step 1: Install cloudflared
```bash
# macOS
brew install cloudflare/cloudflare/cloudflared
```

#### Step 2: Login
```bash
cloudflared login
```

#### Step 3: Create Tunnel
```bash
# Create tunnel
cloudflared tunnel create algtp-agent

# Route tunnel
cloudflared tunnel route dns algtp-agent agent.yourdomain.com

# Start tunnel
cloudflared tunnel run algtp-agent
```

#### Step 4: Configure Tunnel
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: algtp-agent
credentials-file: /Users/hungtran/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: agent.yourdomain.com
    service: http://localhost:17840
  - service: http_status:404
```

#### Pros:
✅ Persistent URL
✅ Free
✅ HTTPS included
✅ Production-ready
✅ Auto-restart support

#### Cons:
❌ Requires domain name
❌ More complex setup

---

### **Option 3: Deploy Agent to Cloud (Most Complex)**

Deploy the ALGTP Agent to a cloud VM that can connect to TWS/IB Gateway.

#### Requirements:
- Cloud VM (AWS EC2, DigitalOcean, etc.)
- Install Node.js
- Install TWS or IB Gateway
- Configure VNC for GUI access
- Set up firewall rules

#### Steps:
1. **Provision VM** (Ubuntu 22.04 recommended)
2. **Install TWS**:
   ```bash
   wget https://download2.interactivebrokers.com/installers/tws/latest-standalone/tws-latest-standalone-linux-x64.sh
   chmod +x tws-latest-standalone-linux-x64.sh
   ./tws-latest-standalone-linux-x64.sh
   ```

3. **Install ALGTP Agent**:
   ```bash
   cd /opt
   git clone https://github.com/hungqtran0515/ALGTP-AI.git
   cd ALGTP-AI/algtp-bridge
   npm install
   ```

4. **Start Agent**:
   ```bash
   npm start
   ```

5. **Expose Port**: Use nginx reverse proxy or open port 17840

#### Pros:
✅ Fully cloud-based
✅ Always accessible
✅ No local machine required

#### Cons:
❌ Complex setup
❌ Monthly cost ($5-20/month)
❌ Requires maintaining TWS connection
❌ Security considerations

---

### **Option 4: Hybrid Approach (Recommended)**

Keep agent local but make trading page work for both local and cloud:

#### Update Trading Page to Support Both Modes

Edit `server.js` - Add environment-aware agent URL:

```javascript
// In the trading page HTML
const DEFAULT_AGENT_URL = process.env.NODE_ENV === 'production' 
  ? 'https://your-ngrok-or-cloudflare-url.com'
  : 'http://localhost:17840';

// Pre-fill agent URL based on environment
document.getElementById("agentUrl").value = DEFAULT_AGENT_URL;
```

#### Deployment Config:
```bash
# Local (.env)
NODE_ENV=development
AGENT_URL=http://localhost:17840

# Render (Environment Variables)
NODE_ENV=production
AGENT_URL=https://your-ngrok-url.ngrok.io
```

---

## Quick Start: ngrok Setup (5 Minutes)

### 1. Install ngrok:
```bash
brew install ngrok
```

### 2. Start ALGTP Agent (local):
```bash
# In terminal 1
cd algtp-bridge
npm start
```

### 3. Start ngrok tunnel (local):
```bash
# In terminal 2
ngrok http 17840
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io`)

### 4. Deploy to Render:
Push your code to git (already done ✅)

### 5. Connect from Render:
1. Open `https://algtp-ai.onrender.com/trading`
2. Enter:
   - **Agent URL**: `https://abc123.ngrok.io` (from ngrok)
   - **Token**: `ALGTP-PAIR-D4Q5-QUUBUD3P`
3. Click Connect

---

## Security Considerations

### ngrok/Cloudflare Tunnel:
✅ HTTPS encryption
✅ Token authentication required
✅ No direct port exposure

### Best Practices:
1. **Never commit pair token** - Keep in `.env` (already in `.gitignore`)
2. **Use HTTPS only** - ngrok/Cloudflare provide this
3. **Regenerate tokens** - Delete `.pair-token` and restart agent
4. **Monitor access** - Check agent logs for unauthorized attempts
5. **Use firewall** - Block port 17840 from internet (only allow tunnel)

---

## Environment Variables for Render

Add these to your Render service:

```bash
# Render Environment Variables
NODE_ENV=production
AGENT_URL=https://your-ngrok-url.ngrok.io
AGENT_TOKEN=ALGTP-PAIR-D4Q5-QUUBUD3P

# Optional: Auto-connect feature
AUTO_CONNECT_AGENT=true
```

Then update `server.js` to use these:

```javascript
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:17840';
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const AUTO_CONNECT = process.env.AUTO_CONNECT_AGENT === 'true';
```

---

## Testing Checklist

### Local Testing:
- ✅ Server: `http://localhost:3000/trading`
- ✅ Agent: `http://localhost:17840`
- ✅ Connection: Direct

### Render Testing:
- ✅ Server: `https://algtp-ai.onrender.com/trading`
- ✅ Agent: `https://abc123.ngrok.io` (via ngrok)
- ✅ Connection: Via tunnel

---

## Troubleshooting

### "Cannot reach agent" on Render:
**Cause**: Agent not exposed or ngrok URL wrong
**Solution**: 
1. Verify ngrok is running: `curl https://your-ngrok-url.ngrok.io/api/health`
2. Check agent is running locally: `lsof -i :17840`
3. Verify token matches

### ngrok URL keeps changing:
**Cause**: Free tier generates new URL on restart
**Solution**: 
- Upgrade to ngrok paid ($8/month) for static domain
- OR use Cloudflare Tunnel (free, static URL)

### Connection timeout:
**Cause**: Agent or tunnel not running
**Solution**: Check both are active:
```bash
# Check agent
ps aux | grep "ALGTP"

# Check ngrok
ps aux | grep "ngrok"
```

---

## Cost Comparison

| Solution | Setup | Monthly Cost | Best For |
|----------|-------|--------------|----------|
| **ngrok (free)** | 5 min | $0 | Testing |
| **ngrok (paid)** | 5 min | $8 | Production |
| **Cloudflare Tunnel** | 30 min | $0 | Production |
| **Cloud VM** | 2-4 hours | $5-20 | Enterprise |

---

## Recommended Solution

### For Testing/Development:
✅ **Use ngrok (free tier)**
- Fastest setup
- Good enough for testing
- URL changes on restart (acceptable for dev)

### For Production:
✅ **Use Cloudflare Tunnel**
- Free
- Static URL
- Production-ready
- Better performance than ngrok free tier

---

## Next Steps

1. **Start ngrok tunnel**:
   ```bash
   ngrok http 17840
   ```

2. **Update Render environment variable**:
   - Go to Render dashboard
   - Add `AGENT_URL` with ngrok URL

3. **Test connection**:
   - Open `https://algtp-ai.onrender.com/trading`
   - Connect with ngrok URL

4. **Make it persistent** (optional):
   - Upgrade to ngrok paid ($8/mo)
   - OR switch to Cloudflare Tunnel (free)

Would you like me to help you set up ngrok or Cloudflare Tunnel?
