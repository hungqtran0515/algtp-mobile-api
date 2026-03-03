# 🧪 Cap Scanner Testing Guide

Complete guide to testing the Large/Mid/Small Cap Scanner implementation.

## Quick Start

### 1. Start the Server
```bash
npm start
# Server should start on http://localhost:3000
```

### 2. Run Automated Tests
```bash
# Shell script (requires jq)
./test-cap-scanners.sh

# OR Node.js test suite
node test-cap-scanners.js
```

## Manual Testing Checklist

### ✅ Backend API Tests

#### Test 1: Large Cap Scanner
```bash
# Tier 1: VWAP Cross Trigger
curl "http://localhost:3000/scan-largecap?tier=1&limit=100" | jq

# Tier 2: VWAP Hold Confirm
curl "http://localhost:3000/scan-largecap?tier=2&limit=100" | jq

# Tier 3: HOD/PM Break Entry
curl "http://localhost:3000/scan-largecap?tier=3&limit=100" | jq
```

**Expected Response:**
```json
{
  "ok": true,
  "tier": 1,
  "boxId": "LC-TRIG",
  "capType": "large",
  "incomingCount": 5,
  "incomingSymbols": ["NVDA", "TSLA"],
  "boxes": [{
    "boxId": "LC-TRIG",
    "title": "Large Cap • VWAP Cross Trigger",
    "items": ["NVDA", "TSLA", "AAPL", ...]
  }],
  "ts": 1707941476000
}
```

#### Test 2: Mid Cap Scanner
```bash
curl "http://localhost:3000/scan-midcap?tier=1&limit=100" | jq
curl "http://localhost:3000/scan-midcap?tier=2&limit=100" | jq
curl "http://localhost:3000/scan-midcap?tier=3&limit=100" | jq
```

#### Test 3: Small Cap Scanner
```bash
curl "http://localhost:3000/scan-smallcap?tier=1&limit=100" | jq
curl "http://localhost:3000/scan-smallcap?tier=2&limit=100" | jq
curl "http://localhost:3000/scan-smallcap?tier=3&limit=100" | jq
```

### ✅ Frontend UI Tests

#### Test 4: Dashboard UI
1. Navigate to `http://localhost:3000/ui`
2. Login with Google OAuth (if required)
3. Verify **3 boxes** appear (not 9):
   - 🔵 Large Cap Scanner
   - 🟡 Mid Cap Scanner
   - 🟠 Small Cap Scanner

#### Test 5: Tier Selector UI
For **each box**, verify:
- ✅ 3 tier buttons in box header: **T1**, **T2**, **T3**
- ✅ Active tier has **purple gradient** background
- ✅ Inactive tiers have **dark gray** background
- ✅ Clicking a tier button **highlights** it
- ✅ Clicking a tier button **reloads** box data
- ✅ Status shows: "X tickers • HH:MM:SS"

#### Test 6: Tier Switching
1. **Click T1** → Box shows VWAP Cross results
2. **Click T2** → Box shows VWAP Hold results
3. **Click T3** → Box shows HOD/PM Break results
4. **Refresh page** → Last selected tier is remembered (localStorage)

#### Test 7: Data Display
Each box should show:
- ✅ Symbol column with clickable links
- ✅ Price, Open, Prev columns
- ✅ Gap% column (calculated correctly)
- ✅ VWAP column (technical indicator)
- ✅ Volume column
- ✅ Float(M) and Float% columns

### ✅ Access Control Tests

#### Test 8: Tier Locking
1. Logout from dashboard
2. Try accessing: `http://localhost:3000/scan-largecap?tier=1`
3. **Expected**: 403 Forbidden or redirect to login
4. Login with **FREE14** account
5. **Expected**: 403 Forbidden (BASIC tier required)
6. Login with **BASIC** account
7. **Expected**: 200 OK with data

## Data Validation Tests

### Test 9: Filter Logic Validation

#### Large Cap Tier 1 (VWAP Cross):
- **Market Cap**: ≥ $10B
- **Volume**: ≥ 1M
- **VWAP Distance**: +0.5% to +2% above VWAP
- **Gap%**: ≥ 1.0%

```bash
curl "http://localhost:3000/scan-largecap?tier=1" | jq '.boxes[0].items[]' | head -10
```

#### Large Cap Tier 2 (VWAP Hold):
- **Market Cap**: ≥ $10B
- **Volume**: ≥ 2M
- **VWAP Distance**: +2% to +8% above VWAP

#### Large Cap Tier 3 (HOD/PM Break):
- **Market Cap**: ≥ $10B
- **Volume**: ≥ 3M
- **Gap%**: ≥ 5.0%

