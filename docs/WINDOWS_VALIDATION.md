# MERQO v1.0.0 — Windows Release Validation Record

**Baseline (frozen RC):** `9d35711` · **Validation attempt date:** 2026-09-16
**Status: GATE — NOT MET YET.** No mandatory Windows validation has PASSed yet;
every item below requires a real Windows machine + hardware. Nothing here is
claimed as Windows evidence except what is explicitly labeled as static evidence.

---

## 1. Why mandatory validation cannot be executed from the current environment

The current environment is a **Linux x86-64 sandbox** (kernel 6.1.158, no GUI,
no display server, no Windows, no Wine, no printer, no scanner). Probes run
2026-09-16:

| Probe | Result | Consequence |
|---|---|---|
| `uname -a` | Linux x86-64 | No Windows OS available |
| `which wine wine64` | not found | Cannot emulate a Windows runtime |
| Electron release CDN download (`github.com/electron/electron/releases/…zip`, 2 attempts) | HTTP 302 loop / curl exit 35 (SSL) | **Binary artifact egress is blocked** — even a cross-compiled Windows build is impossible here (electron-builder must download `electron-*-win32-x64.zip` + NSIS from the same CDN) |
| GitHub main site / npm registry | 200 OK | Only source-level downloads work |
| Local hardware | none | No printer (57/80/A4), no USB/BT scanner, no display for DPI 100–200% |

**Therefore items 1–26 below are all NOT TESTED.** This document records what
*was* verified statically (with evidence), the packaging defect that the static
review found and fixed, and the exact evidence each item still requires.

## 2. Static evidence gathered this round (valid on any platform)

### 2.1 Native-module strategy for the Windows build — VERIFIED

The Windows `.exe` must load `better-sqlite3`. Evidence collected:

1. `node_modules/better-sqlite3/prebuilds/win32-x64.node` **exists in the npm
   package** (1,989,632 bytes) — it will be packed into the installer by
   `asarUnpack`.
2. Its magic bytes are `MZ` → a genuine **PE (Windows) binary**.
3. It exports **`napi_register_module_v1`** → it is a **Node-API (N-API)
   module**: ABI-stable, so the *same file* loads under plain Node and under
   Electron 44 (ABI 149) without any per-Electron rebuild.
4. Local proof of the loader path: the Linux prebuild (also N-API) loads and
   runs the full **114-test suite under plain Node 22 (ABI 127)**:
   `LOADED-OK runtime=node 22.22.3 abi=127 result={"answer":42,"sum":400}`.
5. Independent corroboration: a public project on this exact stack
   (Electron 44.2 + better-sqlite3 13.0.3 + Node 22) verified
   "one binary loads under Node 22 and inside Electron 44" and removed its
   electron-rebuild step.

**Conclusion:** on a real Windows machine, `npm install` + `npm run dist:win`
will produce an installer whose better-sqlite3 loads with **no compiler
toolchain required** — provided the packaging defect below is fixed.

### 2.2 Packaging defect found & fixed (release-critical, build/packaging class)

| Sev | Defect | Symptom | Root cause | Fix | Guard |
|---|---|---|---|---|---|
| **P1** | `electron-builder.yml` had no `npmRebuild` setting (default `true`) | On a clean Windows machine (Node only, no Python/VS Build Tools), `npm run dist:win` fails at the "rebuilding native dependencies" step; and if a toolchain *is* present, the node-gyp output is **ignored anyway** — the v13 loader prefers `prebuilds/win32-x64.node` over `build/Release/` | better-sqlite3 v13 N-API prebuilds make per-Electron rebuilds both required-in-config and useless-in-practice | `npmRebuild: false` added to `electron-builder.yml` (one-line config, with rationale comment) | `tests/unit/native-prebuild.test.ts` (4 tests: prebuilds exist for all 7 platform/arch targets; win32 PE + N-API export; `npmRebuild: false` present; asarUnpack present) |

### 2.3 Cross-build attempt — attempted, blocked by environment

`npx electron-builder --win` was **not run to completion** because it requires
downloading `electron-v44.3.0-win32-x64.zip` (~120 MB) and the NSIS toolchain
from the CDN, which this sandbox blocks (evidence in §1). No `.exe`, no
installer, no SHA was produced — consistent with the gate: **no artifact is
claimed**.

## 3. Mandatory Windows validation — status matrix (26/26 NOT TESTED)

