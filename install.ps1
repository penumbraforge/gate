# Gate All-in-One Installer for Windows
# Usage: irm https://gate.penumbraforge.com/install.ps1 | iex

$ErrorActionPreference = "Stop"

$MinNodeVersion = 18
$RepoUrl = "https://github.com/penumbraforge/gate.git"
$GateDir = if ($env:GATE_HOME) { $env:GATE_HOME } else { Join-Path $env:USERPROFILE ".gate" }
$InstallDir = Join-Path $GateDir "app"
$TotalSteps = 8

function Write-Info($msg)  { Write-Host ">>> $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host ">>> $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host ">>> $msg" -ForegroundColor Red; exit 1 }
function Write-Step($n, $msg) { Write-Host "`n[$n/$TotalSteps] $msg" -ForegroundColor Cyan }

# ── 1. Check Node.js ────────────────────────────────────────────

function Test-Node {
    Write-Step 1 "Checking Node.js"
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Warn "Node.js is not installed."
        Write-Host ""
        Write-Host "  Install Node.js >= $MinNodeVersion using one of:"
        Write-Host ""
        Write-Host "    winget:      winget install OpenJS.NodeJS.LTS"
        Write-Host "    chocolatey:  choco install nodejs-lts"
        Write-Host "    direct:      https://nodejs.org/en/download"
        Write-Host ""
        Write-Err "Please install Node.js and re-run this script."
    }

    $version = (node -v) -replace '^v', ''
    $major = [int]($version.Split('.')[0])
    if ($major -lt $MinNodeVersion) {
        Write-Err "Node.js v$major found, but >= v$MinNodeVersion is required. Please upgrade."
    }

    Write-Info "Node.js v$version detected"
}

# ── 2. Check npm ────────────────────────────────────────────────

function Test-Npm {
    Write-Step 2 "Checking npm"
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Err "npm not found. Please install npm and re-run this script."
    }
    $version = npm -v
    Write-Info "npm v$version detected"
}

# ── 3. Check git ────────────────────────────────────────────────

function Test-Git {
    Write-Step 3 "Checking git"
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Write-Warn "git is not installed. Gate requires git for repository scanning."
        Write-Host "    Install: winget install Git.Git  or  https://git-scm.com/download/win"
        Write-Err "Please install git and re-run this script."
    }
    $version = (git --version) -replace 'git version ', ''
    Write-Info "git v$version detected"
}

# ── 4. Check services ──────────────────────────────────────────

$script:HasPg = $false
$script:HasRedis = $false

function Test-Services {
    Write-Step 4 "Checking services (PostgreSQL, Redis)"

    # PostgreSQL
    $pg = Get-Command pg_isready -ErrorAction SilentlyContinue
    if ($pg) {
        try {
            pg_isready -q 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Info "PostgreSQL is running"
                $script:HasPg = $true
            } else {
                Write-Warn "PostgreSQL is installed but not running"
            }
        } catch {
            Write-Warn "PostgreSQL is installed but not running"
        }
    } else {
        Write-Warn "PostgreSQL not found (optional - needed for dashboard/API)"
        Write-Host "    Install: winget install PostgreSQL.PostgreSQL"
    }

    # Redis
    $redis = Get-Command redis-cli -ErrorAction SilentlyContinue
    if ($redis) {
        try {
            $pong = redis-cli ping 2>$null
            if ($pong -eq "PONG") {
                Write-Info "Redis is running"
                $script:HasRedis = $true
            } else {
                Write-Warn "Redis is installed but not running"
            }
        } catch {
            Write-Warn "Redis is installed but not running"
        }
    } else {
        Write-Warn "Redis not found (optional - needed for background scan workers)"
        Write-Host "    Install: winget install Redis.Redis  or  https://github.com/tporadowski/redis/releases"
    }
}

# ── 5. Clone or update Gate ─────────────────────────────────────

function Install-Gate {
    Write-Step 5 "Installing Gate"

    # Create ~/.gate directory
    if (-not (Test-Path $GateDir)) {
        New-Item -ItemType Directory -Path $GateDir -Force | Out-Null
    }

    if (Test-Path (Join-Path $InstallDir ".git")) {
        Write-Info "Updating existing installation..."
        try {
            Push-Location $InstallDir
            git pull --ff-only 2>$null
            Pop-Location
        } catch {
            Write-Warn "Git pull failed, doing fresh clone..."
            Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
            git clone --depth 1 $RepoUrl $InstallDir
        }
    } else {
        Write-Info "Cloning Gate..."
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
        git clone --depth 1 $RepoUrl $InstallDir
    }

    Write-Info "Gate source installed to $InstallDir"
}

# ── 6. Install dependencies & build ────────────────────────────

