# Gate API Specification

**Base URL:** `https://api.gate.dev/v1`  
**Authentication:** Bearer token or License key  
**Rate Limits:** 100 requests/min per team (by team_id)  

---

## Authentication

### Bearer Token
For authenticated users (OAuth):
```
Authorization: Bearer <github_access_token>
```

### License Key
For CLI operations:
```
Authorization: License <license_key>
X-Team-Id: <team_id>
```

---

## Endpoints

### 1. License Verification

**POST /license/verify**

Verify a license key signature (works offline).

**Request:**
```json
{
  "license_key": "GATE-PRO-a1b2c3d4e5f6-2026-03-16-ABCDEFGH12345678IJKLMNOP90QRSTU"
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "plan": "pro",
  "team_id": "a1b2c3d4e5f6",
  "expiry_date": "2026-03-16",
  "days_remaining": 28,
  "seats": 5,
  "seats_used": 3,
  "scans_unlimited": true,
  "features": {
    "github_actions_enforce": true,
    "cloud_dashboard": true,
    "slack_integration": true,
    "audit_log": true,
    "team_members": true
  }
}
```

**Response (400 Bad Request):**
```json
{
  "valid": false,
  "error": "Invalid key format",
  "error_code": "INVALID_KEY"
}
```

**Response (401 Unauthorized):**
```json
{
  "valid": false,
  "error": "License signature invalid",
  "error_code": "INVALID_SIGNATURE"
}
```

**Response (410 Gone):**
```json
{
  "valid": false,
  "error": "License expired",
  "error_code": "LICENSE_EXPIRED"
}
```

---

### 2. Telemetry / Usage Reporting

**POST /telemetry/report**

Report scan metrics and check quota (free tier).

**Request:**
```json
{
  "team_id": "a1b2c3d4e5f6",
  "plan": "free",
  "scans_used_this_month": 46,
  "repo": "my-org/my-repo",
  "timestamp": "2026-02-16T10:30:00Z",
  "machine_id": "mac-serial-xyz",
  "github_username": "alice"
}
```

**Note:** In production, request body is encrypted (AES-256):
```
POST /telemetry/report
Content-Type: application/json

{
  "version": "v1",
  "data": "<base64-encoded-encrypted-payload>",
  "signature": "<HMAC-SHA256-signature>",
  "timestamp": "2026-02-16T10:30:00Z"
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "plan": "free",
  "scans_remaining": 54,
  "scans_total_month": 100,
  "quota_exceeded": false,
  "in_grace_period": false,
  "message": null,
  "next_reset": "2026-03-01T00:00:00Z"
}
```

**Response (429 Too Many Scans):**
```json
{
  "valid": true,
  "plan": "free",
  "scans_remaining": 0,
  "scans_total_month": 100,
  "quota_exceeded": true,
  "in_grace_period": false,
  "message": "You've reached your free tier quota (100 scans/month). Upgrade to Pro for unlimited scans.",
  "upgrade_link": "https://gate.dev/upgrade?source=api"
}
```

**Response (429 Grace Period):**
```json
{
  "valid": true,
  "plan": "free",
  "scans_remaining": 35,
  "scans_total_month": 100,
  "quota_exceeded": false,
  "in_grace_period": true,
  "message": "You're in grace period (50% over limit). 35 scans remaining before hard stop.",
  "upgrade_link": "https://gate.dev/upgrade?source=api"
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Unauthorized",
  "error_code": "AUTH_FAILED"
}
```

---

### 3. Account / User Endpoints

**GET /account**

Get current user account info.

**Request:**
```
Authorization: Bearer <github_access_token>
```

**Response (200 OK):**
```json
{
  "id": "user-123",
  "github_username": "alice",
  "email": "alice@example.com",
  "created_at": "2026-02-01T10:00:00Z",
  "plan": "pro",
  "team": {
    "id": "a1b2c3d4e5f6",
    "name": "my-org",
    "github_org": "my-org",
    "members": 3,
    "seat_limit": 5,
    "created_at": "2026-02-01T10:00:00Z"
  },
  "license": {
    "key": "GATE-PRO-a1b2c3d4-...",
    "valid": true,
    "expiry_date": "2026-03-16",
    "days_remaining": 28
  }
}
```

---

**GET /account/teams**

List all teams user belongs to.

**Response (200 OK):**
```json
{
  "teams": [
    {
      "id": "a1b2c3d4e5f6",
      "name": "my-org",
      "github_org": "my-org",
      "role": "owner",
      "members": 3,
      "plan": "pro"
    },
    {
      "id": "b2c3d4e5f6a1",
      "name": "another-org",
      "github_org": "another-org",
      "role": "member",
      "members": 2,
      "plan": "free"
    }
  ]
}
```

---

### 4. License Endpoints

**POST /license/create**

Create a new license key (requires Pro/Enterprise plan).

**Request:**
```
Authorization: Bearer <github_access_token>

{
  "team_id": "a1b2c3d4e5f6"
}
```

