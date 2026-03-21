# Stripe Integration Guide for Gate

**Version:** 1.0  
**Last Updated:** 2026-02-16  
**Status:** Ready for Implementation  

---

## Overview

Gate uses Stripe for recurring subscription billing. This guide covers:

1. Stripe account setup
2. Product/Plan configuration
3. Integration code (Node.js + TypeScript)
4. Webhook handling
5. Payment flow implementation
6. Testing & validation

---

## 1. Stripe Account Setup

### 1.1 Create Stripe Account

1. Go to https://stripe.com
2. Sign up with your business email
3. Verify email and complete onboarding
4. Enable recurring billing (Subscriptions)

### 1.2 Get API Keys

1. Dashboard → API Keys
2. Copy **Publishable Key** (public, safe to expose)
   ```
   pk_live_51234567890...
   ```
3. Copy **Secret Key** (private, NEVER expose)
   ```
   sk_live_abcdefghijklmno...
   ```

**Store securely:**
```bash
# .env file (NEVER commit to git)
STRIPE_PUBLIC_KEY=pk_live_51234567890...
STRIPE_SECRET_KEY=sk_live_abcdefghijklmno...
STRIPE_WEBHOOK_SECRET=whsec_1234567890... # Get this after webhook setup
```

### 1.3 Configure Webhook Endpoint

1. Dashboard → Developers → Webhooks
2. Add Endpoint: `https://gate.dev/webhooks/stripe`
3. Select Events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `charge.failed`
   - `charge.refunded`
4. Copy **Signing Secret**: `whsec_...`

---

## 2. Product & Plan Configuration

### 2.1 Create Products

**In Stripe Dashboard → Products:**

**Product 1: Gate Pro**
```
Name: Gate Pro
Type: Service
Billing: Recurring
Default Price:
  - Amount: $79.00 USD
  - Billing Period: Monthly
  - Recurring: Yes
  - Interval: Monthly
Metadata:
  - plan: pro
  - seats: 5
  - features: github_actions,dashboard,slack,audit_log
```

**Product 2: Gate Enterprise**
```
Name: Gate Enterprise
Type: Service
Billing: Recurring
Default Price:
  - Amount: $299.00 USD
  - Billing Period: Monthly
  - Recurring: Yes
  - Interval: Monthly
Metadata:
  - plan: enterprise
  - seats: unlimited
  - features: all
```

### 2.2 Create Prices (Alternative: Code-First)

Instead of creating in dashboard, you can create programmatically:

```javascript
// create-prices.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createPrices() {
  // Pro Plan
  const proPriceId = await stripe.prices.create({
    currency: 'usd',
    unit_amount: 7900, // $79.00 in cents
    recurring: {
      interval: 'month',
      interval_count: 1
    },
    product_data: {
      name: 'Gate Pro',
      metadata: {
        plan: 'pro',
        seats: '5'
      }
    }
  });

  console.log('Pro Price ID:', proPriceId.id);

  // Enterprise Plan
  const enterprisePriceId = await stripe.prices.create({
    currency: 'usd',
    unit_amount: 29900, // $299.00 in cents
    recurring: {
      interval: 'month',
      interval_count: 1
    },
    product_data: {
      name: 'Gate Enterprise',
      metadata: {
        plan: 'enterprise',
        seats: 'unlimited'
      }
    }
  });

  console.log('Enterprise Price ID:', enterprisePriceId.id);
}

createPrices().catch(console.error);
```

**Price IDs (example):**
- Pro Monthly: `price_1234567890abcdef`
- Enterprise Monthly: `price_1234567890xyz`

---

## 3. Backend Integration (Node.js + TypeScript)

### 3.1 Install Dependencies

```bash
npm install stripe express dotenv
npm install --save-dev @types/stripe @types/express
```

### 3.2 Stripe Service Class

