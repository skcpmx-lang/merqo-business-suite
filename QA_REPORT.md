# MERQO — Release Candidate QA Report

**Date:** 2026-09-16 · **Branch:** `arena/01a0a5fc-merqo-business-suite` · **Environment:** Linux sandbox (no GUI, no Windows runner, no printer hardware)

**Release gate (per spec):** no open P0/P1 + all listed checks PASS.
**Status:** **GATE NOT MET YET** — no open P0/P1, but the Windows-only checks below are **NOT TESTED** in this environment and cannot be converted to PASS without a Windows machine. No `.exe` is claimed or produced here.

---

## 1. Verification matrix

### PASS (verified in this environment)

| # | Check | Evidence |
|---|-------|----------|
| 1 | Test suite: 106/106 across 13 files (unit, integration, e2e) | `npx vitest run` — 106 passed |
| 2 | Strict TypeScript, **both** configs (`tsconfig.json` renderer/preload/shared, `tsconfig.node.json` main/domain/tests) | `npx tsc --noEmit` clean ×2 |
| 3 | Production renderer bundle builds | `npx vite build` — 479 kB JS, 19.6 kB CSS |
| 4 | Real shop-day simulation (open shift → purchase → barcode sale → cash sale → credit sale → sales return → purchase return → MFS cash-in → close shift) with reconciliation invariants | `tests/e2e/shop-day.test.ts` (12 steps) |
| 5 | Accounting reconciliation with shared logic: account balance == ledger SUM (all accounts); inventory quantity == movements SUM; customer due / supplier payable == transaction SUMs; daily closing == sales summary | e2e invariants + `money-precision` account recompute |
| 6 | Money precision: integer paise everywhere; order-discount proration parts sum exactly to whole; weighted-average cost `floor((q·avg+inQ·inCost)/(q+inQ)+0.5)`; COGS = `round(avg·qty)`; 300-sale mixed stress with account == exact cash sum | `tests/integration/money-precision.test.ts` (4 tests) |
| 7 | Double submission: same key+payload replays stored result (exactly one sale row); same key+different payload → `CONFLICT`; keyless requests execute independently | `tests/integration/ipc-security.test.ts` (3 tests) |
| 8 | IPC security: 100% of business channels require a valid session; permission gate fires **before** any domain code (verified with DENIED ≠ NOT_FOUND on a fake entity); invalid/revoked token → `UNAUTHORIZED`; no stack traces cross the bridge (generic Bangla message, detail logged only) | `ipc-security.test.ts` (8 tests) |
| 9 | Permission matrix: owner (all), manager (all − users.manage/backup.restore/data.delete), cashier (POS set incl. products.view), inventory_manager, accountant — seeded from `DEFAULT_ROLE_PERMISSIONS` and enforced at the dispatch boundary | role seed (migration 0002/0004) + `ipc-security` matrix tests |
| 10 | Multi-business isolation: every domain query is business-scoped; print channels resolve session → `invoices.view` → business-scope lookup; another business's sale id returns `NOT_FOUND`, never data | `print.test.ts` + scoping across 20 domain services |
| 11 | Renderer hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; typed preload bridge only; external links open in OS browser | `src/main/index.ts`, `src/preload/index.ts` |
| 12 | Barcode: HID-style exact/unique lookup + unknown-barcode flow (POS) + domain lookup | e2e step 3, `search`/`products.barcode` handlers |
| 13 | Print **templates** (main-process HTML): exact BDT money (৳ 450.00), reference, customer, 57mm/80mm widths, void stamp, A4 invoice, `invoice.show_customer_info` privacy, walk-in label | `tests/integration/print.test.ts` (6 tests) |
| 14 | CSV import: preview with per-row errors, column auto-mapping, execute with job log, error listing; round-trip export headers (Bangla, glossary terms) | `tests/integration/import.test.ts` |
| 15 | MFS agent: wallet setup, commission rules, cash-in/out/send-money, reconciliation vs accounts, summary | `tests/integration/mfs.test.ts` |
| 16 | Backup: create (WAL checkpoint + SHA-256 + registry in one tx + audit), verify, list, delete; restore prepare requires hash match **and** `PRAGMA quick_check` on the backup file; corrupted file refused; restore swap + auto-relaunch; restore-completion audit on next start; orphan restore-temp cleanup at startup | `backupService.ts`, `main/restore.ts`, `main/index.ts` (unit-level verified; see NOT-TESTED for the full app-restart cycle) |
| 17 | DB integrity: startup `PRAGMA integrity_check` self-check + on-demand health channel + per-backup quick_check | `db/connection.ts`, `APP_INTEGRITY` |
| 18 | Crash atomicity: failed sale (insufficient stock) rolls back fully; void = reversal (restock + money back + due reversal, document kept as বিলগা); return settlement all-or-nothing | `sale.test.ts`, `purchase.test.ts`, e2e |
| 19 | 10k+ dataset performance: 10,000 products + 2,000 domain sales — product list 7 ms, sales list 1 ms, global search 1 ms, dashboard 28 ms, sales summary 1 ms; accounts + inventory still reconcile at scale | `tests/integration/perf-10k.test.ts` (6 tests) |
| 20 | Migrations: versioned 0001–0004, tracked, idempotent permission re-seed | `db/migrate.ts` |
| 21 | Sales return settlement: `min(refund, due)` reduces receivable, remainder (pre-paid part) from account; `sales.due_paise` kept in sync so reports' current-credit figures stay true; sale status reaches `refunded` on full return; over-return blocked (inclusive boundary) | `sale.test.ts` settlement test + `purchase.test.ts` |
| 22 | Bangla language standard: one term per concept from `shared/glossary.ts` across all 20 modules (পুনরুদ্ধার, রেফারেন্স, বিক্রয় মূল্য, প্রদেয়, প্রাথমিক, সমন্বয়, ফারাক, উজড়, সাধারণ কাস্টমার, আংশিক মোট, কর, ছাড়, অর্ডার সীমা, মূল লব্ধি…); machine-translation artifacts (স্ক্রুটি, হেঁচারি, করয, দেয়াদায়ী, ফাইন্যান্সিয়াল, min/max, …) removed; POS/SKU/Barcode/PDF/CSV retained consistently; no raw errors/stacks to users (generic Bangla + log) | full-repo terminology sweeps this session |
| 23 | No fake data/placeholder functionality: every UI action maps to a real domain service; empty states, permissions and settings are wired (incl. auto-backup settings, auto-print, default customer mode, receipt paper, default printer) | code review + tests |
| 24 | Installer data safety (config-level): NSIS `deleteAppDataOnUninstall: false`; business data lives in `%APPDATA%/merqo` (outside the install dir) | `electron-builder.yml` (behavior on real Windows = NOT TESTED) |

