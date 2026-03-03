// ============================================================================
// 📱 ALGTP Mobile Proxy Server
// Simple proxy to forward mobile app requests to main ALGTP server
// No authentication required - designed for mobile app
// ============================================================================

import express from 'express';
import axios from 'axios';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3000;

// Main ALGTP server URL (will be set via environment variable on Render)
const MAIN_SERVER = process.env.MAIN_SERVER_URL || 'http://10.0.0.230:3000';

// CORS for mobile app
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    ok: true, 
    service: 'ALGTP Mobile Proxy',
    mainServer: MAIN_SERVER,
    timestamp: new Date().toISOString() 
  });
});

// Proxy function
async function proxyToMain(endpoint, query = {}) {
  try {
    const url = `${MAIN_SERVER}${endpoint}`;
    const response = await axios.get(url, {
      params: query,
      timeout: 30000,
      validateStatus: () => true // Accept any status
    });
    
    return {
      status: response.status,
      data: response.data
    };
  } catch (error) {
    console.error(`Proxy error for ${endpoint}:`, error.message);
    return {
      status: 500,
      data: { ok: false, error: error.message }
    };
  }
}

// Mobile API endpoints - proxy everything to main server
app.get('/movers-premarket', async (req, res) => {
  const result = await proxyToMain('/movers-premarket', req.query);
  res.status(result.status).json(result.data);
});

app.get('/movers-afterhours', async (req, res) => {
  const result = await proxyToMain('/movers-afterhours', req.query);
  res.status(result.status).json(result.data);
});

app.get('/most-active', async (req, res) => {
  const result = await proxyToMain('/most-active', req.query);
  res.status(result.status).json(result.data);
});

app.get('/unusual-volume', async (req, res) => {
  const result = await proxyToMain('/unusual-volume', req.query);
  res.status(result.status).json(result.data);
});

app.get('/scan', async (req, res) => {
  const result = await proxyToMain('/scan', req.query);
  res.status(result.status).json(result.data);
});

// Generic proxy for any other endpoints
app.get('*', async (req, res) => {
  const result = await proxyToMain(req.path, req.query);
  res.status(result.status).json(result.data);
});

// Start server
app.listen(PORT, () => {
  console.log(`📱 ALGTP Mobile Proxy running on port ${PORT}`);
  console.log(`🔗 Proxying to: ${MAIN_SERVER}`);
});
