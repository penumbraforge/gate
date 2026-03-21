/**
 * Cloudflare Worker — Penumbra Gate
 *
 * Routes (gate.penumbraforge.com only):
 *   /              — docs hub
 *   /api/version   — CLI auto-updater endpoint
 *   /api/health    — health check
 *   /install.sh    — macOS/Linux installer
 *   /install.ps1   — Windows installer
 *
 * Marketing page now served from penumbraforge.com/gate/ via GitHub Pages
 * Full docs at penumbraforge.com/gate/dashboard/ via GitHub Pages
 */

const CURRENT_VERSION = '1.3.2';
const DOWNLOAD_URL = 'https://www.npmjs.com/package/@penumbra/gate';
const DASHBOARD_URL = 'https://penumbraforge.com/gate/dashboard/';
const MARKETING_URL = 'https://penumbraforge.com/gate/';
const GITHUB_REPO = 'penumbraforge/gate';

// Install scripts are embedded so they can be served without external fetch
const INSTALL_SH = `#!/bin/bash
set -euo pipefail

BOLD="\\033[1m"
DIM="\\033[2m"
GREEN="\\033[32m"
YELLOW="\\033[33m"
RED="\\033[31m"
RESET="\\033[0m"

MIN_NODE_VERSION=18

info()  { echo -e "\${BOLD}\${GREEN}>>>\${RESET} $1"; }
warn()  { echo -e "\${BOLD}\${YELLOW}>>>\${RESET} $1"; }
error() { echo -e "\${BOLD}\${RED}>>>\${RESET} $1"; exit 1; }

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Darwin) PLATFORM="macOS" ;;
    Linux)  PLATFORM="Linux" ;;
    *)      error "Unsupported OS: $OS" ;;
  esac
  case "$ARCH" in
    x86_64|amd64)  ARCH_LABEL="x64" ;;
    arm64|aarch64) ARCH_LABEL="arm64" ;;
    *)             error "Unsupported architecture: $ARCH" ;;
  esac
  info "Detected \${PLATFORM} (\${ARCH_LABEL})"
}

check_node() {
  if ! command -v node &>/dev/null; then
    warn "Node.js is not installed."
    echo "  Install Node.js >= \${MIN_NODE_VERSION}:"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    echo "    nvm install --lts"
    error "Please install Node.js and re-run this script."
  fi
  NODE_VERSION=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
    error "Node.js v\${NODE_VERSION} found, but >= v\${MIN_NODE_VERSION} is required."
  fi
  info "Node.js $(node -v) detected"
}

INSTALL_DIR="\${HOME}/.gate/app"

install_gate() {
  if command -v git &>/dev/null; then
    info "Installing Gate from GitHub..."
    if [ -d "\${INSTALL_DIR}/.git" ]; then
      info "Existing installation found, updating..."
      cd "\${INSTALL_DIR}"
      git pull --ff-only || error "git pull failed. Delete ~/.gate/app and re-run."
    else
      rm -rf "\${INSTALL_DIR}"
      git clone --depth 1 https://github.com/penumbraforge/gate.git "\${INSTALL_DIR}" || error "git clone failed."
      cd "\${INSTALL_DIR}"
    fi
  else
    info "git not found, installing via npm tarball..."
    npm install -g https://github.com/penumbraforge/gate/tarball/main || error "npm install failed."
    return 0
  fi

  info "Installing dependencies..."
  npm install --production=false || error "npm install failed."

  info "Building..."
  npm run build || error "Build failed."

  # Symlink gate binary
  GATE_BIN="\${INSTALL_DIR}/bin/gate.js"
  NPM_BIN_DIR="$(npm bin -g 2>/dev/null || npm prefix -g)/bin"
  mkdir -p "\${NPM_BIN_DIR}" 2>/dev/null || true

  if [ -w "\${NPM_BIN_DIR}" ]; then
    ln -sf "\${GATE_BIN}" "\${NPM_BIN_DIR}/gate" 2>/dev/null && info "Linked gate to \${NPM_BIN_DIR}/gate"
  fi

  # Also link to ~/.gate/bin for PATH fallback
  mkdir -p "\${HOME}/.gate/bin"
  printf '#!/bin/sh\\nexec node "\${HOME}/.gate/app/bin/gate.js" "$@"\\n' > "\${HOME}/.gate/bin/gate"
  chmod +x "\${HOME}/.gate/bin/gate"
  info "Installed to ~/.gate/bin/gate"
}

add_to_path() {
  GATE_BIN_DIR="\${HOME}/.gate/bin"
  case ":\${PATH}:" in
    *":\${GATE_BIN_DIR}:"*) return ;;
  esac

  for RC_FILE in "\${HOME}/.zshrc" "\${HOME}/.bashrc" "\${HOME}/.profile"; do
    if [ -f "\${RC_FILE}" ]; then
      if ! grep -q '.gate/bin' "\${RC_FILE}" 2>/dev/null; then
        echo "" >> "\${RC_FILE}"
        echo '# Penumbra Gate' >> "\${RC_FILE}"
        echo 'export PATH="\${HOME}/.gate/bin:\${PATH}"' >> "\${RC_FILE}"
        info "Added ~/.gate/bin to PATH in \$(basename \${RC_FILE})"
      fi
    fi
  done
  export PATH="\${GATE_BIN_DIR}:\${PATH}"
}

main() {
  echo ""
  echo -e "\${BOLD}Penumbra Gate Installer\${RESET}"
  echo "─────────────────────────────────"
  echo ""
  detect_platform
  check_node
  if ! command -v npm &>/dev/null; then error "npm not found."; fi
  info "npm $(npm -v) detected"
  install_gate
  add_to_path

  # Run setup if possible
  if command -v gate &>/dev/null; then
    info "Running first-time setup..."
    gate setup --skip-db
  elif [ -f "\${HOME}/.gate/app/bin/gate.js" ]; then
    info "Running first-time setup..."
    node "\${HOME}/.gate/app/bin/gate.js" setup --skip-db
  fi

  echo ""
  echo -e "\${GREEN}\${BOLD}Gate installed successfully!\${RESET}"
  echo ""
  echo "  gate scan           Scan staged files for secrets"
  echo "  gate install        Install pre-commit hook"
  echo "  gate serve          Start the dashboard on :3000"
  echo ""
  echo "  If 'gate' is not found, restart your terminal or run:"
  echo "    export PATH=\"\\\$HOME/.gate/bin:\\\$PATH\""
  echo ""
}

main
`;

