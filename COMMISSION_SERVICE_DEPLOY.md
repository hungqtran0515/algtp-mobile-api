# 🚀 ALGTP™ Commission Service - Deployment Guide

## ✅ ĐÃ TÁCH RIÊNG THÀNH MICROSERVICE

Hệ thống commission giờ đây **hoàn toàn độc lập** khỏi main scanner service!

---

## 📁 Files Created

```
commission-service.js       ← Standalone Express server (Port 3001)
commission-db.js           ← Database layer (SQLite)
commission-worker.js       ← Cron job for auto-release
commission-webhooks.js     ← Webhook handlers
commissions.db            ← SQLite database (auto-created)
```

---

## 🏗️ Kiến Trúc Tách Riêng

```
┌──────────────────────────────────┐
│   MAIN SCANNER SERVICE           │  Port 3000
│   - Real-time stock data         │  server.js
│   - WebSocket connections        │
│   - Market scanning              │
└──────────────┬───────────────────┘
               │
               │ HTTP API calls
               │ (khi cần query commission)
               ▼
┌──────────────────────────────────┐
│   COMMISSION SERVICE             │  Port 3001
│   - SQLite database              │  commission-service.js
│   - REST API endpoints           │
│   - Stripe webhook handler       │
│   - Commission tracking          │
└──────────────┬───────────────────┘
               │
               │ Runs every hour
               ▼
┌──────────────────────────────────┐
│   COMMISSION WORKER              │  Cron Job
│   - Auto-release (14-day hold)   │  commission-worker.js
│   - Verify no refund/dispute     │
│   - Process payouts              │
└──────────────────────────────────┘
```

---

## 🔧 Local Development

### 1. Install Dependencies (đã có rồi)
```bash
# Already installed: express, stripe, dotenv, better-sqlite3
```

### 2. Add Environment Variables

Thêm vào `.env`:
```bash
# Commission Service Config
COMMISSION_PORT=3001
COMMISSION_WEBHOOK_SECRET=whsec_your_commission_webhook_secret

# Hoặc dùng chung STRIPE_WEBHOOK_SECRET
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

### 3. Chạy Commission Service

```bash
# Terminal 1: Main Scanner
npm start
# hoặc: node server.js

# Terminal 2: Commission Service
node commission-service.js

# Terminal 3: Test commission worker (manual)
node commission-worker.js
```

### 4. Test Service

```bash
# Health check
curl http://localhost:3001/health

# Test webhook (dùng Stripe CLI)
stripe listen --forward-to localhost:3001/webhook

# Test API
curl http://localhost:3001/api/saler/david_dao/commissions
```

---

## 🌐 Production Deployment (Render)

### Option 1: Separate Render Service (Recommended)

File: `render.yaml`
```yaml
services:
  # Main scanner service
  - type: web
    name: algtp-scanner
    env: node
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: PORT
        value: 3000
      - key: STRIPE_SECRET_KEY
        sync: false
      - key: STRIPE_WEBHOOK_SECRET
        sync: false
      # ... other scanner env vars

  # Commission service (TÁCH RIÊNG)
  - type: web
    name: algtp-commission
    env: node
    buildCommand: npm install
    startCommand: node commission-service.js
    envVars:
      - key: COMMISSION_PORT
        value: 3001
      - key: STRIPE_SECRET_KEY
        sync: false
      - key: COMMISSION_WEBHOOK_SECRET
        sync: false

  # Commission worker (Cron job)
  - type: cron
    name: commission-worker
    env: node
    buildCommand: npm install
    schedule: "0 * * * *"  # Every hour
    startCommand: node commission-worker.js
    envVars:
      - key: STRIPE_SECRET_KEY
        sync: false
```

### Option 2: PM2 (Alternative)

File: `ecosystem.config.cjs`
```javascript
module.exports = {
  apps: [
    {
      name: "scanner",
      script: "./server.js",
      instances: 1,
      env: {
        PORT: 3000
      }
    },
    {
      name: "commission-service",
      script: "./commission-service.js",
      instances: 1,
      env: {
        COMMISSION_PORT: 3001
      }
    },
    {
      name: "commission-worker",
      script: "./commission-worker.js",
      cron_restart: "0 * * * *", // Every hour
      autorestart: false
    }
  ]
};
```

```bash
# Start all services
pm2 start ecosystem.config.cjs

# Monitor
pm2 monit

# Logs
pm2 logs commission-service
pm2 logs commission-worker
```

---

## 🔗 Integration với Main Scanner

Main scanner cần gọi commission service qua HTTP API thay vì import trực tiếp:

### Trong `server.js` (Main Scanner):

```javascript
const COMMISSION_SERVICE_URL = process.env.COMMISSION_SERVICE_URL || "http://localhost:3001";