```typescript
// src/services/stripe.service.ts

import Stripe from 'stripe';
import { LicenseKey } from './license.service';

export interface StripeCustomer {
  id: string; // Stripe customer ID
  email: string;
  teamId: string;
}

export interface StripeSubscription {
  id: string;
  customerId: string;
  priceId: string;
  status: 'active' | 'past_due' | 'unpaid' | 'canceled' | 'trialing';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd?: Date;
  plan: 'pro' | 'enterprise';
  cancelAtPeriodEnd: boolean;
}

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2023-10-16'
    });
  }

  /**
   * Create a new Stripe customer
   */
  async createCustomer(email: string, teamId: string): Promise<StripeCustomer> {
    const customer = await this.stripe.customers.create({
      email,
      metadata: {
        teamId
      }
    });

    return {
      id: customer.id,
      email: customer.email || email,
      teamId
    };
  }

  /**
   * Get or create customer
   */
  async getOrCreateCustomer(email: string, teamId: string): Promise<StripeCustomer> {
    // Check if customer exists
    const existing = await this.stripe.customers.list({
      email,
      limit: 1
    });

    if (existing.data.length > 0) {
      const cust = existing.data[0];
      return {
        id: cust.id,
        email: cust.email || email,
        teamId
      };
    }

    // Create new customer
    return this.createCustomer(email, teamId);
  }

  /**
   * Create checkout session for subscription
   */
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    trialDays: number = 7
  ): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: trialDays
      },
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    return session.url || '';
  }

  /**
   * Create subscription (for existing customers)
   */
  async createSubscription(
    customerId: string,
    priceId: string,
    trialDays: number = 7
  ): Promise<StripeSubscription> {
    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: trialDays,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent']
    });

    return this.mapSubscription(subscription);
  }

  /**
   * Get active subscription
   */
  async getSubscription(customerId: string): Promise<StripeSubscription | null> {
    const subscriptions = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return null;
    }

    return this.mapSubscription(subscriptions.data[0]);
  }

  /**
   * Update subscription (upgrade/downgrade plan)
   */
  async updateSubscription(
    subscriptionId: string,
    newPriceId: string
  ): Promise<StripeSubscription> {
    // Get current subscription
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

    // Update item
    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: newPriceId
        }
      ],
      proration_behavior: 'create_prorations',
      billing_cycle_anchor: 'now' // Bill immediately
    });

    return this.mapSubscription(updated);
  }

  /**
   * Cancel subscription at end of billing cycle
   */
  async cancelSubscription(subscriptionId: string): Promise<StripeSubscription> {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });

    return this.mapSubscription(subscription);
  }

  /**
   * Immediately cancel subscription (no grace period)
   */
  async cancelSubscriptionImmediate(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.del(subscriptionId);
  }

  /**
   * Reactivate canceled subscription
   */
  async reactivateSubscription(subscriptionId: string): Promise<StripeSubscription> {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false
    });

    return this.mapSubscription(subscription);
  }

  /**
   * Get invoice
   */
  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return this.stripe.invoices.retrieve(invoiceId);
  }

  /**
   * Get subscription invoices
   */
  async getInvoices(customerId: string, limit: number = 12): Promise<Stripe.Invoice[]> {
    const invoices = await this.stripe.invoices.list({
      customer: customerId,
      limit
    });

    return invoices.data;
  }

  /**
   * Webhook event handler
   */
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionCanceled(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'charge.refunded':
        await this.handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(body: string, signature: string, secret: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(body, signature, secret);
  }

  // ===== PRIVATE HELPERS =====

  private mapSubscription(sub: Stripe.Subscription): StripeSubscription {
    const item = sub.items.data[0];
    const price = item.price as Stripe.Price;
    const product = price.product as Stripe.Product;

    return {
      id: sub.id,
      customerId: sub.customer as string,
      priceId: price.id,
      status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : undefined,
      plan: (product.metadata.plan || 'pro') as 'pro' | 'enterprise',
      cancelAtPeriodEnd: sub.cancel_at_period_end
    };
  }

  // ===== WEBHOOK HANDLERS =====

  private async handleSubscriptionChange(subscription: Stripe.Subscription): Promise<void> {
    const customerId = subscription.customer as string;
    const mapped = this.mapSubscription(subscription);

    // Update database
    await this.updateLicenseFromSubscription(customerId, mapped);

    // Send email (new/upgraded)
    if (subscription.status === 'active' && subscription.trial_period_days) {
      // New subscription with trial
      await this.sendTrialStartEmail(customerId, mapped);
    } else if (subscription.status === 'active') {
      // Upgrade
      await this.sendUpgradeEmail(customerId, mapped);
    }
  }

  private async handleSubscriptionCanceled(subscription: Stripe.Subscription): Promise<void> {
    const customerId = subscription.customer as string;

    // Delete/revoke license
    await this.revokeLicense(customerId);

    // Send email (cancellation)
    await this.sendCancellationEmail(customerId);
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;

    // Update billing info in database
    await this.recordPayment(customerId, invoice);

    // Send invoice email
    await this.sendInvoiceEmail(customerId, invoice);
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;

    // Mark as failed, schedule retry
    await this.recordFailedPayment(customerId, invoice);

    // Send notification email
    await this.sendPaymentFailedEmail(customerId, invoice);
  }

  private async handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const customerId = charge.customer as string;

    // Record refund
    await this.recordRefund(customerId, charge);

    // Send email
    await this.sendRefundEmail(customerId, charge);
  }

  // TODO: Implement these database update methods
  private async updateLicenseFromSubscription(
    customerId: string,
    subscription: StripeSubscription
  ): Promise<void> {
    // Update user's license based on subscription status
  }

  private async revokeLicense(customerId: string): Promise<void> {
    // Delete/revoke license
  }

  private async recordPayment(customerId: string, invoice: Stripe.Invoice): Promise<void> {
    // Record in database
  }

  private async recordFailedPayment(customerId: string, invoice: Stripe.Invoice): Promise<void> {
    // Record failed payment attempt
  }

  private async recordRefund(customerId: string, charge: Stripe.Charge): Promise<void> {
    // Record refund in database
  }

  // Email helpers (implement or use email service)
  private async sendTrialStartEmail(customerId: string, subscription: StripeSubscription): Promise<void> {}
  private async sendUpgradeEmail(customerId: string, subscription: StripeSubscription): Promise<void> {}
  private async sendCancellationEmail(customerId: string): Promise<void> {}
  private async sendInvoiceEmail(customerId: string, invoice: Stripe.Invoice): Promise<void> {}
  private async sendPaymentFailedEmail(customerId: string, invoice: Stripe.Invoice): Promise<void> {}
  private async sendRefundEmail(customerId: string, charge: Stripe.Charge): Promise<void> {}
}

export default new StripeService();
```

