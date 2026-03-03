/**
 * ALGTP™ Commission Webhook Handlers
 * 
 * Tự động track commissions khi có invoice.paid
 * Tự động cancel khi có refund/dispute
 */

import {
  createCommission,
  cancelCommission,
  markCommissionDisputed,
  getCommissionByInvoiceId,
} from "./commission-db.js";

// ============================================================================
// Commission Policy:
// - Monthly Plans ($35.99 - $55.99) → 65% Commission
// - Annual Plan ($350/year) → 40% Commission (includes 1 month FREE)
// - Verified Trial ($4.95) → NOT eligible for commission
// ============================================================================
const COMMISSION_EXCLUDED_PLANS = [
  'trial_495',
  'verified',
  'trial',
  '4.95',
];

const ANNUAL_PLAN_INDICATORS = [
  'annual',
  '350',
  'yearly',
  'year',
];

// Determine commission rate based on plan type
function getCommissionRate(plan, priceId, amountCents) {
  const planLower = String(plan || '').toLowerCase();
  const priceIdLower = String(priceId || '').toLowerCase();
  
  // Annual plans get 40% commission
  for (const indicator of ANNUAL_PLAN_INDICATORS) {
    if (planLower.includes(indicator) || priceIdLower.includes(indicator)) {
      return 40;
    }
  }
  
  // Check by amount - $350 = 35000 cents (annual)
  if (amountCents >= 30000) {
    return 40; // Annual plan
  }
  
  // Monthly plans get 65% commission
  return 65;
}

// Plans/prices that are excluded from commission (case-insensitive)
function isCommissionEligible(plan, priceId, amountCents) {
  const planLower = String(plan || '').toLowerCase();
  const priceIdLower = String(priceId || '').toLowerCase();
  
  // Exclude $4.95 Trial (amount = 495 cents)
  if (amountCents <= 500) {
    console.log(`   ⚠️  Amount $${(amountCents / 100).toFixed(2)} too low - likely Trial, skipping commission`);
    return false;
  }
  
  // Check plan name against exclusion list
  for (const excluded of COMMISSION_EXCLUDED_PLANS) {
    if (planLower.includes(excluded) || priceIdLower.includes(excluded)) {
      console.log(`   ⚠️  Plan '${plan}' is excluded from commission`);
      return false;
    }
  }
  
  return true;
}

// ============================================================================
// WEBHOOK: invoice.paid
// ============================================================================
export function handleInvoicePaid(invoice) {
  console.log(`\n💰 [WEBHOOK] invoice.paid: ${invoice.id}`);
  
  // Extract metadata from multiple sources
  // Priority: invoice.lines.metadata > invoice.subscription_details.metadata > invoice.metadata
  let metadata = {};
  
  // Try invoice metadata first
  if (invoice.metadata && Object.keys(invoice.metadata).length > 0) {
    metadata = invoice.metadata;
    console.log('   Metadata source: invoice.metadata');
  }
  
  // Try subscription metadata
  if (invoice.subscription_details?.metadata && Object.keys(invoice.subscription_details.metadata).length > 0) {
    metadata = { ...metadata, ...invoice.subscription_details.metadata };
    console.log('   Metadata source: invoice.subscription_details.metadata');
  }
  
  // Try line items metadata
  if (invoice.lines?.data?.[0]?.metadata && Object.keys(invoice.lines.data[0].metadata).length > 0) {
    metadata = { ...metadata, ...invoice.lines.data[0].metadata };
    console.log('   Metadata source: invoice.lines[0].metadata');
  }
  
  // Legacy: subscription_metadata field
  if (invoice.subscription_metadata && Object.keys(invoice.subscription_metadata).length > 0) {
    metadata = { ...metadata, ...invoice.subscription_metadata };
    console.log('   Metadata source: invoice.subscription_metadata');
  }
  
  const salerId = metadata.saler_id || metadata.salerId;
  
  console.log('   Available metadata:', JSON.stringify(metadata));
  console.log('   Extracted saler_id:', salerId || 'NONE');
  
  if (!salerId) {
    console.log("⚠️  No saler_id in metadata, skipping commission");
    return null;
  }
  
  // Get plan details
  const plan = metadata.plan || "unknown";
  const priceId = invoice.lines?.data[0]?.price?.id || "unknown";
  const amountCents = invoice.amount_paid || 0;
  
  // Check if this plan is eligible for commission
  if (!isCommissionEligible(plan, priceId, amountCents)) {
    console.log(`   🚫 Commission NOT eligible for plan: ${plan} ($${(amountCents / 100).toFixed(2)})`);
    return null;
  }
  
  // Check if commission already exists
  const existing = getCommissionByInvoiceId(invoice.id);
  if (existing) {
    console.log(`   ℹ️  Commission already exists: #${existing.id}`);
    return existing.id;
  }
  
  // Determine commission rate (65% monthly, 40% annual)
  const commissionRate = getCommissionRate(plan, priceId, amountCents);
  
  // Create commission with 14-day hold
  const commissionId = createCommission({
    invoiceId: invoice.id,
    subscriptionId: invoice.subscription || null,
    customerId: invoice.customer,
    chargeId: invoice.charge || null,
    salerId,
    userEmail: invoice.customer_email || null,
    plan,
    priceId,
    amountCents,
    commissionRate,
    connectedAccount: null, // Set if using Stripe Connect
  });
  
  const commissionAmount = (amountCents * (commissionRate / 100)) / 100;
  console.log(`   ✅ Commission created: #${commissionId} for plan: ${plan}`);
  console.log(`   💵 Amount: $${(amountCents / 100).toFixed(2)} → Commission (${commissionRate}%): $${commissionAmount.toFixed(2)}`);
  console.log(`   ⏰ Release date: ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()}`);
  
  return commissionId;
}