| # | Mandatory test | Status | Blocker in current environment | Evidence required on Windows |
|---|---|---|---|---|
| 1 | Production `.exe` build | **NOT TESTED** | No Windows; artifact CDN blocked | Build console output; `MERQO-1.0.0-Windows-x64.exe` (portable) + SHA-256; commit = `9d35711` (or fix commit); Node/PS version; Windows version |
| 2 | Installer build | **NOT TESTED** | same | `MERQO-Setup-1.0.0.exe` + SHA-256; NSIS log |
| 3 | Clean-install via installer | **NOT TESTED** | No clean Windows VM | Screenshot of install wizard; installed file tree |
| 4 | First launch + business setup | **NOT TESTED** | No Windows/display | Screenshots: empty start → wizard → first dashboard |
| 5 | Database & user-data path check | **NOT TESTED** | No Windows | Screenshot/listing of `%APPDATA%/merqo/merqo/merqo.db`; backup dir `%USERPROFILE%\MERQO\backups` |
| 6 | Restart → data persistence | **NOT TESTED** | No Windows | Before/after screenshot + `SELECT COUNT(*)` from businesses/users |
| 7 | Uninstall → user data preserved | **NOT TESTED** | No Windows | Uninstall screenshot; `%APPDATA%/merqo` still present; reinstall opens same data |
| 8 | USB HID barcode scanner | **NOT TESTED** | No hardware | Video/photo of scan → POS; unknown-barcode flow screenshot |
| 9 | Bluetooth/HID scanner | **NOT TESTED** | No hardware | same |
| 10 | 58mm thermal printer | **NOT TESTED** | No hardware | Photo of printed receipt (58 mm paper) |
| 11 | 80mm thermal printer | **NOT TESTED** | No hardware | Photo of printed receipt (80 mm paper) |
| 12 | A4 printer | **NOT TESTED** | No hardware | Photo of printed invoice |
| 13 | PDF generation + rendered output | **NOT TESTED** | No Windows display/PDF viewer | Opened PDF screenshots: receipt 57/80 mm + A4 invoice, Bangla + ৳ rendering |
| 14 | DPI 100/125/150/175/200% UI audit | **NOT TESTED** | No display | Screenshot grid per DPI × (normal/maximized window) |
| 15 | Bangla UI spelling/wording/clipping/overlap/Unicode/alignment | **NOT TESTED** (static review done) | No rendering | Screenshots of all 20 screens at 125% and 175% |
| 16 | POS barcode → cart → payment → invoice → stock → ledger flow | **NOT TESTED** (software sim passes on Linux) | No Windows/hardware | Screen recording + final stock/ledger screenshots |
| 17 | Purchase → stock → supplier payable → payment flow | **NOT TESTED** | No Windows | Screenshots of each step |
| 18 | Customer credit → collection → due/ledger flow | **NOT TESTED** | No Windows | Screenshots of each step |
| 19 | Sales return & purchase return | **NOT TESTED** | No Windows | Screenshots incl. status badges (ফেরত/আংশিক ফেরত) |
| 20 | MFS agent transaction + wallet reconciliation | **NOT TESTED** | No Windows | Screenshots: MFS module + reconciliation match |
| 21 | Reports vs Dashboard vs Ledger reconciliation | **NOT TESTED** (Linux sim reconciles) | No Windows | Side-by-side screenshots, identical date range |
| 22 | Backup → close → restore → relaunch → verify | **NOT TESTED** (unit-level prepare/swap verified) | No Windows | Backup file + hash; restored-DB screenshot; audit-log entry `backup.restore_complete` |
| 23 | Backup failure & corrupt-backup handling | **NOT TESTED** | No Windows | Screenshot of corrupted-file refusal dialog (hash mismatch path) |
| 24 | Import/export with real CSV | **NOT TESTED** (domain import tested) | No Windows | Screenshots: preview with per-row errors → executed job |
| 25 | Owner/Manager/Cashier permission flows in real UI | **NOT TESTED** (IPC-level matrix tested) | No Windows | Screenshots: cashier sees no profit card; manager denied restore; owner restores |
| 26 | Crash/restart → database integrity | **NOT TESTED** | No Windows | Force-kill during write; relaunch; integrity-check panel screenshot |

## 4. Windows build information (to be filled by the Windows run)

```
Commit:            9d35711 (frozen baseline) — or the exact fix commit if any
Windows version:   ____ (winver)
Architecture:      x64
Node version:      ____ (node -v, ≥ 20)
Package manager:   npm ____
electron-builder:  26.15.3
Electron:          44.3.0 (win32-x64)
better-sqlite3:    13.0.3 (N-API prebuild, win32-x64)
Installer SHA-256: ____
Portable SHA-256:  ____
Build date/time:   ____
```

## 5. Gate statement

**GATE: NOT MET YET.** All 26 mandatory validations are NOT TESTED pending a
real Windows machine with the hardware in §3. The static round did find and fix
one release-critical packaging defect (P1, `npmRebuild`) and added its
regression guard. Until §3 shows 26/26 PASS with the evidence above, no
`.exe` will be declared production-ready or release-ready.
