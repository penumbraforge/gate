#!/bin/bash
set -euo pipefail

# Gate Release Script
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 2.1.0
#
# This script:
#   1. Updates version in package.json
#   2. Rebuilds the action bundle and regenerates the rule-count docs
#   3. Runs tests + self-scan
#   4. Commits, tags, and pushes
#
# Pushing the v<version> tag triggers .github/workflows/release.yml, which
# publishes to npm via OIDC trusted publishing (no npm token needed here).

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
  echo "  Example: $0 2.1.0"
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

# 2. Rebuild the GitHub Action bundle and regenerate the rule-count docs so the
#    committed artifacts match the new version before tagging.
info "Building action bundle..."
npm run build:action

info "Regenerating docs..."
npm run docs

# 3. Run tests
info "Running tests..."
npm test

# 4. Self-scan
info "Running self-scan..."
node bin/gate.js scan --all

# 5. Commit and tag
info "Committing..."
git add package.json package-lock.json github-action/dist README.md GUIDE.md
git commit -m "v${NEW_VERSION}: release"

info "Tagging v${NEW_VERSION}..."
git tag -a "v${NEW_VERSION}" -m "Gate v${NEW_VERSION}"

# 6. Push
REMOTE="${GATE_REMOTE:-$(git remote | head -1)}"
if [ -z "$REMOTE" ]; then
  error "No git remote configured. Set GATE_REMOTE or add a remote."
fi
info "Pushing to ${REMOTE}..."
git push "$REMOTE" main
git push "$REMOTE" "v${NEW_VERSION}"

echo ""
echo -e "${GREEN}${BOLD}Release v${NEW_VERSION} complete!${RESET}"
echo ""
echo "  Git: pushed to ${REMOTE}/main with tag v${NEW_VERSION}"
echo "  npm: the v${NEW_VERSION} tag triggers .github/workflows/release.yml (OIDC publish)"
echo ""
echo "Users will be notified on next CLI run via 'gate update'."