**Response (200 OK):**
```json
{
  "license_key": "GATE-PRO-a1b2c3d4e5f6-2026-03-16-ABCDEFGH12345678IJKLMNOP90QRSTU",
  "plan": "pro",
  "expiry_date": "2026-03-16",
  "download_url": "https://gate.dev/api/v1/license/download",
  "message": "License key created. Save securely."
}
```

---

**POST /license/revoke**

Revoke current license key and issue a new one.

**Request:**
```
Authorization: Bearer <github_access_token>

{
  "team_id": "a1b2c3d4e5f6"
}
```

**Response (200 OK):**
```json
{
  "revoked_key": "GATE-PRO-a1b2c3d4-...",
  "new_license_key": "GATE-PRO-a1b2c3d4-...",
  "message": "Old license revoked. Use new key."
}
```

---

**GET /license/download**

Download license key as file (requires auth).

**Response:**
```
Content-Type: text/plain
Content-Disposition: attachment; filename="gate-license.txt"

GATE-PRO-a1b2c3d4e5f6-2026-03-16-ABCDEFGH12345678IJKLMNOP90QRSTU
```

---

### 5. Team Management Endpoints

**POST /team/{team_id}/members/invite**

Invite a user to team.

**Request:**
```
Authorization: Bearer <github_access_token>

{
  "github_username": "bob",
  "role": "member"
}
```

**Response (200 OK):**
```json
{
  "invitation": {
    "id": "inv-123",
    "email": "bob@example.com",
    "github_username": "bob",
    "role": "member",
    "token": "inv-token-abc123",
    "invite_link": "https://gate.dev/join/inv-token-abc123",
    "created_at": "2026-02-16T10:30:00Z",
    "expires_at": "2026-03-01T10:30:00Z"
  }
}
```

---

**GET /team/{team_id}/members**

List team members.

**Response (200 OK):**
```json
{
  "members": [
    {
      "id": "user-alice",
      "github_username": "alice",
      "email": "alice@example.com",
      "role": "owner",
      "authenticated": true,
      "last_active": "2026-02-16T10:30:00Z",
      "machine_ids": ["mac-serial-xyz"]
    },
    {
      "id": "user-bob",
      "github_username": "bob",
      "email": "bob@example.com",
      "role": "member",
      "authenticated": true,
      "last_active": "2026-02-15T14:20:00Z",
      "machine_ids": ["linux-uuid-abc"]
    },
    {
      "id": "user-charlie",
      "github_username": "charlie",
      "email": "charlie@example.com",
      "role": "member",
      "authenticated": false,
      "last_active": null,
      "machine_ids": []
    }
  ],
  "seat_limit": 5,
  "seats_used": 3
}
```

---

**DELETE /team/{team_id}/members/{user_id}**

Remove team member.

**Response (204 No Content)**

---

### 6. Subscription / Billing Endpoints

**GET /subscription**

Get current subscription details.

**Request:**
```
Authorization: Bearer <github_access_token>
```

**Response (200 OK):**
```json
{
  "subscription_id": "sub-123",
  "plan": "pro",
  "status": "active",
  "current_period_start": "2026-02-16",
  "current_period_end": "2026-03-16",
  "auto_renew": true,
  "price_per_month": 79.00,
  "currency": "USD",
  "payment_method": {
    "type": "card",
    "last4": "4242",
    "brand": "visa",
    "exp_month": 12,
    "exp_year": 2027
  },
  "next_billing_date": "2026-03-16",
  "cancel_at": null,
  "billing_history": [
    {
      "date": "2026-02-16",
      "amount": 79.00,
      "status": "paid",
      "invoice_url": "https://..."
    }
  ]
}
```

---

**POST /subscription/upgrade**

Upgrade plan.

**Request:**
```
Authorization: Bearer <github_access_token>

{
  "new_plan": "enterprise",
  "billing_cycle": "annual"
}
```

**Response (200 OK):**
```json
{
  "subscription_id": "sub-456",
  "old_plan": "pro",
  "new_plan": "enterprise",
  "proration_credit": 0.00,
  "new_monthly_price": 299.00,
  "effective_date": "2026-02-16",
  "message": "Upgraded to Enterprise. New features enabled."
}
```

---

**POST /subscription/downgrade**

Downgrade plan (Pro → Free).

**Request:**
```
Authorization: Bearer <github_access_token>

{
  "reason": "Too expensive"
}
```

**Response (200 OK):**
```json
{
  "subscription_id": null,
  "old_plan": "pro",
  "new_plan": "free",
  "refund_amount": 26.30,
  "refund_reason": "Unused days in billing cycle",
  "effective_date": "2026-02-16",
  "message": "Downgraded to Free. Refund will appear in 3-5 business days."
}
```

---

**POST /subscription/cancel**

Cancel subscription.

**Request:**
```
Authorization: Bearer <github_access_token>

{
  "reason": "No longer needed",
  "feedback": "Moving to in-house solution"
}
```