### Test 10: Cap Classification Validation

```bash
# Get sample data and verify market caps
curl "http://localhost:3000/scan-largecap?tier=1" | jq '.boxes[0].items[]' | xargs -I {} curl "http://localhost:3000/scan?symbols={}" | jq '.results[] | {symbol, marketCapB, cap}'

# Verify:
# - Large cap: marketCapB >= 10
# - Mid cap: marketCapB >= 2 and < 10
# - Small cap: marketCapB >= 0.3 and < 2
```

## Performance Tests

### Test 11: Response Time
```bash
time curl -s "http://localhost:3000/scan-largecap?tier=1" > /dev/null
# Should complete in < 5 seconds
```

### Test 12: Concurrent Requests
```bash
# Test all 9 endpoints simultaneously
for cap in largecap midcap smallcap; do
  for tier in 1 2 3; do
    curl -s "http://localhost:3000/scan-$cap?tier=$tier" &
  done
done
wait
echo "All requests completed"
```

## Error Handling Tests

### Test 13: Invalid Parameters
```bash
# Invalid tier (should default to 1 or error)
curl "http://localhost:3000/scan-largecap?tier=99" | jq

# Invalid cap type (should 404)
curl "http://localhost:3000/scan-invalid?tier=1" | jq

# Missing tier (should default to 1)
curl "http://localhost:3000/scan-largecap" | jq
```

### Test 14: Empty Results
During market close or with strict filters, results may be empty:
```json
{
  "ok": true,
  "tier": 1,
  "boxes": [{
    "items": []
  }]
}
```
This is **NORMAL** and not an error.

## Browser Console Tests

### Test 15: Device Session Management
1. Open browser console on `/ui`
2. Check for logs:
```
✅ Device ID loaded: abc12345...
📱 Device session initialized: abc12345...
📱 Device Session Management Ready
```

3. Test session management:
```javascript
// View active sessions
viewSessions()

// Should output:
// 📦 Active sessions: [{id: 1, deviceId: "abc123..."}]
// 🔒 Revoked sessions: []
// ⚡ Max devices: 3
```

## Troubleshooting

### Issue: "No symbols found"
**Cause**: Filters are too strict or market is closed
**Solution**: 
- Wait for market hours
- Adjust filter thresholds in `largecap_scanner.js`
- Test with known active symbols

### Issue: "BASIC_REQUIRED" error
**Cause**: User doesn't have BASIC tier subscription
**Solution**: 
- Login with BASIC/PRO account
- Or remove `requireBasic` middleware for testing

### Issue: "Missing VWAP indicator"
**Cause**: `ENABLE_5M_INDICATORS=false` in .env
**Solution**: Set `ENABLE_5M_INDICATORS=true` and restart server

### Issue: UI shows 9 boxes instead of 3
**Cause**: Old FEATURE_REGISTRY definition
**Solution**: Verify lines 10641-10648 in server.js show only 3 boxes

### Issue: Tier buttons not working
**Cause**: JavaScript error in `renderCapScannerBox`
**Solution**: Check browser console for errors

## Success Criteria

✅ **All 9 endpoints** return 200 OK  
✅ **Response structure** matches expected format  
✅ **3 boxes** appear in UI (not 9)  
✅ **Tier selectors** work in each box  
✅ **Active tier** highlighted with purple gradient  
✅ **localStorage** persists selected tier  
✅ **Data enrichment** includes VWAP, Gap%, Float%  
✅ **Access control** locks to BASIC tier  
✅ **No JavaScript errors** in browser console  
✅ **Device session** initializes correctly  

## Test Report Template

```
Cap Scanner Test Report
Date: ___________
Tester: ___________

Backend Tests:
[ ] Large Cap Tier 1/2/3 - Pass/Fail
[ ] Mid Cap Tier 1/2/3 - Pass/Fail
[ ] Small Cap Tier 1/2/3 - Pass/Fail

Frontend Tests:
[ ] 3 boxes visible - Pass/Fail
[ ] Tier selectors work - Pass/Fail
[ ] Active tier highlighted - Pass/Fail
[ ] Data display correct - Pass/Fail

Performance:
[ ] Response time < 5s - Pass/Fail
[ ] Concurrent requests ok - Pass/Fail

Notes:
____________________________
____________________________
```

## Next Steps

After all tests pass:
1. Deploy to production
2. Monitor for errors in production logs
3. Gather user feedback on tier filters
4. Adjust thresholds based on usage patterns
5. Consider adding more tiers or cap categories
