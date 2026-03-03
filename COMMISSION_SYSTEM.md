# 🤖 ALGTP™ Commission System (14-Day Auto-Release)

## ✅ Quy Tắc Quan Trọng

1. **14-day hold period** - BẮT BUỘC cho mọi transaction
2. **NO manual intervention** - BOT tự động release 100%
3. **Auto-cancel on refund/dispute** - Tự động hủy commission
4. **No early release** - Không ai xin sớm được

---

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────────┐
│  Stripe Webhook │
│  (invoice.paid) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ CREATE COMMISSION           │
│ - Status: PENDING           │
│ - Release: now + 14 days    │
│ - Commission: 65%           │
└────────┬────────────────────┘
         │
         │ Wait 14 days...
         │
         ▼
┌─────────────────────────────┐
│ CRON JOB (runs hourly)      │
│ - Check ready commissions   │
│ - Verify no refund/dispute  │
│ - Auto release if safe      │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ STRIPE TRANSFER             │
│ - Transfer to saler         │
│ - Mark as PAID              │
│ - Log transaction           │
└─────────────────────────────┘
```

---

## 📁 Files Created

### 1. `commission-db.js`
Database layer - SQLite with better-sqlite3

**Tables:**
- `commissions` - Main commission tracking
- `commission_logs` - Audit trail

**Functions:**
- `createCommission()` - Tạo commission mới (14-day hold)
- `getReadyCommissions()` - Lấy commissions đã đủ 14 ngày
- `markCommissionPaid()` - Đánh dấu đã trả
- `cancelCommission()` - Hủy (refund/dispute)
- `getCommissionStats()` - Thống kê cho saler

### 2. `commission-worker.js`
Auto-release worker - Chạy cron job

**Chức năng:**
- Query commissions đã đủ 14 ngày
- Verify invoice vẫn còn paid
- Check không có dispute/refund
- Tạo Stripe transfer (nếu dùng Connect)
- Mark as PAID

**Chạy:**
```bash
# Manual test
node commission-worker.js

# Production (cron)
0 * * * * cd /path/to/project && node commission-worker.js >> logs/commission.log 2>&1
```

### 3. `commission-webhooks.js`
Webhook handlers

**Events:**
- `invoice.paid` → Create commission (PENDING)
- `invoice.voided` → Cancel commission
- `charge.refunded` → Cancel commission
- `charge.dispute.created` → Cancel commission

---

## 🔄 Flow Chi Tiết

### Step 1: User Subscribe (via saler link)

```javascript
// User clicks: https://algtp-ai.onrender.com/ref/david_dao
// Chooses plan: $55.99/month (Institutional)
// Stripe checkout with metadata: { saler_id: "david_dao", plan: "55.99" }
```

### Step 2: Webhook `invoice.paid`

```javascript
// server.js webhook endpoint
app.post("/stripe/webhook", async (req, res) => {
  const event = stripe.webhooks.constructEvent(...);
  
  if (event.type === "invoice.paid") {
    handleCommissionWebhook(event); // ← calls commission-webhooks.js
  }
  
  // Original webhook handling...
});
```

```javascript
// commission-webhooks.js
export function handleInvoicePaid(invoice) {
  const salerId = invoice.metadata.saler_id;
  
  createCommission({
    invoiceId: invoice.id,
    salerId,
    amountCents: 5599, // $55.99
    commissionRate: 65,
    commissionCents: 3639, // $36.39 (65%)
    releaseAt: now + 14 days,
  });
  
  // Status: PENDING
  // Release: 2026-02-20 04:37:00
}
```

### Step 3: Wait 14 Days

```
PENDING state - commission in database
User continues using scanner platform
NO commission paid yet
```

### Step 4: Cron Job Runs (Hourly)

```javascript
// commission-worker.js (runs every hour)
const ready = getReadyCommissions(); // WHERE release_at <= NOW()

