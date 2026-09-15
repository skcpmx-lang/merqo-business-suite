# MERQO v1.0.0 — Final Windows Release Gate: QA Report

**Date:** 2026-09-16 · **Branch:** `arena/01a0a5fc-merqo-business-suite` · **Last verified commit:** see git log (`a1c8435` baseline + hardening commits)

## RELEASE GATE STATUS: **NOT MET YET**

No open P0/P1. The Linux-verifiable phases below are PASS. Every real-Windows
item (Phases 1–8, 13–15, 17-on-Windows, 20) is **NOT TESTED** in this
environment (Linux sandbox — no Windows runner, no GUI, no printer, no scanner).
Nothing marked NOT TESTED has been converted to PASS, and no `.exe` is claimed.

---

## Phase-by-phase matrix

### PASS (verified here, Linux)

| Phase | Item | Evidence |
|---|---|---|
| 16 | Role permissions at the IPC boundary — every business channel requires a session; gate fires **before** domain code (DENIED ≠ NOT_FOUND on fake entities) | `ipc-security.test.ts` (17 tests) |
| 16 | Settings permissions (`settings.manage`): cashier denied, manager allowed | ipc-security phase-16 block |
| 16 | Backup vs restore split: manager `backup.create` yes / `backup.restore` no (role exclusion); owner restore end-to-end (prepare → `restartRequired`) | ipc-security phase-16 block |
| 16 | Financial report permissions: P&L → `profit.view`; cash-flow/balance-sheet → `accounts.view`; dues → respective view perms | permission map + matrix tests |
| 16 | **Profit visibility:** dashboard P&L/COGS fields masked per session (`profit.view`); verified against the domain's own P&L figure, masked user gets 0 + empty trends | dashboard masking test |
| 16 | Price override / discount / credit-limit override: flags **derived from the resolved role, never from the client** — role-permission narrowing provably strips them (VALIDATION / CREDIT_LIMIT returned) | sale-flags tests |
| 16 | Stock adjustment: `stock.adjust` gate; inventory_manager passes, cashier denied | phase-16 tests |
| 16 | User management: `users.manage` (cashier/manager matrix; owner-only reset path) | matrix tests |
| 16 | Audit access: `audit.view`; **queryAudit crash fixed** (ambiguous `business_id` vs users join) — accountant denied, manager reads | phase-16 tests + `auditService` fix |
| 16 | Cost visibility: dead-stock report returns cost-based value → now `stock.viewCost` (consistent with top-stock-value); dashboard stock-value masked | handler + UI guard |
| 16 | Double submission: same key+payload replays (1 row), same key+different payload → CONFLICT | idempotency tests |
| 1 (partial) | Build pipeline inputs: `electron-builder.yml` (NSIS + portable, asarUnpack for better-sqlite3), `dist`/`dist-electron` globs exist, `package.json` main entry, icon present, `deleteAppDataOnUninstall: false` | static pre-flight |
| 9/11 | Final Bangla editorial + robotic-language audit — all user-facing strings reviewed and rewritten where unnatural (e.g. "বকেয়া-বিরত"→"বকেয়ায়", "সেললে সতর্কতা"→"বিক্রি করতে অনুমতি লাগবে", "পাওয়া যাওয়া লেখা"→"নিচের লেখা", "আচরণ"→"কী হবে", "রিকোয়েস্ট চাবি"→"চাবি", "অর্থ সঠিক নয়"→"পরিমাণ সঠিক নয়", "প্রিভিউ ভ্যালিডেশন ব্যর্থ"→"প্রিভিউ ব্যর্থ হয়েছে"); anti-robotic rules documented | source sweep + `docs/BANGLA_GLOSSARY.md` |
| 10 | Bangla consistency: `docs/BANGLA_GLOSSARY.md` created; rejected terms verified **0** occurrences (মজুদ, গ্রাহক, সরবরাহকারী, রিটার্ন, আপডেট, আমদানি/রপ্তানি, শেষ-স্টক, ভ্যালিডেশন…); একশন→অ্যাকশন typo fixed | consistency greps (doc §7) |
| 12 | Production placeholder audit: no Lorem/Demo/Sample/John Doe/ABC/fake data in `src/` (only code comments mentioning "no fake data") | grep sweep |
| 14 (software) | Complete business-day simulation: shift → purchase → barcode sale → cash/credit/MFS sales → collections → returns (sales + purchase) → expenses → transfers → MFS in/out → invoices → reports → reconciliation → shift close, with every financial result reconciling | `tests/e2e/shop-day.test.ts` (12 steps) |
| 15 (software) | Cross-surface reconciliation for identical ranges: dashboard ≡ reports  ledgers ≡ accounts ≡ inventory (sales, purchases, payments, receivables, payables, cash, bank, MFS, expenses, COGS, gross, net, stock qty/value) | e2e invariants + `money-precision` (account recompute) + perf-10k consistency |
| 17 (Linux) | 10,000 products + 2,000 sales: list 7 ms, sales list 1 ms, global search 1 ms, dashboard 28 ms, summary 1 ms; accounts + inventory reconcile at scale | `perf-10k.test.ts` (6 tests) |
| 18 | This report | `docs/QA_REPORT.md` |
| — | Regression suite: **112/112** across 13 files; `tsc` clean on both configs; `vite build` clean | `npx vitest run` |

