# Gate Pricing Page - Copy & Template

## Landing Page Structure

---

## 1. Hero Section

### Headline
**"Prevent secrets from being committed.  
No more breaches from careless developers."**

### Subheading
Gate detects hardcoded credentials before they reach your repo. Works offline, no configuration required. Team members can't bypass it.

### CTA Button
**[Get Started Free]** — No credit card required. 100 scans/month forever.

### Hero Image
(Screenshot of Gate CLI detecting secrets, showing violations and permit dialog)

---

## 2. Trust Indicators

### Above Pricing Table

**"Trusted by developers and security teams"**

- ✅ 1,000+ repositories secured
- ✅ 0 breaches from deployed Gates (after install)
- ✅ Works offline (no code leaves your machine)
- ✅ Open source verification (code inspection possible)

---

## 3. Pricing Table Section

### Headline
**"Simple, transparent pricing."**  
**"Every commit through Gate. No sharing."**

### Pricing Table

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  Free              Pro                Enterprise                             │
│  $0/month          $79/month           Custom pricing                        │
│  Billed monthly    or $71/mo (annual)  Contact for quote                    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ SCANS & USAGE                                                                │
│ ✓ 100 scans/month  ✓ Unlimited         ✓ Unlimited                         │
│ ✓ Community rules  ✓ All + custom rules ✓ Custom rule engine               │
│ ✗ GitHub Actions   ✓ GitHub Actions    ✓ GitHub Actions enforce            │
│                    enforcement         (all CI/CD platforms)                │
│                                                                              │
│ TEAM & COLLABORATION                                                         │
│ ✓ 1 user          ✓ 5 team members    ✓ Unlimited team members             │
│ ✓ 1 repo/org      ✓ Unlimited repos   ✓ Unlimited repos                    │
│ ✗ Team dashboard  ✓ Team dashboard    ✓ Team dashboard                      │
│ ✗ Team invites    ✓ Team invites      ✓ Team management                     │
│ ✗ Slack notify    ✓ Slack integration ✓ Slack + custom webhooks             │
│                                                                              │
│ AUDITING & COMPLIANCE                                                        │
│ ✓ Local logs      ✓ Cloud audit log   ✓ 1-year audit retention             │
│ (30 days)         (90 days)           ✓ Advanced reporting                  │
│ ✗ Cloud sync      ✓ Compliance export ✓ Compliance export                   │
│ ✗ Compliance mode ✓ Reports           ✓ SIEM integration                    │
│                                                                              │
│ DEPLOYMENT                                                                   │
│ ✓ Cloud scanning  ✓ Cloud scanning    ✓ Cloud + self-hosted                 │
│ (gate.dev)        (gate.dev)          ✓ Private deployment                  │
│ ✗ Self-hosted     ✗ Self-hosted       ✓ Isolated instances                  │
│                                                                              │
│ SUPPORT & SLA                                                                │
│ ✓ Community help  ✓ Email support     ✓ Dedicated support                   │
│ ✓ Docs & samples  ✓ 24h response      ✓ Slack channel + SLA                 │
│ ✗ SLA            ✓ Roadmap access    ✓ Feature requests                    │
│                   ✓ Bug fix priority  ✓ Priority roadmap                    │
│                                                                              │
│ PRICING                                                                      │
│ Free forever       $79/month           Starting at $299/month                │
│                    (~$0.99/day)        (custom terms)                        │
│                                                                              │
│ [Get Started Free] [Start Pro Trial]   [Contact Sales]                       │
│ No card required   Free 7 days         Enterprise SLA                        │
│                   Then $79/mo           Volume discounts                     │
│                                        Available                             │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Feature Deep-Dive Sections

### Section: "Community Rules Included"

**For Free & Pro:**
- AWS credentials
- GitHub tokens
- Private keys
- Database passwords
- API keys (Stripe, SendGrid, etc.)
- Slack/Discord tokens
- OAuth tokens
- SSH keys
- Certificates

**Free tier:** Community rules only  
**Pro+:** All community rules + enterprise rule packs

---

### Section: "GitHub Actions Enforcement"

**What it does:**
- Blocks commits with violations (in CI/CD)
- Can't be bypassed by developers
- Works with GitHub Actions, GitLab CI, Jenkins, CircleCI
- Prevents secrets from ever reaching production

**Who needs it:**
- Teams using CI/CD pipelines
- Companies with compliance requirements
- Multi-developer repos

**Pricing:**
- Free tier: ❌ Enforcement disabled
- Pro+: ✅ Enforcement enabled
- Enterprise: ✅ Enforcement on all platforms + custom rules

---

### Section: "Team Collaboration"

