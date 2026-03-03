// ============================================================================
// Database Module — SQLite User Management for ALGTP™
// ============================================================================
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, 'algtp.db');
let db = null;

// ============================================================================
// Initialize Database
// ============================================================================
export function initDB() {
  if (db) return db;
  
  console.log(`📦 Initializing database at: ${DB_PATH}`);
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // Better performance for concurrent reads
  
  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar TEXT,
      tier TEXT DEFAULT 'FREE14',
      is_paid INTEGER DEFAULT 0,
      paid_until INTEGER DEFAULT 0,
      free_start_at INTEGER,
      free_until INTEGER,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stripe_setup_intent_id TEXT,
      card_verified INTEGER DEFAULT 0,
      card_verified_at INTEGER,
      selected_box_id TEXT,
      saler_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_users_saler_id ON users(saler_id);
    
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      UNIQUE(user_id, symbol),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
    CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist(symbol);
    
    -- Sales Accounts Table (Admin/Sales role system)
    CREATE TABLE IF NOT EXISTS sales_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      saler_id TEXT UNIQUE NOT NULL,
      role TEXT DEFAULT 'SALES',
      commission INTEGER DEFAULT 65,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    
    CREATE INDEX IF NOT EXISTS idx_sales_accounts_email ON sales_accounts(email);
    CREATE INDEX IF NOT EXISTS idx_sales_accounts_saler_id ON sales_accounts(saler_id);
    
    -- Invites Table (TradingView-style invite system)
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      product TEXT DEFAULT 'both',
      invited_by_admin_id INTEGER,
      invited_by_sales_id INTEGER,
      status TEXT DEFAULT 'pending',
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
    CREATE INDEX IF NOT EXISTS idx_invites_token_hash ON invites(token_hash);
    CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status);
    
    -- Access Grants Table (feature-level permissions)
    CREATE TABLE IF NOT EXISTS access_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      feature_key TEXT NOT NULL,
      granted_by_admin_id INTEGER,
      expires_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      UNIQUE(user_id, feature_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_access_grants_user_id ON access_grants(user_id);
    CREATE INDEX IF NOT EXISTS idx_access_grants_feature_key ON access_grants(feature_key);
    
    -- Access Requests Table (users request access, admin approves)
    CREATE TABLE IF NOT EXISTS access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      name TEXT,
      product TEXT DEFAULT 'tradingview',
      message TEXT,
      status TEXT DEFAULT 'pending',
      reviewed_by_admin_id INTEGER,
      reviewed_at INTEGER,
      admin_notes TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    
    CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email);
    CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
    
  `);
  
  // Migration: Add invited_by_sales_id column if it doesn't exist
  try {
    const columns = db.prepare("PRAGMA table_info(invites)").all();
    const hasColumn = columns.some(col => col.name === 'invited_by_sales_id');
    if (!hasColumn) {
      db.exec('ALTER TABLE invites ADD COLUMN invited_by_sales_id INTEGER');
      console.log('✅ Migration: Added invited_by_sales_id to invites table');
    }
  } catch (e) {
    // Column might already exist, ignore error
  }
  
  // Migration: Add invited_by_saler_id column (TEXT for partner saler_id string)
  try {
    const columns = db.prepare("PRAGMA table_info(invites)").all();
    const hasColumn = columns.some(col => col.name === 'invited_by_saler_id');
    if (!hasColumn) {
      db.exec('ALTER TABLE invites ADD COLUMN invited_by_saler_id TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_invites_saler_id ON invites(invited_by_saler_id)');
      console.log('✅ Migration: Added invited_by_saler_id to invites table');
    }
  } catch (e) {
    // Column might already exist, ignore error
  }
  
  // Migration: Add tv_username column for TradingView indicator access
  try {
    const columns = db.prepare("PRAGMA table_info(invites)").all();
    const hasColumn = columns.some(col => col.name === 'tv_username');
    if (!hasColumn) {
      db.exec('ALTER TABLE invites ADD COLUMN tv_username TEXT');
      console.log('✅ Migration: Added tv_username to invites table');
    }
  } catch (e) {
    // Column might already exist, ignore error
  }
  
  // Migration: Add card_verified columns to users table
  try {
    const userColumns = db.prepare("PRAGMA table_info(users)").all();
    const hasCardVerified = userColumns.some(col => col.name === 'card_verified');
    if (!hasCardVerified) {
      db.exec('ALTER TABLE users ADD COLUMN card_verified INTEGER DEFAULT 0');
      db.exec('ALTER TABLE users ADD COLUMN card_verified_at INTEGER');
      db.exec('ALTER TABLE users ADD COLUMN stripe_setup_intent_id TEXT');
      console.log('✅ Migration: Added card_verified columns to users table');
    }
  } catch (e) {
    // Columns might already exist, ignore error
  }
  
  console.log('✅ Database initialized');
  return db;
}

// Get database instance
function getDB() {
  if (!db) initDB();
  return db;
}

// ============================================================================
// User Queries
// ============================================================================

/**
 * Get user by Google ID
 */
export function getUserByGoogleId(googleId) {
  const stmt = getDB().prepare('SELECT * FROM users WHERE google_id = ?');
  return stmt.get(googleId) || null;
}

/**
 * Get user by ID
 */
export function getUserById(id) {
  const stmt = getDB().prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id) || null;
}

/**
 * Get user by email
 * Email is normalized (trimmed + lowercased) for case-insensitive matching
 */
export function getUserByEmail(email) {
  if (!email) return null;
  // Normalize: trim whitespace + lowercase for case-insensitive matching
  const normalizedEmail = String(email).trim().toLowerCase();
  const stmt = getDB().prepare('SELECT * FROM users WHERE LOWER(email) = ?');
  return stmt.get(normalizedEmail) || null;
}

/**
 * Get user by Stripe customer ID
 */
export function getUserByStripeCustomerId(customerId) {
  const stmt = getDB().prepare('SELECT * FROM users WHERE stripe_customer_id = ?');
  return stmt.get(customerId) || null;
}

/**
 * Create new user
 * @param {Object} userData
 * @param {string} userData.googleId - Google OAuth ID
 * @param {string} userData.email - User email
 * @param {string} userData.name - User display name
 * @param {string} userData.avatar - User avatar URL
 * @param {string} userData.tier - Subscription tier (FREE14, TRIAL7, BASIC, PRO)
 * @param {number} userData.freeStartAt - Free trial start timestamp (ms)
 * @param {number} userData.freeUntil - Free trial end timestamp (ms)
 */
export function createUser(userData) {
  const now = Date.now();
  const stmt = getDB().prepare(`
    INSERT INTO users (
      google_id, email, name, avatar, tier,
      free_start_at, free_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    userData.googleId,
    userData.email,
    userData.name || null,
    userData.avatar || null,
    userData.tier || 'FREE14',
    userData.free_start_at || userData.freeStartAt || now,
    userData.free_until || userData.freeUntil || (now + 14 * 24 * 60 * 60 * 1000),
    now,
    now
  );
  
  console.log(`✅ Created user: ${userData.email} (ID: ${result.lastInsertRowid})`);
  return getUserById(result.lastInsertRowid);
}

