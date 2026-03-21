/**
 * Compliance framework mappings for Gate scanner findings.
 * Maps rule IDs to OWASP Top 10 2021, NIST SP 800-63B, CIS Controls v8, SOC2 TSC.
 */

export interface FrameworkMapping {
  owasp: string[];
  nist: string[];
  cis: string[];
  soc2: string[];
}

export interface ComplianceReport {
  generatedAt: string;
  totalFindings: number;
  findingsByFramework: {
    owasp: Record<string, number>;
    nist: Record<string, number>;
    cis: Record<string, number>;
    soc2: Record<string, number>;
  };
  frameworkCoverage: {
    owasp: string[];
    nist: string[];
    cis: string[];
    soc2: string[];
  };
  findings: Array<{
    idx: number;
    ruleId: string;
    ruleName: string;
    severity: string;
    file?: string;
    mappings: FrameworkMapping;
  }>;
}

// ── OWASP Top 10 2021 ────────────────────────────────────────────

const OWASP = {
  A01: 'A01:2021 — Broken Access Control',
  A02: 'A02:2021 — Cryptographic Failures',
  A03: 'A03:2021 — Injection',
  A04: 'A04:2021 — Insecure Design',
  A05: 'A05:2021 — Security Misconfiguration',
  A06: 'A06:2021 — Vulnerable and Outdated Components',
  A07: 'A07:2021 — Identification and Authentication Failures',
  A08: 'A08:2021 — Software and Data Integrity Failures',
  A09: 'A09:2021 — Security Logging and Monitoring Failures',
  A10: 'A10:2021 — Server-Side Request Forgery',
};

// ── NIST SP 800-63B ──────────────────────────────────────────────

const NIST = {
  '5.1.1': 'NIST 800-63B §5.1.1 — Memorized Secret Authenticators',
  '5.1.2': 'NIST 800-63B §5.1.2 — Look-Up Secret Authenticators',
  '5.1.4': 'NIST 800-63B §5.1.4 — Single-Factor OTP Authenticators',
  '5.2.7': 'NIST 800-63B §5.2.7 — Credential Lifecycle',
  '6.1': 'NIST 800-63B §6.1 — Authenticator Binding',
  '6.2': 'NIST 800-63B §6.2 — Credential Renewal/Re-issuance',
};

// ── CIS Controls v8 ─────────────────────────────────────────────

const CIS = {
  '3.11': 'CIS v8 §3.11 — Encrypt Sensitive Data at Rest',
  '4.7': 'CIS v8 §4.7 — Manage Default Accounts on Enterprise Assets',
  '6.5': 'CIS v8 §6.5 — Require MFA for Externally-Exposed Applications',
  '16.1': 'CIS v8 §16.1 — Establish and Maintain a Secure App Development Process',
  '16.4': 'CIS v8 §16.4 — Encrypt or Hash All Authentication Credentials',
  '16.7': 'CIS v8 §16.7 — Use Standard Hardening Configuration for App Infrastructure',
  '16.12': 'CIS v8 §16.12 — Implement Code-Level Security Checks',
};

// ── SOC2 Trust Services Criteria ────────────────────────────────

const SOC2 = {
  CC6_1: 'SOC2 CC6.1 — Logical and Physical Access Controls',
  CC6_6: 'SOC2 CC6.6 — Restrict Access to External Threats',
  CC6_7: 'SOC2 CC6.7 — Restrict Transmission of Data to Authorized Users',
  CC7_2: 'SOC2 CC7.2 — Monitor System Components for Anomalies',
  CC8_1: 'SOC2 CC8.1 — Authorize, Design, Develop, Configure, and Implement Changes',
};

// ── Rule-to-Framework Mappings ──────────────────────────────────

