// ============================================================================
// Device Session Management with LRU (Least Recently Used) Eviction
// ============================================================================
// Max 3 devices per user. When a 4th device logs in, kick the LRU device.
// ============================================================================

import crypto from "crypto";
import {
  createUserSession,
  getActiveSessions,
  revokeSessions
} from "./db.js";

// Maximum devices allowed per user
const MAX_DEVICES = 3;

/**
 * Hash a token using SHA-256
 * @param {string} token - Token to hash
 * @returns {string} Hex hash
 */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a cryptographically secure random token
 * @param {number} bytes - Number of bytes (default: 48)
 * @returns {string} Hex token
 */
export function generateToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Enforce maximum device limit using LRU eviction
 * When user exceeds MAX_DEVICES, kick the least recently used sessions
 * @param {number} userId - User ID
 */
export async function enforceMaxDevicesLRU(userId) {
  // Get active sessions sorted by oldest first (LRU)
  const activeSessions = getActiveSessions(userId, true);
  
  // If <= MAX_DEVICES-1, there's room for the new session
  if (activeSessions.length <= MAX_DEVICES - 1) {
    console.log(`✅ User ${userId} has ${activeSessions.length} active sessions (under limit)`);
    return;
  }
  
  // Calculate how many sessions need to be revoked
  const needRevoke = activeSessions.length - (MAX_DEVICES - 1);
  
  // Take the oldest sessions (LRU)
  const toRevoke = activeSessions.slice(0, needRevoke);
  const toRevokeIds = toRevoke.map(s => s.id);
  
  console.log(`⚠️  User ${userId} exceeds device limit. Revoking ${needRevoke} oldest session(s)...`);
  toRevoke.forEach(s => {
    console.log(`   🔒 Revoking device: ${s.device_id.slice(0, 8)}... (last seen: ${new Date(s.last_seen_at).toISOString()})`);
  });
  
  // Revoke the oldest sessions
  revokeSessions(toRevokeIds);
}

/**
 * Create a new session for user + device
 * Automatically enforces max device limit using LRU
 * @param {number} userId - User ID
 * @param {string} deviceId - Device UUID
 * @returns {object} { refreshToken, session }
 */
export async function createDeviceSession(userId, deviceId) {
  // Enforce max devices (kick LRU if needed)
  await enforceMaxDevicesLRU(userId);
  
  // Generate refresh token
  const refreshToken = generateToken(48);
  const refreshHash = hashToken(refreshToken);
  
  // Create session in database
  const session = createUserSession(userId, deviceId, refreshHash);
  
  return { refreshToken, session };
}

/**
 * Get device ID from request headers
 * @param {object} req - Express request
 * @returns {string} Device ID (max 80 chars)
 */
export function getDeviceIdFromRequest(req) {
  const deviceId = String(req.get("X-Device-Id") || req.headers["x-device-id"] || "unknown");
  return deviceId.slice(0, 80);
}

/**
 * Set refresh token cookie
 * @param {object} res - Express response
 * @param {string} refreshToken - Refresh token
 * @param {boolean} isProduction - Production environment flag
 */
export function setRefreshCookie(res, refreshToken, isProduction = false) {
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}

/**
 * Clear refresh token cookie
 * @param {object} res - Express response
 */
export function clearRefreshCookie(res) {
  res.clearCookie("refresh_token", { path: "/" });
}
