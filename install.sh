#!/bin/bash
set -euo pipefail

# Gate All-in-One Installer for macOS and Linux
# Usage: curl -fsSL https://gate.penumbraforge.com/install.sh | bash

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

MIN_NODE_VERSION=18
REPO_URL="https://github.com/penumbraforge/gate.git"
GATE_DIR="${GATE_HOME:-$HOME/.gate}"
INSTALL_DIR="$GATE_DIR/app"

info()    { echo -e "${BOLD}${GREEN}>>>${RESET} $1"; }
warn()    { echo -e "${BOLD}${YELLOW}>>>${RESET} $1"; }
error()   { echo -e "${BOLD}${RED}>>>${RESET} $1"; exit 1; }
step()    { echo -e "\n${BOLD}${CYAN}[$1/$TOTAL_STEPS]${RESET} $2"; }

TOTAL_STEPS=8

# ── 1. Detect platform ──────────────────────────────────────────

detect_platform() {
  step 1 "Detecting platform"
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin) PLATFORM="macOS" ;;
    Linux)  PLATFORM="Linux" ;;
    *)      error "Unsupported OS: $OS. Gate supports macOS and Linux." ;;
  esac

  case "$ARCH" in
    x86_64|amd64)  ARCH_LABEL="x64" ;;
    arm64|aarch64) ARCH_LABEL="arm64" ;;
    *)             error "Unsupported architecture: $ARCH" ;;
  esac

  info "Detected ${PLATFORM} (${ARCH_LABEL})"
}

# ── 2. Check Node.js ────────────────────────────────────────────

check_node() {
  step 2 "Checking Node.js"
  if ! command -v node &>/dev/null; then
    warn "Node.js is not installed."
    echo ""
    echo "  Install Node.js >= ${MIN_NODE_VERSION} using one of:"
    echo ""
    echo "    nvm:       curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    echo "               nvm install --lts"
    echo ""
    if [ "$PLATFORM" = "macOS" ]; then
      echo "    Homebrew:  brew install node"
    else
      echo "    apt:       sudo apt install nodejs npm"
      echo "    dnf:       sudo dnf install nodejs npm"
    fi
    echo ""
    error "Please install Node.js and re-run this script."
  fi

  NODE_VERSION=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
    error "Node.js v${NODE_VERSION} found, but >= v${MIN_NODE_VERSION} is required. Please upgrade."
  fi

  info "Node.js $(node -v) detected"
}

# ── 3. Check git ─────────────────────────────────────────────────

check_git() {
  step 3 "Checking git"
  if ! command -v git &>/dev/null; then
    warn "git is not installed. Gate requires git for repository scanning."
    echo ""
    if [ "$PLATFORM" = "macOS" ]; then
      echo "    Install: xcode-select --install  or  brew install git"
    else
      echo "    Install: sudo apt install git  or  sudo dnf install git"
    fi
    error "Please install git and re-run this script."
  fi
  info "git $(git --version | cut -d' ' -f3) detected"
}

# ── 4. Check optional services ───────────────────────────────────

check_services() {
  step 4 "Checking services (PostgreSQL, Redis)"

  HAS_PG=false
  HAS_REDIS=false

  # PostgreSQL
  if command -v pg_isready &>/dev/null; then
    if pg_isready -q 2>/dev/null; then
      info "PostgreSQL is running"
      HAS_PG=true
    else
      warn "PostgreSQL is installed but not running"
      if [ "$PLATFORM" = "macOS" ]; then
        echo "    Start it: brew services start postgresql@17"
      else
        echo "    Start it: sudo systemctl start postgresql"
      fi
    fi
  else
    # Try homebrew cellar path on macOS
    PG_BIN=$(find /opt/homebrew/Cellar/postgresql* -name "pg_isready" 2>/dev/null | head -1)
    if [ -n "$PG_BIN" ] && "$PG_BIN" -q 2>/dev/null; then
      info "PostgreSQL is running"
      HAS_PG=true
    else
      warn "PostgreSQL not found (optional — needed for dashboard/API)"
      if [ "$PLATFORM" = "macOS" ]; then
        echo "    Install: brew install postgresql@17 && brew services start postgresql@17"
      else
        echo "    Install: sudo apt install postgresql && sudo systemctl start postgresql"
      fi
    fi
  fi

  # Redis
  if command -v redis-cli &>/dev/null; then
    if redis-cli ping &>/dev/null; then
      info "Redis is running"
      HAS_REDIS=true
    else
      warn "Redis is installed but not running"
      if [ "$PLATFORM" = "macOS" ]; then
        echo "    Start it: brew services start redis"
      else
        echo "    Start it: sudo systemctl start redis"
      fi
    fi
  else
    warn "Redis not found (optional — needed for background scan workers)"
    if [ "$PLATFORM" = "macOS" ]; then
      echo "    Install: brew install redis && brew services start redis"
    else
      echo "    Install: sudo apt install redis-server && sudo systemctl start redis"
    fi
  fi
}

# ── 5. Clone or update Gate ──────────────────────────────────────

install_gate() {
  step 5 "Installing Gate"

  # Create ~/.gate directory
  mkdir -p "$GATE_DIR"
  chmod 700 "$GATE_DIR"

  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation..."
    (cd "$INSTALL_DIR" && git pull --ff-only 2>/dev/null) || {
      warn "Git pull failed, doing fresh clone..."
      rm -rf "$INSTALL_DIR"
      git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    }
  else
    info "Cloning Gate..."
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi

  info "Gate source installed to $INSTALL_DIR"
}