/**
 * Update user
 * @param {number} userId - User ID
 * @param {Object} updates - Fields to update
 */
export function updateUser(userId, updates) {
  const allowedFields = [
    'tier', 'is_paid', 'paid_until', 'free_start_at', 'free_until',
    'stripe_customer_id', 'stripe_subscription_id', 'stripe_setup_intent_id',
    'card_verified', 'card_verified_at',
    'selected_box_id', 'name', 'avatar', 'saler_id'
  ];
  
  const fields = [];
  const values = [];
  
  // 🔍 DEBUG: Log incoming updates
  console.log(`🔧 [updateUser] User ID: ${userId}`);
  console.log(`🔧 [updateUser] Incoming updates:`, Object.keys(updates));
  
  for (const [key, value] of Object.entries(updates)) {
    // Convert camelCase to snake_case
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    
    // 🔍 DEBUG: Log conversion
    console.log(`🔧 [updateUser] ${key} → ${snakeKey} = ${value}`);
    
    if (allowedFields.includes(snakeKey)) {
      fields.push(`${snakeKey} = ?`);
      
      // ✅ CRITICAL FIX: Convert boolean to integer for is_paid field
      // SQLite INTEGER column requires 0/1, not true/false
      let finalValue = value;
      if (snakeKey === 'is_paid') {
        finalValue = value ? 1 : 0;
        console.log(`🔧 [updateUser] Converting isPaid: ${value} → is_paid: ${finalValue}`);
      }
      
      values.push(finalValue);
    } else {
      console.warn(`⚠️  [updateUser] Field "${snakeKey}" not in allowedFields, skipping`);
    }
  }
  
  if (fields.length === 0) {
    console.warn('⚠️  [updateUser] No valid fields to update');
    return getUserById(userId);
  }
  
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(userId);
  
  const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
  
  // 🔍 DEBUG: Log SQL query
  console.log(`🔧 [updateUser] SQL:`, sql);
  console.log(`🔧 [updateUser] Values:`, values);
  
  const stmt = getDB().prepare(sql);
  const result = stmt.run(...values);
  
  console.log(`✅ [updateUser] Updated ${result.changes} row(s)`);
  
  const updatedUser = getUserById(userId);
  console.log(`🔧 [updateUser] User after update:`, {
    id: updatedUser.id,
    tier: updatedUser.tier,
    is_paid: updatedUser.is_paid,
    paid_until: updatedUser.paid_until,
    stripe_customer_id: updatedUser.stripe_customer_id ? '(set)' : null,
  });
  
  return updatedUser;
}

