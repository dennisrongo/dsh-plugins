# dev-link.ps1 — wire these plugin sources into your dsh profiles so builds self-deploy.
#
# Two jobs, both idempotent, and both undone by any `pnpm install`:
#
#   1. DEPENDENCY ANCHORING (inside each plugin folder)
#      Junction <plugin>\node_modules\@deepseek-ai\<pkg> to the dsh CLI host's
#      own copy. Two reasons, in order of how loudly they fail:
#        a. RESOLUTION. A junctioned plugin is loaded through its REAL path, so
#           Node resolves from this repo, not from the profile. There is no
#           @deepseek-ai directory above this repo, so without these junctions
#           the harness dies at boot with ERR_MODULE_NOT_FOUND. This is the one
#           that actually bites. It is also what makes each package's
#           tsconfig.json "paths" resolve, so `pnpm typecheck` needs it too.
#        b. IDENTITY. Typert's @Remote marker table is a module-level WeakMap in
#           dsh-typert-protocol, so it is per PHYSICAL COPY, not per version:
#           markers written through one copy are invisible to a registry holding
#           another. These plugins publish endpoints through their './typert'
#           MANIFEST export, which is plain data and therefore immune — but
#           anything relying on decorator reflection would 404 silently, with
#           Promise.allSettled swallowing the failure. One copy set is cheap
#           insurance; the same version is NOT the same copy.
#
#   2. LIVE DEPLOY (inside each profile)
#      Junction <profile>\node_modules\@dennisrongo\<plugin> to the plugin
#      folder. pnpm materialises "file:" deps as real directory copies frozen at
#      install time, so `pnpm run build` here does NOT reach a profile. With the
#      junction the profile serves this repo's lib/ directly: client-half edits
#      deploy on browser refresh, host-half edits on profile restart.
#
# Windows only (junctions). Run from anywhere; paths are derived from this
# script's location, never hardcoded.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-link.ps1
#   ... -Profiles web,headless                 # CLI profile names
#   ... -Plugins dsh-weather                   # just one package
#   ... -ExternalPlugins my-other-plugin       # a plugin repo outside this one
#   ... -IdentityOnly                          # skip profile junctions