# ── 6. Install dependencies & build ─────────────────────────────

build_gate() {
  step 6 "Installing dependencies and building"
  (cd "$INSTALL_DIR" && npm install --no-fund --no-audit 2>&1 | tail -1)
  info "Dependencies installed"

  (cd "$INSTALL_DIR" && npx prisma generate 2>&1 | tail -1)
  info "Prisma client generated"

  (cd "$INSTALL_DIR" && npm run build 2>&1 | tail -1)
  info "Build complete"
}

# ── 7. Setup database (if PostgreSQL available) ──────────────────

setup_database() {
  step 7 "Setting up database"
  if [ "$HAS_PG" = true ]; then
    # Try to find createdb/psql
    CREATEDB=$(command -v createdb 2>/dev/null || find /opt/homebrew/Cellar/postgresql* -name "createdb" 2>/dev/null | head -1)
    PSQL=$(command -v psql 2>/dev/null || find /opt/homebrew/Cellar/postgresql* -name "psql" 2>/dev/null | head -1)

    if [ -n "$PSQL" ]; then
      # Check if database exists
      if "$PSQL" -lqt 2>/dev/null | grep -q gate_dev; then
        info "Database gate_dev already exists"
      elif [ -n "$CREATEDB" ]; then
        "$CREATEDB" gate_dev 2>/dev/null && info "Created database gate_dev" || warn "Could not create database gate_dev"
      fi

      # Push schema
      (cd "$INSTALL_DIR" && DATABASE_URL="postgresql://${USER}@localhost:5432/gate_dev" npx prisma db push --accept-data-loss 2>&1 | tail -1)
      info "Database schema synced"
    fi
  else
    warn "Skipping database setup (PostgreSQL not available)"
    echo "    The CLI scanner works without a database."
    echo "    Install PostgreSQL for the dashboard and API features."
  fi
}

# ── 8. Create symlink & hook ─────────────────────────────────────

setup_links() {
  step 8 "Setting up CLI and pre-commit hook"

  # Symlink gate binary
  BIN_DIR="$GATE_DIR/bin"
  mkdir -p "$BIN_DIR"
  ln -sf "$INSTALL_DIR/bin/gate.js" "$BIN_DIR/gate"
  chmod +x "$BIN_DIR/gate"

  # Check if bin dir is in PATH
  if ! echo "$PATH" | grep -q "$BIN_DIR"; then
    SHELL_RC=""
    if [ -f "$HOME/.zshrc" ]; then
      SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
      SHELL_RC="$HOME/.bashrc"
    elif [ -f "$HOME/.profile" ]; then
      SHELL_RC="$HOME/.profile"
    fi

    PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""

    if [ -n "$SHELL_RC" ]; then
      if ! grep -q "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
        echo "" >> "$SHELL_RC"
        echo "# Penumbra Gate" >> "$SHELL_RC"
        echo "$PATH_LINE" >> "$SHELL_RC"
        info "Added $BIN_DIR to PATH in $SHELL_RC"
      fi
    else
      warn "Add this to your shell profile:"
      echo "    $PATH_LINE"
    fi

    # Make gate available for the rest of this script
    export PATH="$BIN_DIR:$PATH"
  fi

  # Install pre-commit hook if in a git repo
  if git rev-parse --git-dir &>/dev/null; then
    node "$INSTALL_DIR/bin/gate.js" install 2>/dev/null && info "Pre-commit hook installed" || true
  else
    info "Not in a git repo — skipping hook install"
    echo "    Run 'gate install' inside a git repo to add the pre-commit hook"
  fi
}

# ── Print success ────────────────────────────────────────────────

print_success() {
  GATE_VERSION=$(node "$INSTALL_DIR/bin/gate.js" version 2>/dev/null || echo "Gate")
  echo ""
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${GREEN}${BOLD}  ${GATE_VERSION} installed successfully${RESET}"
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo "  Commands:"
  echo ""
  echo "    gate scan              Scan staged files for secrets"
  echo "    gate scan <file>       Scan a specific file"
  echo "    gate scan --remediate  Scan and auto-remediate findings"
  echo "    gate install           Install pre-commit hook"
  echo "    gate vault keygen      Generate encryption key"
  echo "    gate vault env .env    Encrypt .env file"
  echo "    gate audit             View scan history"
  echo "    gate auth <key>        Activate a license key"
  echo ""
  if [ "$HAS_PG" = true ] && [ "$HAS_REDIS" = true ]; then
    echo "  Dashboard & API:"
    echo ""
    echo "    gate serve             Start dashboard on :3000"
    echo "    gate worker            Start background scan workers"
    echo ""
  fi
  echo -e "  ${DIM}Documentation: https://gate.penumbraforge.com${RESET}"
  echo -e "  ${DIM}Source:        $INSTALL_DIR${RESET}"
  echo ""
  echo -e "  ${YELLOW}Restart your terminal or run:${RESET}"
  echo -e "    source ~/.zshrc  ${DIM}(or ~/.bashrc)${RESET}"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────

main() {
  echo ""
  echo -e "${BOLD}Penumbra Gate — All-in-One Installer${RESET}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  detect_platform
  check_node
  check_git
  check_services
  install_gate
  build_gate
  setup_database
  setup_links
  print_success
}

main
