export type RemediationAction = 'rotate' | 'move_to_env' | 'encrypt' | 'use_vault' | 'review';

export interface RemediationInfo {
  action: RemediationAction;
  guide: string;
  link: string | null;
}

const REMEDIATION_MAP: Record<string, RemediationInfo> = {
  // AWS (3)
  'aws-access-key-id': {
    action: 'rotate',
    guide: 'Immediately deactivate this key in AWS IAM console, then delete it. Use IAM roles or OIDC federation instead of long-lived access keys. If keys are required, rotate via AWS STS temporary credentials and store in a secrets manager (AWS Secrets Manager, HashiCorp Vault).',
    link: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
  },
  'aws-secret-access-key': {
    action: 'rotate',
    guide: 'Immediately rotate in AWS IAM console. Prefer IAM roles with temporary credentials (STS AssumeRole) over static keys. If static keys are necessary, store in AWS Secrets Manager or a dedicated secrets vault — never in environment variables on shared systems.',
    link: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
  },
  'aws-account-id': {
    action: 'review',
    guide: 'AWS account IDs are low risk but should not be in source code. Move to config.',
    link: null,
  },

  // GitHub (3)
  'github-pat': {
    action: 'rotate',
    guide: 'Immediately revoke at GitHub > Settings > Developer settings > Personal access tokens. Create a new fine-grained token with minimal scopes. Use GitHub Apps with short-lived installation tokens instead of PATs where possible. Store tokens in a secrets manager, not .env files.',
    link: 'https://github.com/settings/tokens',
  },
  'github-oauth': {
    action: 'rotate',
    guide: 'Revoke this OAuth token immediately. Regenerate via OAuth flow. Use GitHub Apps for machine-to-machine auth — they provide scoped, short-lived tokens. Never hardcode OAuth tokens.',
    link: 'https://github.com/settings/tokens',
  },
  'github-app-token': {
    action: 'rotate',
    guide: 'Installation tokens auto-expire in 1 hour, but the private key used to generate them must be rotated. Go to GitHub > Settings > Developer settings > GitHub Apps, generate a new private key, and revoke the old one.',
    link: 'https://github.com/settings/apps',
  },

  // Stripe (4)
  'stripe-live-secret': {
    action: 'rotate',
    guide: 'Roll this key immediately in Stripe Dashboard > Developers > API keys. This is a live production key — treat exposure as a security incident. Use restricted keys with minimal permissions. Store in a secrets manager (not .env in production).',
    link: 'https://dashboard.stripe.com/apikeys',
  },
  'stripe-live-public': {
    action: 'move_to_env',
    guide: 'Publishable keys are designed for client-side use but should still be injected via build-time environment variables, not hardcoded in source. This prevents accidental use of production keys in development.',
    link: 'https://dashboard.stripe.com/apikeys',
  },
  'stripe-live-restricted': {
    action: 'rotate',
    guide: 'Delete this restricted key immediately in Stripe Dashboard and create a new one with minimal required permissions. Use webhook signatures to verify events server-side.',
    link: 'https://dashboard.stripe.com/apikeys',
  },
  'stripe-test-secret': {
    action: 'move_to_env',
    guide: 'Test keys cannot access real payment data, but keep them in environment variables to prevent accidental promotion to production code paths.',
    link: 'https://dashboard.stripe.com/test/apikeys',
  },

  // Slack (5)
  'slack-bot-token': {
    action: 'rotate',
    guide: 'Regenerate at api.slack.com > Your Apps > OAuth & Permissions.',
    link: 'https://api.slack.com/apps',
  },
  'slack-user-token': {
    action: 'rotate',
    guide: 'Regenerate at api.slack.com > Your Apps > OAuth & Permissions.',
    link: 'https://api.slack.com/apps',
  },
  'slack-webhook': {
    action: 'rotate',
    guide: 'Delete and recreate this incoming webhook at api.slack.com.',
    link: 'https://api.slack.com/apps',
  },
  'slack-app-token': {
    action: 'rotate',
    guide: 'Regenerate at api.slack.com > Your Apps > Basic Information > App-Level Tokens.',
    link: 'https://api.slack.com/apps',
  },
  'slack-signing-secret': {
    action: 'rotate',
    guide: 'Regenerate at api.slack.com > Your Apps > Basic Information > App Credentials.',
    link: 'https://api.slack.com/apps',
  },

  // GCP / Azure (4)
  'gcp-api-key': {
    action: 'rotate',
    guide: 'Delete and recreate in Google Cloud Console > APIs & Services > Credentials.',
    link: 'https://console.cloud.google.com/apis/credentials',
  },
  'gcp-service-account': {
    action: 'review',
    guide: 'Service account emails are low risk alone but indicate GCP usage. Keep out of source.',
    link: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  },
  'azure-connection-string': {
    action: 'rotate',
    guide: 'Regenerate storage account keys in Azure Portal > Storage accounts > Access keys.',
    link: 'https://portal.azure.com/',
  },
  'azure-storage-key': {
    action: 'rotate',
    guide: 'Regenerate in Azure Portal > Storage accounts > Access keys.',
    link: 'https://portal.azure.com/',
  },

  // Private keys (6)
  'private-key-rsa': {
    action: 'encrypt',
    guide: 'Remove from source immediately and scrub from git history (git filter-repo). Store in ~/.ssh/ with chmod 0600. Consider upgrading to Ed25519 keys (ssh-keygen -t ed25519). For server deployments, use a secrets manager or certificate authority instead of static keys.',
    link: null,
  },
  'private-key-openssh': {
    action: 'encrypt',
    guide: 'Remove from source immediately and scrub from git history. Store in ~/.ssh/ with chmod 0600. Protect with a strong passphrase. For CI/CD, use ephemeral SSH keys or deploy keys with read-only access.',
    link: null,
  },
  'private-key-dsa': {
    action: 'encrypt',
    guide: 'DSA keys are cryptographically deprecated (NIST FIPS 186-5). Remove from source, scrub git history, and generate a new Ed25519 key: ssh-keygen -t ed25519 -C "your_email".',
    link: null,
  },
  'private-key-ec': {
    action: 'encrypt',
    guide: 'Remove from source immediately and scrub from git history. Store in ~/.ssh/ with chmod 0600. Use P-256 or P-384 curves (avoid P-521 for performance). Protect with a passphrase.',
    link: null,
  },
  'private-key-generic': {
    action: 'encrypt',
    guide: 'Remove from source immediately and scrub from git history. Store with restricted filesystem permissions (0600). Use a secrets manager for production deployments.',
    link: null,
  },
  'pgp-private-key': {
    action: 'encrypt',
    guide: 'Remove from source immediately. Import into your GPG keyring (gpg --import), delete the file, and scrub from git history. Use subkeys for daily operations and keep the primary key offline.',
    link: null,
  },

  // Generic patterns (5)
  'password-assignment': {
    action: 'move_to_env',
    guide: 'Replace hardcoded password with a reference to a secrets manager or environment variable. For user-facing passwords, ensure they are bcrypt/argon2id-hashed before storage. Never store plaintext passwords anywhere.',
    link: null,
  },
  'api-key-assignment': {
    action: 'move_to_env',
    guide: 'Move API key to a secrets manager (e.g., AWS Secrets Manager, Vault, Doppler) or environment variable. Rotate the exposed key. Use scoped, least-privilege API keys where the provider supports it.',
    link: null,
  },
  'secret-assignment': {
    action: 'move_to_env',
    guide: 'Move secret to a secrets manager or environment variable. Rotate the exposed secret immediately. Audit access logs for any unauthorized use during the exposure window.',
    link: null,
  },
  'token-assignment': {
    action: 'move_to_env',
    guide: 'Move token to a secrets manager or environment variable. If this is a long-lived token, rotate it and prefer short-lived tokens (OAuth2 refresh flow, JWT with expiry).',
    link: null,
  },
  'auth-header': {
    action: 'move_to_env',
    guide: 'Remove hardcoded Authorization header. Inject bearer tokens from environment at runtime. Use token refresh flows to avoid long-lived credentials.',
    link: null,
  },

  // Database URIs (3)
  'mongodb-uri': {
    action: 'move_to_env',
    guide: 'Move connection string to a secrets manager or DATABASE_URL env var. Rotate the database password immediately (db.changeUserPassword). Enable SCRAM-SHA-256 authentication and TLS. Use connection pooling with short-lived credentials where supported.',
    link: 'https://www.mongodb.com/docs/manual/tutorial/rotate-database-passwords/',
  },
  'postgres-uri': {
    action: 'move_to_env',
    guide: 'Move connection string to a secrets manager or DATABASE_URL env var. Rotate the password (ALTER ROLE ... PASSWORD). Enable SSL/TLS (sslmode=require). Use pg_hba.conf to restrict connections by IP. Consider IAM database authentication for cloud deployments.',
    link: 'https://www.postgresql.org/docs/current/sql-alterrole.html',
  },
  'mysql-uri': {
    action: 'move_to_env',
    guide: 'Move connection string to a secrets manager or DATABASE_URL env var. Rotate the password (ALTER USER ... IDENTIFIED BY). Enable TLS and restrict access via bind-address and user grants.',
    link: 'https://dev.mysql.com/doc/refman/8.0/en/set-password.html',
  },

  // SaaS (6)
  'firebase-key': {
    action: 'rotate',
    guide: 'Regenerate in Firebase Console > Project Settings > General > Web API Key.',
    link: 'https://console.firebase.google.com/',
  },
  'twilio-api-key': {
    action: 'rotate',
    guide: 'Delete and recreate in Twilio Console > Account > API keys & tokens.',
    link: 'https://www.twilio.com/console',
  },
  'twilio-account-sid': {
    action: 'review',
    guide: 'Account SIDs are semi-public but keep out of source to reduce attack surface.',
    link: 'https://www.twilio.com/console',
  },
  'sendgrid-api-key': {
    action: 'rotate',
    guide: 'Delete and recreate in SendGrid > Settings > API Keys.',
    link: 'https://app.sendgrid.com/settings/api_keys',
  },
  'mailgun-api-key': {
    action: 'rotate',
    guide: 'Regenerate in Mailgun dashboard > API Security.',
    link: 'https://app.mailgun.com/settings/api_security',
  },
  'npm-token': {
    action: 'rotate',
    guide: 'Revoke at npmjs.com > Access Tokens. Generate a new granular token.',
    link: 'https://www.npmjs.com/settings/tokens',
  },
  'pypi-token': {
    action: 'rotate',
    guide: 'Delete and create a new token at pypi.org > Account settings > API tokens.',
    link: 'https://pypi.org/manage/account/',
  },
  'docker-token': {
    action: 'rotate',
    guide: 'Revoke at hub.docker.com > Account Settings > Security.',
    link: 'https://hub.docker.com/settings/security',
  },

  // AI keys (5)
  'openai-api-key': {
    action: 'rotate',
    guide: 'Delete this key immediately at platform.openai.com > API keys. Create a new key with project-scoped permissions. Set usage limits and monitor for unauthorized usage. Store in a secrets manager.',
    link: 'https://platform.openai.com/api-keys',
  },
  'anthropic-api-key': {
    action: 'rotate',
    guide: 'Delete this key immediately at console.anthropic.com > API keys. Create a new key and set spend limits. Monitor usage logs for unauthorized requests during the exposure window.',
    link: 'https://console.anthropic.com/settings/keys',
  },
  'huggingface-token': {
    action: 'rotate',
    guide: 'Delete this token at huggingface.co > Settings > Access Tokens. Create a new fine-grained token with read-only access to only the required repositories.',
    link: 'https://huggingface.co/settings/tokens',
  },
  'grafana-token': {
    action: 'rotate',
    guide: 'Delete and recreate in Grafana > Administration > Service accounts (preferred over legacy API keys). Use role-based access control with minimal permissions.',
    link: null,
  },
  'supabase-key': {
    action: 'rotate',
    guide: 'Regenerate in Supabase Dashboard > Settings > API. The anon key is safe for client-side use with Row Level Security enabled. The service_role key must NEVER be exposed — it bypasses RLS.',
    link: 'https://supabase.com/dashboard',
  },

  // Other specific rules
  'jwt-token': {
    action: 'review',
    guide: 'JWTs in source may indicate a hardcoded session. Remove and generate at runtime.',
    link: null,
  },
  'env-var-secret': {
    action: 'use_vault',
    guide: 'This .env file contains secrets. Encrypt with: gate vault env <file>',
    link: null,
  },
  'ssh-key-passphrase': {
    action: 'encrypt',
    guide: 'SSH key with embedded passphrase data. Move to ~/.ssh/ with proper permissions.',
    link: null,
  },
  'oauth-bearer': {
    action: 'move_to_env',
    guide: 'Remove hardcoded bearer token. Inject from environment variable at runtime.',
    link: null,
  },
  'heroku-token': {
    action: 'rotate',
    guide: 'Regenerate via heroku authorizations:create or in Heroku Dashboard > Account.',
    link: 'https://dashboard.heroku.com/account',
  },
  'datadog-api-key': {
    action: 'rotate',
    guide: 'Regenerate in Datadog > Organization Settings > API Keys.',
    link: 'https://app.datadoghq.com/organization-settings/api-keys',
  },
  'sentry-dsn': {
    action: 'move_to_env',
    guide: 'DSNs are semi-public but move to env var SENTRY_DSN to keep source clean.',
    link: null,
  },

  // Entropy catch-all
  'high-entropy-string': {
    action: 'review',
    guide: 'High-entropy string detected. Review whether this is a secret, hash, or false positive.',
    link: null,
  },

  // Cloud platforms (2026 expansion)
  'vercel-token': {
    action: 'rotate',
    guide: 'Delete this token in Vercel Dashboard > Settings > Tokens. Create a new token with the minimum required scope (e.g., read-only if write access is not needed). Store in a secrets manager or CI/CD environment variable — never hardcode in source.',
    link: 'https://vercel.com/account/tokens',
  },
  'netlify-token': {
    action: 'rotate',
    guide: 'Revoke this token at app.netlify.com > User settings > Applications > Personal access tokens. Generate a new token with the minimum required scope. Prefer site-scoped tokens over full-account tokens.',
    link: 'https://app.netlify.com/user/applications',
  },
  'cloudflare-api-key': {
    action: 'rotate',
    guide: 'The Cloudflare Global API Key provides full account access and cannot be scoped. Create a new scoped API Token instead (Cloudflare Dashboard > My Profile > API Tokens > Create Token), then disable the Global API Key. Store tokens in a secrets manager.',
    link: 'https://dash.cloudflare.com/profile/api-tokens',
  },
  'cloudflare-api-token': {
    action: 'rotate',
    guide: 'Delete this token at Cloudflare Dashboard > My Profile > API Tokens. Create a replacement with the minimum required permissions (e.g., DNS:Edit for a single zone only). Store in a secrets manager.',
    link: 'https://dash.cloudflare.com/profile/api-tokens',
  },

  // SaaS (2026 expansion)
  'linear-api-key': {
    action: 'rotate',
    guide: 'Revoke this key at Linear > Settings > API > Personal API keys. Create a new key. Linear API keys grant full read/write access to your workspace — treat them as production credentials.',
    link: 'https://linear.app/settings/api',
  },
  'notion-api-key': {
    action: 'rotate',
    guide: 'Revoke this integration token at Notion > Settings > Connections > Integrations. Create a new internal integration with the minimum required capabilities. Note: internal integrations can only access pages explicitly shared with them.',
    link: 'https://www.notion.so/profile/integrations',
  },
  'doppler-token': {
    action: 'rotate',
    guide: 'Revoke this service token in Doppler Dashboard > Project > Config > Service Tokens. Generate a new token. Doppler service tokens are config-scoped — verify the token scope matches the intended access level.',
    link: 'https://dashboard.doppler.com/',
  },

  // Infrastructure (2026 expansion)
  'vault-token': {
    action: 'rotate',
    guide: 'Revoke this Vault token immediately: vault token revoke <token>. Audit Vault audit logs for usage during the exposure window. Create a replacement token with least-privilege policies. Prefer short-TTL tokens with renewal (auth/token/renew) over long-lived tokens.',
    link: 'https://developer.hashicorp.com/vault/docs/commands/token/revoke',
  },
  'terraform-token': {
    action: 'rotate',
    guide: 'Delete this token in Terraform Cloud > User Settings > Tokens (for user tokens) or Organization Settings > API Tokens (for org tokens). Generate a replacement. Terraform Cloud tokens grant access to run plans and apply infrastructure changes — treat as critical credentials.',
    link: 'https://app.terraform.io/app/settings/tokens',
  },

  // Databases (2026 expansion)
  'planetscale-token': {
    action: 'rotate',
    guide: 'Delete this service token at app.planetscale.com > Organization Settings > Service tokens. Create a replacement with minimum required database and branch permissions. PlanetScale tokens can be scoped per-database — use least-privilege.',
    link: 'https://app.planetscale.com/settings/service-tokens',
  },
  'upstash-token': {
    action: 'rotate',
    guide: 'Rotate the REST token in Upstash Console > Redis/Kafka database > Details > REST API. Regenerate the token. Upstash REST tokens allow full read/write access to the database — store in a secrets manager.',
    link: 'https://console.upstash.com/',
  },
  'neon-api-key': {
    action: 'rotate',
    guide: 'Revoke this API key at console.neon.tech > Account Settings > API Keys. Create a replacement. Neon API keys grant access to project management (branch creation, deletion). Use connection strings with scoped roles for application database access.',
    link: 'https://console.neon.tech/app/settings/api-keys',
  },
  'turso-token': {
    action: 'rotate',
    guide: 'Revoke this auth token: turso db tokens invalidate <db-name>. Then generate a new token: turso db tokens create <db-name>. Turso JWT tokens grant full read/write access to the database.',
    link: 'https://docs.turso.tech/reference/turso-cli#turso-db-tokens',
  },

  // Cloud deployment (2026 expansion)
  'railway-token': {
    action: 'rotate',
    guide: 'Delete this token in Railway Dashboard > Account Settings > Tokens. Create a new token. Railway tokens grant access to all projects and environments in your account — use per-project tokens where available.',
    link: 'https://railway.app/account/tokens',
  },
  'flyio-token': {
    action: 'rotate',
    guide: 'Revoke this deploy token: fly tokens revoke --token <token>. Create a replacement: fly tokens create deploy. Fly.io tokens are scoped per organization — audit which apps are accessible with this token.',
    link: 'https://fly.io/docs/flyctl/tokens/',
  },

  // Auth (2026 expansion)
  'clerk-secret-key': {
    action: 'rotate',
    guide: 'Roll this key in Clerk Dashboard > API Keys. The secret key (sk_live_) provides full backend API access including user management and session control. Rotate immediately and audit Clerk logs for unauthorized user operations during the exposure window.',
    link: 'https://dashboard.clerk.com/',
  },

  // Email/messaging (2026 expansion)
  'resend-api-key': {
    action: 'rotate',
    guide: 'Revoke this key at resend.com > API Keys. Create a replacement with minimum required permissions (sending only, restricted to specific domains). Monitor for unauthorized email sends from your verified domains.',
    link: 'https://resend.com/api-keys',
  },

  // AI providers (2026 expansion)
  'replicate-token': {
    action: 'rotate',
    guide: 'Delete this token at replicate.com > Account > API tokens. Create a new token. Replicate tokens allow running models which incur per-second billing — monitor your billing dashboard for unexpected usage.',
    link: 'https://replicate.com/account/api-tokens',
  },
  'mistral-api-key': {
    action: 'rotate',
    guide: 'Delete this key at console.mistral.ai > API Keys. Create a replacement. Mistral AI keys allow language model inference which incurs usage charges — audit your usage dashboard for unauthorized requests.',
    link: 'https://console.mistral.ai/api-keys/',
  },
  'groq-api-key': {
    action: 'rotate',
    guide: 'Delete this key at console.groq.com > API Keys. Generate a replacement. Groq keys allow ultra-fast LPU inference — check your usage logs for unauthorized API calls during the exposure window.',
    link: 'https://console.groq.com/keys',
  },
  'cohere-api-key': {
    action: 'rotate',
    guide: 'Delete this key at dashboard.cohere.com > API Keys. Create a replacement with restricted usage if Cohere supports key scoping. Monitor your usage dashboard for unauthorized embedding or generation requests.',
    link: 'https://dashboard.cohere.com/api-keys',
  },

  // VCS (2026 expansion)
  'gitlab-pat': {
    action: 'rotate',
    guide: 'Revoke this token immediately at gitlab.com/-/user_settings/personal_access_tokens. Create a replacement with minimum required scopes (prefer read_repository over api scope). Audit GitLab audit events for unauthorized operations during the exposure window.',
    link: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  },
  'gitlab-pipeline-token': {
    action: 'rotate',
    guide: 'Delete this pipeline trigger token in GitLab > Project > Settings > CI/CD > Pipeline triggers. Create a replacement. Pipeline trigger tokens allow running CI/CD pipelines — audit recent pipeline activity for unauthorized runs.',
    link: 'https://docs.gitlab.com/ee/ci/triggers/',
  },

  // Tooling (2026 expansion)
  'postman-api-key': {
    action: 'rotate',
    guide: 'Delete this key at go.postman.co/settings/me/api-keys. Create a replacement. Postman API keys grant access to all your workspaces, collections, and environment variables — treat as sensitive credentials.',
    link: 'https://go.postman.co/settings/me/api-keys',
  },
  'databricks-token': {
    action: 'rotate',
    guide: 'Delete this token in Databricks > User Settings > Developer > Access tokens. Generate a replacement with a short expiry (max 90 days). Databricks tokens grant full workspace API access including cluster management and job execution.',
    link: 'https://docs.databricks.com/dev-tools/api/latest/authentication.html',
  },
};