/**
 * Get all users (for admin/debugging)
 */
export function getAllUsers() {
  const stmt = getDB().prepare('SELECT * FROM users ORDER BY created_at DESC');
  return stmt.all();
}

/**
 * Delete user (for testing/admin)
 */
export function deleteUser(userId) {
  const stmt = getDB().prepare('DELETE FROM users WHERE id = ?');
  const result = stmt.run(userId);
  return result.changes > 0;
}

/**
 * Get user stats
 */
export function getUserStats() {
  const total = getDB().prepare('SELECT COUNT(*) as count FROM users').get().count;
  const paid = getDB().prepare('SELECT COUNT(*) as count FROM users WHERE is_paid = 1').get().count;
  const free = total - paid;
  
  const byTier = getDB().prepare(`
    SELECT tier, COUNT(*) as count 
    FROM users 
    GROUP BY tier
  `).all();
  
  return { total, paid, free, byTier };
}

/**
 * Get all users referred by a saler
 * @param {string} salerId - Saler ID
 * @returns {Array} Array of users
 */
export function getUsersBySalerId(salerId) {
  if (!salerId) return [];
  const stmt = getDB().prepare('SELECT * FROM users WHERE saler_id = ? ORDER BY created_at DESC');
  return stmt.all(salerId);
}

// ============================================================================
// Watchlist Queries
// ============================================================================

/**
 * Get user's watchlist symbols
 * @param {number} userId - User ID
 * @returns {string[]} Array of symbols
 */
export function getWatchlist(userId) {
  const stmt = getDB().prepare('SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY created_at DESC');
  const rows = stmt.all(userId);
  return rows.map(r => r.symbol);
}

/**
 * Add symbol to user's watchlist
 * @param {number} userId - User ID
 * @param {string} symbol - Stock symbol
 */
