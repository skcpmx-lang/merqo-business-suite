# MERQO v1.0.0 — Final Windows Release Gate: QA Report

**Date:** 2026-09-16 · **Branch:** `arena/01a0a5fc-merqo-business-suite` · **Last verified commit:** see git log (`a1c8435` baseline + hardening commits)

## RELEASE GATE STATUS: **NOT MET YET**

No open P0/P1. The Linux-verifiable phases below are PASS. Every real-Windows
item (Phases 1–8, 13–15, 17-on-Windows, 20) is **NOT TESTED** in this
environment (Linux sandbox — no Windows runner, no GUI, no printer, no scanner).
Nothing marked NOT TESTED has been converted to PASS, and no `.exe` is claimed.

**Round 2 (2026-09-16): full static release audit (31 sections) completed** —
see the audit matrix below. Feature freeze in effect since this round; only
release-critical fixes were made (unused dependencies removed, dead code
removed, import file-size guard added, glossary regression guard added,
README language defects fixed).

**Round 3 (2026-09-16): Windows release validation attempt from the Linux
environment** — see `docs/WINDOWS_VALIDATION.md`. The frozen baseline
(`9d35711`) was audited for Windows packaging: the native-module strategy
(better-sqlite3 v13 N-API prebuilds) was verified with binary-level evidence,
and **one release-critical packaging defect was found and fixed** (missing
`npmRebuild: false` — a clean Windows machine without build tools would have
failed `npm run dist:win`, and any rebuild output would have been ignored by
the v13 loader anyway). All 26 mandatory Windows tests remain **NOT TESTED**
(no Windows OS, no display, no printer/scanner hardware, artifact CDN blocked
in this sandbox — evidence in the validation record).

---

## Static release audit — Round 2, section by section

