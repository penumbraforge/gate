# Contributing to Gate

Gate is built as a **monorepo** with 5 integrated components. This guide helps you understand the structure and contribute effectively.

---

## 📁 Monorepo Structure

```
gate/
├── packages/
│   ├── cli/              # Pre-commit hook CLI
│   ├── github-action/    # GitHub Action
│   ├── backend/          # SaaS API
│   ├── frontend/         # React dashboard
│   └── rules-engine/     # Detection rules
├── docs/                 # Shared documentation
├── examples/             # Example configs
├── tests/                # Integration tests
└── scripts/              # Build/deploy scripts
```

---

## 🛠️ Development Setup

### Prerequisites
- Node.js 18+
- npm 9+
- PostgreSQL 13+ (for backend)
- Git

### Initial Setup

```bash
# Clone the repo
git clone https://github.com/penumbra/gate.git
cd gate

# Install all dependencies
npm install

# Set up environment files
cp packages/backend/.env.example packages/backend/.env.local
cp packages/frontend/.env.example packages/frontend/.env.local

# Set up database
npm run db:setup
```

---

## 🚀 Running the Full Stack

```bash
# Start all services (CLI, backend, frontend in parallel)
npm run dev

# Services will be available at:
# - CLI: Watch mode for development
# - Backend: http://localhost:3000
# - Frontend: http://localhost:5173
```

---

## 📦 Package Descriptions

### CLI (`packages/cli/`)
- **Purpose:** Pre-commit hook for local scanning
- **Tech:** Node.js, no external dependencies
- **Commands:** `gate install`, `gate scan`, `gate audit`
- **Development:** Edit `src/scanner.js` for rules, `src/installer.js` for hook logic

### GitHub Action (`packages/github-action/`)
- **Purpose:** CI/CD enforcement on GitHub
- **Tech:** JavaScript, GitHub Actions toolkit
- **Development:** Edit `action.js` for enforcement logic

### Backend (`packages/backend/`)
- **Purpose:** SaaS API for licensing, auditing, team management
- **Tech:** Node.js, Express, TypeScript, PostgreSQL, Prisma
- **API:** 35 endpoints across 6 categories
- **Development:** Edit `src/routes/` for endpoints, `src/services/` for business logic

### Frontend (`packages/frontend/`)
- **Purpose:** React dashboard for users
- **Tech:** React, TypeScript, Vite, Tailwind CSS, Zustand
- **Pages:** Login, Dashboard, Audit, License, Team, Billing, Integrations
- **Development:** Edit `src/pages/` and `src/components/`

### Rules Engine (`packages/rules-engine/`)
- **Purpose:** 256 detection rules (FORTRESS)
- **Files:** `rules.json` (rules), `rules.json.sig` (signature)
- **Development:** Add rules to `rules.json`, update signature with `fortress.js`

---

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Test Specific Package
```bash
npm test -- cli          # Test CLI
npm test -- backend      # Test backend
npm test -- frontend     # Test frontend
```

### Test Coverage
```bash
npm test -- --coverage
```

---

## 🔨 Building

### Build All Packages
```bash
npm run build
```

### Build Specific Package
```bash
npm run build --workspace=packages/cli
npm run build --workspace=packages/backend
```

---

## 📤 Publishing

### Publish CLI to npm
```bash
npm run publish:cli
```

### Deploy Backend to Staging
```bash
npm run deploy:backend:staging
```

### Deploy Backend to Production
```bash
npm run deploy:backend:prod
```

---

## 🐛 Debugging

### CLI Debugging
```bash
# Run with debug output
DEBUG=* npx gate scan config.js

# Run with verbose audit logging
npx gate scan --verbose
```

### Backend Debugging
```bash
# Set log level
LOG_LEVEL=debug npm run dev --workspace=packages/backend

# View database queries
DEBUG=prisma:* npm run dev --workspace=packages/backend
```

### Frontend Debugging
```bash
# React DevTools available in browser
# Redux DevTools available with Zustand inspector
npm run dev --workspace=packages/frontend
```

---

## 📝 Code Style

All packages follow:
- **Linting:** ESLint (JavaScript/TypeScript)
- **Formatting:** Prettier
- **Style:** Airbnb style guide

```bash
# Fix linting issues
npm run lint -- --fix

# Format code
npm run format
```

---

## 🔒 Security

### Adding New Rules
1. Add rule to `packages/rules-engine/rules.json`
2. Test with `packages/rules-engine/fortress.js test`
3. Update signature: `npm run sign-rules`
4. Commit both `rules.json` and `rules.json.sig`

### Environment Variables
- **Never commit** `.env` files
- **Always use** `.env.example` as template
- **Rotate secrets** regularly (keys, Stripe, GitHub token)

---

## 📚 Documentation

- **Architecture:** See `docs/architecture/`
- **API Reference:** See `packages/backend/README.md`
- **Monetization:** See `docs/monetization/`
- **Deployment:** See `docs/deployment/`

---

## 🎯 Contribution Workflow

1. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** in the appropriate package

3. **Test locally:**
   ```bash
   npm test -- <package>
   ```

4. **Commit with descriptive message:**
   ```bash
   git commit -m "feat(cli): add new detection rule for API keys"
   ```

5. **Push and create a PR**

---

## 🚀 Release Process

### Version Bump
```bash
# Patch (bug fix)
npm version patch

# Minor (feature)
npm version minor

# Major (breaking)
npm version major
```

### Create Release
```bash
git push origin main
git push origin --tags
# GitHub Actions will auto-build and release
```

---

## 📞 Getting Help

- Check existing issues on GitHub
- Read the documentation in `docs/`
- Ask in discussions or open an issue

---

**Thanks for contributing to Gate! 🛡️**