### FAIL

*None open.* (All defects found this round were fixed and re-verified — see defect log.)

### NOT TESTED (require real Windows / hardware — never read as PASS)

| Phase | Item |
|---|---|
| 1 | Production `.exe` + NSIS installer + portable build on a Windows runner/CI; app starts, correct version/icon, no dev UI, no missing deps/assets/console, no startup error; record commit/build#/Node/PM/Windows/arch |
| 2 | Clean install: install → launch → setup → configure → use → close → reopen (shortcuts, DB init, Business Setup, logo, settings/users/transactions persistence) |
| 3 | Uninstall/data safety: app removed, `%APPDATA%/merqo` + backup files survive, reinstall behavior documented (config-level intent: `deleteAppDataOnUninstall: false` — behavior on real Windows unverified) |
| 4 | Real barcode hardware: USB HID + Bluetooth scanner — known/unknown/rapid/repeated scans, suffix/enter behavior, disconnect-reconnect; no duplicate sale, no missed scan, no stray text; unknown-barcode workflow |
| 5 | Real printers: 57 mm / 80 mm thermal + A4 — receipt, invoice, customer/supplier payment receipt, purchase/return documents, daily closing, reports; Bangla glyphs, ৳, logo, margins, alignment, no clipping/blank pages |
| 6 | Real PDF rendering on Windows, visually inspected (Bangla shaping, ৳, logo, long names, many lines, multi-page) — not "file generated" |
| 7 | DPI 100/125/150/175/200% × 1366×768 / 1920×1080 / 2560×1440 / 3840×2160; normal/resized/maximized windows; all blocker classes (overlap, clipping, broken Bangla, off-viewport modals/buttons, broken tables, unusable POS, horizontal overflow) |
| 8 | Complete visual audit of all 20 screens as a senior UI/UX reviewer (typography, spacing, hierarchy, density, iconography, empty/loading/error states, modal proportions, table readability, responsiveness) |
| 9/11 (residual) | Rendering-level check: Bangla shaping + Nirmala UI fallback at real Windows fonts (code-level Unicode verified; pixel-level not) |
| 13 | Full restore on Windows: backup → close app → add transactions → restore → relaunch → verify products/stock/customers/suppliers/sales/purchases/payments/accounts/expenses/MFS/settings/users/audit |
| 14 (residual) | Same 25-step day executed **in the Windows build** with physical printing (software simulation passes on Linux) |
| 15 (residual) | Same reconciliation executed **in the Windows build** |
| 17 (residual) | 10k+ dataset in the **Windows build** — no UI freeze (Linux numbers above) |
| 20 | Final artifacts: exact `.exe`/installer/version/commit/SHA/build-date/arch, reproducible from the repo |

---

## Defect log (severity · symptom · root cause · fix · verifying test)

### Found & fixed this release-gate session