**Response (200 OK):**
```json
{
  "subscription_id": "sub-123",
  "plan": "pro",
  "status": "canceled",
  "current_period_end": "2026-03-16",
  "message": "Subscription canceled. You'll continue to have access until 2026-03-16."
}
```

---

### 7. Audit Log Endpoints

**GET /audit-log**

Get team audit log.

**Request:**
```
Authorization: Bearer <github_access_token>
?limit=50
?offset=0
?filter=scan
?date_start=2026-02-01
?date_end=2026-02-28
```

**Response (200 OK):**
```json
{
  "events": [
    {
      "id": "evt-abc123",
      "timestamp": "2026-02-16T10:30:00Z",
      "action": "scan",
      "user": {
        "id": "user-alice",
        "github_username": "alice"
      },
      "resource": {
        "type": "repository",
        "name": "my-org/api-service"
      },
      "details": {
        "violations_found": 2,
        "rules_triggered": ["AWS_SECRET", "PRIVATE_KEY"],
        "action_taken": "permitted"
      }
    },
    {
      "id": "evt-def456",
      "timestamp": "2026-02-15T14:20:00Z",
      "action": "team_member_added",
      "user": {
        "id": "user-alice",
        "github_username": "alice"
      },
      "resource": {
        "type": "team",
        "name": "my-org"
      },
      "details": {
        "member": "bob",
        "role": "member"
      }
    }
  ],
  "total": 523,
  "limit": 50,
  "offset": 0
}
```

---

**GET /audit-log/export**

Export audit log as CSV/JSON.

**Request:**
```
Authorization: Bearer <github_access_token>
?format=csv
?date_start=2026-01-01
?date_end=2026-02-28
```

**Response:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="audit-log-2026-01.csv"

timestamp,action,user,resource,details
2026-02-16T10:30:00Z,scan,alice,my-org/api-service,"violations_found=2,action=permitted"
...
```

---

### 8. Status / Health Endpoints

**GET /status**

Get API status.

**Response (200 OK):**
```json
{
  "status": "ok",
  "timestamp": "2026-02-16T10:30:00Z",
  "uptime": 99.99,
  "version": "1.2.3",
  "components": {
    "database": "ok",
    "stripe": "ok",
    "github": "ok"
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Human-readable error message",
  "error_code": "MACHINE_READABLE_CODE",
  "status": 400,
  "timestamp": "2026-02-16T10:30:00Z",
  "request_id": "req-abc123"
}
```

### Common Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| INVALID_LICENSE | 401 | License key invalid or expired |
| QUOTA_EXCEEDED | 429 | Free tier quota exceeded |
| UNAUTHORIZED | 401 | Not authenticated |
| FORBIDDEN | 403 | Not authorized for this resource |
| NOT_FOUND | 404 | Resource not found |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |
| STRIPE_ERROR | 500 | Payment processing failed |

---

## Rate Limiting

**Headers returned:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1708069800
```

**Behavior:**
- Limit: 100 requests per minute per team
- Telemetry reports count as 1 request
- License verification is free (not counted)
- Exceeding limit returns `429 Too Many Requests`

---

## Pagination

For list endpoints:

```
GET /audit-log?limit=50&offset=0

Response:
{
  "events": [...],
  "total": 523,
  "limit": 50,
  "offset": 0,
  "next_offset": 50,
  "has_more": true
}
```

---

## Timestamps

All timestamps are in ISO 8601 format (UTC):
```
2026-02-16T10:30:00Z
```

---

## Webhooks (Enterprise Only)

**Configure in dashboard:**
```
POST /webhook/configure
{
  "url": "https://your-company.com/webhooks/gate",
  "events": ["scan_violation", "license_expiry", "payment_failed"],
  "secret": "whsec_..."
}
```

**Webhook payload:**
```json
{
  "id": "evt-123",
  "timestamp": "2026-02-16T10:30:00Z",
  "type": "scan_violation",
  "team_id": "a1b2c3d4",
  "data": {
    "repository": "my-org/api-service",
    "violations": 2,
    "rules": ["AWS_SECRET"]
  }
}
```

Signature verification:
```
X-Gate-Signature: sha256=<hmac_signature>
```

---

## SDK / Client Libraries

Official SDKs:

- **Python:** `pip install gate-sdk`
- **Node.js:** `npm install @gate/sdk`
- **Go:** `go get github.com/gate/sdk-go`
- **Java:** Maven Central (coming soon)

Example (Node.js):
```javascript
const Gate = require('@gate/sdk');

const client = new Gate.Client({
  licenseKey: 'GATE-PRO-...',
  teamId: 'a1b2c3d4'
});

// Verify license
const result = await client.license.verify();
console.log(result.valid); // true

// Record scan
const quota = await client.telemetry.report({
  scansUsed: 46,
  repo: 'my-org/my-repo'
});
console.log(quota.scansRemaining); // 54
```

---

## Backwards Compatibility

**Current version:** v1

**Deprecation policy:**
- Breaking changes announced 6 months in advance
- Deprecated endpoints marked with `Deprecated-Remove-Date` header
- Old versions supported for 12 months minimum
