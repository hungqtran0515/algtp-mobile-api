# Agent Bridge Proxy Solution

## Problem
Render deployment cannot connect to localhost:17840 where the ALGTP Agent runs.

## Solution: Built-in WebSocket Relay

Instead of using ngrok, we'll create a WebSocket relay that runs on the Render server. Your local agent connects TO Render, and Render relays commands between the web UI and your agent.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ YOUR MACHINE (localhost)                                    │
│                                                              │
│  ALGTP Agent (17840) ──────┐                                │
│                             │ Outbound WS Connection         │
└─────────────────────────────┼──────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ RENDER (algtp-s1.onrender.com)                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Agent Bridge Relay (WebSocket Server)                │  │
│  │  - Receives connections from agents                  │  │
│  │  - Receives commands from web UI                     │  │
│  │  - Relays messages bidirectionally                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                              ▲                               │
│                              │                               │
│  Browser ───────────────────┘                               │
│  (Trading Page)                                             │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

1. **Agent connects TO Render** (outbound connection - no firewall issues)
2. **Web UI connects TO Render** (standard web connection)
3. **Render relays messages** between agent and UI
4. **No port forwarding needed** - all connections are outbound

## Implementation Steps

### 1. Add WebSocket Relay to server.js

```javascript
// Add to server.js
const { WebSocketServer } = require('ws');

// Create WebSocket server for agent connections
const agentWss = new WebSocketServer({ noServer: true });
const agents = new Map(); // sessionId -> {ws, agentInfo}
const webClients = new Map(); // sessionId -> {ws}

// Handle WebSocket upgrade for agent connections
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  
  if (pathname === '/agent-bridge') {
    agentWss.handleUpgrade(request, socket, head, (ws) => {
      handleAgentConnection(ws, request);
    });
  } else if (pathname === '/agent-client') {
    agentWss.handleUpgrade(request, socket, head, (ws) => {
      handleClientConnection(ws, request);
    });
  } else {
    socket.destroy();
  }
});

function handleAgentConnection(ws, request) {
  const sessionId = generateSessionId();
  const agentInfo = {
    ws,
    sessionId,
    connectedAt: Date.now(),
    authenticated: false
  };
  
  console.log(`[Agent Bridge] Agent connecting: ${sessionId}`);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      // Authentication
      if (msg.type === 'auth') {
        if (validateAgentToken(msg.token)) {
          agentInfo.authenticated = true;
          agentInfo.token = msg.token;
          agents.set(sessionId, agentInfo);
          ws.send(JSON.stringify({ type: 'auth:success', sessionId }));
          console.log(`[Agent Bridge] Agent authenticated: ${sessionId}`);
        } else {
          ws.send(JSON.stringify({ type: 'auth:failed' }));
          ws.close();
        }
        return;
      }
      
      if (!agentInfo.authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        return;
      }
      
      // Relay message to client
      const client = webClients.get(sessionId);
      if (client && client.ws.readyState === 1) {
        client.ws.send(data);
      }
    } catch (e) {
      console.error('[Agent Bridge] Error handling agent message:', e);
    }
  });
  
  ws.on('close', () => {
    console.log(`[Agent Bridge] Agent disconnected: ${sessionId}`);
    agents.delete(sessionId);
  });
}

function handleClientConnection(ws, request) {
  const url = new URL(request.url, 'http://localhost');
  const sessionId = url.searchParams.get('session');
  
  if (!sessionId || !agents.has(sessionId)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
    ws.close();
    return;
  }
  
  webClients.set(sessionId, { ws });
  console.log(`[Agent Bridge] Client connected to session: ${sessionId}`);
  
  ws.on('message', (data) => {
    // Relay message to agent
    const agent = agents.get(sessionId);
    if (agent && agent.ws.readyState === 1) {
      agent.ws.send(data);
    }
  });
  
  ws.on('close', () => {
    console.log(`[Agent Bridge] Client disconnected from session: ${sessionId}`);
    webClients.delete(sessionId);
  });
}
```

