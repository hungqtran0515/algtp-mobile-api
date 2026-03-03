/**
 * ALGTP™ Commission Auto-Release Worker
 * 
 * 🤖 BOT TỰ ĐỘNG RELEASE COMMISSION SAU 14 NGÀY
 * ❌ KHÔNG CÓ MANUAL INTERVENTION
 * 
 * Chạy cron job mỗi giờ hoặc mỗi ngày
 */

import "dotenv/config";
import Stripe from "stripe";
import {
  getReadyCommissions,
  markCommissionPaid,
  cancelCommission,
  getCommissionByInvoiceId,
} from "./commission-db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ============================================================================
// MAIN WORKER FUNCTION
// ============================================================================
export async function processCommissions() {
  console.log("\n🤖 [COMMISSION WORKER] Starting...");
  console.log("⏰ Time:", new Date().toISOString());
  
  const ready = getReadyCommissions();
  
  console.log(`📋 Found ${ready.length} commissions ready for release`);
  
  if (ready.length === 0) {
    console.log("✅ No commissions to process. Exiting.");
    return { processed: 0, success: 0, failed: 0 };
  }
  
  let success = 0;
  let failed = 0;
  
  for (const commission of ready) {
    try {
      console.log(`\n💰 Processing commission #${commission.id}`);
      console.log(`   Saler: ${commission.saler_id}`);
      console.log(`   Invoice: ${commission.invoice_id}`);
      console.log(`   Amount: $${(commission.commission_cents / 100).toFixed(2)}`);
      
      // 1. Verify invoice is still paid (no refund/void)
      const invoice = await stripe.invoices.retrieve(commission.invoice_id);
      
      if (invoice.status !== "paid") {
        console.log(`   ❌ Invoice status changed: ${invoice.status}`);
        cancelCommission(commission.id, `Invoice status: ${invoice.status}`);
        failed++;
        continue;
      }
      
      // 2. Check for disputes
      if (invoice.charge) {
        const charge = await stripe.charges.retrieve(invoice.charge);
        
        if (charge.disputed) {
          console.log(`   ⚠️  Charge disputed!`);
          cancelCommission(commission.id, "Charge disputed");
          failed++;
          continue;
        }
        
        if (charge.refunded) {
          console.log(`   ⚠️  Charge refunded!`);
          cancelCommission(commission.id, "Charge refunded");
          failed++;
          continue;
        }
      }
      
      // 3. ✅ SAFE TO RELEASE - Create transfer
      // Note: This requires Stripe Connect with connected accounts
      // If you don't use Stripe Connect, you'll need alternative payout method
      
      let transferId = null;
      
      if (commission.connected_account) {
        // Using Stripe Connect
        console.log(`   💸 Creating transfer to ${commission.connected_account}...`);
        
        const transfer = await stripe.transfers.create({
          amount: commission.commission_cents,
          currency: commission.currency,
          destination: commission.connected_account,
          metadata: {
            commission_id: String(commission.id),
            invoice_id: commission.invoice_id,
            saler_id: commission.saler_id,
            hold_days: "14",
            auto_released: "true",
          },
        });
        
        transferId = transfer.id;
        console.log(`   ✅ Transfer created: ${transferId}`);
      } else {
        // Manual payout tracking (you'll handle payout separately)
        console.log(`   📝 Marking as PAID (manual payout required)`);
        transferId = `MANUAL_${Date.now()}`;
      }
      
      // 4. Mark as paid in database
      markCommissionPaid(commission.id, transferId);
      
      console.log(`   ✅ Commission #${commission.id} RELEASED!`);
      success++;
      
    } catch (error) {
      console.error(`   ❌ Error processing commission #${commission.id}:`, error.message);
      failed++;
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log(`🤖 [COMMISSION WORKER] Complete`);
  console.log(`   Total: ${ready.length}`);
  console.log(`   ✅ Success: ${success}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log("=".repeat(60) + "\n");
  
  return { processed: ready.length, success, failed };
}

// ============================================================================
// RUN IF CALLED DIRECTLY
// ============================================================================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("🔥 ALGTP™ Commission Auto-Release Worker");
  console.log("=========================================");
  
  processCommissions()
    .then(result => {
      console.log("\n✅ Worker completed successfully");
      process.exit(0);
    })
    .catch(error => {
      console.error("\n❌ Worker failed:", error);
      process.exit(1);
    });
}