### FAIL

*None.* All defects found this round were fixed and re-verified (see §3).

### NOT TESTED (requires Windows / GUI / hardware — do not read as PASS)

| # | Check | Why not testable here |
|---|-------|----------------------|
| 1 | Windows build: NSIS installer + portable `.exe` packaging | Linux sandbox; no Windows runner. `electron-builder.yml` is configured (nsis+portable, asarUnpack for better-sqlite3) but **no .exe is built or claimed** |
| 2 | Installer validation: install flow, shortcuts, uninstall **without deleting business data** | needs real Windows + installer |
| 3 | Full restore cycle with real app relaunch | prepare/swap/audit logic verified at unit level; the `before-quit → relaunch → open restored DB` cycle needs the packaged app |
| 4 | Physical thermal printing (57/80mm) + print-to-printer channel | no printer hardware; template + offscreen print code path verified, paper output not |
| 5 | Real PDF rendering output (`webContents.printToPDF`) | offscreen window path exists and is code-verified; pixel/geometry output needs an OS |
| 6 | DPI 100–200% × resolutions, Windows display scaling | no display |
| 7 | Visual audit of the light theme (layout, spacing, overflow with long Bangla strings at all fonts) | no GUI; styles reviewed in code only |
| 8 | HID scanner hardware behavior (scanner keyboards are just fast typing; the software lookup path is tested) | no hardware |
| 9 | Reproducible build (identical artifact hashes across clean builds) | needs the Windows build pipeline run twice |
| 10 | Windows autostart/locale/font rendering (Nirmala UI fallbacks) | no Windows |