[CmdletBinding()]
param(
  # Packages to wire up. Defaults to every folder under plugins/.
  [string[]]$Plugins,
  # Plugin repos that live OUTSIDE this monorepo, resolved next to it.
  [string[]]$ExternalPlugins = @(),
  # dsh CLI profile names under $env:USERPROFILE\.dsh\profiles.
  [string[]]$Profiles = @('web'),
  # DSH Desktop profile names. The desktop keeps its own DSH_HOME.
  [string[]]$DesktopProfiles = @('web'),
  # Full profile paths, bypassing the two lists above entirely.
  [string[]]$ProfilePaths,
  [switch]$IdentityOnly
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path $PSScriptRoot -Parent
$pluginRoot = Join-Path $repoRoot 'plugins'
$siblingRoot = Split-Path $repoRoot -Parent

# powershell.exe -File does NOT split comma-separated array arguments, so
# `-Profiles web,headless` arrives as one string. Split it here so the
# documented invocation works under both -File and -Command.
function Split-List([string[]]$values) {
  if (-not $values) { return @() }
  return @($values | ForEach-Object { $_ -split ',' } | Where-Object { $_ -ne '' })
}
$Plugins         = Split-List $Plugins
$ExternalPlugins = Split-List $ExternalPlugins
$Profiles        = Split-List $Profiles
$DesktopProfiles = Split-List $DesktopProfiles
$ProfilePaths    = Split-List $ProfilePaths

if (-not $Plugins) {
  $Plugins = Get-ChildItem $pluginRoot -Directory | Select-Object -ExpandProperty Name
}
$Plugins = @($Plugins) + @($ExternalPlugins)

# Where the dsh CLI keeps its own dependency copies. Override with
# DSH_HOST_DEPS if your global install lives somewhere unusual.
function Resolve-HostDeps {
  if ($env:DSH_HOST_DEPS -and (Test-Path $env:DSH_HOST_DEPS)) { return $env:DSH_HOST_DEPS }
  $candidates = @()
  try {
    $npmRoot = (& npm root -g 2>$null | Select-Object -First 1)
    if ($npmRoot) { $candidates += (Join-Path $npmRoot '@deepseek-ai\dsh\node_modules\@deepseek-ai') }
  } catch { }
  $candidates += (Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai')
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return $null
}

$hostDeps = Resolve-HostDeps
if (-not $hostDeps) {
  Write-Host 'FATAL   could not locate the dsh CLI dependency copies.'
  Write-Host '        Install the harness first:  npm i -g @deepseek-ai/dsh'
  Write-Host '        Or point DSH_HOST_DEPS at <dsh>/node_modules/@deepseek-ai.'
  exit 1
}

$profileDirs = if ($ProfilePaths) { $ProfilePaths } else {
  @($Profiles        | ForEach-Object { Join-Path $env:USERPROFILE ".dsh\profiles\$_" }) +
  @($DesktopProfiles | ForEach-Object { Join-Path $env:APPDATA "dsh-desktop\harness\profiles\$_" })
}

$linked = 0; $skipped = 0; $already = 0; $ident = 0; $warn = 0

function Resolve-PluginSource([string]$name) {
  foreach ($base in $pluginRoot, $siblingRoot) {
    $p = Join-Path $base $name
    if (Test-Path (Join-Path $p 'package.json')) { return $p }
  }
  return $null
}

# Point $path at $target, replacing whatever is there. Returns 'linked'|'already'.
function Set-Junction([string]$path, [string]$target) {
  if (Test-Path $path) {
    $item = Get-Item $path -Force
    if ($item.LinkType -eq 'Junction' -and $item.Target -and
        ((Join-Path $item.Target[0] '') -ieq (Join-Path $target ''))) {
      return 'already'
    }
    # NEVER `Remove-Item -Recurse` a reparse point: on some Windows PowerShell
    # builds that deletes THROUGH the junction and wipes the target — which here
    # would be a plugin source folder. Unlink the reparse point itself and
    # reserve -Recurse for real directories.
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      [IO.Directory]::Delete($path, $false)
    } else {
      Remove-Item $path -Recurse -Force
    }
  }
  $parent = Split-Path $path -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  New-Item -ItemType Junction -Path $path -Target $target | Out-Null
  return 'linked'
}

# Every @deepseek-ai package this plugin needs anchored: what it declares at
# runtime, plus whatever its tsconfig maps for typechecking. Derived, so it
# cannot drift out of date.
function Get-NeededHostPackages($src) {
  $needed = New-Object System.Collections.Generic.HashSet[string]
  $pkg = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
  foreach ($field in 'dependencies', 'peerDependencies') {
    if ($pkg.PSObject.Properties.Name -contains $field -and $pkg.$field) {
      foreach ($n in $pkg.$field.PSObject.Properties.Name) {
        if ($n -like '@deepseek-ai/*') { [void]$needed.Add(($n -split '/')[1]) }
      }
    }
  }
  $tsconfig = Join-Path $src 'tsconfig.json'
  if (Test-Path $tsconfig) {
    # Strip // comments; tsconfig allows them, ConvertFrom-Json does not.
    $raw = (Get-Content $tsconfig -Raw) -replace '(?m)^\s*//.*$', ''
    try {
      $ts = $raw | ConvertFrom-Json
      if ($ts.compilerOptions.paths) {
        foreach ($key in $ts.compilerOptions.paths.PSObject.Properties.Name) {
          if ($key -like '@deepseek-ai/*') { [void]$needed.Add(($key -split '/')[1]) }
        }
      }
    } catch { Write-Host "  WARN  could not parse $tsconfig - tsconfig paths not anchored" ; $script:warn++ }
  }
  return $needed
}

Write-Host "repo        $repoRoot"
Write-Host "host deps   $hostDeps"
Write-Host ''
Write-Host '=== dependency anchoring: @deepseek-ai -> dsh CLI host copy ==='

foreach ($plugin in $Plugins) {
  $src = Resolve-PluginSource $plugin
  if (-not $src) { Write-Host "SKIP    $plugin (no package.json found)"; $skipped++; continue }

  # A junctioned plugin resolves through its real path, so its own runtime deps
  # must live in ITS node_modules — the profile's hoisted tree is off that path.
  # A pruned node_modules is why the harness can die on a missing 'zod'.
  $pkg = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
  if ($pkg.PSObject.Properties.Name -contains 'dependencies' -and $pkg.dependencies) {
    foreach ($dep in $pkg.dependencies.PSObject.Properties.Name) {
      if ($dep -like '@deepseek-ai/*') { continue }
      if (-not (Test-Path (Join-Path $src "node_modules\$dep"))) {
        Write-Host "  WARN  $plugin is missing runtime dep '$dep' - run 'pnpm install' at the repo root"
        $warn++
      }
    }
  }

  $needed = Get-NeededHostPackages $src
  if ($needed.Count -eq 0) { Write-Host "  --    $plugin needs no @deepseek-ai anchoring"; continue }

  foreach ($short in ($needed | Sort-Object)) {
    $target = Join-Path $hostDeps $short
    if (-not (Test-Path $target)) {
      Write-Host "  WARN  $plugin -> @deepseek-ai/$short not in the host copy"; $warn++; continue
    }
    $dst = Join-Path $src "node_modules\@deepseek-ai\$short"
    if ((Set-Junction $dst $target) -eq 'linked') {
      Write-Host "  IDENT $plugin -> @deepseek-ai/$short"; $ident++
    } else { $already++ }
  }
}

# --- Desktop shared deps: report only ---------------------------------------
$desktopShared = Join-Path $env:APPDATA 'dsh-desktop\harness\profiles\node_modules\@deepseek-ai'
if (Test-Path $desktopShared) {
  $onHost = 0; $onBundle = 0; $other = 0
  foreach ($entry in Get-ChildItem $desktopShared -Force) {
    if ($entry.Name -eq 'dsh') { continue }   # the desktop's own launcher; leave it alone
    $t = if ($entry.Target) { $entry.Target[0] } else { '' }
    if ($t -like "$hostDeps*") { $onHost++ }
    elseif ($t -like '*DSH Desktop*') { $onBundle++ }
    else { $other++ }
  }
  Write-Host ''
  Write-Host '=== DSH Desktop shared deps ==='
  Write-Host "  npm-host=$onHost  desktop-bundle=$onBundle  other=$other"
  if ($onBundle -gt 0) {
    # Informational. Verified against dsh 0.1.1-rc.2: every non-dsh package is
    # version-identical between the desktop bundle and the CLI host, both
    # surfaces answer /api with 200, and endpoint registration is manifest-driven
    # rather than dependent on the per-copy WeakMap. Revisit if the two dsh
    # versions ever diverge - then copy identity really would matter.
    Write-Host "  note  $onBundle package(s) resolve to the desktop bundle, not the CLI host."
    Write-Host '        Expected, and not a failure while the two dsh versions match.'
  }
}

# --- Profile junctions ------------------------------------------------------
if (-not $IdentityOnly) {
  Write-Host ''
  Write-Host '=== profile deploy junctions ==='
  foreach ($prof in $profileDirs) {
    if (-not (Test-Path $prof)) { Write-Host "SKIP    profile not found: $prof"; $skipped++; continue }

    # Only touch plugins the profile actually depends on. Junctioning a package
    # a profile never installed leaves an entry it does not declare, which its
    # next `pnpm install` prunes as extraneous anyway.
    $declared = @()
    $profManifest = Join-Path $prof 'package.json'
    if (Test-Path $profManifest) {
      $pm = Get-Content $profManifest -Raw | ConvertFrom-Json
      if ($pm.dependencies) { $declared = $pm.dependencies.PSObject.Properties.Name }
    }

    foreach ($plugin in $Plugins) {
      $src = Resolve-PluginSource $plugin
      if (-not $src) { $skipped++; continue }

      $pkgName = (Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json).name
      if ($declared -notcontains $pkgName) {
        Write-Host "  --    $plugin not a dependency of $(Split-Path $prof -Leaf) - left alone"
        continue
      }

      # Install location follows the PACKAGE NAME, not the folder name: scoped
      # packages land in node_modules\@scope\name, unscoped ones directly in
      # node_modules\name. Both shapes exist in this repo.
      $dst = Join-Path $prof (Join-Path 'node_modules' ($pkgName -replace '/', '\'))
      $parent = Split-Path $dst -Parent
      if (-not (Test-Path $parent)) {
        Write-Host "SKIP    $plugin in $prof (no $parent - pnpm add the package there first)"
        $skipped++; continue
      }
      if ((Set-Junction $dst $src) -eq 'linked') {
        Write-Host "LINKED  $dst"; $linked++
      } else { Write-Host "ALREADY $dst"; $already++ }
    }
  }
}

Write-Host ''
Write-Host "Done. anchored=$ident linked=$linked already=$already skipped=$skipped warnings=$warn"
Write-Host 'Client-half edits: browser refresh. Host-half edits: restart the profile.'
Write-Host "Re-run after ANY 'pnpm install' - pnpm replaces junctions with copies."
if ($warn -gt 0) { Write-Host 'Review the WARN lines above before trusting a surface.' }
