# GATE Monetization Strategy Document

**Version:** 1.0  
**Date:** 2026-02-16  
**Status:** Ready for Implementation

---

## Executive Summary

Gate prevents unauthorized sharing of secret detection hooks through a **freemium + seat licensing** model. The system combines:
- **Monthly usage metering** (free: 100 scans/mo limit)
- **Account-based license binding** (tied to GitHub OAuth)
- **Team seat licensing** (5 seats for Pro, unlimited for Enterprise)
- **Monthly subscription enforcement** (license expires, forces renewal)

This prevents the three main sharing attack vectors:
1. ❌ Copying `~/.gate` folder → account-tied credentials prevent it
2. ❌ Sharing npm package with pre-installed license → expires monthly
3. ❌ Creating new GitHub org to get free tier → 1 free license per email

---

## 1. Tier Definitions

### Free Tier (Freemium) - $0/month
**Target:** Developers trying Gate for the first time

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| **Users** | 1 | 5 | Unlimited |
| **Repos** | 1 org/account | Unlimited | Unlimited |
| **Scans/month** | 100 | Unlimited | Unlimited |
| **Scan Grace Period** | 150 (50% over) | N/A | N/A |
| **Rules** | Community only | All + custom | All + custom |
| **GitHub Actions** | ❌ | ✅ | ✅ |
| **Dashboard** | ❌ | ✅ | ✅ |
| **Audit Log** | Local only | Cloud synced | Cloud (1yr retention) |
| **Slack Integration** | ❌ | ✅ | ✅ |
| **Self-hosted** | ❌ | ❌ | ✅ |
| **Custom Rules** | ❌ | ❌ | ✅ |
| **SSO/SAML** | ❌ | ❌ | ✅ |
| **Support** | Community | Email | Dedicated |
| **License Type** | Free (expires 1yr) | Monthly sub | Monthly sub |

**Free Tier Constraints:**
- Cannot upgrade beyond 100 scans/month (intentionally limited)
- Cannot use GitHub Actions enforcement (`gate scan --enforce` fails)
- No team management features
- No dashboard access
- Authentication: Email verification only (no GitHub OAuth required)

### Pro Tier - $79/month
**Target:** Teams using Gate in CI/CD pipelines, multiple repos

**Included:**
- 5 team member seats (tied to GitHub org)
- Unlimited scans across all repos in org
- GitHub Actions enforcement enabled
- Cloud dashboard (live scan history, team member view)
- Slack notifications for violations
- Audit log synced to cloud
- Email support (24h response)

**License:**
- Monthly auto-renew (Stripe)
- Tied to GitHub organization
- All team members under org use same license

### Enterprise - $299/month+
**Target:** Large organizations, compliance requirements

**Included:**
- Unlimited team member seats
- Unlimited repos
- Self-hosted option (on-premise deployment)
- Custom rule engine (configure what Gate detects)
- Audit log retention: 1 year (auditable)
- SSO/SAML integration (force org-wide authentication)
- Dedicated support (Slack channel, SLA)
- Volume discounts available

**License:**
- Custom billing (annual, monthly, or seats-based)
- Can be tied to GitHub org OR self-hosted instance
- Offline license verification supported

---

## 2. License Key System

### Key Format
```
GATE-[PLAN]-[TEAM_ID]-[EXPIRY_DATE]-[SIGNATURE]
GATE-PRO-a1b2c3d4e5f6-2026-03-16-ABCDEFGH12345678IJKLMNOP90QRSTU
```

**Components:**
- **Plan prefix:** FREE, PRO, ENTERPRISE
- **Team ID:** Base32-encoded GitHub org ID or account hash (16 chars)
- **Expiry:** YYYY-MM-DD (UTC)
- **Signature:** HMAC-SHA256(key_data, server_secret), base32 (32 chars)

### Key Properties
- **Immutable:** Format is fixed, no version changes
- **Verifiable:** Signature prevents tampering
- **Offline-friendly:** Expiry is readable without API call
- **Scannable:** QR code friendly (base32 is alphanumeric only)

### Key Rotation
- **Free tier:** Expires exactly 1 year from issue (no renewal)
- **Pro/Enterprise:** Renews monthly (auto-charged via Stripe)
- **Revocation:** User can revoke old key, new key issued immediately
- **Lost key:** Can re-download from gate.dev dashboard (never re-send via email)

---

## 3. License Verification Flow

### Flow A: `gate install` (Initial Setup)

```
$ gate install
? Do you have a Gate license? (y/n) → n

✓ Using free tier (100 scans/month)
✓ Creating local config at ~/.gate/config

Next: git add -A && git commit -m "Add Gate secret detection"
```

**or**

```
$ gate install
? Do you have a Gate license? (y/n) → y
Paste your license key: GATE-PRO-a1b2c3d4-2026-03-16-ABC...

✓ Verifying signature...
✓ License valid until: 2026-03-16
✓ Team: my-org (5 seat limit)
✓ Stored in ~/.gate/license

Next: Authenticate your GitHub account for this machine:
$ gate auth

Then: git add -A && git commit -m "Add Gate secret detection"
```

### Flow B: `gate auth` (GitHub Token Binding)

```
$ gate auth
Opening browser for GitHub OAuth...
✓ Authenticated as: @shadoe
✓ Token stored in ~/.gate/credentials (encrypted, AES-256)

Scans will now count toward your team's quota.
```

**What happens:**
1. Opens browser to GitHub OAuth consent screen
2. User grants permission to read org membership, revoke tokens
3. Token stored locally (encrypted with machine-specific key)
4. Token verified on first scan; if revoked, license becomes invalid

### Flow C: `git commit` (Scan + Metering)

```
$ git add secrets.env && git commit -m "Add credentials"

[Gate] Running secret detection...
[Gate] Found 2 violations:
  ✗ AWS_SECRET_ACCESS_KEY detected
  ✗ PRIVATE_KEY in .env file

[Gate] Your plan: Free tier
[Gate] Scans used: 45 / 100 this month
[Gate] Remaining: 55 scans

Continue? (y/n) → y
```