| # | Section | Verdict | Notes |
|---|---|---|---|
| 1 | Full source audit | **PASS** | 0 TODO/FIXME/HACK; 7 `console.error` — all main-process production diagnostics (integrity, restore, IPC unhandled, auto-backup, print, DB close) — kept deliberately; 0 localhost; 0 dev-only paths in production code (single `MERQO_DEV_URL` dev-env branch, unset in production, documented); dead code + unused imports removed this round (16 files); unused runtime deps `jsbarcode`, `qrcode`, `@types/qrcode` removed |
| 2 | Secret scan | **PASS** | No API keys/passwords/tokens/private keys/.env in the repo; passwords are salted+hashed in DB; only test fixtures use a test password (test-only) |
| 3 | Dependency audit | **PASS** | Runtime deps: `better-sqlite3` (MIT; native, no net, needs electron-rebuild — handled), `lucide-react` (ISC; icons, no net), `react`/`react-dom` (MIT; no net). No internet, no accounts, no paid services anywhere |
| 4 | Offline test | **PASS** | Zero network calls in `src/` (no fetch/XHR/axios/websocket); all core operations are local SQLite + local files |
| 5 | IPC final audit (131) | **PASS** | Every channel: session required (except AUTH_STATUS/AUTH_LOGIN/SETUP_CREATE by design), permission mapped, business scope from the resolved session (`user.businessId` — never client-supplied), inputs validated in the domain, errors serialized to `{code,message}`. Sensitive outputs masked: dashboard profit/cost/balance fields (Phase-16 fix), P&L report (`profit.view`), stock cost (`stock.viewCost`), audit (`audit.view`) |
| 6 | Business-scope isolation | **PASS** | Systematic scan of all SQL: every query touching a business table starts from `business_id = ?` (or inherits scope from an already-validated parent document: `getSale`/`getProductDetail`/`updateUser` verify business first); cross-business access tested (print test: other business's sale → NOT_FOUND) |
| 7 | Financial domain audit | **PASS** | All money is integer paise; single authoritative conversion layer (`shared/money.ts`); zero raw `×100/÷100` in the domain; no float arithmetic on money; P0 ×100 bugs fixed + regression-tested (money-precision 4/4); weighted-avg + COGS formulas single-implemented in `inventoryService` |
| 8 | Inventory domain audit | **PASS** | Exactly 3 `UPDATE inventory` sites in the whole domain — `receive`/`issue`/`adjustStock` — each writes its `inventory_movements` row in the same transaction; reconcile tests + 10k-scale consistency verify movements ≡ balance |
| 9 | Ledger audit | **PASS** | Event-sourced ledgers (`customer_transactions`/`supplier_transactions`); balances denormalized in-tx with every event; running balance order deterministic (`created_at, id`); e2e invariants: due ≡ Σ customer events, payable ≡ Σ supplier events |
| 10 | Account audit | **PASS** | Single funnel `post()`; kinds (cash/bank/mfs/other) never mixed — payment method resolves to the correct kind; internal transfers post `transfer_in/out` (never revenue); MFS agent wallets are separate from MFS payment accounts (`mfs_wallets` vs `accounts.kind='mfs'`), settled via `mfs_cash_in/out`; MFS reconciliation tested |
| 11 | Status audit | **PASS** | One vocabulary per entity: sales `completed/partially_refunded/refunded/voided` (UI badges, domain, report filters all agree); held carts `held/resumed/cancelled`; batches `active/depleted`; shifts `open/closed`; sessions `active/ended`; backups `verified/failed/missing/deleted`; products/customers/suppliers `active/inactive/deleted` |
| 12 | Return audit | **PASS** | Partial/full/exact-quantity returns tested (sale + purchase); exact remaining quantity returnable (epsilon on the correct side); due/payable decremented in-tx; stock restored via `receive`; final status via SUM of non-voided returns; over-return blocked |
| 13 | Date range audit | **PASS** | `resolveRange` is fully local-timezone (start/end of local day, inclusive); report filters use `date >= from AND date <= to` on the same local boundaries — dashboard and reports share `resolveRange`; day/week/month bucketing uses SQLite `localtime` modifier (a UTC+6 morning sale lands in the correct local day) |
| 14 | Import safety | **PASS** | Preview validates before any commit; errors listed per-row (capped); duplicate SKU/barcode, invalid numbers, missing fields all rejected pre-commit (import tests); Bangla data round-trips; **new:** 25 MB file-size guard prevents renderer freeze/OOM on huge files |
| 15 | Backup safety | **PASS** | WAL checkpoint (TRUNCATE) before copy → consistent snapshot; SHA-256 + registry + audit in one tx; restore requires hash match AND `PRAGMA quick_check`; swap is an atomic `rename` after DB close, stale `-wal/-shm` of the live DB removed so they can't replay onto the restored file; rename failure leaves the live DB untouched; completion audit via marker file |
| 16 | Audit log immutability | **PASS** | Sole write path is INSERT in `recordAudit` (same tx as the action); no UPDATE/DELETE statement exists anywhere; no IPC channel can edit/delete audit rows or forge user/timestamp (actor identity from the resolved session) |
| 17 | Role spoofing | **PASS** | Permissions derived from the resolved session on every call (fresh `role_permissions` read); client flags stripped server-side — proven by live role-narrowing tests (discount/price/credit override); profit/cost/account visibility masked at the dashboard |
| 18 | UI string final audit | **PASS** | Full re-sweep this round: 0 rejected terms in `src/renderer`; glossary cross-checked; new `restore` entry added to `glossary.ts` (was missing); `একশন`→`অ্যাকশন` fixed; README language defects fixed (typos: পদ্ধায়→পদ্ধতি, অমুছ, পিচেস, আশকা, সংস্করন; term drift: লিডজার/দেয়াদায়ী/ট্রানজেকশন/আডেমেন্ট → canonical terms) |
| 19 | Language regression guard | **PASS (new)** | `tests/unit/bangla-glossary.test.ts` — fails the build if any rejected term (মজুদ, গ্রাহক, সরবরাহকারী, রিটার্ন, আপডেট, আমদানি, রপ্তানি, শেষ স্টক, একশন, ভ্যালিডেশন, পুনঃ, ক্যান্সেল, ডিলিট, এডিট) reappears in `src/renderer`, or if a canonical term disappears from `glossary.ts` |
| 20 | Production build audit | **PASS** | `dist:win` = build + electron-builder; esbuild bundles main/preload (no sourcemaps, native modules external); Vite renderer build; `package.json` main → `dist-electron/main/index.js`; name `merqo` / productName `MERQO`; version 1.0.0 consistent across package.json/README/release notes; `buildResources/icon.ico` present; no dev-only env in production path |
| 21 | Windows path safety | **PASS** | All paths via `path.join`/`path.dirname`; DB `app.getPath('userData')/merqo/merqo.db`; backups `process.env.HOME \|\| USERPROFILE` fallback; PDF/save dialogs `app.getPath('downloads')`; no `/home`, `C:\`, or Linux-only assumptions in `src/` |
| 22 | User data location | **PASS (documented)** | Business DB: `%APPDATA%/merqo/merqo/merqo.db` (outside the install dir → survives uninstall; `deleteAppDataOnUninstall: false`); backups: `%USERPROFILE%/MERQO/backups` (user-settable in settings). Behavior on real Windows = NOT TESTED (Phase 3) |
| 23 | Print architecture review | **PASS (static)** | `printAuth(token)` = session + `invoices.view` + business-scoped document lookup on every print channel; paper sizes 57mm/80mm/A4 from settings; template selection by document type; print errors → `PRINT_ERROR`/`VALIDATION` codes |
| 24 | PDF page size review | **PASS (static)** | `printToPDF` pageSize in INCHES: A4 preset; 57mm → 2.24×20; 80mm → 3.15×20 (tall page keeps a receipt on one page); pixel→inch conversion done once at this boundary. Physical rendering = NOT TESTED |
| 25 | Responsiveness static review | **PASS (static)** | Only absolute-positioned elements are search icons inside sized inputs; no fixed widths > 400px; no overflow-hidden around content containers; modal sizing via `size` prop. Real-DPI visual check = NOT TESTED |
| 26 | Accessibility static review | **PASS with notes** | All primary actions are real `<button>`; 4 clickable-divs are stopPropagation wrappers (harmless), 1 is an optional provider filter chip (works with mouse; keyboard can't toggle — minor, does not prevent normal use); form labels rendered via `Field` but not programmatically associated (no htmlFor) — minor, documented; contrast via CSS variables (light theme). Full keyboard/DPI audit = NOT TESTED |
| 27 | Artifact cleanliness | **PASS** | `dist/` + `dist-electron/` contain no test fixtures, no credentials, no demo data (scanned for `টেলে-টেস্ট`, `admin1234`, `makeEnv` → 0 hits) |
| 28 | Documentation audit | **PASS** | README (v1.0.0, migrations 0001→0004 corrected, language fixed, release-status pointer added), `docs/QA_REPORT.md`, `docs/BANGLA_GLOSSARY.md`, `docs/RELEASE_NOTES.md` now agree on version, tested/not-tested state, build process, limitations; no premature Windows-validated claims |
| 29 | Final test requirement | **PASS** | After this round's fixes: tsc clean (both configs), **vitest 114/114** (14 files, +2 guard tests), vite build clean |
| 30 | Feature freeze | **IN EFFECT** | No features added this round; only release-critical/security/language/packaging fixes |
| 31 | Final status | **NOT MET YET** | Unchanged — requires real Windows evidence (see NOT TESTED table) |

### Known limitations (static, documented — none block packaging, all visible to users as minor)

1. Failed restore swap: app relaunches on the live DB with the failure logged; the user is not shown an explicit error dialog (data is never harmed).
2. A backup whose registry insert fails after the file copy leaves an untracked file (never listed, never restored from).
3. Form labels are visually adjacent to inputs but not programmatically associated (screen-reader limitation; the app targets mouse/keyboard shop use).
4. Provider filter chips on the MFS screen are mouse-only.

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

### Found & fixed in the Round-3 Windows validation attempt

| Sev | Defect | Symptom | Root cause | Fix | Verified by |
|---|---|---|---|---|---|
| **P1** | `electron-builder.yml` missing `npmRebuild: false` | `npm run dist:win` on a clean Windows machine (Node only) fails at "rebuilding native dependencies" (needs Python + VS Build Tools); with a toolchain present, the rebuild output is ignored — the v13 loader always prefers `prebuilds/win32-x64.node` over `build/Release/` | better-sqlite3 v13 ships N-API (ABI-stable) prebuilds, making electron-builder's default native rebuild both unnecessary and counterproductive | `npmRebuild: false` + rationale comment in `electron-builder.yml`; README build section updated (no toolchain required; `rebuild:electron` is now an explicit fallback) | `tests/unit/native-prebuild.test.ts` (4 guards: all 7 platform/arch prebuilds present; win32 PE magic + `napi_register_module_v1` export; `npmRebuild: false` present; asarUnpack present) |

### Found & fixed in the Round-2 static audit

| Sev | Defect | Symptom | Root cause | Fix | Verified by |
|---|---|---|---|---|---|
| P2 | Import could freeze/OOM the renderer on a huge CSV | Selecting a multi-hundred-MB CSV read + parsed the whole file in memory | `readFile` had no size guard | 25 MB cap with a Bangla error toast | code review (guard is renderer-side, before IPC) |
| P2 | Unused runtime dependencies shipped (`jsbarcode`, `qrcode`) | Bloat + supply-chain surface, zero usage | Leftover planned features (no barcode/QR rendering implemented) | Removed from `package.json` | `grep` 0 imports; build + 114/114 green |
| P2 | Dead code / unused imports across 16 renderer files | Maintenance noise; 1 dead function (`clearPayment`), 3 dead props, 9 unused icons/hooks | Incremental development | Removed (no behavior change) | `tsc --noUnusedLocals --noUnusedParameters` now clean |
| P2 | `glossary.ts` missing the canonical `restore` term | Glossary incomplete vs spec-listed concept | Oversight | `restore: 'পুনরুদ্ধার'` added | new glossary guard test |
| P2 | README language defects | Typos (পদ্ধায়, অমুছ, পিচেস, আশকা, সংস্করন) + term drift (লিডজার, দেয়াদায়ী, ট্রানজেকশন, আডেমেন্ট) + stale migration count (0001→0003) | Pre-audit copy | Rewritten to canonical terms; 0001→0004; release-status pointer added | doc review |

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
npx vitest run                           # PASS 118/118 (15 files)
npx vite build                           # PASS (renderer bundle)
npx tsc --noEmit -p tsconfig.json --noUnusedLocals --noUnusedParameters
                                         # PASS (dead-code guard, Round 2)
```

Test inventory: ipc-security 17 (incl. phase-16 matrix), money-precision 4,
perf-10k 6, print 6, bangla-glossary guard 2, native-prebuild guard 4
(Round 3), e2e shop-day 12, plus unit/integration
sale/purchase/mfs/import/search suites.

## Release decision

Per the final principle: **MERQO is not declared production-ready.**
When the Windows runner is available, execute Phases 1–8, 13–15, 17 and 20
against this exact commit, record results here (never converting NOT TESTED
to PASS without evidence), and only then may the gate change to
**PRODUCTION RELEASE READY** with the artifact details from Phase 20.