function Build-Gate {
    Write-Step 6 "Installing dependencies and building"
    Push-Location $InstallDir

    npm install --no-fund --no-audit 2>&1 | Select-Object -Last 1
    Write-Info "Dependencies installed"

    npx prisma generate 2>&1 | Select-Object -Last 1
    Write-Info "Prisma client generated"

    npm run build 2>&1 | Select-Object -Last 1
    Write-Info "Build complete"

    Pop-Location
}

# ── 7. Setup database ──────────────────────────────────────────

function Setup-Database {
    Write-Step 7 "Setting up database"
    if ($script:HasPg) {
        Push-Location $InstallDir

        # Check if database exists
        try {
            $dbs = psql -lqt 2>$null
            if ($dbs -match "gate_dev") {
                Write-Info "Database gate_dev already exists"
            } else {
                createdb gate_dev 2>$null
                Write-Info "Created database gate_dev"
            }
        } catch {
            Write-Warn "Could not check/create database"
        }

        # Push schema
        $env:DATABASE_URL = "postgresql://localhost:5432/gate_dev"
        try {
            npx prisma db push --accept-data-loss 2>&1 | Select-Object -Last 1
            Write-Info "Database schema synced"
        } catch {
            Write-Warn "Could not sync database schema"
        }

        Pop-Location
    } else {
        Write-Warn "Skipping database setup (PostgreSQL not available)"
        Write-Host "    The CLI scanner works without a database."
        Write-Host "    Install PostgreSQL for the dashboard and API features."
    }
}

# ── 8. Create shim & hook ──────────────────────────────────────

function Setup-Links {
    Write-Step 8 "Setting up CLI and pre-commit hook"

    $BinDir = Join-Path $GateDir "bin"
    if (-not (Test-Path $BinDir)) {
        New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    }

    # Create a batch file shim for Windows
    $ShimPath = Join-Path $BinDir "gate.cmd"
    $GateJs = Join-Path $InstallDir "bin" "gate.js"
    Set-Content -Path $ShimPath -Value "@echo off`nnode `"$GateJs`" %*"

    # Also create a shell script for Git Bash / WSL
    $ShimSh = Join-Path $BinDir "gate"
    Set-Content -Path $ShimSh -Value "#!/bin/sh`nnode `"$GateJs`" `"`$@`""

    # Add to PATH if not already there
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($UserPath -notmatch [regex]::Escape($BinDir)) {
        [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$UserPath", "User")
        $env:PATH = "$BinDir;$env:PATH"
        Write-Info "Added $BinDir to user PATH"
    }

    # Install pre-commit hook if in a git repo
    try {
        git rev-parse --git-dir 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            node $GateJs install 2>$null
            Write-Info "Pre-commit hook installed"
        }
    } catch {
        Write-Info "Not in a git repo - skipping hook install"
        Write-Host "    Run 'gate install' inside a git repo to add the pre-commit hook"
    }
}

# ── Print success ──────────────────────────────────────────────

function Write-Success {
    $GateJs = Join-Path $InstallDir "bin" "gate.js"
    $GateVersion = try { node $GateJs version 2>$null } catch { "Gate" }

    Write-Host ""
    Write-Host ([char]0x2501 * 40) -ForegroundColor Green
    Write-Host "  $GateVersion installed successfully" -ForegroundColor Green
    Write-Host ([char]0x2501 * 40) -ForegroundColor Green
    Write-Host ""
    Write-Host "  Commands:"
    Write-Host ""
    Write-Host "    gate scan              Scan staged files for secrets"
    Write-Host "    gate scan <file>       Scan a specific file"
    Write-Host "    gate scan --remediate  Scan and auto-remediate findings"
    Write-Host "    gate install           Install pre-commit hook"
    Write-Host "    gate vault keygen      Generate encryption key"
    Write-Host "    gate vault env .env    Encrypt .env file"
    Write-Host "    gate audit             View scan history"
    Write-Host "    gate auth <key>        Activate a license key"
    Write-Host ""
    if ($script:HasPg -and $script:HasRedis) {
        Write-Host "  Dashboard & API:"
        Write-Host ""
        Write-Host "    gate serve             Start dashboard on :3000"
        Write-Host "    gate worker            Start background scan workers"
        Write-Host ""
    }
    Write-Host "  Documentation: https://gate.penumbraforge.com" -ForegroundColor DarkGray
    Write-Host "  Source:        $InstallDir" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Restart your terminal for PATH changes to take effect." -ForegroundColor Yellow
    Write-Host ""
}

# ── Main ────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Penumbra Gate - All-in-One Installer" -ForegroundColor White
Write-Host ([char]0x2501 * 40)
Write-Host ""

Test-Node
Test-Npm
Test-Git
Test-Services
Install-Gate
Build-Gate
Setup-Database
Setup-Links
Write-Success
