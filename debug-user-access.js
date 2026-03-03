#!/usr/bin/env node
/**
 * DEBUG SCRIPT: Check user access logic
 * Usage: node debug-user-access.js <email>
 */

import { getUserByEmail } from './db.js';

const email = process.argv[2];

if (!email) {
  console.error('❌ Usage: node debug-user-access.js <email>');
  process.exit(1);
}

const user = getUserByEmail(email.trim().toLowerCase());

if (!user) {
  console.error(`❌ User not found: ${email}`);
  process.exit(1);
}

const now = Date.now();

console.log('\n🔍 USER ACCESS DEBUG REPORT');
console.log('═'.repeat(60));
console.log(`📧 Email: ${user.email}`);
console.log(`🆔 ID: ${user.id}`);
console.log(`👤 Name: ${user.name || '(none)'}`);
console.log(`🎫 Tier: ${user.tier}`);
console.log('');

console.log('💳 PAYMENT STATUS (DATABASE FIELDS):');
console.log('─'.repeat(60));
console.log(`is_paid (snake_case): ${user.is_paid} (type: ${typeof user.is_paid})`);
console.log(`isPaid (camelCase):   ${user.isPaid} (type: ${typeof user.isPaid})`);
console.log('');

console.log('⏰ TIMESTAMP FIELDS:');
console.log('─'.repeat(60));
console.log(`paid_until (snake_case): ${user.paid_until} → ${user.paid_until ? new Date(user.paid_until).toISOString() : 'null'}`);
console.log(`paidUntil (camelCase):   ${user.paidUntil} → ${user.paidUntil ? new Date(user.paidUntil).toISOString() : 'null'}`);
console.log(`free_until (snake_case): ${user.free_until} → ${user.free_until ? new Date(user.free_until).toISOString() : 'null'}`);
console.log(`freeUntil (camelCase):   ${user.freeUntil} → ${user.freeUntil ? new Date(user.freeUntil).toISOString() : 'null'}`);
console.log('');

console.log('🔒 ACCESS LOGIC EVALUATION:');
console.log('─'.repeat(60));

// Simulate computeAccessCountdown logic
const paidUntil = Number(user?.paid_until || user?.paidUntil || 0);
const freeUntil = Number(user?.free_until || user?.freeUntil || 0);
const isPaidFlag = (user?.is_paid === 1) || (user?.isPaid === true);
const tier = String(user?.tier || "").toUpperCase();
const isPaidTier = ["TRIAL7", "BASIC", "PRO"].includes(tier);

console.log(`paidUntil value: ${paidUntil}`);
console.log(`freeUntil value: ${freeUntil}`);
console.log(`isPaidFlag (is_paid || isPaid): ${isPaidFlag}`);
console.log(`isPaidTier (TRIAL7/BASIC/PRO): ${isPaidTier}`);
console.log('');

console.log('✅ PAID ACCESS CHECK:');
console.log(`  paidUntil > now? ${paidUntil > now} (${paidUntil} > ${now})`);
console.log(`  isPaidFlag OR isPaidTier? ${isPaidFlag || isPaidTier}`);
console.log(`  → PAID ACTIVE: ${(paidUntil > now) && (isPaidFlag || isPaidTier)}`);
console.log('');

console.log('🆓 FREE14 ACCESS CHECK:');
console.log(`  tier === "FREE14"? ${tier === "FREE14"}`);
console.log(`  freeUntil > now? ${freeUntil > now} (${freeUntil} > ${now})`);
console.log(`  → FREE14 ACTIVE: ${tier === "FREE14" && freeUntil > now}`);
console.log('');

const paidActive = (paidUntil > now) && (isPaidFlag || isPaidTier);
const freeActive = tier === "FREE14" && freeUntil > now;

if (paidActive) {
  const msLeft = paidUntil - now;
  const hours = Math.ceil(msLeft / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  console.log('🟢 RESULT: PAID ACCESS GRANTED');
  console.log(`   Mode: PAID`);
  console.log(`   Tier: ${tier}`);
  console.log(`   Expires: ${new Date(paidUntil).toISOString()}`);
  console.log(`   Time left: ${days}d ${hours % 24}h`);
} else if (freeActive) {
  const msLeft = freeUntil - now;
  const hours = Math.ceil(msLeft / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  console.log('🟡 RESULT: FREE14 ACCESS GRANTED');
  console.log(`   Mode: FREE`);
  console.log(`   Tier: FREE14`);
  console.log(`   Expires: ${new Date(freeUntil).toISOString()}`);
  console.log(`   Time left: ${days}d ${hours % 24}h`);
} else {
  console.log('🔴 RESULT: ACCESS DENIED (EXPIRED)');
  console.log(`   Mode: EXPIRED`);
  console.log(`   Tier: ${tier}`);
}

console.log('');
console.log('💡 RECOMMENDED FIXES:');
console.log('─'.repeat(60));

if (!paidActive && isPaidTier && paidUntil <= now) {
  console.log('⚠️  User has PAID tier but paidUntil has expired!');
  console.log('   → Check Stripe subscription status');
  console.log('   → Run: node fix-stripe-sync.js');
}

if (!paidActive && isPaidTier && !isPaidFlag) {
  console.log('⚠️  User has PAID tier but is_paid flag is 0!');
  console.log('   → Update database: is_paid = 1');
  console.log(`   → Run: UPDATE users SET is_paid = 1 WHERE id = ${user.id};`);
}

if (!paidActive && !freeActive && tier === "FREE14" && freeUntil <= now) {
  console.log('ℹ️  FREE14 trial has expired');
  console.log('   → User needs to upgrade to paid plan');
  console.log('   → Redirect to /pricing');
}

if (user.stripe_customer_id) {
  console.log('');
  console.log('💳 STRIPE INFO:');
  console.log(`   Customer ID: ${user.stripe_customer_id}`);
  console.log(`   Subscription ID: ${user.stripe_subscription_id || '(none)'}`);
}

console.log('');
console.log('═'.repeat(60));
console.log('✅ Debug complete\n');