---

## 2. Defects found & fixed this round (for the record)

| Sev | Defect | Fix |
|-----|--------|-----|
| **P0** | `saleMath.previewSaleTotals` multiplied paise by 100 (`roundToPaise` on paise) — POS preview totals were **100× the recorded bill** (always, tax on or off); §120 preview==bill violated | gross now uses the domain formula exactly: `roundToPaise(fromPaise(paise)·qty)` |
| **P0** | `saleMath.taxForBase` inclusive-price branch ×100 — domain bills with `tax_inclusive_prices=true` over-taxed 100× | rounds paise directly: `Math.round(base·bps/(10000+bps))` |
| P1 | `requirePermission` threw `UNAUTHORIZED` for a valid session lacking a permission — renderer would force re-login instead of showing no-access | new `PERMISSION_DENIED` code (`PermissionDeniedError`) |
| P1 | cashier role lacked `products.view` — POS product grid (gated on it) was broken for the cashier | added to `DEFAULT_ROLE_PERMISSIONS.cashier` |
| P1 | Sales return never reached status `refunded` (truthy object + single-row check) — reports' status figures wrong | SUM-based full-return detection + `.has_unreturned` |
| P1 | Return quantity check blocked the exact remaining quantity (epsilon on wrong side) — full-line returns impossible | `qty+already > item.qty + QTY_EPS` |
| P1 | Returns didn't decrement `sales.due_paise` — reports' current-credit totals overstated after returns | due updated in the return transaction |
| P1 | Print channels had **no authentication** (renderer sent only a sale id) | session + `invoices.view` + business scope on all print channels |
| P1 | `printToPDF` pageSize was in pixels (215×1500 interpreted as inches ≈ a 215-inch page) | inches: 57mm 2.24×20, 80mm 3.15×20 |
| P1 | Renderer ran with `sandbox: false`; crash dialog exposed raw error text; save-file name unsanitized; dialogs could crash on a closing window | `sandbox: true`; generic Bangla crash message (stack → log only); `path.basename` sanitize; null-safe dialog helpers |
| P2 | Movement ledger used raw adjustment types (`increase`/`decrease`…) instead of the stable `adjustment`; movement reference numbers invisible in UI | stable type + `reference_no` joins in `movementHistory` |
| P2 | Inventory stat cards / price history / notifications / global search read wrong column keys (always 0/empty) | keys aligned to domain output |
| P2 | Restore: no structural check of backup file, no completion audit, orphan temp files, manual-restart UX | `quick_check` gate, marker-file audit at next start, startup cleanup, auto relaunch+quit |
| P2 | Settings↔POS contract drift (`58mm` paper, `walkin/select`, `paper` vs `default_paper`, unused `default_printer`) | aligned: `57mm/80mm/A4`, `walk_in/last_used`, `default_paper`, printer name passed to print |

## 3. Verification commands

```
npx tsc --noEmit -p tsconfig.json       # renderer/preload/shared
npx tsc --noEmit -p tsconfig.node.json  # main/domain/tests
npx vitest run                          # 106/106
npx vite build                          # renderer bundle
```

## 4. Remaining work before release (owner: Windows machine)

1. Run `electron-builder` on Windows → produce NSIS + portable; verify install, shortcuts, first launch, data dir creation.
2. Uninstall test: confirm `%APPDATA%/merqo` survives.
3. Printer test: 57mm + 80mm thermal receipts, A4 invoice, print-to-printer channel, PDF save.
4. DPI 100/125/150/200% visual pass; font fallback check (Nirmala UI).
5. Full restore cycle in the packaged app (restore → relaunch → data correct → audit row present).
6. Reproducible build: two clean builds, compare hashes.
7. If any FAIL emerges, fix and re-run §3.