for (const commission of ready) {
  // 1. Verify invoice still paid
  const invoice = await stripe.invoices.retrieve(commission.invoice_id);
  if (invoice.status !== "paid") {
    cancelCommission(commission.id, "Invoice voided");
    continue;
  }
  
  // 2. Check for disputes
  const charge = await stripe.charges.retrieve(invoice.charge);
  if (charge.disputed || charge.refunded) {
    cancelCommission(commission.id, "Refunded/disputed");
    continue;
  }
  
  // 3. ✅ SAFE TO RELEASE
  const transfer = await stripe.transfers.create({
    amount: commission.commission_cents,
    destination: commission.connected_account,
  });
  
  markCommissionPaid(commission.id, transfer.id);
}
```

### Step 5: Commission Paid

```
Status: PAID
Transfer ID: tr_xxxxx
Saler receives $36.39
Audit log created
```

---

## 💰 Commission Calculation

| Plan | Price | Commission (65%) |
|------|-------|------------------|
| Day Trader | $35.99/mo | **$23.39** |
| Pro Trader | $45.99/mo | **$29.89** |
| Institutional | $55.99/mo | **$36.39** |

---

## 🚨 Auto-Cancel Scenarios

Commission tự động HỦY nếu:

1. **Invoice voided** - User cancel subscription trước khi charge
2. **Charge refunded** - Refund trong 14 ngày
3. **Charge disputed** - User dispute payment
4. **Subscription cancelled** - Cancel trước khi commission release

---

## 🔧 Setup Instructions

### 1. Install Dependencies

```bash
npm install better-sqlite3 stripe
```

### 2. Setup Database

```bash
# Database tự động tạo khi chạy commission-db.js
# Location: /path/to/project/commissions.db
```

### 3. Setup Cron Job

**Option A: Cron (Linux/Mac)**

```bash
# Edit crontab
crontab -e

# Add line (runs every hour)
0 * * * * cd /Users/hungtran/Documents/ALGTP-AI/AI/ALGTP-AI && node commission-worker.js >> logs/commission.log 2>&1
```

**Option B: Render Cron Jobs**

```yaml
# render.yaml
services:
  - type: cron
    name: commission-worker
    schedule: "0 * * * *"  # Every hour
    buildCommand: npm install
    startCommand: node commission-worker.js
    envVars:
      - key: STRIPE_SECRET_KEY
        sync: false
```

**Option C: PM2 (Alternative)**

```bash
pm2 start commission-worker.js --cron "0 * * * *"
```

### 4. Add to Stripe Webhook

```javascript
// server.js - existing webhook endpoint
import { handleCommissionWebhook } from "./commission-webhooks.js";

app.post("/stripe/webhook", async (req, res) => {
  const event = stripe.webhooks.constructEvent(...);
  
  // Add commission tracking
  if (["invoice.paid", "invoice.voided", "charge.refunded", "charge.dispute.created"].includes(event.type)) {
    try {
      handleCommissionWebhook(event);
    } catch (error) {
      console.error("Commission webhook error:", error);
    }
  }
  
  // Original webhook handling...
});
```

---

## 📊 Admin Endpoints

### Get Saler Commission Stats

```bash
GET /api/saler/:salerId/commissions
```

Response:
```json
{
  "ok": true,
  "saler": {
    "id": "david_dao",
    "name": "David Dao"
  },
  "stats": {
    "pending": { "count": 5, "amount": 181.95 },
    "paid": { "count": 12, "amount": 436.68 },
    "cancelled": { "count": 1, "amount": 36.39 },
    "disputed": { "count": 0, "amount": 0 }
  },
  "total_earned": 436.68,
  "total_pending": 181.95,
  "next_payout": "2026-02-20"
}
```

### Get Commission Details

```bash
GET /api/commission/:commissionId
```

---

## 🧪 Testing

### Manual Test Worker

```bash
node commission-worker.js
```

### Test with Mock Data

```bash
node test-commission-system.js
```

---

## ⚠️  Important Notes

1. **Stripe Connect Required** - To auto-transfer, salers need Stripe Connect accounts
2. **Without Connect** - System marks as PAID, you handle payout manually
3. **Backup Strategy** - Always keep audit logs in `commission_logs`
4. **Rate Limits** - Worker processes max 100 commissions per run
5. **Error Handling** - Failed transfers are logged, manual review needed

---

## 🔒 Security

- ✅ 14-day hold protects against chargebacks
- ✅ Auto-cancel on refund/dispute
- ✅ Complete audit trail
- ✅ No manual intervention = no fraud
- ✅ Database transactions for consistency

---

## 📞 Support

Hệ thống hoàn toàn tự động. Nếu có vấn đề:

1. Check logs: `logs/commission.log`
2. Query database: `sqlite3 commissions.db`
3. Review audit trail: `SELECT * FROM commission_logs WHERE commission_id = X`

**NO MANUAL RELEASE!** 🤖