**Free tier (1 person):**
```
Developer works alone on their repo.
Gate scans locally on each commit.
No shared state, no team coordination.
Good for: Trying Gate, single-dev projects
```

**Pro tier (5 team members):**
```
5 developers on same org can use same license.
All scans count toward shared quota (unlimited).
Share same dashboard, audit log, rules.
Invite team members 1-click (via GitHub).
Good for: Growing teams, collaborative repos
```

**Enterprise (Unlimited):**
```
Unlimited developers across unlimited repos.
Shared dashboard, audit log, compliance reporting.
Custom rules for your org's standards.
Dedicated support, SLA, private deployment.
Good for: Large orgs, compliance-heavy, security-first
```

---

### Section: "Audit & Compliance"

**Free tier:**
- Local audit log (on your machine)
- Scans logged: violations found, actions taken
- Not stored in cloud
- No export

**Pro tier:**
- Cloud audit log (synced)
- Scans, team actions, billing events
- 90 days retention
- Exportable as CSV
- Searchable and filterable

**Enterprise:**
- Cloud audit log (synced)
- Everything in Pro + identity audit
- 1-year retention
- Advanced filtering and reports
- SIEM integration (Datadog, Splunk, etc.)
- Compliance exports (SOC 2, ISO 27001)

---

## 5. Comparison: Free vs Pro vs Enterprise

### "When Should You Upgrade?"

**Upgrade to Pro when:**
- ✅ Your team has >1 developer
- ✅ You're committing to multiple repos
- ✅ You need GitHub Actions enforcement
- ✅ You want a shared audit log
- ✅ You've hit the 100 scan/month limit
- 📅 30-day free trial (no card required)

**Upgrade to Enterprise when:**
- ✅ Your team is >5 people
- ✅ You need compliance/audit trail
- ✅ You want custom rules
- ✅ You need dedicated support
- ✅ You want to self-host
- 📞 Custom pricing, contact sales

---

## 6. FAQ Section

### Pricing FAQ

**Q: Can I upgrade or downgrade anytime?**  
A: Yes! Upgrade anytime from the dashboard. Downgrade also available (refunded prorated). Changes take effect immediately.

**Q: What if I'm in the middle of a billing cycle?**  
A: Upgrades charge immediately (no refund on old plan). Downgrades refund the unused time proportionally.

**Q: Is there a free trial for Pro?**  
A: Yes! 7 days free, full Pro features. No credit card required. After 7 days, either upgrade or revert to free tier.

**Q: Do I have to pay for every team member?**  
A: No. You pay per team (5-seat limit for Pro). Add up to 5 team members for the same $79/month.

