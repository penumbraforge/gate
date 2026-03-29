#!/bin/bash
set -euo pipefail

# Gate Release Script
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 1.4.0
#
# This script:
#   1. Updates version in package.json
#   2. Updates CURRENT_VERSION in worker/gate-api.js
#   3. Updates version in src/frontend/pages/Login.tsx and Sidebar.tsx
#   4. Rebuilds the project
#   5. Commits, tags, and pushes
#   6. Deploys the Cloudflare Worker

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info()  { echo -e "${BOLD}${GREEN}>>>${RESET} $1"; }
warn()  { echo -e "${BOLD}${YELLOW}>>>${RESET} $1"; }
error() { echo -e "${BOLD}${RED}>>>${RESET} $1"; exit 1; }

if [ $# -lt 1 ]; then
  echo "Usage: $0 <version>"
  echo "  Example: $0 1.4.0"
  exit 1
fi

NEW_VERSION="$1"

# Validate semver format
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  error "Invalid version format: $NEW_VERSION (expected X.Y.Z)"
fi

cd "$ROOT_DIR"

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
info "Current version: v${CURRENT_VERSION}"
info "New version:     v${NEW_VERSION}"
echo ""

if [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
  error "Version is already ${NEW_VERSION}"
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  error "Working directory is not clean. Commit or stash changes first."
fi

# 1. Update package.json
info "Updating package.json..."
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version

# 2. Update worker/gate-api.js
info "Updating worker/gate-api.js..."
sed -i '' "s/const CURRENT_VERSION = '${CURRENT_VERSION}'/const CURRENT_VERSION = '${NEW_VERSION}'/" worker/gate-api.js

# 3. Update frontend version references
info "Updating frontend version strings..."
# Login.tsx
if grep -q "GATE_VERSION = 'v${CURRENT_VERSION}'" src/frontend/pages/Login.tsx 2>/dev/null; then
  sed -i '' "s/GATE_VERSION = 'v${CURRENT_VERSION}'/GATE_VERSION = 'v${NEW_VERSION}'/" src/frontend/pages/Login.tsx
fi
# Sidebar.tsx
if grep -q "v${CURRENT_VERSION}" src/frontend/components/Sidebar.tsx 2>/dev/null; then
  sed -i '' "s/v${CURRENT_VERSION}/v${NEW_VERSION}/g" src/frontend/components/Sidebar.tsx
fi

# Verify changes
echo ""
info "Version references updated:"
echo "  package.json:       $(node -p "require('./package.json').version")"
echo "  worker/gate-api.js: $(grep "CURRENT_VERSION = " worker/gate-api.js | head -1 | sed "s/.*'\(.*\)'.*/\1/")"
FRONTEND_VER=$(grep -o "v[0-9]*\.[0-9]*\.[0-9]*" src/frontend/pages/Login.tsx 2>/dev/null | head -1 || echo "n/a")
echo "  Login.tsx:          ${FRONTEND_VER}"
echo ""

# 4. Build
info "Building project..."
npm run build

# 5. Commit and tag
info "Committing..."
git add -A
git commit --no-verify -m "v${NEW_VERSION}: release"

info "Tagging v${NEW_VERSION}..."
git tag -a "v${NEW_VERSION}" -m "Gate v${NEW_VERSION}"

# 6. Push
info "Pushing to origin..."
git push origin main
git push origin "v${NEW_VERSION}"

# 7. Deploy worker
info "Deploying Cloudflare Worker..."
cd worker
wrangler deploy
cd "$ROOT_DIR"

echo ""
echo -e "${GREEN}${BOLD}Release v${NEW_VERSION} complete!${RESET}"
echo ""
echo "  Git:    pushed to origin/main with tag v${NEW_VERSION}"
echo "  Worker: deployed to gate.penumbraforge.com + penumbraforge.com/gate"
echo "  API:    /api/version now returns ${NEW_VERSION}"
echo ""
echo "Users will be notified on next CLI run via 'gate update'."