### 3.3 Express Route Handlers

```typescript
// src/routes/billing.routes.ts

import express, { Request, Response } from 'express';
import stripe from '../services/stripe.service';
import licensing from '../services/license.service';
import auth from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/v1/subscription
 * Get current subscription
 */
router.get('/subscription', auth.required, async (req: any, res: Response) => {
  try {
    const user = req.user; // From middleware
    const stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      return res.status(404).json({
        error: 'No active subscription',
        plan: 'free'
      });
    }

    const subscription = await stripe.getSubscription(stripeCustomerId);

    if (!subscription) {
      return res.status(404).json({
        error: 'Subscription not found'
      });
    }

    res.json({
      subscription_id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      current_period_start: subscription.currentPeriodStart.toISOString(),
      current_period_end: subscription.currentPeriodEnd.toISOString(),
      trial_end: subscription.trialEnd?.toISOString(),
      cancel_at_period_end: subscription.cancelAtPeriodEnd
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

/**
 * POST /api/v1/checkout
 * Create checkout session
 */
router.post('/checkout', auth.required, async (req: any, res: Response) => {
  try {
    const { plan } = req.body;
    const user = req.user;

    if (!['pro', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Get or create Stripe customer
    const customer = await stripe.getOrCreateCustomer(user.email, user.teamId);

    // Save Stripe customer ID to user
    await user.update({ stripeCustomerId: customer.id });

    // Get price ID from environment
    const priceId = plan === 'pro' 
      ? process.env.STRIPE_PRO_PRICE_ID 
      : process.env.STRIPE_ENTERPRISE_PRICE_ID;

    // Create checkout session
    const sessionUrl = await stripe.createCheckoutSession(
      customer.id,
      priceId!,
      `${process.env.BASE_URL}/upgrade-success`,
      `${process.env.BASE_URL}/upgrade-cancel`,
      7 // 7-day trial
    );

    res.json({ checkout_url: sessionUrl });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/v1/subscription/upgrade
 * Upgrade plan
 */
router.post('/subscription/upgrade', auth.required, async (req: any, res: Response) => {
  try {
    const { newPlan } = req.body;
    const user = req.user;

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No subscription to upgrade' });
    }

    const subscription = await stripe.getSubscription(user.stripeCustomerId);
    if (!subscription) {
      return res.status(400).json({ error: 'Subscription not found' });
    }

    const newPriceId = newPlan === 'pro'
      ? process.env.STRIPE_PRO_PRICE_ID
      : process.env.STRIPE_ENTERPRISE_PRICE_ID;

    const updated = await stripe.updateSubscription(subscription.id, newPriceId!);

    res.json({
      old_plan: subscription.plan,
      new_plan: updated.plan,
      effective_date: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to upgrade' });
  }
});

/**
 * POST /api/v1/subscription/cancel
 * Cancel subscription (at end of period)
 */
router.post('/subscription/cancel', auth.required, async (req: any, res: Response) => {
  try {
    const user = req.user;

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No subscription to cancel' });
    }

    const subscription = await stripe.getSubscription(user.stripeCustomerId);
    if (!subscription) {
      return res.status(400).json({ error: 'Subscription not found' });
    }

    const updated = await stripe.cancelSubscription(subscription.id);

    res.json({
      subscription_id: updated.id,
      status: 'cancel_scheduled',
      cancel_at_period_end: updated.currentPeriodEnd.toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

export default router;
```