| Sev | Defect | Symptom | Root cause | Fix | Verified by |
|---|---|---|---|---|---|
| **P1** | Audit-log query crash | Every audit-log query failed with INTERNAL ("অপ্রত্যাশিত ত্রুটি"); audit tab unusable for all roles | `queryAudit` WHERE clause used unqualified `business_id` while LEFT JOINing `users` (both tables have the column) → SQLite `ambiguous column name` | Qualify `a.business_id` in the list query; keep single-table count unqualified | `ipc-security` phase-16 audit gate (manager now reads audit, accountant denied) |
| **P1** | Dashboard leaked profit/cost/balances to any role | Cashier (no `profit.view`/`accounts.view`/`stock.viewCost`) could read today's net profit, profit trend, cost-based stock value and cash/bank balances via direct IPC; UI hid the cards but the data crossed the bridge | `DASHBOARD_GET` had no field-level scope — one rollup served all roles | `getDashboard(..., access)` — profit/COGS, stock value, account balances, MFS computed+returned only when the session holds `profit.view` / `stock.viewCost` / `accounts.view` / `mfs.view`; renderer hides matching cards | `ipc-security` "dashboard masks profit/cost/balance fields" (manager = domain P&L, cashier = 0 + empty) |
| **P1** | Dead-stock report leaked cost values | `REPORT_DEAD_STOCK` returned `quantity × avg_cost` to any `reports.view` holder (accountant), while the equivalent top-stock-value report required `stock.viewCost` | Inconsistent cost-visibility gate | Channel now requires `stock.viewCost`; UI fetch guarded by the same permission | `ipc-security` "cost-based dead-stock report requires stock.viewCost" |
| **P2** | Table-header typos | Slow-moving report headers showed "প্ণ্য" / "স্ডক" | Stray matra drops in source strings | Corrected to "পণ্য" / "স্টক" | visual/source review |
| **P2** | Ambiguous/robotic UI wording (batch) | "বকেয়া-বিরত", "সেললে সতর্কতা", "পাওয়া যাওয়া লেখা", "অর্থ সঠিক নয়", "ছোট হরফ", "হোল্ড থেকে আনা যায়নি", "শেষ স্টক", "রিটার্ন হয়নি", "আপডেট", "আমদানি/রপ্তানি" mixed with "এক্সপোর্ট", "একশন" typo, "পুনঃ অর্ডার সীমা" | Machine-translation residue + term drift across modules | Rewritten to natural Bangladeshi Bangla; single canonical term per concept; rejected-terms verified at 0 occurrences | `docs/BANGLA_GLOSSARY.md` §7 greps |

### Carried from the RC-hardening round (already fixed)

| Sev | Defect | Fix (short) |
|---|---|---|
| P0 | `previewSaleTotals` gross ×100 (paise fed to taka helper) → POS preview always 100× the bill | domain formula: `roundToPaise(fromPaise(paise)·qty)` |
| P0 | `taxForBase` inclusive branch ×100 | `Math.round(base·bps/(10000+bps))` in paise |
| P1 | `requirePermission` threw `UNAUTHORIZED` for valid session w/o permission | `PERMISSION_DENIED` error code |
| P1 | cashier lacked `products.view` → POS grid broken | added to role defaults |
| P1 | Return status never `refunded`; exact-qty return blocked; `sales.due_paise` not decremented on returns | SUM-based detection, epsilon side, due sync |
| P1 | Print channels had no auth; `printToPDF` pageSize in pixels | session + `invoices.view` + business scope; inches (57mm 2.24×20, 80mm 3.15×20) |
| P1 | `sandbox: false`, raw crash text, unsanitized save name | `sandbox: true`, generic Bangla message, `path.basename`, null-safe dialogs |
| P2 | Movement types, stat-card keys, restore hardening, settings key drift | see prior commits |

---

## Verification commands & results (last run)

```
npx tsc --noEmit -p tsconfig.json        # PASS (0 errors)
npx tsc --noEmit -p tsconfig.node.json   # PASS (0 errors)
npx vitest run                           # PASS 112/112 (13 files)
npx vite build                           # PASS (renderer bundle)
```

Test inventory: ipc-security 17 (incl. phase-16 matrix), money-precision 4,
perf-10k 6, print 6, e2e shop-day 12, plus unit/integration sale/purchase/
mfs/import/search suites.

## Release decision

Per the final principle: **MERQO is not declared production-ready.**
When the Windows runner is available, execute Phases 1–8, 13–15, 17 and 20
against this exact commit, record results here (never converting NOT TESTED
to PASS without evidence), and only then may the gate change to
**PRODUCTION RELEASE READY** with the artifact details from Phase 20.
