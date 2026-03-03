/**
 * ALGTP™ Commission Tracking System
 * 14-day hold + auto release
 * NO MANUAL INTERVENTION
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, "commissions.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ============================================================================
// COMMISSION TABLE
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Stripe data
    invoice_id TEXT NOT NULL UNIQUE,
    subscription_id TEXT,
    customer_id TEXT NOT NULL,
    charge_id TEXT,
    
    -- Saler data
    saler_id TEXT NOT NULL,
    user_email TEXT,
    
    -- Money
    plan TEXT NOT NULL,
    price_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    commission_rate INTEGER NOT NULL DEFAULT 65,
    commission_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    
    -- Status: PENDING | PAID | CANCELLED | DISPUTED
    status TEXT NOT NULL DEFAULT 'PENDING',
    
    -- Timing (14-day hold)
    created_at INTEGER NOT NULL,
    release_at INTEGER NOT NULL,
    paid_at INTEGER,
    cancelled_at INTEGER,
    
    -- Stripe Connect (if using connected accounts)
    connected_account TEXT,
    transfer_id TEXT,
    
    -- Metadata
    cancellation_reason TEXT,
    notes TEXT,
    
    FOREIGN KEY (saler_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
  CREATE INDEX IF NOT EXISTS idx_commissions_release_at ON commissions(release_at);
  CREATE INDEX IF NOT EXISTS idx_commissions_saler_id ON commissions(saler_id);
  CREATE INDEX IF NOT EXISTS idx_commissions_invoice_id ON commissions(invoice_id);
`);

// ============================================================================
// COMMISSION LOG (Audit trail)
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS commission_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commission_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    
    FOREIGN KEY (commission_id) REFERENCES commissions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_logs_commission_id ON commission_logs(commission_id);
`);

// ============================================================================
// CREATE COMMISSION (on invoice.paid)
// ============================================================================
export function createCommission({
  invoiceId,
  subscriptionId,
  customerId,
  chargeId,
  salerId,
  userEmail,
  plan,
  priceId,
  amountCents,
  commissionRate = 65,
  connectedAccount = null,
}) {
  const commissionCents = Math.round((amountCents * commissionRate) / 100);
  const now = Math.floor(Date.now() / 1000);
  const releaseAt = now + 14 * 24 * 60 * 60; // +14 days

  const stmt = db.prepare(`
    INSERT INTO commissions (
      invoice_id, subscription_id, customer_id, charge_id,
      saler_id, user_email,
      plan, price_id, amount_cents, commission_rate, commission_cents,
      status, created_at, release_at, connected_account
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
  `);

  const result = stmt.run(
    invoiceId,
    subscriptionId || null,
    customerId,
    chargeId || null,
    salerId,
    userEmail || null,
    plan,
    priceId,
    amountCents,
    commissionRate,
    commissionCents,
    now,
    releaseAt,
    connectedAccount
  );

  logCommissionAction(result.lastInsertRowid, "CREATED", null, "PENDING", "14-day hold started");

  return result.lastInsertRowid;
}

// ============================================================================
// GET COMMISSIONS READY FOR RELEASE
// ============================================================================
export function getReadyCommissions() {
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    SELECT * FROM commissions
    WHERE status = 'PENDING'
      AND release_at <= ?
    ORDER BY release_at ASC
  `);

  return stmt.all(now);
}

// ============================================================================
// MARK AS PAID
// ============================================================================
export function markCommissionPaid(commissionId, transferId) {
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    UPDATE commissions
    SET status = 'PAID', paid_at = ?, transfer_id = ?
    WHERE id = ?
  `);

  stmt.run(now, transferId || null, commissionId);
  logCommissionAction(commissionId, "PAID", "PENDING", "PAID", `Transfer: ${transferId || "N/A"}`);
}

// ============================================================================
// CANCEL COMMISSION (refund/dispute)
// ============================================================================
export function cancelCommission(commissionId, reason) {
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    UPDATE commissions
    SET status = 'CANCELLED', cancelled_at = ?, cancellation_reason = ?
    WHERE id = ? AND status = 'PENDING'
  `);

  const result = stmt.run(now, reason, commissionId);

  if (result.changes > 0) {
    logCommissionAction(commissionId, "CANCELLED", "PENDING", "CANCELLED", reason);
  }

  return result.changes > 0;
}

// ============================================================================
// MARK AS DISPUTED
// ============================================================================
export function markCommissionDisputed(commissionId, reason) {
  const stmt = db.prepare(`
    UPDATE commissions
    SET status = 'DISPUTED', cancellation_reason = ?
    WHERE id = ?
  `);

  stmt.run(reason, commissionId);
  logCommissionAction(commissionId, "DISPUTED", "PENDING", "DISPUTED", reason);
}

// ============================================================================
// GET COMMISSION BY ID
// ============================================================================
export function getCommissionById(commissionId) {
  const stmt = db.prepare(`
    SELECT * FROM commissions WHERE id = ? LIMIT 1
  `);

  return stmt.get(commissionId);
}

// ============================================================================
// GET COMMISSION BY INVOICE ID
// ============================================================================
export function getCommissionByInvoiceId(invoiceId) {
  const stmt = db.prepare(`
    SELECT * FROM commissions WHERE invoice_id = ? LIMIT 1
  `);

  return stmt.get(invoiceId);
}

// ============================================================================
// GET ALL COMMISSIONS FOR SALER
// ============================================================================
export function getCommissionsBySalerId(salerId, status = null) {
  let sql = `SELECT * FROM commissions WHERE saler_id = ?`;
  const params = [salerId];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY created_at DESC`;

  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

// ============================================================================
// GET COMMISSION STATS FOR SALER
// ============================================================================
export function getCommissionStats(salerId) {
  const stmt = db.prepare(`
    SELECT
      status,
      COUNT(*) as count,
      SUM(commission_cents) as total_cents
    FROM commissions
    WHERE saler_id = ?
    GROUP BY status
  `);

  const rows = stmt.all(salerId);

  const stats = {
    pending: { count: 0, amount: 0 },
    paid: { count: 0, amount: 0 },
    cancelled: { count: 0, amount: 0 },
    disputed: { count: 0, amount: 0 },
  };

  rows.forEach(row => {
    const key = row.status.toLowerCase();
    if (stats[key]) {
      stats[key].count = row.count;
      stats[key].amount = row.total_cents / 100;
    }
  });

  return stats;
}

// ============================================================================
// LOG COMMISSION ACTION
// ============================================================================
function logCommissionAction(commissionId, action, oldStatus, newStatus, reason) {
  const stmt = db.prepare(`
    INSERT INTO commission_logs (commission_id, action, old_status, new_status, reason)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(commissionId, action, oldStatus || null, newStatus || null, reason || null);
}

// ============================================================================
// GET COMMISSION LOGS
// ============================================================================
export function getCommissionLogs(commissionId) {
  const stmt = db.prepare(`
    SELECT * FROM commission_logs
    WHERE commission_id = ?
    ORDER BY created_at DESC
  `);

  return stmt.all(commissionId);
}

export default db;
