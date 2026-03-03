#!/usr/bin/env node
/**
 * Debug Premium Upgrade Issue
 * 
 * This script helps diagnose why premium features remain locked after payment.
 * 
 * Usage:
 *   node debug-premium-upgrade.js <email>
 * 
 * Example:
 *   node debug-premium-upgrade.js user@example.com
 */

import { initDB, getUserByEmail, updateUser, getUserById } from './db.js';

const email = process.argv[2];

if (!email || !email.includes('@')) {
  console.error('❌ Usage: node debug-premium-upgrade.js <email>');
  process.exit(1);
}

initDB();

console.log('\n🔍 Debugging Premium Upgrade for:', email);
console.log('='.repeat(60));

// 1. Find user
const user = await getUserByEmail(email);
if (!user) {
  console.error('\n❌ User not found:', email);
  console.log('\n💡 Possible causes:');
  console.log('  1. Email mismatch between Stripe and database');
  console.log('  2. User hasn\'t logged in yet (no account created)');
  console.log('  3. Typo in email address');
  process.exit(1);
}

console.log('\n✅ User found:');
console.log('  ID:', user.id);
console.log('  Email:', user.email);
console.log('  Name:', user.name || '(not set)');
console.log('  Google ID:', user.google_id || '(not set)');

// 2. Check tier and paid status
console.log('\n📊 Subscription Status:');
console.log('  Tier:', user.tier || '(not set)');
console.log('  is_paid:', user.is_paid, `(${typeof user.is_paid})`);
console.log('  paid_until:', user.paid_until || 0);

if (user.paid_until) {
  const paidUntilDate = new Date(user.paid_until);
  const now = new Date();
  const isExpired = paidUntilDate <= now;
  console.log('  paid_until (date):', paidUntilDate.toISOString());
  console.log('  Status:', isExpired ? '❌ EXPIRED' : '✅ ACTIVE');
  console.log('  Days left:', Math.ceil((paidUntilDate - now) / (24 * 60 * 60 * 1000)));
}

// 3. Check free trial
console.log('\n🆓 Free Trial Status:');
console.log('  free_until:', user.free_until || 0);
if (user.free_until) {
  const freeUntilDate = new Date(user.free_until);
  const now = new Date();
  const isExpired = freeUntilDate <= now;
  console.log('  free_until (date):', freeUntilDate.toISOString());
  console.log('  Status:', isExpired ? '❌ EXPIRED' : '✅ ACTIVE');
}

// 4. Check Stripe integration
console.log('\n💳 Stripe Integration:');
console.log('  stripe_customer_id:', user.stripe_customer_id || '(not set)');
console.log('  stripe_subscription_id:', user.stripe_subscription_id || '(not set)');

// 5. Diagnose issues
console.log('\n🔍 Diagnosis:');
const issues = [];
const now = Date.now();

if (!user.is_paid || user.is_paid !== 1) {
  issues.push('❌ is_paid flag not set (should be 1)');
}

if (!user.paid_until || user.paid_until === 0) {
  issues.push('❌ paid_until not set');
} else if (user.paid_until < now) {
  issues.push('⚠️  paid_until has expired');
}

if (!user.tier || user.tier === 'FREE14') {
  issues.push('⚠️  tier still set to FREE14 (should be TRIAL7/BASIC/PRO)');
}

if (!user.stripe_customer_id) {
  issues.push('⚠️  stripe_customer_id not set (webhook may not have fired)');
}

if (issues.length === 0) {
  console.log('✅ No issues found! User should have premium access.');
  
  // Check if it's just expired
  if (user.paid_until && user.paid_until < now) {
    console.log('\n⚠️  However, subscription has expired. User needs to renew.');
  }
} else {
  console.log('Found', issues.length, 'issue(s):');
  issues.forEach((issue, i) => {
    console.log(`  ${i + 1}. ${issue}`);
  });
  
  console.log('\n💡 Recommended Actions:');
  
  if (!user.stripe_customer_id) {
    console.log('  1. Check Stripe webhook logs for this user\'s email');
    console.log('  2. Verify webhook URL is configured: https://your-domain.com/stripe/webhook');
    console.log('  3. Check STRIPE_WEBHOOK_SECRET matches Stripe Dashboard');
  }
  
  if (!user.is_paid || !user.paid_until) {
    console.log('  4. Manually grant access using: node grant-paid-access.js ' + email);
  }
  
  console.log('  5. Check server logs around payment time for webhook events');
  console.log('  6. Test /debug/me endpoint after logging in as this user');
}

// 6. Test fix (optional)
console.log('\n🔧 Would you like to manually grant BASIC access? (for testing)');
console.log('   To grant access, run:');
console.log('   node grant-paid-access.js', email, 'basic 40');
console.log('');

// 7. Show what webhook should have done
console.log('📋 What Stripe webhook should have done:');
console.log('  updateUser(', user.id, ', {');
console.log('    tier: "BASIC",  // or TRIAL7 / PRO');
console.log('    isPaid: true,   // converted to is_paid = 1');
console.log('    paidUntil: ', Date.now() + (40 * 24 * 60 * 60 * 1000), ', // 40 days from now');
console.log('    stripeCustomerId: "cus_xxxxx",');
console.log('    stripeSubscriptionId: "sub_xxxxx"');
console.log('  });');

console.log('\n' + '='.repeat(60));
console.log('Debug complete.');
