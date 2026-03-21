/**
 * Secret detection rules for Gate scanner
 * 50+ patterns covering common cloud providers, APIs, and private keys
 */

const RULES = [
  // AWS
  {
    id: 'aws-access-key-id',
    name: 'AWS Access Key ID',
    pattern: /AKIA[0-9A-Z]{16}/,
    entropy: false,
    severity: 'critical',
    provider: 'AWS',
    category: 'Cloud Credentials',
    description: 'Matches the fixed AKIA prefix used by all AWS IAM access key IDs followed by 16 alphanumeric characters',
  },
  {
    id: 'aws-secret-access-key',
    name: 'AWS Secret Access Key',
    pattern: /aws_secret_access_key\s*=\s*[A-Za-z0-9\/+=]{40}/i,
    entropy: false,
    severity: 'critical',
    provider: 'AWS',
    category: 'Cloud Credentials',
    description: 'Matches aws_secret_access_key assignment with a 40-character base64-encoded secret value',
  },
  {
    id: 'aws-account-id',
    name: 'AWS Account ID (in context)',
    pattern: /(?:aws|account)[_\s-]*id\s*[=:]\s*\d{12}\b/i,
    entropy: false,
    severity: 'low',
    provider: 'AWS',
    category: 'Cloud Credentials',
    description: 'Matches a 12-digit AWS account ID when preceded by aws/account identifier keywords',
  },

  // GitHub
  {
    id: 'github-pat',
    name: 'GitHub Personal Access Token',
    pattern: /ghp_[A-Za-z0-9_]{20,}/,
    entropy: false,
    severity: 'critical',
    provider: 'GitHub',
    category: 'Authentication Tokens',
    description: 'Matches the ghp_ prefix used by GitHub fine-grained and classic personal access tokens',
  },
  {
    id: 'github-oauth',
    name: 'GitHub OAuth Token',
    pattern: /ghu_[A-Za-z0-9_]{20,}/,
    entropy: false,
    severity: 'critical',
    provider: 'GitHub',
    category: 'Authentication Tokens',
    description: 'Matches the ghu_ prefix used by GitHub OAuth user-to-server tokens',
  },
  {
    id: 'github-app-token',
    name: 'GitHub App Installation Token',
    pattern: /ghs_[A-Za-z0-9_]{20,}/,
    entropy: false,
    severity: 'critical',
    provider: 'GitHub',
    category: 'Authentication Tokens',
    description: 'Matches the ghs_ prefix used by GitHub App server-to-server installation tokens',
  },

  // Stripe
  {
    id: 'stripe-live-secret',
    name: 'Stripe Live Secret Key',
    pattern: /sk_live_[A-Za-z0-9]{20,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Stripe',
    category: 'API Keys',
    description: 'Matches Stripe live-mode secret API key with sk_live_ prefix — grants full account access',
  },
  {
    id: 'stripe-live-public',
    name: 'Stripe Live Public Key',
    pattern: /pk_live_[A-Za-z0-9]{20,}/,
    entropy: false,
    severity: 'medium',
    provider: 'Stripe',
    category: 'API Keys',
    description: 'Matches Stripe live-mode publishable key with pk_live_ prefix — client-safe but should be env-injected',
  },
  {
    id: 'stripe-live-restricted',
    name: 'Stripe Live Restricted API Key',
    pattern: /rk_live_[A-Za-z0-9]{20,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Stripe',
    category: 'API Keys',
    description: 'Matches Stripe live-mode restricted key with rk_live_ prefix — limited scope but still sensitive',
  },
  {
    id: 'stripe-test-secret',
    name: 'Stripe Test Secret Key',
    pattern: /sk_test_[A-Za-z0-9]{20,}/,
    entropy: false,
    severity: 'low',
    provider: 'Stripe',
    category: 'API Keys',
    description: 'Matches Stripe test-mode secret key with sk_test_ prefix — no production access but indicates key management issues',
  },

  // Slack
  {
    id: 'slack-bot-token',
    name: 'Slack Bot Token',
    pattern: /xoxb-[A-Za-z0-9-]{10,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Slack',
    category: 'SaaS Tokens',
    description: 'Matches Slack bot user OAuth token with xoxb- prefix — grants bot permissions in the workspace',
  },
  {
    id: 'slack-user-token',
    name: 'Slack User Token',
    pattern: /xoxp-[A-Za-z0-9-]{10,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Slack',
    category: 'SaaS Tokens',
    description: 'Matches Slack user OAuth token with xoxp- prefix — grants user-level workspace access',
  },
  {
    id: 'slack-webhook',
    name: 'Slack Webhook URL',
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/,
    entropy: false,
    severity: 'high',
    provider: 'Slack',
    category: 'SaaS Tokens',
    description: 'Matches Slack incoming webhook URL on hooks.slack.com/services — allows posting messages to channels',
  },

  // Google Cloud
  {
    id: 'gcp-api-key',
    name: 'GCP / Firebase API Key',
    pattern: /AIza[A-Za-z0-9_-]{35}/,
    entropy: false,
    severity: 'critical',
    provider: 'Google Cloud',
    category: 'Cloud Credentials',
    description: 'Matches Google Cloud / Firebase API key with fixed AIza prefix — used across GCP, Firebase, and Google Maps',
  },
  {
    id: 'gcp-service-account',
    name: 'GCP Service Account Email',
    pattern: /[a-z0-9]+-compute@developer\.gserviceaccount\.com/,
    entropy: false,
    severity: 'medium',
    provider: 'Google Cloud',
    category: 'Cloud Credentials',
    description: 'Matches GCP default compute service account email — indicates GCP infrastructure details',
  },

  // Azure
  {
    id: 'azure-connection-string',
    name: 'Azure Connection String',
    pattern: /DefaultEndpointsProtocol=https;AccountName=[A-Za-z0-9]+/i,
    entropy: false,
    severity: 'high',
    provider: 'Azure',
    category: 'Cloud Credentials',
    description: 'Matches Azure Storage connection string starting with DefaultEndpointsProtocol — contains account credentials',
  },
  {
    id: 'azure-storage-key',
    name: 'Azure Storage Account Key',
    pattern: /AccountKey=[A-Za-z0-9+/=]{88}|AccountKey=[A-Za-z0-9+/=]{86}/i,
    entropy: false,
    severity: 'critical',
    provider: 'Azure',
    category: 'Cloud Credentials',
    description: 'Matches Azure Storage account key (86-88 char base64) — grants full storage account access',
  },

  // Private Keys
  {
    id: 'private-key-rsa',
    name: 'RSA Private Key',
    pattern: /-----BEGIN RSA PRIVATE KEY-----/,
    entropy: false,
    severity: 'critical',
    provider: 'OpenSSL',
    category: 'Private Keys',
    description: 'Matches PEM-encoded RSA private key header — the complete key follows in base64 blocks',
  },
  {
    id: 'private-key-openssh',
    name: 'OpenSSH Private Key',
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/,
    entropy: false,
    severity: 'critical',
    provider: 'OpenSSH',
    category: 'Private Keys',
    description: 'Matches OpenSSH native private key format header — modern default format for ssh-keygen',
  },
  {
    id: 'private-key-dsa',
    name: 'DSA Private Key',
    pattern: /-----BEGIN DSA PRIVATE KEY-----/,
    entropy: false,
    severity: 'critical',
    provider: 'OpenSSL',
    category: 'Private Keys',
    description: 'Matches PEM-encoded DSA private key header — DSA is cryptographically deprecated (NIST FIPS 186-5)',
  },
  {
    id: 'private-key-ec',
    name: 'EC Private Key',
    pattern: /-----BEGIN EC PRIVATE KEY-----/,
    entropy: false,
    severity: 'critical',
    provider: 'OpenSSL',
    category: 'Private Keys',
    description: 'Matches PEM-encoded elliptic curve private key header (ECDSA/ECDH)',
  },
  {
    id: 'private-key-generic',
    name: 'Generic Private Key',
    pattern: /-----BEGIN PRIVATE KEY-----/,
    entropy: false,
    severity: 'critical',
    provider: 'OpenSSL',
    category: 'Private Keys',
    description: 'Matches PKCS#8 generic private key header — algorithm-agnostic PEM format',
  },
  {
    id: 'pgp-private-key',
    name: 'PGP Private Key Block',
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/,
    entropy: false,
    severity: 'critical',
    provider: 'GnuPG',
    category: 'Private Keys',
    description: 'Matches ASCII-armored PGP/GPG private key block — used for encryption, signing, and authentication',
  },

  // Generic patterns
  {
    id: 'password-assignment',
    name: 'Password Assignment',
    pattern: /password\s*=\s*['"]{0,1}[^\s'"]{8,}['"]{0,1}/i,
    entropy: false,
    severity: 'high',
    provider: 'Generic',
    category: 'Generic Secrets',
    description: 'Matches password variable assignment with a value of 8+ characters — likely a hardcoded credential',
  },
  {
    id: 'api-key-assignment',
    name: 'API Key Assignment',
    pattern: /api[_-]?key\s*[=:]\s*['"]{0,1}[^\s'"]{8,}['"]{0,1}/i,
    entropy: false,
    severity: 'high',
    provider: 'Generic',
    category: 'Generic Secrets',
    description: 'Matches api_key or api-key assignment with a value of 8+ characters',
  },
  {
    id: 'secret-assignment',
    name: 'Secret Assignment',
    pattern: /secret\s*[=:]\s*['"]{0,1}[^\s'"]{8,}['"]{0,1}/i,
    entropy: false,
    severity: 'high',
    provider: 'Generic',
    category: 'Generic Secrets',
    description: 'Matches secret variable assignment with a value of 8+ characters',
  },
  {
    id: 'token-assignment',
    name: 'Token Assignment',
    pattern: /token\s*[=:]\s*['"]{0,1}[^\s'"]{8,}['"]{0,1}/i,
    entropy: false,
    severity: 'high',
    provider: 'Generic',
    category: 'Generic Secrets',
    description: 'Matches token variable assignment with a value of 8+ characters',
  },
  {
    id: 'auth-header',
    name: 'Authorization Header',
    pattern: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]+/i,
    entropy: false,
    severity: 'high',
    provider: 'Generic',
    category: 'Authentication Tokens',
    description: 'Matches HTTP Authorization header with Bearer token — indicates a hardcoded access token',
  },

  // Database credentials
  {
    id: 'mongodb-uri',
    name: 'MongoDB Connection String',
    pattern: /mongodb(\+srv)?:\/\/[^\s:]+:[^\s@]+@[^\s/]+/i,
    entropy: false,
    severity: 'critical',
    provider: 'MongoDB',
    category: 'Database Credentials',
    description: 'Matches MongoDB connection URI with embedded username:password credentials',
  },
  {
    id: 'postgres-uri',
    name: 'PostgreSQL Connection String',
    pattern: /postgres(ql)?:\/\/[^\s:]+:[^\s@]+@[^\s/]+/i,
    entropy: false,
    severity: 'critical',
    provider: 'PostgreSQL',
    category: 'Database Credentials',
    description: 'Matches PostgreSQL connection URI with embedded username:password credentials',
  },
  {
    id: 'mysql-uri',
    name: 'MySQL Connection String',
    pattern: /mysql:\/\/[^\s:]+:[^\s@]+@[^\s/]+/i,
    entropy: false,
    severity: 'critical',
    provider: 'MySQL',
    category: 'Database Credentials',
    description: 'Matches MySQL connection URI with embedded username:password credentials',
  },

  // Twilio
  {
    id: 'twilio-api-key',
    name: 'Twilio API Key',
    pattern: /SK[a-z0-9]{32}/i,
    entropy: false,
    severity: 'critical',
    provider: 'Twilio',
    category: 'SaaS Tokens',
    description: 'Matches Twilio API key with SK prefix followed by 32 hex characters',
  },
  {
    id: 'twilio-account-sid',
    name: 'Twilio Account SID',
    pattern: /AC[a-z0-9]{32}/i,
    entropy: false,
    severity: 'medium',
    provider: 'Twilio',
    category: 'SaaS Tokens',
    description: 'Matches Twilio Account SID with AC prefix — semi-public but indicates Twilio usage',
  },

  // SendGrid
  {
    id: 'sendgrid-api-key',
    name: 'SendGrid API Key',
    pattern: /SG\.[A-Za-z0-9_-]{66}[A-Za-z0-9_-]{1,}/,
    entropy: false,
    severity: 'critical',
    provider: 'SendGrid',
    category: 'SaaS Tokens',
    description: 'Matches SendGrid API key with SG. prefix — grants email sending and account management access',
  },

  // Mailgun
  {
    id: 'mailgun-api-key',
    name: 'Mailgun API Key',
    pattern: /key-[A-Za-z0-9]{32}/,
    entropy: false,
    severity: 'critical',
    provider: 'Mailgun',
    category: 'SaaS Tokens',
    description: 'Matches Mailgun API key with key- prefix followed by 32 alphanumeric characters',
  },

  // NPM token
  {
    id: 'npm-token',
    name: 'NPM Token',
    pattern: /npm_[A-Za-z0-9]{36,}/,
    entropy: false,
    severity: 'critical',
    provider: 'npm',
    category: 'Registry Tokens',
    description: 'Matches npm automation/publish token with npm_ prefix — can publish packages to the registry',
  },

  // PyPI token
  {
    id: 'pypi-token',
    name: 'PyPI Token',
    pattern: /pypi-[A-Za-z0-9]{20,}/,
    entropy: false,
    severity: 'critical',
    provider: 'PyPI',
    category: 'Registry Tokens',
    description: 'Matches PyPI API token with pypi- prefix — grants package upload access to the Python Package Index',
  },

  // Docker registry token
  {
    id: 'docker-token',
    name: 'Docker Registry Token',
    pattern: /dckr_[A-Za-z0-9_-]{11,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Docker',
    category: 'Registry Tokens',
    description: 'Matches Docker Hub personal access token with dckr_ prefix — grants image push/pull access',
  },

  // JWT patterns (basic)
  {
    id: 'jwt-token',
    name: 'JWT Token',
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    entropy: false,
    severity: 'high',
    provider: 'Generic',
    category: 'Authentication Tokens',
    description: 'Matches JSON Web Token with base64url-encoded header.payload.signature structure',
  },

  // Generic high-entropy strings (for catch-all)
  {
    id: 'high-entropy-string',
    name: 'High Entropy String',
    pattern: null, // Special handling in scanner
    entropy: true,
    entropyThreshold: 3.8,
    severity: 'medium',
    provider: 'Generic',
    category: 'Entropy Detection',
    description: 'Shannon entropy analysis detected a high-randomness string that may be a secret or credential',
  },

  // .env file patterns
  {
    id: 'env-var-secret',
    name: 'Environment Variable Secret',
    pattern: /^\s*[A-Z_]+_(?:SECRET|KEY|TOKEN|PASSWORD)\s*=\s*[^\s]+$/im,
    entropy: false,
    severity: 'high',
    provider: 'Generic',
    category: 'Generic Secrets',
    description: 'Matches .env-style variable assignment where the name ends with SECRET, KEY, TOKEN, or PASSWORD',
  },

  // SSH key passphrases (if in config)
  {
    id: 'ssh-key-passphrase',
    name: 'SSH Key with Passphrase',
    pattern: /Proc-Type.*ENCRYPTED/,
    entropy: false,
    severity: 'critical',
    provider: 'OpenSSH',
    category: 'Private Keys',
    description: 'Matches PEM encrypted private key header (Proc-Type: ENCRYPTED) — key file present in source',
  },

  // OAuth2 bearer tokens
  {
    id: 'oauth-bearer',
    name: 'OAuth2 Bearer Token',
    pattern: /bearer\s+[A-Za-z0-9._-]{20,}/i,
    entropy: false,
    severity: 'high',
    provider: 'Generic',
    category: 'Authentication Tokens',
    description: 'Matches OAuth2 bearer token string with 20+ character token value',
  },

  // Heroku API token (requires context keyword to avoid UUID false positives)
  {
    id: 'heroku-token',
    name: 'Heroku API Token',
    pattern: /(?:HEROKU|heroku)[_\s]*(?:API[_\s]*)?(?:KEY|TOKEN|SECRET)\s*[=:]\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    entropy: false,
    severity: 'high',
    provider: 'Heroku',
    category: 'SaaS Tokens',
    description: 'Matches Heroku API token assignment with UUID-format value preceded by HEROKU keyword context',
  },

  // Datadog API key
  {
    id: 'datadog-api-key',
    name: 'Datadog API Key',
    pattern: /dd_api_key\s*=\s*[a-f0-9]{32}/i,
    entropy: false,
    severity: 'critical',
    provider: 'Datadog',
    category: 'SaaS Tokens',
    description: 'Matches Datadog API key assignment with 32-character hex value',
  },

  // Sentry DSN
  {
    id: 'sentry-dsn',
    name: 'Sentry DSN',
    pattern: /https:\/\/[a-f0-9]+@[a-z0-9.]+\/\d+/,
    entropy: false,
    severity: 'high',
    provider: 'Sentry',
    category: 'SaaS Tokens',
    description: 'Matches Sentry DSN URL containing project auth key — semi-public but should be env-injected',
  },

  // Anthropic API key
  {
    id: 'anthropic-api-key',
    name: 'Anthropic API Key',
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Anthropic',
    category: 'AI/ML Keys',
    description: 'Matches Anthropic API key with sk-ant- prefix — grants access to Claude API with billing implications',
  },

  // OpenAI API key
  {
    id: 'openai-api-key',
    name: 'OpenAI API Key',
    pattern: /sk-(?:proj-)?[A-Za-z0-9]{48,}/,
    entropy: false,
    severity: 'critical',
    provider: 'OpenAI',
    category: 'AI/ML Keys',
    keywords: ['openai', 'OPENAI_API_KEY', 'openai-api-key'],
    description: 'Matches OpenAI API key with sk- prefix (48+ chars) — grants model access with billing implications',
  },

  // Slack App-level token
  {
    id: 'slack-app-token',
    name: 'Slack App-Level Token',
    pattern: /xapp-[A-Za-z0-9-]{30,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Slack',
    category: 'SaaS Tokens',
    description: 'Matches Slack app-level token with xapp- prefix — used for Socket Mode connections',
  },

  // Hugging Face token
  {
    id: 'huggingface-token',
    name: 'Hugging Face API Token',
    pattern: /hf_[A-Za-z0-9]{34,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Hugging Face',
    category: 'AI/ML Keys',
    description: 'Matches Hugging Face access token with hf_ prefix — grants model and dataset access',
  },

  // Grafana API token
  {
    id: 'grafana-token',
    name: 'Grafana API Token',
    pattern: /eyJrIjoiK[A-Za-z0-9_-]{30,}/,
    entropy: false,
    severity: 'critical',
    provider: 'Grafana',
    category: 'SaaS Tokens',
    description: 'Matches Grafana service account or API token with base64-encoded JSON prefix',
  },

  // Supabase key
  {
    id: 'supabase-key',
    name: 'Supabase API Key',
    pattern: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/,
    entropy: false,
    severity: 'critical',
    provider: 'Supabase',
    category: 'API Keys',
    description: 'Matches Supabase JWT API key with fixed HS256/JWT header — service_role key bypasses Row Level Security',
  },

  // Slack signing secret
  {
    id: 'slack-signing-secret',
    name: 'Slack Signing Secret',
    pattern: /signing.?secret\s*[=:]\s*[A-Za-z0-9]{32}/i,
    entropy: false,
    severity: 'critical',
    provider: 'Slack',
    category: 'SaaS Tokens',
    description: 'Matches Slack app signing secret assignment — used to verify incoming webhook requests',
  },

  // ── 2026 Expansion: Modern Cloud Platforms ─────────────────────

  // Vercel
  {
    id: 'vercel-token',
    name: 'Vercel API Token',
    pattern: /(?:VERCEL_TOKEN|vercel[_-]token|vercel[_-]api[_-]token)[\s]*[=:][\s]*[A-Za-z0-9]{24}/,
    entropy: false,
    severity: 'high',
    provider: 'Vercel',
    category: 'Cloud Credentials',
    description: 'Matches Vercel deployment token in context — grants full access to Vercel projects and deployments',
  },

  // Netlify
  {
    id: 'netlify-token',
    name: 'Netlify Personal Access Token',
    pattern: /nfp_[A-Za-z0-9]{40}/,
    entropy: false,
    severity: 'high',
    provider: 'Netlify',
    category: 'Cloud Credentials',
    description: 'Matches Netlify personal access token with nfp_ prefix — grants full account and site management access',
  },

  // Cloudflare
  {
    id: 'cloudflare-api-key',
    name: 'Cloudflare Global API Key',
    pattern: /(?:CF_API_KEY|CLOUDFLARE_API_KEY|cloudflare[_-]api[_-]key)[\s]*[=:][\s]*[a-f0-9]{40}/,
    entropy: false,
    severity: 'high',
    provider: 'Cloudflare',
    category: 'Cloud Credentials',
    description: 'Matches Cloudflare Global API key (40 hex chars) in context — provides full account access including DNS, WAF, and Workers',
  },
  {
    id: 'cloudflare-api-token',
    name: 'Cloudflare API Token',
    pattern: /(?:CLOUDFLARE_TOKEN|CF_TOKEN|cloudflare[_-]token)[\s]*[=:][\s]*[A-Za-z0-9_-]{40}/,
    entropy: false,
    severity: 'high',
    provider: 'Cloudflare',
    category: 'Cloud Credentials',
    description: 'Matches scoped Cloudflare API token in context — grants permissions defined at token creation',
  },

  // Linear
  {
    id: 'linear-api-key',
    name: 'Linear API Key',
    pattern: /lin_api_[A-Za-z0-9]{40}/,
    entropy: false,
    severity: 'high',
    provider: 'Linear',
    category: 'SaaS Tokens',
    description: 'Matches Linear project management API key with lin_api_ prefix — grants read/write access to issues, projects, and team data',
  },

  // Notion
  {
    id: 'notion-api-key',
    name: 'Notion API Key',
    pattern: /ntn_[A-Za-z0-9]{50}/,
    entropy: false,
    severity: 'high',
    provider: 'Notion',
    category: 'SaaS Tokens',
    description: 'Matches Notion integration token with ntn_ prefix — grants access to shared Notion pages and databases',
  },

  // Doppler
  {
    id: 'doppler-token',
    name: 'Doppler Service Token',
    pattern: /dp\.st\.[A-Za-z0-9_-]+/,
    entropy: false,
    severity: 'high',
    provider: 'Doppler',
    category: 'Infrastructure',
    description: 'Matches Doppler service token with dp.st. prefix — grants access to a specific Doppler config/environment\'s secrets',
  },

  // HashiCorp Vault
  {
    id: 'vault-token',
    name: 'HashiCorp Vault Service Token',
    pattern: /hvs\.[A-Za-z0-9_-]{24,}/,
    entropy: false,
    severity: 'critical',
    provider: 'HashiCorp Vault',
    category: 'Infrastructure',
    description: 'Matches HashiCorp Vault service token with hvs. prefix — grants access to vault secrets paths defined by attached policies',
  },

  // Terraform Cloud
  {
    id: 'terraform-token',
    name: 'Terraform Cloud API Token',
    pattern: /[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{60,}/,
    entropy: false,
    severity: 'high',
    provider: 'Terraform Cloud',
    category: 'Infrastructure',
    description: 'Matches Terraform Cloud (Atlas) API token — grants access to Terraform workspaces, state, and runs',
  },

  // PlanetScale
  {
    id: 'planetscale-token',
    name: 'PlanetScale Database Token',
    pattern: /pscale_tkn_[A-Za-z0-9_-]{30,}/,
    entropy: false,
    severity: 'high',
    provider: 'PlanetScale',
    category: 'Database Credentials',
    description: 'Matches PlanetScale database service token with pscale_tkn_ prefix — grants database read/write access',
  },

  // Railway
  {
    id: 'railway-token',
    name: 'Railway API Token',
    pattern: /(?:RAILWAY_TOKEN|railway[_-]token)[\s]*[=:][\s]*railway_[A-Za-z0-9_-]{30,}/,
    entropy: false,
    severity: 'high',
    provider: 'Railway',
    category: 'Cloud Credentials',
    description: 'Matches Railway deployment platform API token in context — grants access to deployments, environment variables, and services',
  },

  // Fly.io
  {
    id: 'flyio-token',
    name: 'Fly.io Deploy Token',
    pattern: /fo1_[A-Za-z0-9_-]{30,}/,
    entropy: false,
    severity: 'high',
    provider: 'Fly.io',
    category: 'Cloud Credentials',
    description: 'Matches Fly.io deploy token with fo1_ prefix — grants access to Fly.io applications and deployment operations',
  },

  // Clerk
  {
    id: 'clerk-secret-key',
    name: 'Clerk Secret Key',
    pattern: /sk_live_[A-Za-z0-9]{30,}/,
    entropy: false,
    severity: 'high',
    provider: 'Clerk',
    category: 'Authentication Tokens',
    description: 'Matches Clerk authentication secret key with sk_live_ prefix — grants full API access including user management',
  },

  // Resend
  {
    id: 'resend-api-key',
    name: 'Resend API Key',
    pattern: /re_[A-Za-z0-9_]{30,}/,
    entropy: false,
    severity: 'high',
    provider: 'Resend',
    category: 'SaaS Tokens',
    description: 'Matches Resend email API key with re_ prefix — grants ability to send email from verified domains',
  },

  // Upstash
  {
    id: 'upstash-token',
    name: 'Upstash Redis/Kafka Token',
    pattern: /(?:UPSTASH_REDIS_REST_TOKEN|UPSTASH_KAFKA_REST_PASSWORD|upstash[_-](?:redis|kafka)[_-](?:rest[_-])?(?:token|password))[\s]*[=:][\s]*[A-Za-z0-9_-]{40,}/,
    entropy: false,
    severity: 'high',
    provider: 'Upstash',
    category: 'Database Credentials',
    description: 'Matches Upstash Redis or Kafka REST token in context — grants read/write access to serverless Redis or Kafka clusters',
  },

  // Neon
  {
    id: 'neon-api-key',
    name: 'Neon Database API Key',
    pattern: /(?:NEON_API_KEY|neon[_-]api[_-]key)[\s]*[=:][\s]*neon_[A-Za-z0-9_-]{40,}/,
    entropy: false,
    severity: 'high',
    provider: 'Neon',
    category: 'Database Credentials',
    description: 'Matches Neon serverless Postgres API key in context — grants access to Neon projects and branch management',
  },

  // Turso
  {
    id: 'turso-token',
    name: 'Turso Auth Token',
    pattern: /(?:TURSO_AUTH_TOKEN|turso[_-]auth[_-]token)[\s]*[=:][\s]*eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    entropy: false,
    severity: 'high',
    provider: 'Turso',
    category: 'Database Credentials',
    description: 'Matches Turso (libSQL) database auth token (JWT) in context — grants full read/write access to Turso edge database',
  },

  // Replicate
  {
    id: 'replicate-token',
    name: 'Replicate API Token',
    pattern: /r8_[A-Za-z0-9]{30,}/,
    entropy: false,
    severity: 'high',
    provider: 'Replicate',
    category: 'AI/ML Keys',
    description: 'Matches Replicate AI model inference API token with r8_ prefix — allows running AI models and may incur billing charges',
  },

  // Mistral
  {
    id: 'mistral-api-key',
    name: 'Mistral AI API Key',
    pattern: /(?:MISTRAL_API_KEY|mistral[_-]api[_-]key)[\s]*[=:][\s]*[A-Za-z0-9]{50,}/,
    entropy: false,
    severity: 'high',
    provider: 'Mistral',
    category: 'AI/ML Keys',
    description: 'Matches Mistral AI API key in context — grants access to Mistral language model inference API',
  },

  // Groq
  {
    id: 'groq-api-key',
    name: 'Groq API Key',
    pattern: /gsk_[A-Za-z0-9]{50,}/,
    entropy: false,
    severity: 'high',
    provider: 'Groq',
    category: 'AI/ML Keys',
    description: 'Matches Groq LPU inference API key with gsk_ prefix — grants access to ultra-fast Groq AI model inference',
  },

  // Cohere
  {
    id: 'cohere-api-key',
    name: 'Cohere API Key',
    pattern: /(?:COHERE_API_KEY|CO_API_KEY|cohere[_-]api[_-]key)[\s]*[=:][\s]*[A-Za-z0-9]{50,}/,
    entropy: false,
    severity: 'high',
    provider: 'Cohere',
    category: 'AI/ML Keys',
    description: 'Matches Cohere AI API key in context — grants access to text generation, embedding, and reranking APIs',
  },

  // GitLab
  {
    id: 'gitlab-pat',
    name: 'GitLab Personal Access Token',
    pattern: /glpat-[A-Za-z0-9_-]{20,}/,
    entropy: false,
    severity: 'critical',
    provider: 'GitLab',
    category: 'Authentication Tokens',
    description: 'Matches GitLab personal access token with glpat- prefix — grants API access to GitLab repositories, pipelines, and account',
  },
  {
    id: 'gitlab-pipeline-token',
    name: 'GitLab Pipeline Trigger Token',
    pattern: /glptt-[A-Za-z0-9_-]{20,}/,
    entropy: false,
    severity: 'high',
    provider: 'GitLab',
    category: 'Authentication Tokens',
    description: 'Matches GitLab pipeline trigger token with glptt- prefix — allows triggering CI/CD pipeline runs',
  },

  // Postman
  {
    id: 'postman-api-key',
    name: 'Postman API Key',
    pattern: /PMAK-[A-Za-z0-9]{24}-[A-Za-z0-9]{34}/,
    entropy: false,
    severity: 'high',
    provider: 'Postman',
    category: 'SaaS Tokens',
    description: 'Matches Postman API key with PMAK- prefix — grants access to Postman workspaces, collections, and environments',
  },

  // Databricks
  {
    id: 'databricks-token',
    name: 'Databricks Personal Access Token',
    pattern: /dapi[a-z0-9]{32}/,
    entropy: false,
    severity: 'high',
    provider: 'Databricks',
    category: 'Cloud Credentials',
    description: 'Matches Databricks personal access token with dapi prefix — grants access to Databricks workspace APIs and cluster management',
  },

  // Cursor
  {
    id: 'cursor-api-key',
    name: 'Cursor API Key',
    pattern: /cursor_[A-Za-z0-9]{32,}/,
    entropy: false,
    severity: 'high',
    provider: 'Cursor',
    category: 'AI Keys',
    description: 'Matches Cursor IDE API keys',
  },

  // 1Password
  {
    id: 'onepassword-token',
    name: '1Password Service Account Token',
    pattern: /ops_[A-Za-z0-9_-]{40,}/i,
    entropy: false,
    severity: 'critical',
    provider: '1Password',
    category: 'Secrets Management',
    description: 'Matches 1Password service account tokens with ops_ prefix',
  },
];

/**
 * Get all rules
 */
function getRules() {
  return RULES;
}

/**
 * Get rule by ID
 */
function getRuleById(id) {
  return RULES.find((r) => r.id === id);
}

/**
 * Get rules by severity
 */
function getRulesBySeverity(severity) {
  return RULES.filter((r) => r.severity === severity);
}

/**
 * Get rules for pattern matching (exclude entropy-only rules)
 */
function getPatternRules() {
  return RULES.filter((r) => r.pattern !== null);
}

/**
 * Get entropy detection rule
 */
function getEntropyRule() {
  return RULES.find((r) => r.id === 'high-entropy-string');
}

/**
 * Get built-in rules plus custom rules from .gaterc config.
 * Each custom rule must have: id, name, pattern (string), severity, remediation.
 * The pattern string is compiled to a RegExp before appending.
 *
 * @param {Array<{id: string, name: string, pattern: string, severity: string, remediation: string}>} customRules
 * @returns {Array} Built-in rules + compiled custom rules
 */
function getRulesWithCustom(customRules) {
  if (!Array.isArray(customRules) || customRules.length === 0) {
    return RULES;
  }

  const compiled = customRules.map((r) => ({
    ...r,
    pattern: new RegExp(r.pattern),
    entropy: false,
  }));

  return [...RULES, ...compiled];
}

module.exports = {
  RULES,
  getRules,
  getRuleById,
  getRulesBySeverity,
  getPatternRules,
  getEntropyRule,
  getRulesWithCustom,
};