### 3.4 Webhook Handler

```typescript
// src/routes/webhooks.routes.ts

import express, { Request, Response } from 'express';
import stripe from '../services/stripe.service';

const router = express.Router();

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    // Verify and construct event
    const event = stripe.verifyWebhookSignature(req.body.toString(), sig, secret);

    // Handle event
    await stripe.handleWebhookEvent(event);

    // Return 200 OK
    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }
});

export default router;
```

---

## 4. Frontend Integration (React Example)

### 4.1 Upgrade Button

```typescript
// src/components/UpgradeButton.tsx

import React, { useState } from 'react';

export const UpgradeButton: React.FC<{ plan: 'pro' | 'enterprise' }> = ({ plan }) => {
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);

    try {
      // Call backend to create checkout session
      const response = await fetch('/api/v1/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan })
      });

      const { checkout_url } = await response.json();

      // Redirect to Stripe checkout
      window.location.href = checkout_url;
    } catch (error) {
      console.error('Upgrade failed:', error);
      alert('Failed to start upgrade. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button 
      onClick={handleUpgrade}
      disabled={loading}
      className="btn btn-primary"
    >
      {loading ? 'Loading...' : `Upgrade to ${plan.toUpperCase()}`}
    </button>
  );
};
```

### 4.2 Success Page

```typescript
// src/pages/upgrade-success.tsx

import React, { useEffect, useState } from 'react';

export const UpgradeSuccessPage = () => {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<any>(null);

  useEffect(() => {
    // Fetch subscription details
    fetch('/api/v1/subscription')
      .then(r => r.json())
      .then(data => {
        setSubscription(data);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="success-page">
      <h1>✅ Welcome to Gate {subscription.plan}!</h1>
      <p>Your license has been issued:</p>
      <code>{subscription.license_key}</code>
      <p>Next: Run `gate license update [key]`</p>
    </div>
  );
};
```

---

## 5. Testing & Validation

### 5.1 Test Cards (Stripe Sandbox)

Use these cards in test mode to simulate scenarios:

| Card | Number | CVC | Expiry | Result |
|------|--------|-----|--------|--------|
| Success | 4242 4242 4242 4242 | 123 | 12/26 | Charge succeeds |
| Decline | 4000 0000 0000 0002 | 123 | 12/26 | Charge declines |
| Decline (fail 3x) | 4000 0000 0000 0341 | 123 | 12/26 | Retry 3x then fail |
| Require auth | 4000 0000 0000 0101 | 123 | 12/26 | Requires SCA |

### 5.2 Test Flow

```bash
# 1. Start in development (test mode)
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...

# 2. Create checkout session
curl -X POST http://localhost:3000/api/v1/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token" \
  -d '{"plan": "pro"}'

# Response
{
  "checkout_url": "https://checkout.stripe.com/pay/..."
}

# 3. Use test card 4242 4242 4242 4242
# 4. Verify webhook was received
# 5. Check database for created subscription
# 6. Issue license key
# 7. Verify CLI can activate license
```

### 5.3 Webhook Testing

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/webhooks/stripe

