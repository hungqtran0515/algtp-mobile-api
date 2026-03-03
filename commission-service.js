/**
 * ALGTP™ Commission Service - Standalone Microservice
 * 
 * Features:
 * - REST API cho commission tracking
 * - Webhook endpoint riêng cho Stripe
 * - Database độc lập (SQLite)
 * - Không phụ thuộc vào main scanner
 * 
 * Port: 3001 (hoặc config từ env)
 */

import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import {
  createCommission,
  getReadyCommissions,
  markCommissionPaid,
  cancelCommission,
  getCommissionsBySalerId,
  getCommissionById,
} from "./commission-db.js";
import { handleCommissionWebhook } from "./commission-webhooks.js";

dotenv.config();

const app = express();
const PORT = process.env.COMMISSION_PORT || 3001;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.COMMISSION_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2023-10-16" });

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Webhook endpoint needs raw body
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    try {
      const event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
      console.log(`[Commission Service] Webhook received: ${event.type}`);

      // Handle commission-related events
      await handleCommissionWebhook(event);

      res.json({ received: true });
    } catch (err) {
      console.error(`[Commission Service] Webhook error: ${err.message}`);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// JSON parser for other routes
app.use(express.json());

// CORS for cross-origin requests from main app
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ALGTP Commission Service",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ============================================================================
// COMMISSION API ENDPOINTS
// ============================================================================

/**
 * GET /api/saler/:salerId/commissions
 * 
 * Lấy tất cả commissions của một saler
 */
app.get("/api/saler/:salerId/commissions", async (req, res) => {
  try {
    const { salerId } = req.params;
    const commissions = getCommissionsBySalerId(salerId);

    // Calculate stats
    const stats = {
      pending: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
      cancelled: { count: 0, amount: 0 },
      disputed: { count: 0, amount: 0 },
    };

    commissions.forEach((c) => {
      const status = c.status.toLowerCase();
      if (stats[status]) {
        stats[status].count++;
        stats[status].amount += c.commission_cents / 100;
      }
    });

    // Next payout date (earliest pending commission)
    const nextPayout = commissions
      .filter((c) => c.status === "PENDING")
      .sort((a, b) => a.release_at - b.release_at)[0];

    res.json({
      ok: true,
      salerId,
      stats,
      total_earned: stats.paid.amount,
      total_pending: stats.pending.amount,
      next_payout: nextPayout
        ? new Date(nextPayout.release_at * 1000).toISOString().split("T")[0]
        : null,
      commissions: commissions.map((c) => ({
        id: c.id,
        invoice_id: c.invoice_id,
        user_email: c.user_email,
        plan: c.plan,
        amount: c.amount_cents / 100,
        commission: c.commission_cents / 100,
        status: c.status,
        created_at: new Date(c.created_at * 1000).toISOString(),
        release_at: new Date(c.release_at * 1000).toISOString(),
        paid_at: c.paid_at ? new Date(c.paid_at * 1000).toISOString() : null,
      })),
    });
  } catch (error) {
    console.error("[Commission Service] Error fetching saler commissions:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/commission/:commissionId
 * 
 * Lấy chi tiết một commission
 */
app.get("/api/commission/:commissionId", async (req, res) => {
  try {
    const { commissionId } = req.params;
    const commission = getCommissionById(parseInt(commissionId));

    if (!commission) {
      return res.status(404).json({ ok: false, error: "Commission not found" });
    }

    res.json({
      ok: true,
      commission: {
        ...commission,
        amount: commission.amount_cents / 100,
        commission: commission.commission_cents / 100,
        created_at: new Date(commission.created_at * 1000).toISOString(),
        release_at: new Date(commission.release_at * 1000).toISOString(),
        paid_at: commission.paid_at ? new Date(commission.paid_at * 1000).toISOString() : null,
      },
    });
  } catch (error) {
    console.error("[Commission Service] Error fetching commission:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/commissions/ready
 * 
 * Lấy danh sách commissions đã sẵn sàng để release (14 ngày đã qua)
 * Admin endpoint
 */
app.get("/api/commissions/ready", async (req, res) => {
  try {
    const ready = getReadyCommissions();

    res.json({
      ok: true,
      count: ready.length,
      total_amount: ready.reduce((sum, c) => sum + c.commission_cents, 0) / 100,
      commissions: ready.map((c) => ({
        id: c.id,
        saler_id: c.saler_id,
        user_email: c.user_email,
        commission: c.commission_cents / 100,
        release_at: new Date(c.release_at * 1000).toISOString(),
      })),
    });
  } catch (error) {
    console.error("[Commission Service] Error fetching ready commissions:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/commission/create
 * 
 * Manual commission creation (for testing or manual entries)
 */
app.post("/api/commission/create", async (req, res) => {
  try {
    const {
      invoiceId,
      subscriptionId,
      customerId,
      chargeId,
      salerId,
      userEmail,
      plan,
      priceId,
      amountCents,
      commissionRate,
      connectedAccount,
    } = req.body;

    const commissionId = createCommission({
      invoiceId,
      subscriptionId,
      customerId,
      chargeId,
      salerId,
      userEmail,
      plan,
      priceId,
      amountCents,
      commissionRate: commissionRate || 65,
      connectedAccount,
    });

    res.json({
      ok: true,
      commissionId,
      message: "Commission created with 14-day hold",
    });
  } catch (error) {
    console.error("[Commission Service] Error creating commission:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/commission/:commissionId/cancel
 * 
 * Cancel a pending commission
 */
app.post("/api/commission/:commissionId/cancel", async (req, res) => {
  try {
    const { commissionId } = req.params;
    const { reason } = req.body;

    const success = cancelCommission(parseInt(commissionId), reason || "Manual cancellation");

    if (success) {
      res.json({ ok: true, message: "Commission cancelled" });
    } else {
      res.status(400).json({ ok: false, error: "Commission not found or not cancellable" });
    }
  } catch (error) {
    console.error("[Commission Service] Error cancelling commission:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((err, req, res, next) => {
  console.error("[Commission Service] Unhandled error:", err);
  res.status(500).json({
    ok: false,
    error: "Internal server error",
    message: err.message,
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════╗
  ║   ALGTP™ Commission Service                   ║
  ║   Running on http://localhost:${PORT}         ║
  ║   Environment: ${process.env.NODE_ENV || "development"}              ║
  ║   Database: commissions.db                     ║
  ║   14-day auto-release enabled                  ║
  ╚════════════════════════════════════════════════╝
  
  Endpoints:
  - GET  /health
  - POST /webhook (Stripe)
  - GET  /api/saler/:salerId/commissions
  - GET  /api/commission/:commissionId
  - GET  /api/commissions/ready
  - POST /api/commission/create
  - POST /api/commission/:commissionId/cancel
  `);
});

export default app;