// ============================================================================
// WEBHOOK: invoice.voided / invoice.payment_failed
// ============================================================================
export function handleInvoiceVoided(invoice) {
  console.log(`\n❌ [WEBHOOK] invoice.voided: ${invoice.id}`);
  
  const commission = getCommissionByInvoiceId(invoice.id);
  if (!commission) {
    console.log("   ℹ️  No commission found for this invoice");
    return false;
  }
  
  if (commission.status !== "PENDING") {
    console.log(`   ⚠️  Commission already ${commission.status}`);
    return false;
  }
  
  const cancelled = cancelCommission(commission.id, "Invoice voided");
  if (cancelled) {
    console.log(`   ✅ Commission #${commission.id} cancelled`);
  }
  
  return cancelled;
}

// ============================================================================
// WEBHOOK: charge.refunded
// ============================================================================
export function handleChargeRefunded(charge) {
  console.log(`\n💸 [WEBHOOK] charge.refunded: ${charge.id}`);
  
  // Find commission by charge_id or invoice_id
  const invoiceId = charge.invoice;
  if (!invoiceId) {
    console.log("   ⚠️  No invoice ID on charge");
    return false;
  }
  
  const commission = getCommissionByInvoiceId(invoiceId);
  if (!commission) {
    console.log("   ℹ️  No commission found for this charge");
    return false;
  }
  
  if (commission.status !== "PENDING") {
    console.log(`   ⚠️  Commission already ${commission.status}`);
    return false;
  }
  
  const cancelled = cancelCommission(commission.id, "Charge refunded");
  if (cancelled) {
    console.log(`   ✅ Commission #${commission.id} cancelled`);
  }
  
  return cancelled;
}

// ============================================================================
// WEBHOOK: charge.dispute.created
// ============================================================================
export function handleDisputeCreated(dispute) {
  console.log(`\n⚠️  [WEBHOOK] charge.dispute.created: ${dispute.id}`);
  
  const chargeId = dispute.charge;
  // Note: You may need to look up the invoice from the charge
  // This is simplified - in production, fetch charge -> invoice mapping
  
  console.log(`   Charge: ${chargeId}`);
  console.log(`   Reason: ${dispute.reason}`);
  console.log(`   Amount: $${(dispute.amount / 100).toFixed(2)}`);
  
  // Mark commission as disputed (if you want to track it separately)
  // In most cases, you'd just cancel it like refunds
  
  return true;
}

// ============================================================================
// MAIN WEBHOOK ROUTER
// ============================================================================
export function handleCommissionWebhook(event) {
  const type = event.type;
  
  try {
    switch (type) {
      case "invoice.paid":
        return handleInvoicePaid(event.data.object);
      
      case "invoice.voided":
      case "invoice.payment_failed":
        return handleInvoiceVoided(event.data.object);
      
      case "charge.refunded":
        return handleChargeRefunded(event.data.object);
      
      case "charge.dispute.created":
        return handleDisputeCreated(event.data.object);
      
      default:
        console.log(`   ℹ️  Unhandled event type: ${type}`);
        return null;
    }
  } catch (error) {
    console.error(`   ❌ Error handling webhook ${type}:`, error.message);
    throw error;
  }
}