# Trigger test event
stripe trigger customer.subscription.created
```

---

## 6. Production Checklist

- [ ] Switch to live Stripe keys
- [ ] Set production API key in environment
- [ ] Test payment flow with real card (charge will be refunded)
- [ ] Configure SSL/TLS for all endpoints
- [ ] Enable webhook signing verification
- [ ] Set up email notifications for payment events
- [ ] Configure retry logic for failed payments (Stripe default: 3 retries)
- [ ] Set up monitoring/alerts for webhook failures
- [ ] Document refund policy
- [ ] Test edge cases (upgrade during trial, concurrent subscriptions, etc.)

---

## 7. Important Considerations

### 7.1 Trial Period

- Default: 7 days (configurable per subscription)
- User can access Pro features during trial
- No charge until trial ends
- If canceled during trial, no charge
- Can upgrade during trial (new charge depends on proration)

### 7.2 Proration

When upgrading or downgrading:
- Stripe calculates credit/charge for unused time
- Default behavior: Create prorations (charge/credit on next invoice)
- Billing anchor can be set to upgrade date or month

### 7.3 Failed Payments

Stripe automatically retries failed payments:
1. First attempt: Immediately
2. Second attempt: 3 days later
3. Third attempt: 5 days later

After 3 failed attempts, subscription is unpaid. Implement grace period (notify user, allow them to update card).

### 7.4 Refunds

Manual refunds:
```typescript
await stripe.refunds.create({
  charge: chargeId,
  amount: refundAmount // in cents
});
```

Full subscription refund:
```typescript
// Downgrade Pro → Free, refund unused days
const daysUsed = Math.floor((now - periodStart) / (1000 * 60 * 60 * 24));
const daysRemaining = 30 - daysUsed;
const refund = (daysRemaining / 30) * 79 * 100; // in cents

await stripe.refunds.create({
  charge: invoice.charge,
  amount: Math.floor(refund)
});
```

---

## 8. Error Handling

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `card_declined` | Card declined by bank | User updates card |
| `authentication_required` | SCA/3D Secure needed | User completes verification |
| `insufficient_funds` | Insufficient balance | User updates card |
| `expired_card` | Card expired | User updates card |
| `rate_limit` | API rate limited | Implement exponential backoff |
| `api_connection_error` | Network issue | Retry with exponential backoff |

### Retry Logic

```typescript
async function createSubscriptionWithRetry(
  customerId: string,
  priceId: string,
  maxRetries: number = 3
): Promise<StripeSubscription> {
  let lastError: any;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await stripe.createSubscription(customerId, priceId);
    } catch (error: any) {
      lastError = error;

      // Don't retry on client errors
      if (error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }

      // Exponential backoff
      const delay = Math.pow(2, i) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

---

## 9. Monitoring & Analytics

### Track These Metrics

```typescript
// Log successful charge
logger.info('Payment succeeded', {
  customerId,
  amount: invoice.amount_paid,
  plan: subscription.plan,
  timestamp: new Date()
});

// Log failed charge
logger.error('Payment failed', {
  customerId,
  invoiceId: invoice.id,
  reason: invoice.last_payment_error?.message,
  timestamp: new Date()
});

// Log subscription events
logger.info('Subscription created', { customerId, plan });
logger.info('Subscription canceled', { customerId, reason });
logger.info('Subscription upgraded', { customerId, oldPlan, newPlan });
```

### Dashboard Queries (Stripe Admin)

```
Metrics:
- Total MRR (Monthly Recurring Revenue)
- Churn rate (canceled subscriptions)
- Upgrade/downgrade ratio
- Payment success rate
- Average customer lifetime value
```

---

## 10. Compliance

### PCI Compliance

Gate does NOT handle card data:
- All payment processing through Stripe
- Never store card details
- Use Stripe's hosted checkout (not custom form)
- Webhooks only contain reference IDs

### Refund Policy

Document in terms:
```
Refunds are issued prorated for unused days.
Example: Downgrade Pro → Free after 10 days of 30-day cycle
  Refund = (20 days / 30 days) × $79 = $52.67
```

### Data Retention

- Keep payment records for: 7 years (legal requirement)
- Stripe retains all data per their privacy policy
- Implement data deletion for GDPR compliance

---

## Final Integration Checklist

- [ ] Stripe account created & configured
- [ ] Publishable & Secret keys secured
- [ ] Webhook endpoint configured
- [ ] Products created in Stripe
- [ ] StripeService class implemented
- [ ] Billing routes implemented
- [ ] Webhook handler implemented
- [ ] Frontend upgrade flow complete
- [ ] Test mode tested end-to-end
- [ ] Live mode configured
- [ ] Email notifications working
- [ ] Database synchronized with Stripe
- [ ] License generation automated
- [ ] Error handling tested
- [ ] Monitoring/alerts set up
- [ ] Documentation updated

---

## Support

- Stripe API Docs: https://stripe.com/docs/api
- Stripe CLI: https://stripe.com/docs/stripe-cli
- Webhook Testing: https://stripe.com/docs/webhooks/test
- Error Handling: https://stripe.com/docs/error-handling
