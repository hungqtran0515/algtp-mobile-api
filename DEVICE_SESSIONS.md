# Device Session Management with LRU Eviction

## Overview
ALGTP™ now supports **device-based session management** with automatic **LRU (Least Recently Used) eviction**:
- **Maximum 3 devices** per user
- When a 4th device logs in, the **oldest inactive device is automatically kicked**
- Each device gets a unique refresh token stored in httpOnly cookies
- Sessions are tracked in the database with timestamps

## Architecture

### Database Table: `user_sessions`
```sql
CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  refresh_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### How It Works
1. **Device Identification**: Client generates a UUID stored in `localStorage`
2. **Login**: Device ID sent via `X-Device-Id` header
3. **Session Creation**: New session created with LRU check
4. **Auto-Kick**: If >3 devices, oldest (by `last_seen_at`) is revoked
5. **Refresh Token**: httpOnly cookie set for 30 days
6. **Session Tracking**: `last_seen_at` updated on each request (future feature)

## Client-Side Implementation

### 1. Device ID Generator (Add to your login page)

```html
<script>
// Generate or retrieve device ID from localStorage
function getDeviceId() {
  const key = "algtp_device_id";
  let id = localStorage.getItem(key);
  
  if (!id) {
    // Generate new UUID
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
    console.log("🆕 New device ID generated:", id);
  } else {
    console.log("✅ Existing device ID:", id);
  }
  
  return id;
}

// Automatically send device ID with Google OAuth
document.addEventListener("DOMContentLoaded", () => {
  // Get or generate device ID on page load
  const deviceId = getDeviceId();
  
  // Store in sessionStorage for easy access
  sessionStorage.setItem("algtp_device_id", deviceId);
  
  // Add device ID to Google OAuth button
  const googleBtn = document.querySelector('a[href="/auth/google"]');
  if (googleBtn) {
    googleBtn.addEventListener("click", (e) => {
      // Device ID will be sent automatically by browser on redirect
      console.log("🔐 Logging in with device:", deviceId.slice(0, 8) + "...");
    });
  }
});
</script>
```

### 2. Send Device ID with OAuth (Already Handled Server-Side)

The server automatically reads the device ID from the session/cookie during OAuth callback.

### 3. View Active Sessions

```javascript
// Fetch user's active device sessions
async function getActiveSessions() {
  const response = await fetch("/auth/sessions", {
    credentials: "include" // Send cookies
  });
  
  const data = await response.json();
  console.log("Active sessions:", data.active);
  console.log("Revoked sessions:", data.revoked);
  console.log("Max devices allowed:", data.maxDevices);
  
  return data;
}

// Example output:
// {
//   ok: true,
//   active: [
//     {
//       id: 123,
//       deviceId: "a1b2c3d4-...",
//       createdAt: 1707941476000,
//       lastSeenAt: 1707941876000
//     }
//   ],
//   revoked: [],
//   maxDevices: 3
// }
```

### 4. Manually Revoke a Session

```javascript
// Revoke a specific device session
async function revokeSession(sessionId) {
  const response = await fetch("/auth/revoke-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "include",
    body: JSON.stringify({ sessionId })
  });
  
  const data = await response.json();
  console.log(data.message); // "Session revoked successfully"
}
```

## API Endpoints

### GET `/auth/sessions`
View all device sessions for the logged-in user.

**Response:**
```json
{
  "ok": true,
  "active": [
    {
      "id": 1,
      "deviceId": "abc123...",
      "createdAt": 1707941476000,
      "lastSeenAt": 1707941876000
    }
  ],
  "revoked": [],
  "maxDevices": 3
}
```

### POST `/auth/revoke-session`
Manually revoke a device session.

**Request:**
```json
{
  "sessionId": 1
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Session revoked successfully"
}
```

### GET `/logout`
Logout current session and clear refresh token cookie.

## LRU Eviction Example

### Scenario:
1. User logs in on **Device A** (iPhone) → Session 1 created
2. User logs in on **Device B** (MacBook) → Session 2 created
3. User logs in on **Device C** (iPad) → Session 3 created
4. User logs in on **Device D** (Windows PC) → **Session 1 is automatically revoked** (LRU)

### Console Output:
```
⚠️  User 42 exceeds device limit. Revoking 1 oldest session(s)...
   🔒 Revoking device: abc12345... (last seen: 2026-02-14T18:00:00.000Z)
✅ Created session for user 42, device xyz67890...
📱 Device session created for user 42, device xyz67890...
```

## Database Queries

### Check active sessions for a user:
```sql
SELECT * FROM user_sessions 
WHERE user_id = 42 AND revoked_at IS NULL 
ORDER BY last_seen_at ASC;
```

### Manually revoke a session:
```sql
UPDATE user_sessions 
SET revoked_at = strftime('%s', 'now') * 1000 
WHERE id = 123;
```

### Clean up old revoked sessions (>30 days):
```sql
DELETE FROM user_sessions 
WHERE revoked_at IS NOT NULL 
  AND revoked_at < (strftime('%s', 'now') * 1000) - (30 * 24 * 60 * 60 * 1000);
```

## Configuration

Maximum devices can be changed in `device-sessions.js`:

```javascript
const MAX_DEVICES = 3; // Change to your desired limit
```

## Testing

### 1. Test LRU Eviction
```bash
# Login from 4 different devices (browsers)
# The 1st device should be automatically logged out

# Check sessions via API
curl http://localhost:3000/auth/sessions -H "Cookie: algtp.sid=..."
```

### 2. Test Manual Revocation
```bash
# Get session ID from /auth/sessions
# Revoke it
curl -X POST http://localhost:3000/auth/revoke-session \
  -H "Content-Type: application/json" \
  -H "Cookie: algtp.sid=..." \
  -d '{"sessionId": 123}'
```

## Security Features

✅ **httpOnly cookies** - Refresh tokens can't be accessed by JavaScript  
✅ **Secure flag** - HTTPS-only in production  
✅ **SameSite: lax** - CSRF protection  
✅ **Hashed tokens** - Only SHA-256 hash stored in database  
✅ **30-day expiry** - Automatic cleanup of old sessions  
✅ **LRU eviction** - Prevents session hoarding  

## Future Enhancements

- [ ] Middleware to update `last_seen_at` on every authenticated request
- [ ] Push notifications when a device is kicked (email/SMS)
- [ ] "Trust this device" option to prevent eviction
- [ ] Session activity logs (IP address, user agent)
- [ ] Manual "logout all devices" button
- [ ] Refresh token rotation for extra security