const INSTALL_PS1 = `$ErrorActionPreference = "Stop"
$MinNodeVersion = 18

function Write-Info($msg) { Write-Host ">>> $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host ">>> $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host ">>> $msg" -ForegroundColor Red; exit 1 }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Warn "Node.js is not installed."
    Write-Host "  Install: winget install OpenJS.NodeJS.LTS"
    Write-Err "Please install Node.js and re-run."
}

$version = (node -v) -replace '^v', ''
$major = [int]($version.Split('.')[0])
if ($major -lt $MinNodeVersion) { Write-Err "Node.js v$major found, need >= v$MinNodeVersion." }
Write-Info "Node.js v$version detected"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Write-Err "npm not found." }
Write-Info "npm v$(npm -v) detected"

$InstallDir = "$env:USERPROFILE\\.gate\\app"

# Install from GitHub
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
    Write-Info "Installing Gate from GitHub..."
    if (Test-Path "$InstallDir\\.git") {
        Write-Info "Existing installation found, updating..."
        Push-Location $InstallDir
        git pull --ff-only
        Pop-Location
    } else {
        if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
        git clone --depth 1 https://github.com/penumbraforge/gate.git $InstallDir
    }
    Push-Location $InstallDir
    Write-Info "Installing dependencies..."
    npm install
    Write-Info "Building..."
    npm run build
    Pop-Location
} else {
    Write-Info "git not found, installing via npm tarball..."
    npm install -g https://github.com/penumbraforge/gate/tarball/main
}

# Create wrapper script
$BinDir = "$env:USERPROFILE\\.gate\\bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$nl = [Environment]::NewLine
$wrapper = "@echo off" + $nl + "node " + [char]34 + "%USERPROFILE%\\.gate\\app\\bin\\gate.js" + [char]34 + " %*"
Set-Content -Path "$BinDir\\gate.cmd" -Value $wrapper
Write-Info "Installed to $BinDir\\gate.cmd"

# Add to PATH for current session
$env:PATH = "$BinDir;$env:PATH"

# Persist to user PATH
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable('PATH', "$BinDir;" + $userPath, 'User')
    Write-Info "Added $BinDir to user PATH"
}

# Run first-time setup
$gateJs = "$InstallDir\\bin\\gate.js"
if (Test-Path $gateJs) {
    Write-Info "Running first-time setup..."
    node $gateJs setup --skip-db
}

Write-Host ""
Write-Host "Gate installed successfully!" -ForegroundColor Green
Write-Host "  gate scan     Scan staged files"
Write-Host "  gate install  Install pre-commit hook"
Write-Host "  gate serve    Start the dashboard on :3000"
Write-Host ""
`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ─── gate.penumbraforge.com — Wiki + Files + API ───

    // API: Version check (used by CLI auto-updater)
    if (path === '/api/version') {
      return Response.json({
        version: CURRENT_VERSION,
        latest: true,
        downloadUrl: DOWNLOAD_URL,
        releaseNotes: `Gate v${CURRENT_VERSION}`,
        github: `https://github.com/${GITHUB_REPO}`,
        install: {
          npm: 'npm install -g @penumbra/gate@latest',
          unix: 'curl -fsSL https://gate.penumbraforge.com/install.sh | bash',
          windows: 'irm https://gate.penumbraforge.com/install.ps1 | iex',
          git: `git clone https://github.com/${GITHUB_REPO}.git && cd gate && npm install && npm run build`,
        },
      }, {
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=300' },
      });
    }

    // API: Health check
    if (path === '/api/health') {
      return Response.json(
        { status: 'ok', timestamp: new Date().toISOString() },
        { headers: corsHeaders },
      );
    }

    // API: License verification
    if (path === '/api/verify' && request.method === 'POST') {
      return Response.json({
        error: 'License verification should be done against the main Gate API server.',
        docs: DASHBOARD_URL,
      }, { status: 400, headers: corsHeaders });
    }

    // Serve install scripts
    if (path === '/install.sh') {
      return new Response(INSTALL_SH, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (path === '/install.ps1') {
      return new Response(INSTALL_PS1, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Root — wiki / docs landing page
    if (path === '/' || path === '') {
      return new Response(getWikiHTML(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=1800',
        },
      });
    }

    // 404 for everything else
    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  },
};

function getWikiHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>gate docs — penumbra forge</title>
  <meta name="description" content="Gate documentation, install scripts, CLI reference, and API docs. Zero-trust pre-commit secret defense by Penumbra Forge.">
  <meta name="theme-color" content="#07070b">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #07070b;
      --surface: #0b0b11;
      --border: #1a1a24;
      --text: #8a8a98;
      --text-bright: #aaaabc;
      --text-dim: #3a3a48;
      --prompt: #6b8f6b;
      --accent: #687a8e;
      --accent-hover: #8a9aae;
      --success: #6b8f6b;
      --error: #8a5555;
    }
    html { scroll-behavior: smooth; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
    body {
      font-family: 'JetBrains Mono', monospace;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      line-height: 1.7;
      overflow-x: hidden;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.02) 1px, rgba(0,0,0,0.02) 2px);
      pointer-events: none;
      z-index: 100;
    }
    ::-webkit-scrollbar { width: 3px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); }

    nav {
      position: sticky; top: 0; left: 0; right: 0; z-index: 50;
      background: rgba(7,7,11,0.92);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
    }
    .nav-inner {
      max-width: 840px; margin: 0 auto;
      display: flex; align-items: center; justify-content: space-between; height: 48px;
    }
    .nav-brand { color: var(--text-bright); font-size: 12px; font-weight: 500; letter-spacing: 0.06em; text-decoration: none; }
    .nav-brand:hover { color: #fff; }
    .nav-links { display: flex; gap: 20px; align-items: center; }
    .nav-links a { color: var(--text-dim); text-decoration: none; font-size: 11px; letter-spacing: 0.04em; transition: color 0.2s; }
    .nav-links a:hover { color: var(--text); }
    .nav-back { color: var(--text-dim); text-decoration: none; font-size: 11px; transition: color 0.2s; }
    .nav-back:hover { color: var(--text); }
    .nav-badge { font-size: 9px; color: var(--prompt); border: 1px solid var(--border); padding: 2px 6px; letter-spacing: 0.08em; }

    .content { max-width: 840px; margin: 0 auto; padding: 0 24px; flex: 1; }
    section { padding: 48px 0; border-bottom: 1px solid var(--border); }
    section:last-of-type { border-bottom: none; }

    .section-label {
      font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-dim); margin-bottom: 20px;
    }
    .section-label::before { content: '# '; color: var(--border); }

    .header { padding: 80px 0 40px; border-bottom: 1px solid var(--border); }
    .header h1 { font-size: 14px; font-weight: 500; color: var(--text-bright); letter-spacing: 0.06em; margin-bottom: 8px; }
    .header p { font-size: 12px; color: var(--text-dim); }

    .card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); border: 1px solid var(--border); }
    .card {
      background: var(--surface); padding: 24px; text-decoration: none; display: block; transition: background 0.2s;
    }
    .card:hover { background: rgba(11,11,17,0.6); }
    .card-icon { color: var(--prompt); font-size: 14px; margin-bottom: 10px; display: block; }
    .card h3 { font-size: 12px; color: var(--text-bright); font-weight: 500; margin-bottom: 6px; }
    .card p { font-size: 11px; color: var(--text-dim); line-height: 1.6; }
    .card-link { font-size: 10px; color: var(--accent); margin-top: 10px; display: inline-block; }

    .install-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
    .install-block {
      background: var(--surface); border: 1px solid var(--border); padding: 14px 18px; position: relative;
    }
    .install-block-label {
      font-size: 10px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase;
      position: absolute; top: -8px; left: 12px; background: var(--surface); padding: 0 6px;
    }
    .install-block code { color: var(--text-bright); font-size: 11px; display: block; margin-top: 4px; white-space: nowrap; overflow-x: auto; }
    .install-block code .p { color: var(--prompt); user-select: none; }
    .install-block .cmd-row { display: flex; align-items: center; gap: 8px; }
    .copy-btn {
      background: none; border: 1px solid var(--border); color: var(--text-dim);
      font-family: inherit; font-size: 10px; padding: 3px 8px; cursor: pointer;
      transition: all 0.2s; white-space: nowrap; flex-shrink: 0;
    }
    .copy-btn:hover { color: var(--text); border-color: var(--text-dim); }
    .copy-btn.copied { color: var(--success); border-color: var(--success); }

    .cli-row { display: grid; grid-template-columns: 160px 1fr; border-bottom: 1px solid var(--border); font-size: 11px; }
    .cli-row:last-child { border-bottom: none; }
    .cli-name { padding: 8px 0; color: var(--text-bright); }
    .cli-desc { padding: 8px 0; color: var(--text-dim); }

    .security-items { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
    .security-item { font-size: 11px; color: var(--text-dim); padding-left: 18px; position: relative; }
    .security-item::before { content: '\\2713'; position: absolute; left: 0; color: var(--success); font-size: 10px; }
    .security-item strong { color: var(--text); font-weight: 400; }

    footer { border-top: 1px solid var(--border); padding: 32px 0; text-align: center; }
    .footer-links { display: flex; justify-content: center; gap: 24px; margin-bottom: 16px; }
    .footer-links a { color: var(--text-dim); text-decoration: none; font-size: 11px; transition: color 0.2s; }
    .footer-links a:hover { color: var(--text); }
    .footer-copy { font-size: 10px; color: var(--text-dim); letter-spacing: 0.04em; }

    @media (max-width: 640px) {
      .card-grid { grid-template-columns: 1fr; }
      .install-row { grid-template-columns: 1fr; }
      .cli-row { grid-template-columns: 1fr; }
      .cli-name { padding-bottom: 0; }
      .header { padding: 64px 0 32px; }
    }
  </style>
</head>
<body>

<nav>
  <div class="nav-inner">
    <a href="https://penumbraforge.com/gate/" class="nav-back">&larr; gate</a>
    <div style="display:flex;align-items:center;gap:10px">
      <a href="/" class="nav-brand">gate docs</a>
      <span class="nav-badge">v${CURRENT_VERSION}</span>
    </div>
    <div class="nav-links">
      <a href="https://penumbraforge.com/gate/">product</a>
      <a href="https://penumbraforge.com/gate/dashboard/">full docs</a>
      <a href="https://github.com/${GITHUB_REPO}">github</a>
    </div>
  </div>
</nav>

<div class="content">
  <div class="header">
    <h1>penumbra gate</h1>
    <p>zero-trust pre-commit secret defense. documentation, downloads, and cli reference.</p>
  </div>

  <section>
    <div class="section-label">resources</div>
    <div class="card-grid">
      <a href="https://penumbraforge.com/gate/" class="card">
        <span class="card-icon">&rarr;</span>
        <h3>getting started</h3>
        <p>install gate, configure your first pre-commit hook, and scan your repository for secrets.</p>
        <span class="card-link">view guide &rarr;</span>
      </a>
      <a href="https://penumbraforge.com/gate/dashboard/" class="card">
        <span class="card-icon">&equiv;</span>
        <h3>full documentation</h3>
        <p>dashboard tabs, cli reference, detection rules, and plan comparison. the complete reference.</p>
        <span class="card-link">view docs &rarr;</span>
      </a>
      <a href="https://github.com/${GITHUB_REPO}" class="card">
        <span class="card-icon">&diams;</span>
        <h3>source code</h3>
        <p>browse the source, file issues, and contribute. gate is open source under the MIT license.</p>
        <span class="card-link">github.com/penumbraforge/gate &rarr;</span>
      </a>
      <a href="/api/version" class="card">
        <span class="card-icon">#!</span>
        <h3>api endpoints</h3>
        <p>version check and health endpoints used by the CLI auto-updater and monitoring.</p>
        <span class="card-link">/api/version &rarr;</span>
      </a>
      <a href="/install.sh" class="card">
        <span class="card-icon">$_</span>
        <h3>install script (unix)</h3>
        <p>bash installer for macOS and linux. detects platform, verifies node.js, clones and builds.</p>
        <span class="card-link">install.sh &rarr;</span>
      </a>
      <a href="/install.ps1" class="card">
        <span class="card-icon">&gt;_</span>
        <h3>install script (windows)</h3>
        <p>powershell installer for windows. validates node.js, installs globally, runs initial setup.</p>
        <span class="card-link">install.ps1 &rarr;</span>
      </a>
    </div>
  </section>

  <section>
    <div class="section-label">quick install</div>
    <div class="install-row">
      <div class="install-block">
        <span class="install-block-label">macos / linux</span>
        <div class="cmd-row">
          <code><span class="p">$ </span>curl -fsSL https://penumbraforge.com/install.sh | sh</code>
          <button class="copy-btn" onclick="copyCmd(this, 'curl -fsSL https://penumbraforge.com/install.sh | sh')">copy</button>
        </div>
      </div>
      <div class="install-block">
        <span class="install-block-label">windows</span>
        <div class="cmd-row">
          <code><span class="p">&gt; </span>irm penumbraforge.com/install.ps1 | iex</code>
          <button class="copy-btn" onclick="copyCmd(this, 'irm penumbraforge.com/install.ps1 | iex')">copy</button>
        </div>
      </div>
    </div>
    <div style="margin-top:12px;font-size:11px;color:var(--text-dim)">or: <code style="color:var(--accent)">npm install -g @penumbraforge/gate</code></div>
  </section>

  <section>
    <div class="section-label">cli reference</div>
    <div style="background:var(--surface);border:1px solid var(--border);padding:4px 0">
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate scan</div><div class="cli-desc">scan files for secrets. use --staged for pre-commit, --all for entire repo</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate install</div><div class="cli-desc">install the pre-commit hook in the current git repository</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate uninstall</div><div class="cli-desc">remove the pre-commit hook</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate serve</div><div class="cli-desc">start the dashboard and api server on localhost:3000</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate setup</div><div class="cli-desc">first-time setup: deps, database, prisma, build, hook</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate vault</div><div class="cli-desc">aes-256-gcm local encryption. set, get, list, delete, export</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate auth</div><div class="cli-desc">manage authentication. login, logout, status, token</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate audit</div><div class="cli-desc">view scan history and audit trail</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate worker</div><div class="cli-desc">start background scan worker (bullmq, for webhook scans)</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate config</div><div class="cli-desc">show or edit gate configuration</div></div>
      <div class="cli-row"><div class="cli-name" style="padding-left:14px">gate version</div><div class="cli-desc">print installed version and check for updates</div></div>
    </div>
  </section>

  <section>
    <div class="section-label">security architecture</div>
    <div class="security-items">
      <div class="security-item"><strong>local-only scanning.</strong> all scanning runs on your machine. no code transmitted. no telemetry.</div>
      <div class="security-item"><strong>aes-256-gcm vault.</strong> keys generated and stored locally at ~/.gate/vault.key. never transmitted.</div>
      <div class="security-item"><strong>encrypted github oauth tokens.</strong> stored with aes-256-gcm. we cannot read them.</div>
      <div class="security-item"><strong>secure session cookies.</strong> httpOnly, sameSite strict, signed. no localStorage tokens.</div>
      <div class="security-item"><strong>opt-in error reporting</strong> with sanitized data. nothing sent without explicit consent.</div>
    </div>
  </section>
</div>

<footer>
  <div class="content">
    <div class="footer-links">
      <a href="https://penumbraforge.com">penumbraforge.com</a>
      <a href="https://penumbraforge.com/gate/">gate</a>
      <a href="https://penumbraforge.com/gate/dashboard/">full docs</a>
      <a href="https://github.com/${GITHUB_REPO}">github</a>
    </div>
    <div class="footer-copy">&copy; 2026 penumbra forge. all rights reserved.</div>
  </div>
</footer>

<script>
  function copyCmd(btn, text) {
    navigator.clipboard.writeText(text).then(function() {
      btn.textContent = 'copied';
      btn.classList.add('copied');
      setTimeout(function() {
        btn.textContent = 'copy';
        btn.classList.remove('copied');
      }, 2000);
    });
  }
</script>
</body>
</html>`;
}