### 2. Update ALGTP Agent to Connect to Render

Add to `algtp-bridge/src/server.js`:

```javascript
import WebSocket from 'ws';

// Connect to Render bridge when in production mode
const RENDER_BRIDGE_URL = process.env.RENDER_BRIDGE_URL || 'wss://algtp-s1.onrender.com/agent-bridge';

let bridgeWs = null;
let bridgeSessionId = null;

function connectToRenderBridge() {
  if (bridgeWs) return;
  
  console.log('[Bridge] Connecting to Render bridge...');
  bridgeWs = new WebSocket(RENDER_BRIDGE_URL);
  
  bridgeWs.on('open', () => {
    console.log('[Bridge] Connected to Render bridge');
    // Authenticate
    bridgeWs.send(JSON.stringify({
      type: 'auth',
      token: getPairToken()
    }));
  });
  
  bridgeWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'auth:success') {
        bridgeSessionId = msg.sessionId;
        console.log(`[Bridge] Authenticated with session: ${bridgeSessionId}`);
        return;
      }
      
      // Handle commands from web UI (via Render relay)
      handleBridgeCommand(msg);
    } catch (e) {
      console.error('[Bridge] Error handling bridge message:', e);
    }
  });
  
  bridgeWs.on('close', () => {
    console.log('[Bridge] Disconnected from Render bridge, reconnecting...');
    bridgeWs = null;
    bridgeSessionId = null;
    setTimeout(connectToRenderBridge, 5000);
  });
  
  bridgeWs.on('error', (err) => {
    console.error('[Bridge] Connection error:', err.message);
  });
}

// Start bridge connection on agent startup
if (process.env.ENABLE_RENDER_BRIDGE === 'true') {
  connectToRenderBridge();
}
```

### 3. Update Trading Page to Use Bridge

```javascript
// In trading page, detect if agent is remote and use bridge
function connectAgent() {
  const isRender = window.location.hostname.includes('onrender.com');
  
  if (isRender) {
    // Use bridge mode
    connectViaAgentBridge();
  } else {
    // Use direct connection (localhost)
    connectDirectly();
  }
}

function connectViaAgentBridge() {
  // Get available sessions from server
  fetch('/api/agent-bridge/sessions')
    .then(r => r.json())
    .then(sessions => {
      if (sessions.length === 0) {
        showError('No agent connected to bridge. Start your local agent with ENABLE_RENDER_BRIDGE=true');
        return;
      }
      
      // Connect to first available session
      const sessionId = sessions[0].sessionId;
      const ws = new WebSocket(`wss://${window.location.host}/agent-client?session=${sessionId}`);
      
      ws.onopen = () => {
        setAgentState('CONNECTED');
        // Use WebSocket for all commands
      };
      
      // ... rest of WebSocket handling
    });
}
```

## Configuration

### Local Agent (.env in algtp-bridge)
```bash
ENABLE_RENDER_BRIDGE=true
RENDER_BRIDGE_URL=wss://algtp-s1.onrender.com/agent-bridge
```

### Render Environment Variables
```bash
ENABLE_AGENT_BRIDGE=true
AGENT_BRIDGE_PORT=3000
```

## Benefits

✅ **No ngrok needed** - Pure WebSocket relay
✅ **No port forwarding** - All connections are outbound
✅ **Works through firewalls** - Standard HTTPS/WSS
✅ **Auto-reconnect** - Agent reconnects if disconnected
✅ **Multi-agent support** - Can have multiple agents connected
✅ **Secure** - Token-based authentication

## Drawbacks

⚠️ **Latency** - Extra hop through Render server
⚠️ **Agent must initiate** - Agent connects TO Render (not Render to Agent)
⚠️ **Always-on required** - Agent must stay connected to Render

## Alternative: Simpler Approach

If the above is too complex, we can use **CloudFlare Tunnel** instead (free, no code changes needed):

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Start tunnel
cloudflared tunnel --url http://localhost:17840
```

This gives you a persistent URL without code changes!