const RULE_MAPPINGS: Record<string, FrameworkMapping> = {
  // AWS
  'aws-access-key-id': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
  'aws-secret-access-key': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
  'aws-account-id': {
    owasp: [OWASP.A05],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.7']],
    soc2: [SOC2.CC6_1],
  },

  // GitHub
  'github-pat': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
  'github-oauth': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
  'github-app-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Stripe
  'stripe-live-secret': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7'], NIST['5.1.2']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'stripe-live-public': {
    owasp: [OWASP.A05],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.7']],
    soc2: [SOC2.CC8_1],
  },
  'stripe-live-restricted': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'stripe-test-secret': {
    owasp: [OWASP.A05],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.7']],
    soc2: [SOC2.CC8_1],
  },

  // Slack
  'slack-bot-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'slack-user-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'slack-webhook': {
    owasp: [OWASP.A05],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.7']],
    soc2: [SOC2.CC6_6],
  },
  'slack-app-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'slack-signing-secret': {
    owasp: [OWASP.A07, OWASP.A08],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // GCP
  'gcp-api-key': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
  'gcp-service-account': {
    owasp: [OWASP.A05],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.7']],
    soc2: [SOC2.CC6_1],
  },

  // Azure
  'azure-connection-string': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'azure-storage-key': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },

  // Private Keys
  'private-key-rsa': {
    owasp: [OWASP.A02, OWASP.A07],
    nist: [NIST['6.1'], NIST['5.2.7']],
    cis: [CIS['3.11'], CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'private-key-openssh': {
    owasp: [OWASP.A02, OWASP.A07],
    nist: [NIST['6.1'], NIST['5.2.7']],
    cis: [CIS['3.11'], CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'private-key-dsa': {
    owasp: [OWASP.A02, OWASP.A07],
    nist: [NIST['6.1'], NIST['5.2.7']],
    cis: [CIS['3.11'], CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'private-key-ec': {
    owasp: [OWASP.A02, OWASP.A07],
    nist: [NIST['6.1'], NIST['5.2.7']],
    cis: [CIS['3.11'], CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'private-key-generic': {
    owasp: [OWASP.A02, OWASP.A07],
    nist: [NIST['6.1'], NIST['5.2.7']],
    cis: [CIS['3.11'], CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'pgp-private-key': {
    owasp: [OWASP.A02, OWASP.A07],
    nist: [NIST['6.1'], NIST['5.2.7']],
    cis: [CIS['3.11'], CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'ssh-key-passphrase': {
    owasp: [OWASP.A02, OWASP.A07],
    nist: [NIST['6.1'], NIST['5.2.7']],
    cis: [CIS['3.11'], CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Generic patterns
  'password-assignment': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.1.1'], NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'api-key-assignment': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'secret-assignment': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1],
  },
  'token-assignment': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'auth-header': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },

  // Database URIs
  'mongodb-uri': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.1.1'], NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'postgres-uri': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.1.1'], NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'mysql-uri': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.1.1'], NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },

  // Firebase
  'firebase-key': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Twilio
  'twilio-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'twilio-account-sid': {
    owasp: [OWASP.A05],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.7']],
    soc2: [SOC2.CC6_1],
  },

  // SaaS
  'sendgrid-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'mailgun-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Registry tokens
  'npm-token': {
    owasp: [OWASP.A07, OWASP.A08],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['16.12']],
    soc2: [SOC2.CC6_1, SOC2.CC8_1],
  },
  'pypi-token': {
    owasp: [OWASP.A07, OWASP.A08],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['16.12']],
    soc2: [SOC2.CC6_1, SOC2.CC8_1],
  },
  'docker-token': {
    owasp: [OWASP.A07, OWASP.A08],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['16.12']],
    soc2: [SOC2.CC6_1, SOC2.CC8_1],
  },

  // JWT
  'jwt-token': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Entropy
  'high-entropy-string': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Env vars
  'env-var-secret': {
    owasp: [OWASP.A05, OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['3.11'], CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // OAuth
  'oauth-bearer': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },

  // Heroku
  'heroku-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Datadog
  'datadog-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC7_2],
  },

  // Sentry
  'sentry-dsn': {
    owasp: [OWASP.A05],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.7']],
    soc2: [SOC2.CC7_2],
  },

  // AI/ML keys
  'anthropic-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'openai-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'huggingface-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Grafana
  'grafana-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC7_2],
  },

  // Supabase
  'supabase-key': {
    owasp: [OWASP.A07, OWASP.A01],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Cloud platforms (2026 expansion)
  'vercel-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'netlify-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'cloudflare-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
  'cloudflare-api-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // SaaS (2026 expansion)
  'linear-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'notion-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'doppler-token': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },

  // Infrastructure (2026 expansion)
  'vault-token': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7'], NIST['6.1'], NIST['6.2']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
  'terraform-token': {
    owasp: [OWASP.A07, OWASP.A05],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC8_1],
  },

  // Databases (2026 expansion)
  'planetscale-token': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'upstash-token': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'neon-api-key': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },
  'turso-token': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4'], CIS['3.11']],
    soc2: [SOC2.CC6_1, SOC2.CC6_7],
  },

  // Cloud deployment (2026 expansion)
  'railway-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'flyio-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // Auth (2026 expansion)
  'clerk-secret-key': {
    owasp: [OWASP.A07, OWASP.A01],
    nist: [NIST['5.2.7'], NIST['6.1']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },

  // Email/messaging (2026 expansion)
  'resend-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // AI providers (2026 expansion)
  'replicate-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'mistral-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'groq-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'cohere-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },

  // VCS (2026 expansion)
  'gitlab-pat': {
    owasp: [OWASP.A07, OWASP.A01],
    nist: [NIST['5.2.7'], NIST['6.2']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
  'gitlab-pipeline-token': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC8_1],
  },

  // Tooling (2026 expansion)
  'postman-api-key': {
    owasp: [OWASP.A07],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1],
  },
  'databricks-token': {
    owasp: [OWASP.A07, OWASP.A02],
    nist: [NIST['5.2.7']],
    cis: [CIS['16.4']],
    soc2: [SOC2.CC6_1, SOC2.CC6_6],
  },
};

const DEFAULT_MAPPING: FrameworkMapping = {
  owasp: [OWASP.A07],
  nist: [NIST['5.2.7']],
  cis: [CIS['16.4']],
  soc2: [SOC2.CC6_1],
};

export function getComplianceMapping(ruleId: string): FrameworkMapping {
  return RULE_MAPPINGS[ruleId] || DEFAULT_MAPPING;
}

export function generateComplianceReport(findings: any[]): ComplianceReport {
  const report: ComplianceReport = {
    generatedAt: new Date().toISOString(),
    totalFindings: findings.length,
    findingsByFramework: {
      owasp: {},
      nist: {},
      cis: {},
      soc2: {},
    },
    frameworkCoverage: {
      owasp: [],
      nist: [],
      cis: [],
      soc2: [],
    },
    findings: [],
  };

  const owaspSet = new Set<string>();
  const nistSet = new Set<string>();
  const cisSet = new Set<string>();
  const soc2Set = new Set<string>();

  for (let idx = 0; idx < findings.length; idx++) {
    const f = findings[idx];
    const ruleId = f.ruleId || '';
    const mappings = getComplianceMapping(ruleId);

    report.findings.push({
      idx,
      ruleId,
      ruleName: f.ruleName || '',
      severity: f.severity || 'medium',
      file: f.file,
      mappings,
    });

    for (const ctrl of mappings.owasp) {
      owaspSet.add(ctrl);
      report.findingsByFramework.owasp[ctrl] = (report.findingsByFramework.owasp[ctrl] || 0) + 1;
    }
    for (const ctrl of mappings.nist) {
      nistSet.add(ctrl);
      report.findingsByFramework.nist[ctrl] = (report.findingsByFramework.nist[ctrl] || 0) + 1;
    }
    for (const ctrl of mappings.cis) {
      cisSet.add(ctrl);
      report.findingsByFramework.cis[ctrl] = (report.findingsByFramework.cis[ctrl] || 0) + 1;
    }
    for (const ctrl of mappings.soc2) {
      soc2Set.add(ctrl);
      report.findingsByFramework.soc2[ctrl] = (report.findingsByFramework.soc2[ctrl] || 0) + 1;
    }
  }

  report.frameworkCoverage.owasp = Array.from(owaspSet).sort();
  report.frameworkCoverage.nist = Array.from(nistSet).sort();
  report.frameworkCoverage.cis = Array.from(cisSet).sort();
  report.frameworkCoverage.soc2 = Array.from(soc2Set).sort();

  return report;
}