export function addToWatchlist(userId, symbol) {
  const stmt = getDB().prepare(`
    INSERT OR IGNORE INTO watchlist (user_id, symbol, created_at)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(userId, symbol.toUpperCase(), Date.now());
  return result.changes > 0;
}

/**
 * Remove symbol from user's watchlist
 * @param {number} userId - User ID
 * @param {string} symbol - Stock symbol
 */
export function removeFromWatchlist(userId, symbol) {
  const stmt = getDB().prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?');
  const result = stmt.run(userId, symbol.toUpperCase());
  return result.changes > 0;
}

/**
 * Get watchlist count for user
 * @param {number} userId - User ID
 * @returns {number} Count of symbols
 */
export function getWatchlistCount(userId) {
  const stmt = getDB().prepare('SELECT COUNT(*) as count FROM watchlist WHERE user_id = ?');
  return stmt.get(userId)?.count || 0;
}

/**
 * Clear user's entire watchlist
 * @param {number} userId - User ID
 */
export function clearWatchlist(userId) {
  const stmt = getDB().prepare('DELETE FROM watchlist WHERE user_id = ?');
  const result = stmt.run(userId);
  return result.changes;
}

// Box subscriptions removed - simplified to single $35.99/month plan only

// ============================================================================
// Sales Accounts Queries (Admin/Sales Role System)
// ============================================================================

/**
 * Get sales account by email
 * @param {string} email - Sales account email
 * @returns {Object|null} Sales account or null
 */
export function getSalesAccountByEmail(email) {
  if (!email) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  const stmt = getDB().prepare('SELECT * FROM sales_accounts WHERE LOWER(email) = ?');
  return stmt.get(normalizedEmail) || null;
}

/**
 * Get sales account by saler_id
 * @param {string} salerId - Saler ID
 * @returns {Object|null} Sales account or null
 */
export function getSalesAccountBySalerId(salerId) {
  if (!salerId) return null;
  const stmt = getDB().prepare('SELECT * FROM sales_accounts WHERE saler_id = ?');
  return stmt.get(salerId) || null;
}

/**
 * Get sales account by ID
 * @param {number} id - Sales account ID
 * @returns {Object|null} Sales account or null
 */
export function getSalesAccountById(id) {
  const stmt = getDB().prepare('SELECT * FROM sales_accounts WHERE id = ?');
  return stmt.get(id) || null;
}

/**
 * Get all sales accounts
 * @param {boolean} activeOnly - If true, only return active accounts
 * @returns {Array} Array of sales accounts
 */
export function getAllSalesAccounts(activeOnly = false) {
  const sql = activeOnly 
    ? 'SELECT * FROM sales_accounts WHERE is_active = 1 ORDER BY created_at DESC'
    : 'SELECT * FROM sales_accounts ORDER BY created_at DESC';
  const stmt = getDB().prepare(sql);
  return stmt.all();
}

/**
 * Create new sales account
 * @param {Object} data - Sales account data
 * @param {string} data.email - Email address
 * @param {string} data.name - Display name
 * @param {string} data.salerId - Unique saler ID
 * @param {string} data.role - 'ADMIN' or 'SALES'
 * @param {number} data.commission - Commission percentage (default 65)
 * @returns {Object} Created sales account
 */
export function createSalesAccount(data) {
  const now = Date.now();
  const stmt = getDB().prepare(`
    INSERT INTO sales_accounts (email, name, saler_id, role, commission, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  
  const result = stmt.run(
    String(data.email || '').trim().toLowerCase(),
    String(data.name || '').trim(),
    String(data.salerId || data.saler_id || '').trim(),
    String(data.role || 'SALES').toUpperCase(),
    Number(data.commission || 65),
    now,
    now
  );
  
  console.log(`✅ Created sales account: ${data.email} (ID: ${result.lastInsertRowid})`);
  return getSalesAccountById(result.lastInsertRowid);
}

/**
 * Update sales account
 * @param {number} id - Sales account ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated sales account
 */
export function updateSalesAccount(id, updates) {
  const allowedFields = ['email', 'name', 'saler_id', 'role', 'commission', 'is_active'];
  
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    
    if (allowedFields.includes(snakeKey)) {
      fields.push(`${snakeKey} = ?`);
      values.push(snakeKey === 'email' ? String(value).trim().toLowerCase() : value);
    }
  }
  
  if (fields.length === 0) {
    return getSalesAccountById(id);
  }
  
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  
  const sql = `UPDATE sales_accounts SET ${fields.join(', ')} WHERE id = ?`;
  const stmt = getDB().prepare(sql);
  stmt.run(...values);
  
  console.log(`✅ Updated sales account ID: ${id}`);
  return getSalesAccountById(id);
}

/**
 * Delete sales account
 * @param {number} id - Sales account ID
 * @returns {boolean} True if deleted
 */
export function deleteSalesAccount(id) {
  const stmt = getDB().prepare('DELETE FROM sales_accounts WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Check if email is a valid active sales account
 * @param {string} email - Email to check
 * @returns {boolean} True if valid active sales account
 */
export function isActiveSalesAccount(email) {
  const account = getSalesAccountByEmail(email);
  return account && account.is_active === 1;
}

/**
 * Get sales account stats
 * @returns {Object} Stats object
 */
export function getSalesAccountStats() {
  const total = getDB().prepare('SELECT COUNT(*) as count FROM sales_accounts').get().count;
  const active = getDB().prepare('SELECT COUNT(*) as count FROM sales_accounts WHERE is_active = 1').get().count;
  const admins = getDB().prepare('SELECT COUNT(*) as count FROM sales_accounts WHERE role = "ADMIN"').get().count;
  const sales = getDB().prepare('SELECT COUNT(*) as count FROM sales_accounts WHERE role = "SALES"').get().count;
  
  return { total, active, inactive: total - active, admins, sales };
}

// ============================================================================
// Invite System Functions (TradingView-style)
// ============================================================================

/**
 * Generate a secure invite token
 * @returns {Object} { token, tokenHash }
 */
export function generateInviteToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/**
 * Hash a token for lookup
 * @param {string} token - Plain token
 * @returns {string} Token hash
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create invite
 * @param {Object} data
 * @param {string} data.email - Email to invite
 * @param {string} data.product - 'scanner' | 'tradingview' | 'both'
 * @param {string} data.tvUsername - TradingView username (for TV indicator access)
 * @param {number} data.expiresInDays - Days until expiry
 * @param {number} data.invitedByAdminId - Admin user ID (optional)
 * @param {number} data.invitedBySalesId - Sales account ID (optional, numeric)
 * @param {string} data.invitedBySalerId - Partner saler_id (optional, string)
 * @returns {Object} { invite, token }
 */
export function createInvite(data) {
  const { token, tokenHash } = generateInviteToken();
  const expiresAt = Date.now() + (data.expiresInDays || 7) * 24 * 60 * 60 * 1000;
  
  const stmt = getDB().prepare(`
    INSERT INTO invites (email, token_hash, product, tv_username, invited_by_admin_id, invited_by_sales_id, invited_by_saler_id, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  
  const result = stmt.run(
    String(data.email).trim().toLowerCase(),
    tokenHash,
    data.product || 'both',
    data.tvUsername || null,
    data.invitedByAdminId || null,
    data.invitedBySalesId || null,
    data.invitedBySalerId || null,
    expiresAt
  );
  
  const createdBy = data.invitedBySalerId 
    ? `Partner ${data.invitedBySalerId}` 
    : data.invitedBySalesId 
      ? `Sales ID ${data.invitedBySalesId}` 
      : `Admin ID ${data.invitedByAdminId}`;
  const tvInfo = data.tvUsername ? ` (TV: ${data.tvUsername})` : '';
  console.log(`✉️ Created invite for: ${data.email}${tvInfo} by ${createdBy} (ID: ${result.lastInsertRowid})`);
  return { invite: getInviteById(result.lastInsertRowid), token };
}

/**
 * Get invite by ID
 */
export function getInviteById(id) {
  const stmt = getDB().prepare('SELECT * FROM invites WHERE id = ?');
  return stmt.get(id) || null;
}

/**
 * Get invite by token hash
 */
export function getInviteByTokenHash(tokenHash) {
  const stmt = getDB().prepare('SELECT * FROM invites WHERE token_hash = ?');
  return stmt.get(tokenHash) || null;
}

/**
 * Get invite by token (plain token)
 */
export function getInviteByToken(token) {
  const tokenHash = hashToken(token);
  return getInviteByTokenHash(tokenHash);
}

/**
 * Get all invites
 */
export function getAllInvites() {
  const stmt = getDB().prepare('SELECT * FROM invites ORDER BY created_at DESC');
  return stmt.all();
}

/**
 * Get invites by sales account ID
 * @param {number} salesId - Sales account ID
 * @returns {Array} Invites created by this sales person
 */
export function getInvitesBySalesId(salesId) {
  const stmt = getDB().prepare('SELECT * FROM invites WHERE invited_by_sales_id = ? ORDER BY created_at DESC');
  return stmt.all(salesId);
}

/**
 * Get invites by partner saler_id (string)
 * @param {string} salerId - Partner saler_id string
 * @returns {Array} Invites created by this partner
 */
export function getInvitesBySalerId(salerId) {
  const stmt = getDB().prepare('SELECT * FROM invites WHERE invited_by_saler_id = ? ORDER BY created_at DESC');
  return stmt.all(salerId);
}

/**
 * Get invite stats for a sales account
 * @param {number} salesId - Sales account ID
 * @returns {Object} Stats for this sales person's invites
 */
export function getSalesInviteStats(salesId) {
  const total = getDB().prepare('SELECT COUNT(*) as count FROM invites WHERE invited_by_sales_id = ?').get(salesId).count;
  const pending = getDB().prepare('SELECT COUNT(*) as count FROM invites WHERE invited_by_sales_id = ? AND status = "pending"').get(salesId).count;
  const accepted = getDB().prepare('SELECT COUNT(*) as count FROM invites WHERE invited_by_sales_id = ? AND status = "accepted"').get(salesId).count;
  const expired = getDB().prepare('SELECT COUNT(*) as count FROM invites WHERE invited_by_sales_id = ? AND (status = "expired" OR (status = "pending" AND expires_at < ?))').get(salesId, Date.now()).count;
  
  return { total, pending, accepted, expired };
}

/**
 * Get invites by email
 */
export function getInvitesByEmail(email) {
  const stmt = getDB().prepare('SELECT * FROM invites WHERE LOWER(email) = ? ORDER BY created_at DESC');
  return stmt.all(String(email).trim().toLowerCase());
}

/**
 * Get pending invites for email
 */
export function getPendingInviteForEmail(email) {
  const stmt = getDB().prepare(`
    SELECT * FROM invites 
    WHERE LOWER(email) = ? AND status = 'pending' AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `);
  return stmt.get(String(email).trim().toLowerCase(), Date.now()) || null;
}

/**
 * Accept invite
 * @param {string} token - Plain invite token
 * @param {number} userId - User ID accepting the invite
 * @returns {Object|null} Updated invite or null if invalid
 */
export function acceptInvite(token, userId) {
  const invite = getInviteByToken(token);
  
  if (!invite) {
    console.log(`❌ Invalid invite token`);
    return null;
  }
  
  if (invite.status !== 'pending') {
    console.log(`❌ Invite already ${invite.status}`);
    return null;
  }
  
  if (invite.expires_at < Date.now()) {
    // Mark as expired
    const stmt = getDB().prepare('UPDATE invites SET status = "expired" WHERE id = ?');
    stmt.run(invite.id);
    console.log(`❌ Invite expired`);
    return null;
  }
  
  // Accept the invite
  const stmt = getDB().prepare('UPDATE invites SET status = "accepted", accepted_at = ? WHERE id = ?');
  stmt.run(Date.now(), invite.id);
  
  // Grant access based on product
  if (invite.product === 'scanner' || invite.product === 'both') {
    grantAccess(userId, 'scanner_pro', invite.invited_by_admin_id);
  }
  if (invite.product === 'tradingview' || invite.product === 'both') {
    grantAccess(userId, 'tv_indicators', invite.invited_by_admin_id);
  }
  
  console.log(`✅ Invite accepted for user ${userId}`);
  return getInviteById(invite.id);
}

/**
 * Revoke invite
 */
export function revokeInvite(id) {
  const stmt = getDB().prepare('UPDATE invites SET status = "revoked" WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Get invite stats
 */
export function getInviteStats() {
  const total = getDB().prepare('SELECT COUNT(*) as count FROM invites').get().count;
  const pending = getDB().prepare('SELECT COUNT(*) as count FROM invites WHERE status = "pending"').get().count;
  const accepted = getDB().prepare('SELECT COUNT(*) as count FROM invites WHERE status = "accepted"').get().count;
  const expired = getDB().prepare('SELECT COUNT(*) as count FROM invites WHERE status = "expired" OR (status = "pending" AND expires_at < ?)').get(Date.now()).count;
  const revoked = getDB().prepare('SELECT COUNT(*) as count FROM invites WHERE status = "revoked"').get().count;
  
  return { total, pending, accepted, expired, revoked };
}

// ============================================================================
// Access Grants Functions
// ============================================================================

/**
 * Grant access to a feature
 * @param {number} userId - User ID
 * @param {string} featureKey - Feature key (e.g., 'scanner_pro', 'tv_indicators')
 * @param {number} grantedByAdminId - Admin who granted access
 * @param {number} expiresAt - Optional expiry timestamp
 */
export function grantAccess(userId, featureKey, grantedByAdminId, expiresAt = null) {
  const stmt = getDB().prepare(`
    INSERT OR REPLACE INTO access_grants (user_id, feature_key, granted_by_admin_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(userId, featureKey, grantedByAdminId, expiresAt, Date.now());
  console.log(`✅ Granted ${featureKey} access to user ${userId}`);
}

/**
 * Revoke access to a feature
 */
export function revokeAccess(userId, featureKey) {
  const stmt = getDB().prepare('DELETE FROM access_grants WHERE user_id = ? AND feature_key = ?');
  const result = stmt.run(userId, featureKey);
  return result.changes > 0;
}

/**
 * Check if user has access to feature
 * @param {number} userId - User ID
 * @param {string} featureKey - Feature key
 * @returns {boolean} True if has valid access
 */
export function hasAccess(userId, featureKey) {
  const stmt = getDB().prepare(`
    SELECT * FROM access_grants 
    WHERE user_id = ? AND feature_key = ? AND (expires_at IS NULL OR expires_at > ?)
  `);
  return stmt.get(userId, featureKey, Date.now()) !== undefined;
}

/**
 * Get all access grants for a user
 */
export function getUserAccessGrants(userId) {
  const stmt = getDB().prepare(`
    SELECT * FROM access_grants 
    WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)
  `);
  return stmt.all(userId, Date.now());
}

/**
 * Get all users with a specific feature access
 */
export function getUsersWithAccess(featureKey) {
  const stmt = getDB().prepare(`
    SELECT u.*, ag.feature_key, ag.expires_at as access_expires_at
    FROM access_grants ag
    JOIN users u ON ag.user_id = u.id
    WHERE ag.feature_key = ? AND (ag.expires_at IS NULL OR ag.expires_at > ?)
  `);
  return stmt.all(featureKey, Date.now());
}

// ============================================================================
// Access Requests Functions (User requests access, Admin approves)
// ============================================================================

/**
 * Create access request
 * @param {Object} data
 * @param {string} data.email - Requester email
 * @param {string} data.name - Requester name (optional)
 * @param {string} data.product - Product requested (default: tradingview)
 * @param {string} data.message - Optional message from requester
 * @returns {Object} Created request
 */
export function createAccessRequest(data) {
  const stmt = getDB().prepare(`
    INSERT INTO access_requests (email, name, product, message, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);
  
  const result = stmt.run(
    String(data.email).trim().toLowerCase(),
    data.name || null,
    data.product || 'tradingview',
    data.message || null,
    Date.now()
  );
  
  console.log(`📩 Access request created: ${data.email} (ID: ${result.lastInsertRowid})`);
  return getAccessRequestById(result.lastInsertRowid);
}

/**
 * Get access request by ID
 */
export function getAccessRequestById(id) {
  const stmt = getDB().prepare('SELECT * FROM access_requests WHERE id = ?');
  return stmt.get(id) || null;
}

/**
 * Get all access requests
 * @param {string} status - Filter by status (optional)
 */
export function getAllAccessRequests(status = null) {
  if (status) {
    const stmt = getDB().prepare('SELECT * FROM access_requests WHERE status = ? ORDER BY created_at DESC');
    return stmt.all(status);
  }
  const stmt = getDB().prepare('SELECT * FROM access_requests ORDER BY created_at DESC');
  return stmt.all();
}

/**
 * Get pending access requests
 */
export function getPendingAccessRequests() {
  return getAllAccessRequests('pending');
}

/**
 * Check if email has pending request
 */
export function hasPendingRequest(email) {
  const stmt = getDB().prepare('SELECT * FROM access_requests WHERE LOWER(email) = ? AND status = "pending"');
  return stmt.get(String(email).trim().toLowerCase()) !== undefined;
}

/**
 * Approve access request
 * @param {number} id - Request ID
 * @param {number} adminId - Admin user ID
 * @param {string} notes - Admin notes (optional)
 */
export function approveAccessRequest(id, adminId, notes = null) {
  const stmt = getDB().prepare(`
    UPDATE access_requests 
    SET status = 'approved', reviewed_by_admin_id = ?, reviewed_at = ?, admin_notes = ?
    WHERE id = ?
  `);
  stmt.run(adminId, Date.now(), notes, id);
  console.log(`✅ Access request ${id} approved`);
  return getAccessRequestById(id);
}

/**
 * Reject access request
 * @param {number} id - Request ID
 * @param {number} adminId - Admin user ID
 * @param {string} notes - Reason for rejection
 */
export function rejectAccessRequest(id, adminId, notes = null) {
  const stmt = getDB().prepare(`
    UPDATE access_requests 
    SET status = 'rejected', reviewed_by_admin_id = ?, reviewed_at = ?, admin_notes = ?
    WHERE id = ?
  `);
  stmt.run(adminId, Date.now(), notes, id);
  console.log(`❌ Access request ${id} rejected`);
  return getAccessRequestById(id);
}

/**
 * Get access request stats
 */
export function getAccessRequestStats() {
  const total = getDB().prepare('SELECT COUNT(*) as count FROM access_requests').get().count;
  const pending = getDB().prepare('SELECT COUNT(*) as count FROM access_requests WHERE status = "pending"').get().count;
  const approved = getDB().prepare('SELECT COUNT(*) as count FROM access_requests WHERE status = "approved"').get().count;
  const rejected = getDB().prepare('SELECT COUNT(*) as count FROM access_requests WHERE status = "rejected"').get().count;
  
  return { total, pending, approved, rejected };
}

// ============================================================================
// Cleanup
// ============================================================================
export function closeDB() {
  if (db) {
    db.close();
    db = null;
    console.log('🔒 Database connection closed');
  }
}

// Handle process termination
process.on('exit', closeDB);
process.on('SIGINT', () => {
  closeDB();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeDB();
  process.exit(0);
});
