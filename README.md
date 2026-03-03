# ALGTP Mobile Proxy

Simple proxy server that forwards mobile app requests to the main ALGTP server.
No authentication, no database - just a clean proxy.

## How it Works

Mobile App → Proxy (Render) → Main ALGTP Server (algtp-ai.onrender.com)

## Deploy to Render

1. Create GitHub repo: `algtp-mobile-proxy`
2. Push this code
3. Create Web Service on Render
4. Add environment variable:
   - `MAIN_SERVER_URL` = `https://algtp-ai.onrender.com`

## Endpoints

All requests are proxied to the main server:
- `/movers-premarket?limit=20`
- `/most-active?limit=20`
- `/unusual-volume?limit=20`
- `/scan?symbols=AAPL,MSFT`

## Test

```bash
curl https://algtp-mobile-proxy.onrender.com/
curl https://algtp-mobile-proxy.onrender.com/movers-premarket?limit=3
```
