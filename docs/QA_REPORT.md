# MERQO Business Suite — QA Report

**Date:** 2026-09-16 · **Branch:** `arena/01a0a5fc-merqo-business-suite` · **Scope:** full build through renderer completion

## 1. Verification matrix

| Check | Command | Result |
|---|---|---|
| TypeScript (renderer + preload + shared) | `tsc -p tsconfig.json` | ✅ 0 errors |
| TypeScript (main + node config) | `tsc -p tsconfig.node.json` | ✅ 0 errors |
| Unit + integration + e2e tests | `npx vitest run` | ✅ **78/78 passed** (9 files) |
| Renderer production bundle | `npx vite build` | ✅ 0 warnings, no native-module externalization |
| Main + preload esbuild bundle | `node scripts/build.mjs` | ✅ (see §4 packaging note) |

## 2. Domain invariants verified by tests (all green)

- Account balance ≡ ledger `SUM` (cash/bank/MFS).
- Inventory quantity ≡ movements ledger.
- Customer due ≡ `customer_transactions` sums; supplier payable ≡ `supplier_transactions` sums.
- Shift close: expected = opening + cash in − cash out; variance computed against counted cash.
- Daily closing: netSales − cogs = gross; gross − expenses = net; equals `salesSummary`.
- Weighted average: `newAvg = floor((q·avg + inQ·inCost)/(q+inQ) + 0.5)`; COGS = `round(avgCost·qty)`.
- Returns: restock path adjusts inventory + COGS reversal; payable/due deltas correct.
- Atomicity: mid-transaction failure → full rollback (no partial rows).
- Idempotency: duplicate idempotency key → same result, no double write.
- Migration: fresh DB → v3; schema version tracked; integrity check (`PRAGMA integrity_check` + FK) clean.

## 3. UI contract audit (renderer ↔ main)

Every `window.merqo` call in the renderer was checked against the actual
handler + domain service:

- Method names, argument order, and result shapes (incl. fixes found and
  applied during this pass):
  - `customers.list` / `suppliers.list` return `{rows,total}` (interface fixed).
  - `shift.list` returns `Row[]` (interface fixed).
  - `import.preview` result keys (`totalRows, validRows, errors, sample`) and
    `import.execute` result (`jobId, imported, skipped, failed, errorFile`)
    matched to `importService`.
  - Report row keys matched to `reportService` (`bucket`, `day`, `netSales`,
    `grossProfit`, `netProfit`, `stock_summary: products/low_stock/out_of_stock/stock_value`,
    `topStockValue.value`, `slowMoving.sold_recent`, `receivable/payable`).
  - MFS keys: providers (`wallet_balance_paise`, `wallet_account_no`),
    reconciliation (`openingBalancePaise, cashInPaise, cashOutPaise,
    expectedBalancePaise, walletBalancePaise, variancePaise, transactionCount`).
  - Sales statuses corrected to the real set: `completed /
    partially_refunded / refunded / voided`.
- Permission gating mirrors the IPC registry (e.g. backup panel requires
  `backup.create`; role editor requires `users.manage`; CSV export requires
  `exports.run`). Denied panels render Bangla empty states, not errors.
- Bangla terminology: single source (`src/shared/glossary.ts` labels reused
  across modules); one mixed-script defect (Devanagari in a settings label)
  found by automated code-point scan and fixed; `হেঁচারি` replaced with the
  standard `সাধারণ কাস্টমার` in POS/Sales to match reports.
- Money: all UI paths go through `Money` (integer paise → `৳ 12,500.00`);
  no `Number` arithmetic on taka anywhere in modules.

## 4. Packaging

- `electron-builder.yml` present: NSIS + portable, asar with
  `better-sqlite3` unpacked, icon `buildResources/icon.ico` (multi-size,
  generated from `icon-src.png`).
- **Note (environment):** this sandbox is Linux; producing the signed
  Windows `.exe`/NSIS artifact and rebuilding `better-sqlite3` for `win32-x64`
  requires Windows (or Wine + electron-rebuild). The build pipeline
  (`scripts/build.mjs`) and Vite output are verified; the final
  `dist:win` step should be run on a Windows agent or CI (GitHub Actions
  `windows-latest`) before release. `deleteAppDataOnUninstall: false` is
  intentional (user data must survive upgrades/uninstall).

## 5. Residual risks / follow-ups

1. **Windows E2E pass**: run the built app on Windows 11 — barcode-scan
   hardware, thermal printer driver paths, PDF dialog flow.
2. **Auto-lock**: `security.auto_lock_minutes` exists in settings defaults;
   the UI exposes it only if a session timer is added (not claimed as a
   feature).
3. **i18n**: 100% Bangla as specified; no other languages.
4. **Icon**: generated squircle "M" — brand review may swap `icon-src.png`
   and re-run the ImageMagick ICO step.
5. **Code signing**: no signing configured; add EV/standard code-sign cert
   for production distribution.

## 6. Known limitations (by design, per spec §152–153)

- MFS agent is **manual recording** — no provider API integration, no live
  balance fetch.
- No online sync, no multi-device, no cloud.
- Single business per machine (setup wizard creates one; multi-business is
  not a v1 scope).