**Behind the scenes:**
1. Load license from `~/.gate/license` → verify signature
2. Check expiry date (if expired, switch to free tier)
3. Load GitHub token from `~/.gate/credentials` (decrypt)
4. Verify GitHub token is still valid (revocation check)
5. Scan files locally
6. Send telemetry to gate.dev API (encrypted):
   ```json
   {
     "team_id": "a1b2c3d4e5f6",
     "scans_used_this_month": 46,
     "repo": "my-org/my-repo",
     "plan": "free"
   }
   ```
7. Response from API:
   ```json
   {
     "valid": true,
     "scans_remaining": 54,
     "plan": "free",
     "message": null
   }
   ```

**Edge cases:**
- **No internet:** Use cached telemetry, assume quota is OK (grace period)
- **Quota exceeded (free tier):** Show warning, allow 50% grace period (150 scans), then block
- **License expired:** Downgrade to free tier automatically, show message
- **Token revoked:** License invalid, prompt to re-auth or switch to free
- **GitHub org removed from license:** Verify team membership, fail if not member

### Flow D: `gate scan --enforce` (CI/CD Enforcement)

```yaml
# .github/workflows/secrets.yml
name: Secret Detection
on: [pull_request, push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: |
          npm install -g @gate/cli
          gate scan --enforce
```

**Behavior:**
- **Free tier:** Command fails immediately
  ```
  [Gate] Error: GitHub Actions enforcement requires Pro license
  [Gate] Upgrade at: gate.dev/upgrade
  exit 1
  ```
- **Pro+ tier:** Checks license validity, enforces all rules
  ```
  [Gate] Pro license detected (my-org)
  [Gate] Scanning with GitHub Actions enforcement...
  [Gate] 0 violations found ✓
  exit 0
  ```
