# ALGTP Agent Bridge Relay - Setup Guide

## Overview
The bridge relay system allows your local ALGTP Agent (on your computer) to communicate with the trading page on Render (cloud) WITHOUT requiring ngrok, port forwarding, or any external tunneling tools.

**How it works**: Your local agent connects TO Render (outbound connection), Render relays messages bidirectionally between the agent and your browser.

## Architecture
```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Browser (You)  │◄────────┤  Render Server   │◄────────┤  ALGTP Agent    │
│  Trading Page   │  WebSocket  (Bridge Relay)  │  WebSocket  (Your Computer) │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                     │                              │
                                     │    Relay messages            │
                                     │◄───────────────────────────►│
```

## Setup Instructions

### 1. Configure ALGTP Agent (Local)

Add these environment variables to your ALGTP Agent:

**Option A: Edit `.env` file in `algtp-bridge/` directory:**
```bash
ENABLE_RENDER_BRIDGE=true
RENDER_BRIDGE_URL=wss://algtp-s1.onrender.com/agent-bridge
```

**Option B: Set via Electron app UI (if available)**

### 2. Restart ALGTP Agent

After setting the environment variables, restart the ALGTP Agent desktop application.

You should see these logs in the console:
```
⚡ ALGTP Bridge API running on http://localhost:17840
[Bridge] Render bridge mode enabled
[Bridge] Connecting to wss://algtp-s1.onrender.com/agent-bridge...
[Bridge] Connected to Render relay
[Bridge] Authenticated with session: XXXXX-XXXXX-XXXXX
```

### 3. Access Trading Page on Render

1. Go to: **https://algtp-s1.onrender.com/trading**
2. Enter your **pair token** (same token you use locally)
3. Click **Connect**

The page will automatically:
- Detect it's running on Render (not localhost)
- Switch to bridge mode
- Find your agent session
- Establish connection

You should see:
- `AGENT: ON` badge turns green
- Agent Panel shows your connection details
- No ngrok needed!

## Troubleshooting

### Agent shows "No pair token available"
**Solution**: Make sure you've paired the agent first via the Electron app UI or localhost:17840

### Connection fails with "No agent connected to bridge"
**Possible causes**:
1. Agent not running on your computer
2. `ENABLE_RENDER_BRIDGE=true` not set
3. Firewall blocking outbound WebSocket connections

**Solution**: Check agent console logs for bridge connection status

### "Authentication failed" error
**Solution**: Make sure the pair token in the trading page matches your agent's token

### Bridge disconnects frequently
**Normal behavior**: The bridge auto-reconnects every 5 seconds if disconnected. This is expected.

## Checking Connection Status

### Server-side (Render)
Check active agent sessions:
```bash
curl https://algtp-s1.onrender.com/api/agent-bridge/sessions
```

Expected response:
```json
{
  "ok": true,
  "sessions": [
    {
      "sessionId": "XXXXX-XXXXX-XXXXX",
      "connectedAt": 1234567890,
      "uptime": 45000,
      "clientCount": 1
    }
  ],
  "count": 1
}
```

### Agent-side (Local)
Check agent health:
```bash
curl http://localhost:17840/api/health
```

You should see `"paired": true` and broker status.

## Security

- All connections use WebSocket over TLS (wss://)
- Authentication required via pair token (ALGTP-PAIR-XXXX-XXXXXXXX format)
- Session-based routing prevents cross-contamination
- No data is stored on Render - all trades go through your local agent

## Environment Variables Reference

### ALGTP Agent (.env)
```bash
# Enable bridge mode (default: false)
ENABLE_RENDER_BRIDGE=true

# Render bridge URL (default: wss://algtp-s1.onrender.com/agent-bridge)
RENDER_BRIDGE_URL=wss://algtp-s1.onrender.com/agent-bridge
```

### Render Server (.env)
```bash
# Enable bridge server (default: true)
ENABLE_AGENT_BRIDGE=true
```

## Advantages Over ngrok

✅ **No installation required** - Works out of the box  
✅ **No external dependencies** - Built into ALGTP  
✅ **No URL changes** - Always use algtp-s1.onrender.com  
✅ **Auto-reconnect** - Handles connection drops gracefully  
✅ **Multiple sessions** - Multiple agents can connect (future feature)  
✅ **Free** - No paid tunneling service needed

## Limitations

- Requires stable internet connection on agent machine
- Initial connection takes ~1-2 seconds
- WebSocket requests have 10-second timeout
- Bridge sessions expire when agent disconnects

## Next Steps

Once connected, you can:
- ✅ View real-time positions and account data
- ✅ Execute trades (buy/sell/close)
- ✅ Monitor broker connection status
- ✅ Manage IB accounts
- ✅ Use all trading features remotely

## Support

If you encounter issues:
1. Check agent console logs for bridge connection status
2. Verify pair token matches on both sides
3. Ensure agent is running and accessible at localhost:17840
4. Check firewall settings for outbound WebSocket connections

For advanced debugging, check browser console (F12) for WebSocket connection messages.
