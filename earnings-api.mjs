import express from 'express';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;
const FMP_API_KEY = process.env.FMP_API_KEY;

if (!FMP_API_KEY) {
  console.error('Error: FMP_API_KEY environment variable is required');
  process.exit(1);
}

// Helper function for safe API calls
async function safeGet(url) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    return {
      ok: true,
      status: response.status,
      data: response.data,
      errorDetail: null
    };
  } catch (error) {
    return {
      ok: false,
      status: error.response?.status || 500,
      data: null,
      errorDetail: error.message
    };
  }
}

// Earnings endpoint
app.get('/api/earnings', async (req, res) => {
  const { symbol, limit = 8 } = req.query;

  if (!symbol) {
    return res.status(400).json({
      error: 'Missing required parameter: symbol'
    });
  }

  const url = `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${symbol.toUpperCase()}?limit=${limit}&apikey=${FMP_API_KEY}`;

  const result = await safeGet(url);

  if (!result.ok) {
    return res.status(result.status).json({
      error: 'Failed to fetch earnings data',
      detail: result.errorDetail
    });
  }

  res.json({
    symbol: symbol.toUpperCase(),
    earnings: result.data || []
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    fmpConfigured: !!FMP_API_KEY
  });
});

app.listen(PORT, () => {
  console.log(`Earnings API server running on port ${PORT}`);
  console.log(`Test with: curl "http://localhost:${PORT}/api/earnings?symbol=AAPL&limit=8"`);
});