/**
 * Standard incident response steps for any secret exposed in a git repository:
 *
 * 1. ROTATE — Immediately revoke/rotate the exposed credential at the provider
 * 2. AUDIT — Check provider access logs for unauthorized usage during the exposure window
 * 3. REMOVE — Delete the secret from the current codebase
 * 4. SCRUB — Remove from git history using git-filter-repo or BFG Repo-Cleaner
 * 5. REPLACE — Store the new credential in a secrets manager (not .env in production)
 * 6. NOTIFY — If the secret accessed user data, follow your incident response plan
 *
 * References:
 * - OWASP Secrets Management Cheat Sheet
 * - NIST SP 800-63B (credential lifecycle)
 * - CIS Controls v8 §16 (Application Software Security)
 */

const DEFAULT_REMEDIATION: RemediationInfo = {
  action: 'review',
  guide: 'Review this finding and determine if it contains a real secret. If confirmed, rotate the credential immediately, audit provider logs for unauthorized access, remove from code, and scrub from git history (git-filter-repo or BFG Repo-Cleaner).',
  link: null,
};

export function getRemediation(ruleId: string): RemediationInfo {
  return REMEDIATION_MAP[ruleId] || DEFAULT_REMEDIATION;
}

export function getActionLabel(action: RemediationAction): string {
  const labels: Record<RemediationAction, string> = {
    rotate: 'ROTATE',
    move_to_env: 'MOVE TO ENV',
    encrypt: 'ENCRYPT',
    use_vault: 'USE VAULT',
    review: 'REVIEW',
  };
  return labels[action];
}