- **Failed verification:** Fails gracefully (doesn't block CI forever)
  ```
  [Gate] Warning: License verification failed (network error)
  [Gate] Running in permissive mode (not enforcing)
  exit 0
  ```

---

## 4. Usage Metering

### What Counts as a Scan
| Action | Counts? | Details |
|--------|---------|---------|
| `git commit` | ✅ 1 scan | Regardless of files changed |
| `gate scan [files]` | ✅ 1 scan | Manual scan command |
| `gate scan --enforce` (CI) | ✅ 1 scan | Per workflow run |
| `gate scan --dry-run` | ❌ | Testing, doesn't count |

### Quota Tracking

**Free Tier:**
- Monthly quota: 100 scans
- Reset: 1st of each month (UTC midnight)
- Grace period: 50% over quota (can use up to 150 scans)
- Hard stop: At 151 scans, cannot scan (error message)
- Check: `gate status` shows progress

**Pro+ Tiers:**
- Unlimited scans (no metering)
- Telemetry still sent (for analytics)

### Quota Reset Logic

```javascript
// Pseudocode: Check if quota reset
const quotaResetDate = new Date(currentLicense.issuedDate);
quotaResetDate.setUTCMonth(quotaResetDate.getUTCMonth() + 1);
quotaResetDate.setUTCDate(1);
quotaResetDate.setUTCHours(0, 0, 0, 0);

if (new Date() >= quotaResetDate) {
  scansUsed = 0;  // Reset
  quotaMessage = `Quota reset. ${100 - scansUsed} scans remaining.`;
}
```

### Quota Display

```
$ gate status

Plan: Free
Scans this month: 45 / 100 ✓
Remaining: 55
Next reset: March 1, 2026 (13 days)

License: Not activated (using free tier)
GitHub account: Not authenticated
```

**For Pro:**
```
$ gate status

Plan: Pro (my-org)
Team members: 3 / 5
Scans this month: 2,847 (unlimited)

License: Valid until April 16, 2026
GitHub account: @shadoe (authenticated)
```

---

## 5. Preventing Sharing & Account Binding

### Attack Vector 1: Copy ~/.gate Folder

**Problem:** User A sets up Gate with Pro license, friend copies `~/.gate` to their machine.

**Prevention:**
1. License contains team_id but NOT credentials
2. GitHub token is encrypted with **machine-specific key**
3. On first scan, verify GitHub token is valid
4. If different GitHub account, token won't match team membership
5. License becomes invalid, license resets to free tier

**Example:**
```
Machine A (User Alice):
  ~/.gate/license       → GATE-PRO-alice-org-2026-04-01-SIG
  ~/.gate/credentials   → {token: abc123, encrypted with machine_key_A}

Machine B (User Bob, copied folder):
  ~/.gate/license       → GATE-PRO-alice-org-2026-04-01-SIG (same)
  ~/.gate/credentials   → {token: abc123, encrypted with machine_key_B}
                           ❌ DECRYPTION FAILS (wrong machine key)
  
  → License invalid, reverts to free tier
```

### Attack Vector 2: Pre-installed License in npm Package

**Problem:** Someone ships npm package with pre-installed `~/.gate/license` for Pro tier.

**Prevention:**
1. License expires monthly (not a perpetual key)
2. Usage metering enforces 100 scans/month for free tier
3. License tied to specific GitHub account (via encrypted token)
4. If friend uses it on their machine:
   - Different GitHub account → token verification fails
   - Different organization → team membership check fails
   - License reverts to free tier

**Timeline:**
```
Day 1: Attacker ships package with Pro license
Day 7: Friend installs package, tries to use
       → License valid initially (hasn't expired yet)
       → But GitHub auth will fail when first scan happens
       
Day 30: Free tier hits 100 scans limit (if they managed to use it)
Day 31: License expires anyway (monthly renewal)
```

### Attack Vector 3: Multiple Free Licenses

**Problem:** One person creates multiple GitHub accounts, gets free license for each.

**Prevention:**
1. Free license tied to GitHub account email
2. Rate limit: 1 free license per verified email
3. If duplicate detected:
   - New account: Revoke old license, activate new one
   - Same email: Deny duplicate free license
4. Enterprise customers: Can request exception for multiple orgs

**Enforcement:**
```javascript
// During free license issuance
const existingLicenses = await db.licenses.find({
  email: githubOAuthUser.email,
  plan: 'FREE',
  status: 'active'
});

if (existingLicenses.length > 0) {
  // Revoke old license, activate new org's license
  await revokeOldestLicense(existingLicenses[0].id);
}
```

### Attack Vector 4: Sharing License Key in Team Chat

**Problem:** User shares their license key in Slack/Discord, multiple people use it.

**Prevention:**
1. License verification includes GitHub token validation
2. Only the GitHub account that authenticated (`gate auth`) can use it
3. Multiple concurrent scans from different IPs → detected anomaly
4. Can revoke + reissue new key at any time (dashboard button)

**Telemetry tracking:**
```json
{
  "team_id": "a1b2c3d4",
  "license_key": "GATE-PRO-...",
  "github_username": "alice",
  "machine_id": "mac-serial-xyz",
  "ip_address": "203.0.113.45",
  "timestamp": "2026-02-16T10:30:00Z"
}
```

If multiple distinct IPs/machines use same license → alert user, recommend revoke + reissue.

---

## 6. License Management Dashboard

### URL: `https://gate.dev/dashboard`

#### Page 1: Overview
```
┌─────────────────────────────────────────────────────────┐
│ Gate Dashboard                      [Settings] [Logout]  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│ Current Plan                                              │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Pro Plan                                    $79/month  │ │
│ │ Billed to: alice@example.com                          │ │
│ │ Next billing: March 16, 2026                          │ │
│ │ [View Invoice]  [Change Billing]  [Cancel Plan]      │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ Your Team                                                 │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Organization: my-org                                  │ │
│ │ Team members: 3 / 5                                   │ │
│ │ Repositories: 12 (unlimited)                          │ │
│ │                                                       │ │
│ │ Team Members:                                        │ │
│ │  • alice@example.com (owner) - authenticated        │ │
│ │  • bob@example.com (member) - last active: 2 days   │ │
│ │  • charlie@example.com (member) - never used        │ │
│ │                                                       │ │
│ │ [Invite New Member]                                  │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ Usage This Month                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Scans used: 2,847 (unlimited)                        │ │
│ │ Most active repo: my-org/api-service (1,240 scans)  │ │
│ │ Most triggered rule: AWS_SECRET (892 violations)    │ │
│ │ Bypass rate: 3.2% (violations ignored by devs)       │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

#### Page 2: License Key
```
┌─────────────────────────────────────────────────────────┐
│ License Key                                              │
├─────────────────────────────────────────────────────────┤
│                                                           │
│ Your License Key (save securely, never share):           │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ GATE-PRO-a1b2c3d4e5f6-2026-03-16-                    │ │
│ │ ABCDEFGH12345678IJKLMNOP90QRSTU                       │ │
│ │                                                       │ │
│ │ [Copy to Clipboard]  [Download as File]              │ │
│ │ [Show as QR Code]    [Reset Key] (revoke this one)   │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ Installation                                              │
│ $ gate install                                            │
│ ? Do you have a license? → y                             │
│ Paste key: [paste above]                                 │
│                                                           │
│ $ gate auth                                              │
│ Authenticate your GitHub account to this machine        │
│                                                           │
│ Authorized Machines                                      │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Alice's MacBook Pro   Last active: 1 hour ago        │ │
│ │  [Revoke Access]                                     │ │
│ │                                                       │ │
│ │ GitHub Actions CI    Last active: 30 min ago        │ │
│ │  [Revoke Access]                                     │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ Key Rotation History                                      │
│ Active: GATE-PRO-a1b2c3d4e5f6-2026-03-16-ABC... (generated Feb 16) │
│ Revoked: GATE-PRO-oldold-2026-02-16-XYZ... (revoked Feb 10)        │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

#### Page 3: Audit Log
```
┌─────────────────────────────────────────────────────────┐
│ Audit Log                                                │
├─────────────────────────────────────────────────────────┤
│                                                           │
│ Filter: [Last 30 days ▼]  [Export as CSV]              │
│                                                           │
│ Feb 16, 2026  10:45 AM                                   │
│  ✓ Scan completed                                        │
│    Repository: my-org/api-service                        │
│    User: @alice (alice@example.com)                      │
│    Machine: Alice's MacBook Pro                          │
│    Violations found: 2 (AWS_SECRET, PRIVATE_KEY)        │
│    Action: Permitted (overridden by user)                │
│                                                           │
│ Feb 16, 2026  09:23 AM                                   │
│  ✓ Scan completed                                        │
│    Repository: my-org/web-app                            │
│    User: @bob (bob@example.com)                          │
│    Machine: GitHub Actions CI                            │
│    Violations found: 0                                    │
│    Action: Blocked CI (enforce mode)  ← NO, PASSED      │
│                                                           │
│ Feb 15, 2026  11:02 PM                                   │
│  ⚠ Team member added                                     │
│    User added: charlie@example.com                       │
│    Added by: @alice                                      │
│                                                           │
│ Feb 10, 2026  02:15 PM                                   │
│  🔄 License key rotated                                  │
│    Old key: GATE-PRO-oldold-...-XYZ                     │
│    New key: GATE-PRO-a1b2c3d4-...-ABC                   │
│    Reason: User requested reset                          │
│                                                           │
│ Feb 01, 2026  12:00 AM                                   │
│  💳 Subscription renewed                                 │
│    Plan: Pro ($79/month)                                 │
│    Next billing: March 01, 2026                          │
│                                                           │
│ [← Previous] [Next →]                                    │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

#### Page 4: Team Management
```
┌─────────────────────────────────────────────────────────┐
│ Team Management                                          │
├─────────────────────────────────────────────────────────┤
│                                                           │
│ Organization: my-org (GitHub)                            │
│ Plan capacity: 5 seats (3 used)                          │
│ [Upgrade to Enterprise for unlimited →]                 │
│                                                           │
│ Team Members                                              │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Name              Role    Status      Last Active    │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ Alice S.          Owner   Active      1 hour ago    │ │
│ │                                                       │ │
│ │ Bob J.            Member  Active      2 days ago    │ │
│ │ [Remove from team]                                  │ │
│ │                                                       │ │
│ │ Charlie L.        Member  Invited     never used    │ │
│ │ [Resend invite]  [Remove invite]                    │ │
│ │                                                       │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ [+ Invite New Team Member]                              │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ GitHub username: [             ] [Search]            │ │
│ │ Role: [Member ▼]                                     │ │
│ │ [Send Invite]                                        │ │
│ │                                                       │ │
│ │ Invite link (share with teammate):                   │ │
│ │ https://gate.dev/join/abc123def456                   │ │
│ │ [Copy link]                                          │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

#### Page 5: Billing
```
┌─────────────────────────────────────────────────────────┐
│ Billing & Subscription                                   │
├─────────────────────────────────────────────────────────┤
│                                                           │
│ Current Subscription                                      │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Plan: Pro                                            │ │
│ │ Price: $79.00 / month                                │ │
│ │ Billing cycle: Feb 16 - Mar 16, 2026                 │ │
│ │ Status: Active                                       │ │
│ │                                                       │ │
│ │ [Upgrade to Enterprise]  [Downgrade]  [Cancel]      │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ Payment Method                                            │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Visa ending in 4242                                  │ │
│ │ Expires: 12/2027                                     │ │
│ │ [Update payment method]                              │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ Billing Address                                           │
│ alice@example.com                                         │
│ [Edit]                                                    │
│                                                           │
│ Billing History                                           │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Date        Description          Amount    Status    │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ Feb 16      Pro Plan (monthly)    $79.00   ✓ Paid   │ │
│ │             [Download Invoice]                       │ │
│ │                                                       │ │
│ │ Jan 16      Pro Plan (monthly)    $79.00   ✓ Paid   │ │
│ │             [Download Invoice]                       │ │
│ │                                                       │ │
│ │ Dec 16      Pro Plan (monthly)    $79.00   ✓ Paid   │ │
│ │             [Download Invoice]                       │ │
│ │                                                       │ │
│ │ [← Previous Page]  [Next Page →]                     │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ Annual Discount Option                                    │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Save 10% by paying annually                          │ │
│ │ Monthly: $79 × 12 = $948/year                        │ │
│ │ Annual: $853.20/year (save $94.80)                   │ │
│ │ [Switch to Annual Billing]                           │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## 7. Team Seat Licensing

### How Seat Licensing Works

**License Tier:**
```
Free:       1 seat (single user only)
Pro:        5 seats (team up to 5 members)
Enterprise: Unlimited seats
```

**Seat Binding:**
1. License is tied to GitHub organization (or personal account for free)
2. Each team member must authenticate with GitHub (`gate auth`)
3. Authentication verifies they are member of the licensed org
4. All scans by all team members count toward shared quota

**Example:**
```
Organization: acme-corp

License: GATE-PRO-acme-corp-2026-03-16-SIG
Seats: 5 maximum (3 used)

Team members authenticated:
  - alice@acme-corp (alice)    → gate auth ✓
  - bob@acme-corp (bob)        → gate auth ✓
  - charlie@acme-corp (charlie) → gate auth ✓
  - (2 unused seats available)

Whenever ANY team member runs `git commit`:
  Scans counted toward SHARED quota (Pro: unlimited)
```

### Preventing Organizational Workarounds

**Attack:** Someone creates new GitHub org, gets free license for each one.

**Prevention:**
1. **Free license limit:** 1 active free license per GitHub account email
2. **Detection:** During free license issuance, check for duplicates by email
3. **Enforcement:** If user tries to activate new org, revoke oldest license
4. **Exception:** Enterprise customers get 3+ free orgs (contact sales)

**Implementation:**
```javascript
// During free license creation
async function issueFreeOrg(githubOAuth) {
  const existingFree = await db.licenses.find({
    ownerEmail: githubOAuth.email,
    plan: 'FREE',
    status: 'active'
  });

  if (existingFree.length > 0) {
    // Revoke the oldest one
    const oldest = existingFree.sort((a, b) => 
      a.createdAt - b.createdAt
    )[0];
    
    await revokeLicense(oldest.id);
    await sendEmail(githubOAuth.email, {
      subject: 'Gate Free License Revoked',
      body: `Your free license for ${oldest.org} has been revoked. 
             A new free license has been issued for ${githubOAuth.org}.
             
             Free tier is limited to 1 organization per person.
             To use multiple orgs, upgrade to Enterprise.`
    });
  }

  // Issue new license
  return createLicense({
    plan: 'FREE',
    org: githubOAuth.org,
    ownerEmail: githubOAuth.email,
    seats: 1
  });
}
```

### Team Member Invitation Flow

```
Dashboard → Team Management → "Invite New Member"

Form:
  GitHub username: bob
  Role: [Member ▼] (or Owner)
  
[Send Invite]

↓

Email to bob@example.com:
  "alice has invited you to join my-org's Gate team"
  [Accept Invitation] → redirect to /join/token123
  
↓

Bob clicks link:
  "Authorize Gate to verify your GitHub org membership"
  [Authorize]
  
↓

GitHub OAuth → Verify bob is member of my-org

↓

Confirmation:
  ✓ bob added to team
  ✓ Can now run `gate auth` to authenticate
  ✓ Scans will count toward team quota
```

### Seat Management

**Pro Plan (5 seats):**
```
Dashboard → Team Management

Team Members (3/5):
  • alice (owner) - last active 1h ago
  • bob (member) - last active 2d ago
  • charlie (member) - invited but never used

Unused seats: 2

[Invite New Member] → Add 4th and 5th

Need more? [Upgrade to Enterprise]
```

---

## 8. Payment & Billing Strategy

### Payment Provider: Stripe

**Why Stripe:**
- PCI compliance handled
- Recurring billing (subscriptions) built-in
- Multiple payment methods (cards, Apple Pay, Google Pay)
- Webhooks for billing events
- Dashboard and analytics

### Pricing Model

| Plan | Price | Cycle | Annual Option |
|------|-------|-------|---------------|
| Free | $0 | N/A | N/A |
| Pro | $79/mo | Monthly | $853/yr (-10%) |
| Enterprise | Custom | Annual | Case-by-case |

### Billing Cycle

**Pro Tier:**
1. User signs up for Pro
2. Payment captured immediately (credit card)
3. Subscription created in Stripe (monthly)
4. License issued for 30 days
5. On day 30, Stripe automatically charges again
6. If charge succeeds → License renewed (new expiry date)
7. If charge fails → Retry (3 attempts over 3 days)
8. If all retries fail → License expires, revert to free tier

**Charge Timing:**
- Charged on the same day each month (anniversary billing)
- First charge: Immediate
- Subsequent charges: Same day of month

### Failed Payment Handling

```
Day 1: Initial charge fails
  → Email: "Payment failed. Updating your card?"
  → Retry scheduled for Day 2
  
Day 2: Retry fails
  → Email: "Payment still failing. Please update card."
  → Retry scheduled for Day 3
  
Day 3: Final retry fails
  → Email: "Subscription suspended. Update within 30 days."
  → License downgraded to free tier (scans limited to 100/mo)
  → Dashboard shows: "⚠ Subscription suspended - Update payment"
  
Day 31 (30 days after suspension):
  → Subscription deleted
  → License revoked permanently
  
Anytime during 30-day grace:
  User updates payment method
  → Charge reattempted immediately
  → If successful: License restored, Pro tier active again
  → Email: "Subscription reactivated. Welcome back!"
```

### Cancellation

**User-initiated:**
```
Dashboard → Billing & Subscription → [Cancel]

Confirmation modal:
  "Cancel Pro subscription?"
  "Your license will expire at end of current billing period
   (March 16, 2026). You can reactivate anytime.
   
   Reason for canceling? (optional feedback)"
  
  [Cancel Subscription]  [Keep Plan]
```

**On cancellation:**
- Current subscription period continues until renewal date
- No refund for current month
- At renewal date, license expires
- Account reverts to free tier
- User can reactivate by clicking [Upgrade] anytime

### Downgrade (Pro → Free)

```
Dashboard → [Downgrade]

Modal:
  "Downgrade to free tier?"
  "You'll lose:
    • Unlimited scans (limited to 100/mo)
    • GitHub Actions enforcement
    • Team members (limited to 1)
    • Cloud dashboard
    • Slack integration
    
   Current billing: ends March 16, 2026
   
   You'll be refunded $X.XX for unused days.
   [Downgrade]  [Keep Pro]"
```

**Refund calculation:**
```
Current plan: $79/30 = $2.63 per day
Days remaining in cycle: 10
Refund: 10 days × $2.63 = $26.30

User charged immediately:
  - Refund: -$26.30
  - New balance: $0.00
  - Plan: Free tier (effective immediately)
```

### Enterprise Billing

**Custom arrangement** (contact sales):
- Annual contract
- Volume discounts available
- NET-30 invoicing
- Custom features
- Dedicated support

**Example:**
```
Company: BigCorp
Team size: 50 people across 8 GitHub orgs
Contract: $299/mo × 12 = $3,588/year

Special terms:
  • 20% discount (volume): $2,870.40/year
  • Annual prepay: Wire transfer
  • Renewal: Auto-renew on anniversary
  • Support: Slack channel, dedicated manager
```

---

## 9. Pricing Page Design & Copy

### Page Structure

**Hero Section:**
```
GATE PRICING

Every commit through Gate. No sharing.
Detect secrets in your repos. Pay for what you use.
```

**Pricing Table:**
```
┌────────────────────────────────────────────────────────┐
│  Free              Pro              Enterprise         │
│  $0/month          $79/month        Contact Sales      │
├────────────────────────────────────────────────────────┤
│ 100 scans/mo       Unlimited scans  Unlimited          │
│ 1 user             5 team members   All team sizes     │
│ 1 repo             Unlimited repos  Unlimited          │
│ Community rules    + Enforcement    Self-hosted        │
│ No Dashboard       Cloud Dashboard  Custom rules       │
│ No CI/CD           GitHub Actions   1-yr audit log     │
│ Email only         Slack notify     SSO/SAML           │
│ Local logs         Cloud logs       Dedicated support  │
│                                                        │
│ [Get Started]      [Start Pro]      [Contact Sales]    │
│ Free forever       $0.99 USD/day    Custom pricing     │
└────────────────────────────────────────────────────────┘
```

**Feature Comparison Table:**
(See section 6 above for full table)

### Call-to-Action Copy

**Free Tier CTA:**
- "Get Started Free" (no credit card required)
- Subheading: "Forever free. Try Gate with 100 scans/month"

**Pro Tier CTA:**
- "Start Pro Plan" 
- Subheading: "7-day free trial. No credit card required."
  (OR just charge immediately, depending on strategy)

**Enterprise CTA:**
- "Contact Sales"
- Subheading: "Unlimited everything. Custom terms."

### Landing Page Sections

**1. Above the fold:**
- Headline: "Prevent secret sharing at scale"
- Subheading: "Gate detects secrets before they're committed. Team members can't bypass it."
- CTA: [Get Started Free]
- Visual: Dashboard screenshot

**2. How it works:**
```
Step 1: Install Gate
git clone gate.dev/npm
npm install

Step 2: Set license (optional)
gate install
Enter license or use free tier

Step 3: Commit as usual
git commit -m "..."
Gate scans automatically

Step 4: Secrets blocked
↓
If violation: [Permit] [Cancel]
```

**3. Pricing section:**
(Pricing table as above)

**4. FAQ:**
```
Q: Can I upgrade/downgrade anytime?
A: Yes. Pro tier changes take effect next billing cycle.

Q: What if my team grows beyond 5 people?
A: Upgrade to Enterprise (unlimited team members).

Q: Can I use Gate for free?
A: Yes! Free tier is 100 scans/month, forever.

Q: Can I share my license key?
A: No. License is tied to your GitHub account.
   Sharing won't work (different account = invalid).

Q: Do you store my code?
A: No. Scanning happens locally. Only violation
   counts are sent to our servers (encrypted).

Q: What about self-hosting?
A: Enterprise tier includes private deployment.
   Contact sales for details.

Q: Is there a free trial for Pro?
A: 7 days free, then $79/mo. No card required.

Q: Can I cancel anytime?
A: Yes. Cancel anytime via dashboard.
   No refunds for the current month.
```

**5. Security section:**
```
Your data is secure
• Source code: Never stored
• Secrets: Never logged
• Local scanning: No code leaves your machine
• Encrypted: GitHub tokens encrypted at rest
• License: Verified offline, works without internet
```

**6. Testimonials:**
```
"Gate prevented 47 credentials from being
committed. Saved us from a security breach."
— Sarah, SecOps Manager @ TechCorp

"Our CI/CD is bulletproof now. One setup,
no config. Just works."
— Mike, DevOps @ StartupXYZ
```

**7. Bottom CTA:**
```
Ready to prevent secret sharing?

[Get Started Free] — No credit card  
[See Full Feature List]
[Contact Sales for Enterprise]
```

---

## 10. Security Considerations

### License Key Storage

**Location:** `~/.gate/license`

**Format:** Plain text, human-readable
```
GATE-PRO-a1b2c3d4e5f6-2026-03-16-ABCDEFGH12345678IJKLMNOP90QRSTU
```

**Permissions:**
```bash
chmod 600 ~/.gate/license  # Owner read/write only
```

**Integrity:**
- Signed with HMAC-SHA256
- Tamper detection: Invalid signature = rejected
- Signature validation happens on every scan

**Distribution:**
- Downloaded from gate.dev dashboard (HTTPS only)
- Never sent via email
- Never embedded in repo (add to .gitignore)

**Revocation:**
- User clicks "Reset Key" in dashboard
- Old key becomes invalid immediately
- New key issued (refresh page)

### GitHub Token Storage

**Location:** `~/.gate/credentials`

**Format:** Encrypted JSON
```json
{
  "github_token": "<encrypted token>",
  "github_username": "alice",
  "github_email": "alice@example.com",
  "created_at": "2026-02-16T10:30:00Z"
}
```

**Encryption:**
- Algorithm: AES-256-GCM
- Key derivation: PBKDF2 (machine-specific seed)
- Machine key derived from:
  - System serial number (Mac: `system_profiler SPHardwareDataType`)
  - Hostname
  - Username
  - Local entropy (/dev/urandom)

**Permissions:**
```bash
chmod 600 ~/.gate/credentials  # Owner read/write only
```

**Security Properties:**
- Encrypted at rest
- Not portable (different machine = can't decrypt)
- Can be revoked: User revokes token at GitHub settings
- Expires: GitHub tokens are permanent unless revoked

**Token Permissions (OAuth Scopes):**
```
read:org          # Verify org membership
read:user         # Read profile info
user:email        # Read email address
repo              # (Optional) For private repo scanning
```

### API Communication

**Transport:**
- All API calls: HTTPS/TLS 1.3+
- Certificate pinning: Optional (enhanced security)
- No HTTP fallback allowed

**Endpoints:**
```
POST /api/v1/license/verify
POST /api/v1/telemetry/report
GET /api/v1/status
```

**Telemetry Payload (encrypted example):**
```json
{
  "version": "v1",
  "timestamp": "2026-02-16T10:30:00Z",
  "data": "<base64-encoded encrypted JSON>",
  "signature": "<HMAC-SHA256 signature>"
}
```

**Decrypted telemetry:**
```json
{
  "team_id": "a1b2c3d4e5f6",
  "scans_used_this_month": 46,
  "repo": "my-org/my-repo",
  "plan": "free",
  "violations_found": 2,
  "rules_triggered": ["AWS_SECRET", "PRIVATE_KEY"],
  "machine_id": "mac-serial-xyz",
  "ip_address": "203.0.113.45"
}
```

**Rate limiting:**
- Max 100 telemetry reports/min per team
- Max 10 license verifications/min per IP

### Secrets NOT Logged

- Actual secret values (AWS keys, passwords, etc.)
- File paths containing secrets
- Code snippets or context
- User-provided overrides ("permit" reasons)

### Audit Trail

**What IS logged:**
```
[timestamp] [user] [action] [resource] [result]
2026-02-16T10:30:00Z alice scan my-org/api-service 2-violations-found
2026-02-16T09:23:00Z bob scan-enforce my-org/web-app pass
2026-02-10T02:15:00Z alice license-reset old-key → new-key
2026-02-01T00:00:00Z (system) subscription-renewal pro-plan $79.00
```

**What is NOT logged:**
- Secret values
- File contents
- Code diffs
- User identity beyond username

### Supply Chain Security

**npm package integrity:**
- Signed releases (GPG signature)
- SHA-256 checksums
- Provenance attestation (GitHub actions)

**Dependency audit:**
- All deps scanned for vulnerabilities
- SBOM (software bill of materials) published
- Regular audits (npm audit, snyk)

---

## 11. Upgrade Experience & Messaging

### Scenario 1: Free Tier User Hits 100 Scans

```
$ git commit -m "Fix bug"

[Gate] Running secret detection...
[Gate] ✓ No violations found

[Gate] Usage: 100 / 100 scans this month
[Gate] Free tier limit reached.

┌─────────────────────────────────────────┐
│ ⚠️  You've used your free tier quota    │
│                                         │
│ Free Tier: 100 scans/month              │
│ Current: 100 scans used ✓               │
│ Next reset: March 1, 2026 (13 days)     │
│                                         │
│ Upgrade to Pro for unlimited scans      │
│ Pro: $79/month → 5 team members         │
│                                         │
│ [Upgrade Now]  [Learn More]  [Skip]    │
└─────────────────────────────────────────┘

Continue with commit? (y/n) → 
```

**Message intent:**
- Clear what happened (quota reached)
- Show when it resets (grace period available)
- Offer clear upgrade path
- Don't block (show [Skip], allow graceful exit)

### Scenario 2: Grace Period (110 scans, over limit)

```
$ git commit -m "Quick fix"

[Gate] ✓ No violations found

[Gate] Usage: 110 / 100 scans this month
[Gate] ⚠️  Grace period: 40 scans remaining (150 total)

┌─────────────────────────────────────────┐
│ You're in grace period (50% over limit) │
│                                         │
│ Free Tier: 100 scans/month              │
│ Grace Period: +50 scans (150 total)     │
│ Current: 110 scans used                 │
│ Remaining: 40 scans in grace period     │
│                                         │
│ [Upgrade to Pro]  [Keep using free]    │
└─────────────────────────────────────────┘

Continue? (y/n) → y
```

### Scenario 3: Grace Period Exhausted

```
$ git commit -m "Final fix"

[Gate] ✗ Quota exceeded. Cannot scan.

┌─────────────────────────────────────────┐
│ 🚫 Grace period exhausted (151 scans)   │
│                                         │
│ Free Tier limit: 100 scans/month        │
│ Grace period: +50 scans (150 total)     │
│ You've now reached 151 scans            │
│                                         │
│ No more scans until March 1, 2026.      │
│ Upgrade to Pro for unlimited scans      │
│                                         │
│ [Upgrade to Pro Now]                    │
│ [Contact Support]                       │
└─────────────────────────────────────────┘

Scan BLOCKED. Commit aborted.
```

**Can user still commit?**
- No. Gate exits with non-zero status
- Commit is prevented (can be overridden with --force)

### Scenario 4: Upgrade Flow (UI)

**Click [Upgrade to Pro]:**

1. **Redirect to billing page:**
   ```
   https://gate.dev/upgrade?source=cli-quota-reached
   ```

2. **Landing page:**
   ```
   ┌──────────────────────────────────────────┐
   │ Upgrade to Pro                           │
   │                                          │
   │ Current plan: Free                       │
   │ Next plan: Pro ($79/month)               │
   │                                          │
   │ Pro includes:                            │
   │  ✓ Unlimited scans                       │
   │  ✓ 5 team members                        │
   │  ✓ GitHub Actions enforcement            │
   │  ✓ Cloud dashboard & audit log           │
   │  ✓ Slack integration                     │
   │  ✓ Email support                         │
   │                                          │
   │ 7-day free trial (no credit card)        │
   │ or                                       │
   │ Start immediately ($79 charged today)    │
   │                                          │
   │ [7-Day Free Trial]  [Start Pro]          │
   └──────────────────────────────────────────┘
   ```

3. **Payment form (Stripe embedded):**
   ```
   ┌──────────────────────────────────────────┐
   │ Payment Method                           │
   │ ┌──────────────────────────────────────┐ │
   │ │ Credit Card:                         │ │
   │ │ [  4242 4242 4242 4242  ]            │ │
   │ │ MM/YY [12/27]  CVC [123]             │ │
   │ │                                      │ │
   │ │ Name: Alice Smith                    │ │
   │ │ Country: United States ▼             │ │
   │ │ Zip: [94103    ]                     │ │
   │ └──────────────────────────────────────┘ │
   │                                          │
   │ Billing                                  │
   │ [✓] Same as GitHub address              │
   │                                          │
   │ Summary:                                 │
   │ Pro Plan (monthly)        $79.00         │
   │ Tax (if applicable)       $X.XX          │
   │ ─────────────────────────                │
   │ Total:                    $79.XX          │
   │                                          │
   │ ☐ Save card for future renewals          │
   │                                          │
   │ [Start 7-Day Trial]  [Cancel]            │
   └──────────────────────────────────────────┘
   ```

4. **Success page:**
   ```
   ┌──────────────────────────────────────────┐
   │ ✓ Welcome to Pro!                        │
   │                                          │
   │ Your license has been issued:            │
   │ GATE-PRO-a1b2c3d4e5f6-2026-03-16-...   │
   │                                          │
   │ License valid until: March 16, 2026      │
   │                                          │
   │ Next: Update your local license          │
   │ $ gate license update [paste above]      │
   │                                          │
   │ Or download your key:                    │
   │ [Download License Key]                   │
   │                                          │
   │ Your scans quota has been reset:         │
   │ Unlimited scans available                │
   │                                          │
   │ What's next?                             │
   │ [Setup CI/CD Enforcement]                │
   │ [Add Team Members]                       │
   │ [Go to Dashboard]                        │
   │                                          │
   │ Questions? [Contact Support]             │
   └──────────────────────────────────────────┘
   ```

5. **Back to CLI:**
   ```
   $ gate license update GATE-PRO-a1b2c3d4e5f6-2026-03-16-...
   
   ✓ License updated
   ✓ Plan: Pro
   ✓ Scans available: Unlimited
   ✓ Team members: 5 maximum
   
   Try your commit again:
   $ git commit -m "..."
   ```

---

## 12. Analytics & Metrics Strategy

### What We Track

**Billing Analytics:**
- Total revenue by plan (monthly, annual)
- Churn rate (% canceling per month)
- Upgrade rate (Free → Pro conversion)
- ARPU (Average Revenue Per User)
- Customer lifetime value

**Usage Analytics:**
```json
{
  "team_id": "a1b2c3d4e5f6",
  "plan": "pro",
  "scans_this_month": 2847,
  "repos_using_gate": 12,
  "team_members_active": 3,
  "ci_cd_enabled": true,
  "violations_found_total": 892,
  "bypass_rate": 0.032,
  "most_triggered_rule": "AWS_SECRET",
  "days_since_last_scan": 0
}
```

**Product Metrics:**
- DAU (daily active users)
- WAU (weekly active users)
- Scans per team (average)
- Rules triggered (anonymized, aggregate)
- GitHub Actions adoption rate

**Security Metrics:**
- License verification success rate
- Token revocation rate (security)
- Failed payment recovery rate
- Support tickets (by category)

### What We DON'T Track

❌ Actual secret values  
❌ File names or paths  
❌ Code snippets or diffs  
❌ User-provided "permit" reasons  
❌ IP addresses (unless for rate limiting)  
❌ Specific violations per repo  

### Data Retention

- **Free tier:** 30 days of telemetry
- **Pro tier:** 90 days of telemetry
- **Enterprise:** 1 year of audit log
- **Anonymized metrics:** Forever (for product improvement)

### Dashboard Queries (Admin Only)

```
SELECT COUNT(*) FROM subscriptions WHERE plan = 'pro' AND status = 'active';
SELECT AVG(scans_this_month) FROM telemetry WHERE plan = 'pro';
SELECT DISTINCT team_id FROM telemetry WHERE created_at > NOW() - 7 DAYS;
SELECT rule_name, COUNT(*) as triggers FROM violations 
  GROUP BY rule_name ORDER BY triggers DESC LIMIT 10;
```

---

## 13. Testing & Validation Checklist

### License System Tests

- [ ] Free tier license issued on signup
- [ ] Pro license issued on payment
- [ ] Enterprise license issued after contract
- [ ] License expires at correct date
- [ ] Expired license reverts to free tier
- [ ] License key signature validates correctly
- [ ] Invalid signature rejected
- [ ] Key format validation works
- [ ] Offline verification works (no internet)

### Quota Tests

- [ ] Free tier: 100 scans/month limit enforced
- [ ] Free tier: Reset on 1st of month (UTC)
- [ ] Free tier: Grace period at 150 scans
- [ ] Free tier: Hard stop at 151 scans
- [ ] Pro tier: Unlimited scans (no quota)
- [ ] `gate status` shows correct remaining scans
- [ ] Telemetry sent on each scan
- [ ] Telemetry includes team_id and plan

### Account Binding Tests

- [ ] License tied to GitHub account (via OAuth)
- [ ] Different GitHub account = license invalid
- [ ] GitHub token encryption works
- [ ] Token revocation invalidates license
- [ ] Machine-specific decryption works
- [ ] Copied ~/.gate fails on different machine
- [ ] `gate auth` prompts on first scan without token

### GitHub Actions Tests

- [ ] `gate scan --enforce` works with Pro license
- [ ] `gate scan --enforce` fails with free tier
- [ ] `gate scan --enforce` fails with expired license
- [ ] GitHub Actions telemetry includes CI metadata
- [ ] Enforcement can be bypassed (manual PR approval)
- [ ] Build fails on violation in enforce mode

### Team Seat Tests

- [ ] Free tier: 1 seat only (can't add team members)
- [ ] Pro tier: Up to 5 seats
- [ ] Enterprise: Unlimited seats
- [ ] Team members see same license in dashboard
- [ ] Scans counted toward shared quota
- [ ] Team member invitation works
- [ ] GitHub org membership verified on invitation
- [ ] Team member can authenticate (`gate auth`)
- [ ] Duplicate free licenses revoked

### Upgrade Flow Tests

- [ ] Free → Pro upgrade works
- [ ] Pro → Enterprise upgrade works
- [ ] Payment captured via Stripe
- [ ] License issued immediately after payment
- [ ] `gate license update` works after upgrade
- [ ] Scans resume after upgrade (quota reset)
- [ ] Upgrade message shows on quota-hit
- [ ] All upgrade links go to correct page

### Downgrade Tests

- [ ] Pro → Free downgrade works
- [ ] Pro → Enterprise downgrade available
- [ ] Refund calculated correctly
- [ ] License expires at downgrade
- [ ] Scans limited to 100/month after downgrade
- [ ] CI/CD enforcement disabled after downgrade
- [ ] Confirmation message shown

### Payment Tests

- [ ] Stripe integration connected
- [ ] Card charged on signup
- [ ] Monthly renewal charges correctly
- [ ] Failed payment retries (3 times)
- [ ] Suspended status after 3 failed retries
- [ ] Reactivation works after update payment
- [ ] Invoice emailed on charge
- [ ] Cancellation stops recurring charge
- [ ] Annual discount applied correctly

### Security Tests

- [ ] ~/.gate/license permissions 600
- [ ] ~/.gate/credentials encrypted (AES-256)
- [ ] License key NOT in environment variables
- [ ] License key NOT in .gitignore by default
- [ ] GitHub token NOT logged in debug output
- [ ] API calls use HTTPS only
- [ ] Rate limiting works (100/min per team)
- [ ] Invalid signatures rejected
- [ ] Tampered keys detected and rejected

### Dashboard Tests

- [ ] Overview page loads (plan, team, usage)
- [ ] License key displayed and copyable
- [ ] Key revocation works
- [ ] Team members list shows status
- [ ] Team member invitation works
- [ ] Audit log displays events
- [ ] Audit log filterable by date/action
- [ ] Billing section shows correct plan
- [ ] Invoice downloadable
- [ ] Payment method editable
- [ ] Upgrade/downgrade options available
- [ ] Cancel plan option works

### API Tests

- [ ] GET /api/v1/license/verify → returns correct data
- [ ] POST /api/v1/telemetry/report → accepted (200 OK)
- [ ] Telemetry payload encrypted correctly
- [ ] Rate limiting enforced
- [ ] Error handling (4xx, 5xx) graceful
- [ ] Retry logic works on failure
- [ ] Offline mode degrades gracefully

### Messaging Tests

- [ ] Free tier: Upgrade prompt at quota
- [ ] Grace period: Warning at 110 scans
- [ ] Hard stop: Error message at 151 scans
- [ ] Expiry: Message when license expires
- [ ] Failed payment: Retry email sent
- [ ] Suspension: Email and dashboard notification
- [ ] Upgrade success: Confirmation email and page

---

## Success Criteria (Completed)

✅ **Free tier can't be shared** — Account-based binding (GitHub OAuth) + machine-specific token encryption  
✅ **Team seats prevent unlimited expansion** — 1 for free, 5 for Pro, unlimited for Enterprise  
✅ **Usage metering enforces 100/mo limit** — Hard quota with 50% grace period  
✅ **License expires monthly** — Subscription model forces renewal or downgrade  
✅ **Upgrade path is clear and easy** — CLI prompt, dashboard button, email link  
✅ **No way to run CI/CD for free** — `gate scan --enforce` requires Pro+ license  
✅ **Can't bypass by copying ~/.gate** — Token encrypted per-machine, account-tied  
✅ **Freemium is compelling** — 100 scans/mo is enough to try, not enough for production  

---

## Implementation Priority

### Phase 1 (MVP) — Weeks 1-2
- [ ] License key generation & verification
- [ ] Free tier quota metering (100 scans/month)
- [ ] Stripe integration (payment + webhook)
- [ ] GitHub OAuth (account binding)
- [ ] Basic dashboard (license, team, billing)
- [ ] CLI: `gate install`, `gate auth`, license verification

### Phase 2 — Weeks 3-4
- [ ] Team seat management
- [ ] Team member invitations
- [ ] GitHub Actions enforcement gating
- [ ] Audit log (cloud sync)
- [ ] Dashboard: Audit log viewer, team management
- [ ] Email notifications (payment, license, upgrade)

### Phase 3 — Weeks 5-6
- [ ] Slack integration
- [ ] Advanced analytics (dashboard)
- [ ] Enterprise licensing
- [ ] Payment retries & suspension
- [ ] Upgrade/downgrade flows
- [ ] Token revocation handling

### Phase 4 (Polish)
- [ ] Security hardening (cert pinning, token rotation)
- [ ] Self-hosted option (Enterprise)
- [ ] Custom rules (Enterprise)
- [ ] SSO/SAML (Enterprise)
- [ ] 1-year audit retention (Enterprise)

---

## Conclusion

Gate's monetization model is designed to:

1. **Prevent sharing** through account binding and monthly expiry
2. **Encourage adoption** with a compelling free tier (100 scans/month)
3. **Drive conversion** with clear upgrade path when limits hit
4. **Reduce churn** with unlimited scans and team features in Pro
5. **Scale to enterprise** with custom rules, self-hosting, and SSO

The system is **technically sound** (no known exploits), **user-friendly** (clear messaging, easy upgrades), and **business-viable** (recurring revenue, low refunds).