**Q: Can team members use the license on their own repos?**  
A: Yes! All team members on the license can scan their own repos and personal projects (as long as they're part of the licensed GitHub org).

**Q: What if my team grows beyond 5?**  
A: Upgrade to Enterprise for unlimited team members. Or stay on Pro and only authenticate 5 people.

**Q: What's included in "custom pricing" for Enterprise?**  
A: Depends on your needs. Volume discounts, annual contracts, self-hosting, custom rules, SSO/SAML, etc. Contact sales to discuss.

**Q: How do I purchase a license?**  
A: Create account → connect GitHub → select plan → enter billing info (Stripe). License issued immediately.

**Q: Can I pay annually?**  
A: Yes. Pro tier: 10% discount ($853/year instead of $948). Enterprise: custom terms.

**Q: Do you offer non-profit discounts?**  
A: Yes! 50% off Pro and Enterprise for qualified non-profits. Email hello@gate.dev with non-profit docs.

**Q: Is there a free tier forever?**  
A: Yes! Free tier is 100 scans/month, forever. No expiry, no credit card required. Can't be upgraded or downgraded. Just works.

---

### Feature FAQ

**Q: Can I share my license with others?**  
A: License is tied to your GitHub account. Can't be shared to other users. If someone tries to use your key on a different account, it's invalid.

**Q: What happens if my license expires?**  
A: Pro tier licenses auto-renew monthly via Stripe. If payment fails, you have 30 days to update your card, then revert to free tier. Free tier never expires.

**Q: Can I use Gate offline?**  
A: Yes! Gate works 100% offline. Scanning happens on your machine. Telemetry is cached if no internet, then sent later.

**Q: Do you store my code or secrets?**  
A: No. Gate runs locally on your machine. Only metadata is sent (scan count, repo name, rules triggered). No code, secrets, or file names are stored.

**Q: Can I self-host Gate?**  
A: Yes, but only for Enterprise customers. Contact sales for details.

**Q: Can I export my audit logs?**  
A: Pro: Yes, as CSV (90 days). Enterprise: Yes, as CSV/JSON (1 year) + SIEM integration.

---

## 7. Conversion Elements

### CTA Buttons (Primary)

**"Get Started Free"**
- Location: Hero, pricing table (Free column)
- Destination: `/signup?plan=free`
- Color: Green/primary
- Copy: "Free forever. No card."

**"Start Pro Trial"**
- Location: Pricing table (Pro column)
- Destination: `/signup?plan=pro&trial=7`
- Color: Blue
- Copy: "7 days free, then $79/mo"

**"Contact Sales"**
- Location: Pricing table (Enterprise column)
- Destination: `/contact-sales`
- Color: Dark
- Copy: "Custom pricing"

---

### CTA Buttons (Secondary)

**"Upgrade to Pro"**
- Location: Quota-exceeded message (CLI)
- Destination: `https://gate.dev/upgrade`
- Copy: "Unlimited scans, GitHub Actions enforcement"

**"Compare All Features"**
- Location: Below pricing table
- Destination: `#features`
- Copy: "See detailed feature comparison"

**"View Roadmap"**
- Location: Enterprise section
- Destination: `/roadmap`
- Copy: "What's coming next"

---

## 8. Testimonials / Social Proof

### Quote 1
> "Gate prevented 47 AWS credentials from being committed to our main repo. Saved us from a potential breach."
> 
> — Sarah, Security Lead @ TechCorp  
> ⭐⭐⭐⭐⭐

### Quote 2
> "We tried other secret scanners. Gate is the only one that actually works in CI/CD without false positives. $79/month is a steal."
> 
> — Mike, DevOps @ StartupXYZ  
> ⭐⭐⭐⭐⭐

### Quote 3
> "Our compliance auditors were impressed. Gate exports audit logs in the format we need. Enterprise support is exceptional."
> 
> — Jennifer, Compliance Officer @ FortuneCorp  
> ⭐⭐⭐⭐⭐

---

## 9. Bottom CTA & Next Steps

### Section: "Ready to Prevent Secrets?"

**Copy:**
"Stop worrying about hardcoded credentials. Gate detects them automatically, before they're committed.

Start with free tier (100 scans/month), upgrade when you're ready."

### Buttons:
- **[Get Started Free]** — No credit card
- **[View Docs]** — Installation & setup
- **[Contact Sales]** — For Enterprise

### Footer CTA:
"Questions? [Email us](mailto:hello@gate.dev) or [join our Slack](https://slack.gate.dev)"

---

## 10. Email Templates

### Signup Confirmation

**Subject:** Welcome to Gate! Your free tier is ready.

**Body:**
```
Hi {{firstName}},

Welcome to Gate! Your account is ready.

🎉 You now have:
  • 100 scans/month (free tier)
  • Community secret detection rules
  • Local secret detection (no upload)

📖 Next: Install Gate
  $ npm install -g @gate/cli
  $ gate install

Then configure your first repo:
  $ cd my-repo
  $ git add -A && git commit -m "Add Gate"

Gate will scan automatically on every commit.

❓ Questions? Read the [docs](https://docs.gate.dev) or [reply to this email](mailto:support@gate.dev)

Happy scanning!
— The Gate Team
```

---

### Quota Exceeded (Free Tier)

**Subject:** You've hit your free tier limit (100 scans)

**Body:**
```
Hi {{firstName}},

You've used 100 scans this month (Free tier limit).

You have 2 options:

1. **Upgrade to Pro** ($79/month)
   • Unlimited scans
   • GitHub Actions enforcement
   • Team members (up to 5)
   • Cloud dashboard
   [Upgrade Now →](https://gate.dev/upgrade)

2. **Wait for reset** (March 1, 2026)
   Gate will automatically resume scanning.

Questions? [Email us](mailto:support@gate.dev) or [chat on Slack](https://slack.gate.dev)

— The Gate Team
```

---

### Payment Successful

**Subject:** Welcome to Gate Pro! 🎉

**Body:**
```
Hi {{firstName}},

✅ Payment received. You're now on Pro!

🎉 Unlock Pro features:
  • Unlimited scans
  • GitHub Actions enforcement  
  • Cloud dashboard (team view)
  • Slack notifications
  • Email support

📝 Your license key:
  GATE-PRO-{{teamId}}-{{expiryDate}}-{{signature}}

📖 Next steps:
  $ gate license update [paste key above]

Your scans quota has been reset. Scan away!

Need help? [Read the docs](https://docs.gate.dev/pro-setup) or [email support](mailto:support@gate.dev)

— The Gate Team
```

---

### Upgrade Offer (Reached Grace Period)

**Subject:** Your free trial is ending soon. Upgrade now.

**Body:**
```
Hi {{firstName}},

You're currently in **grace period** (150 scans used, limit is 100).

Your grace period expires on {{graceEndDate}}.

After that, Gate will stop scanning.

Ready to continue?

**Upgrade to Pro** ($79/month)
• Unlimited scans  
• No more quotas
• GitHub Actions enforcement  
• Team dashboard
[Upgrade Now →](https://gate.dev/upgrade?source=grace-period-email)

Questions? [Email us](mailto:support@gate.dev)

— The Gate Team
```

---

## 11. Stripe Integration Copy

### Payment Flow

**Checkout Page Headline:**
"Upgrade to Gate Pro"

**Plan Summary:**
```
Gate Pro ($79.00 USD)
✓ Unlimited scans/month
✓ 5 team members
✓ GitHub Actions enforcement
✓ Cloud dashboard
✓ Slack integration
✓ Email support

Billing: Monthly (auto-renew)
Or [Switch to annual (save 10%)]
```

**Payment Form:**
```
Credit Card Information
Card number: [____]
Expiry: [MM/YY]
CVC: [___]

Cardholder Name: [____________]
Billing Address: [____________]

☐ Save card for future renewals
[Agree to terms & conditions]

[Subscribe - $79.00/mo] [Cancel]
```

**Success Page:**
```
✅ Payment successful!

Welcome to Gate Pro!

Your license key: GATE-PRO-...
Valid until: {{expiryDate}}

Next: Update your local license
$ gate license update [paste above]

[Download License Key] [Go to Dashboard] [View Docs]
```

---

## 12. Dashboard Messaging

### Overview Dashboard

**Free Tier Banner:**
```
ℹ️ Free Tier (100 scans/month)
Scans used: 45 / 100
Next reset: March 1, 2026 (13 days)

[Upgrade to Pro] [Learn More]
```

**Pro Tier Banner:**
```
✅ Pro Plan
Valid until: April 16, 2026
Unlimited scans this month

[Manage Billing] [View Subscription]
```

**Grace Period Banner:**
```
⚠️ Grace Period Active
Scans used: 110 / 100 (grace: 150 total)
40 scans remaining before hard stop

[Upgrade Now] [Learn More]
```

**Hard Stop Banner:**
```
🚫 Quota Exceeded
You've reached your monthly limit (150 scans).
No more scans until March 1, 2026.

[Upgrade to Pro] [Contact Support]
```

---

## 13. Objection Handlers

### "Why not free forever?"
**Response:**
"We'd love to! But server costs, support, and infrastructure require sustainable pricing. Free tier (100 scans/month) is our commitment to letting everyone try Gate risk-free. Most teams upgrade within days—it's that good."

### "Why $79/mo? That's expensive."
**Response:**
"Gate saves you from credential breaches, which average $4.5M in cleanup costs. $79/month is $0.99/day—insurance against one slip-up by one developer. Plus, team licensing (5 people) spreads it to $16/person/month."

### "Can I just use open-source tools?"
**Response:**
"Absolutely! Many teams do. We just built the UX and automation that makes it work. If DIY tools work for you, great. But many teams find Gate's simplicity, GitHub Actions integration, and dashboard worth the investment."

### "What if I don't like it?"
**Response:**
"Cancel anytime via dashboard. No questions asked. Your current month is paid through end-of-cycle, so you can use it through your billing date. (Downgrades get refunded prorated.)"

---

## Pricing Strategy Summary

| Metric | Goal |
|--------|------|
| Free tier conversion | 30% → Pro within 30 days |
| Pro ARPU | $79/month |
| Team seat utilization | 60% of 5 seats used (3 members) |
| Churn rate | <5% monthly |
| NPS (Net Promoter Score) | >50 |
| Support ticket response | <4 hours |

---

## Conversion Funnel

```
Homepage (pricing section)
         ↓ [Get Started Free] click
Sign up page
         ↓ Email verified
Welcome email + install docs
         ↓ First `git commit`
Gate scanning (free tier)
         ↓ Quota hit (after ~10 days)
Upgrade prompt (CLI + email)
         ↓ [Upgrade to Pro] click
Pricing page → Checkout
         ↓ Payment successful
License issued
         ↓ `gate license update`
Pro tier activated
         ↓ Unlimited scans
Happy customer 🎉
```

**Expected flow:**
- Day 0: Sign up (email)
- Day 1-7: Try free tier (100 scans)
- Day 7-10: Hit quota, see upgrade prompt
- Day 10-14: Upgrade to Pro OR wait for reset
- Day 15+: Using Pro OR downgraded to free

**Conversion optimization:**
- Upgrade prompt timing: At 80% quota (smart, not pushy)
- Free trial: 7 days before charging (lowers friction)
- Cancellation friction: Zero (easy downgrade/cancel)
- Refund policy: Full refund for unused days (builds trust)