// Khi cần lấy saler commissions
app.get("/api/saler/:salerId/dashboard", async (req, res) => {
  const { salerId } = req.params;
  
  // Call commission service
  const response = await fetch(`${COMMISSION_SERVICE_URL}/api/saler/${salerId}/commissions`);
  const commissionsData = await response.json();
  
  // Kết hợp với user data từ scanner database
  const users = getUsersBySalerId(salerId);
  
  res.json({
    ...commissionsData,
    users, // thêm thông tin users từ scanner DB
  });
});
```

### Webhook Routing

**Option A: Stripe gửi trực tiếp đến commission service**
```
Stripe Webhook → https://algtp-commission.onrender.com/webhook
```

**Option B: Main scanner forward sang commission service**
```javascript
// Trong server.js webhook handler
app.post("/stripe/webhook", async (req, res) => {
  const event = stripe.webhooks.constructEvent(...);
  
  // Forward commission-related events
  if (["invoice.paid", "charge.refunded", "charge.dispute.created"].includes(event.type)) {
    await fetch(`${COMMISSION_SERVICE_URL}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  }
  
  // Original webhook handling...
});
```

---

## 📊 API Endpoints (Commission Service)

### GET /health
Health check cho service

### POST /webhook
Stripe webhook cho commission events:
- `invoice.paid` → Tạo commission
- `charge.refunded` → Cancel commission
- `charge.dispute.created` → Cancel commission

### GET /api/saler/:salerId/commissions
Lấy tất cả commissions của saler
```json
{
  "ok": true,
  "salerId": "david_dao",
  "stats": {
    "pending": { "count": 5, "amount": 181.95 },
    "paid": { "count": 12, "amount": 436.68 }
  },
  "total_earned": 436.68,
  "total_pending": 181.95,
  "next_payout": "2026-02-20",
  "commissions": [...]
}
```

### GET /api/commission/:commissionId
Chi tiết một commission

### GET /api/commissions/ready
Danh sách commissions sẵn sàng release (14 ngày đã qua)

### POST /api/commission/create
Tạo commission thủ công (testing)

### POST /api/commission/:commissionId/cancel
Hủy commission

---

## 🔐 Security

### Database Isolation
- Commission service có database riêng (`commissions.db`)
- Main scanner không direct access database này
- Chỉ giao tiếp qua REST API

### Webhook Security
- Webhook endpoint riêng với secret key riêng
- Verify Stripe signature
- Rate limiting (có thể thêm)

### API Authentication
Hiện tại chưa có auth, có thể thêm:
```javascript
// Simple API key auth
app.use((req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.COMMISSION_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});
```

---

## 🧪 Testing

### Test Commission Creation
```bash
curl -X POST http://localhost:3001/api/commission/create \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "in_test_123",
    "customerId": "cus_test_123",
    "salerId": "david_dao",
    "userEmail": "test@example.com",
    "plan": "PRO",
    "priceId": "price_test_123",
    "amountCents": 4599,
    "commissionRate": 65
  }'
```

### Test Worker (Manual Run)
```bash
# Chạy worker một lần để test
node commission-worker.js

# Xem logs
tail -f logs/commission.log
```

### Test với Stripe CLI
```bash
# Listen to Stripe events và forward đến commission service
stripe listen --forward-to localhost:3001/webhook

# Trigger test events
stripe trigger invoice.payment_succeeded
stripe trigger charge.refunded
```

---

## 📈 Monitoring

### Logs
```bash
# Commission service logs
pm2 logs commission-service

# Worker logs
pm2 logs commission-worker

# Or with Render
# Check logs in Render dashboard
```

### Database Queries
```bash
# Check pending commissions
sqlite3 commissions.db "SELECT COUNT(*), SUM(commission_cents)/100 FROM commissions WHERE status='PENDING';"

# Check next payout date
sqlite3 commissions.db "SELECT MIN(release_at) FROM commissions WHERE status='PENDING';"

# Audit trail
sqlite3 commissions.db "SELECT * FROM commission_logs WHERE commission_id=1 ORDER BY created_at DESC;"
```

---

## 🚨 Troubleshooting

### Service Not Starting
```bash
# Check port conflict
lsof -i :3001

# Check logs
pm2 logs commission-service --lines 100
```

### Database Locked
```bash
# SQLite WAL mode helps, nhưng nếu vẫn lock:
sqlite3 commissions.db "PRAGMA journal_mode=WAL;"
```

### Worker Not Running
```bash
# Check cron expression
node -e "const cron = require('node-cron'); console.log(cron.validate('0 * * * *'));"

# Run manually
node commission-worker.js
```

### Webhook Not Receiving
```bash
# Check Stripe webhook settings
# Ensure URL is: https://algtp-commission.onrender.com/webhook
# Check webhook secret matches COMMISSION_WEBHOOK_SECRET

# Test with Stripe CLI
stripe listen --forward-to localhost:3001/webhook
```

---

## ✅ Deployment Checklist

- [ ] Commission service deployed riêng (Port 3001)
- [ ] Worker cron job setup (chạy mỗi giờ)
- [ ] Stripe webhook URL updated (point đến commission service)
- [ ] Environment variables configured
- [ ] Database file persisted (nếu dùng Render disk)
- [ ] Main scanner updated để call commission API
- [ ] API authentication added (nếu cần)
- [ ] Monitoring/logging setup
- [ ] Test tạo commission
- [ ] Test worker auto-release
- [ ] Test webhook từ Stripe

---

## 🎉 Benefits của Kiến Trúc Tách Riêng

✅ **Isolation**: Scanner crash không ảnh hưởng commission  
✅ **Security**: Financial data tách biệt  
✅ **Scalability**: Scale riêng từng service  
✅ **Maintainability**: Code dễ maintain hơn  
✅ **Compliance**: Dễ pass audit  
✅ **Testing**: Test riêng từng service  

---

**Version**: 2.0.0 (Standalone Microservice)  
**Created**: February 6, 2026  
**Author**: ALGTP Development Team
