# MERQO Business Suite

**বাংলাদেশি দোকানের জন্য সম্পূর্ণ অফলাইন বিজনেস সফটওয়্যার — Windows ডেস্কটপ।**

MERQO একটি ১০০% অফলাইনে চলা, ইনস্টল-আই-অ্যান্ড-ব্যবহার দোকান ব্যবস্থাপনা অ্যাপ:
বিক্রয় (POS), পণ্য ও স্টক, ক্রয়, কাস্টমার/সাপ্লায়ার হিসাব, খরচ, নগদ-ব্যাংক-
MFS হিসাব, শিফট, লাভ-ক্ষতি রিপোর্ট, রসিদ প্রিন্ট, ব্যাকআপ — সবকিছু এক জায়গায়,
পুরোপুরি বাংলায়।

## মূল বৈশিষ্ট্য

| অংশ | যা পাবেন |
|---|---|
| **POS (বিক্রয়)** | বারকোড স্ক্যান (HID কীবোর্ড) দিয়ে দ্রুত বিক্রয়, অজানা বারকোড ক্যাপচার, ক্রেডিট লিমিট ওয়ার্নিং, মেয়াদোত্তীর্ণ পণ্য ব্লক, ধাপে ধাপে পেমেন্ট (নগদ/ব্যাংক/MFS), বিল হোল্ড-রিস্যুম, রসিদ প্রিভিউ |
| **পণ্য ও ইনভেন্টরি** | ক্যাটাগরি/ব্র্যান্ড/একক, ওয়েটেড-এভারেজ খরচদাম, স্টক অ্যাডজাস্টমেন্ট, ব্যাচ ও মেয়াদ, ইনভেন্টরি রিকনসিলিয়েশন চেক |
| **ক্রয়** | সাপ্লায়ারে পণ্য আসা, আংশিক পেমেন্ট/বকেয়া, পিচেস রিটার্ন (স্টকে ফেরত) |
| **কাস্টমার** | বকেয়া হিসাব (লিডজার), কালেকশন, ক্রেডিট লিমিট ওয়ার্নিং |
| **সাপ্লায়ার** | দেয়াদায়ী হিসাব, পেমেন্ট, লিডজার |
| **খরচ** | ক্যাটাগরিভিত্তিক খরচ, কাস্টম ক্যাটাগরি |
| **হিসাব** | নগদ/ব্যাংক/MFS হিসাব, ট্রান্সফার, লিডজার |
| **শিফট** | ক্যাশিয়ার শিফট খোলা-বন্ধ, কাউন্টেড ক্যাশ vs আশকা, ভ্যারিয়েন্স |
| **MFS এজেন্ট** | bKash/Nagad আডেমেন্ট — ক্যাশ-ইন/আউট, সেন্ড মানি, কমিশন, রিকনসিলিয়েশন (ম্যানুয়াল রেকর্ডিং, কোনো লাইভ API নেই) |
| **রিপোর্ট** | বিক্রয়, লাভ-ক্ষতি, স্টক, হিসাব, খরচ, কালেকশন — ড্যাশবোর্ডের সাথে সবসময় মিলে থাকে |
| **প্রিন্ট/PDF** | 58/80mm থার্মাল ও A4 রসিদ, PDF সেভ |
| **ডেটা** | ব্যাকআপ/ভেরিফাই/রিস্টোর, CSV ইমপোর্ট (প্রিভিউ + কলাম ম্যাপিং), CSV এক্সপোর্ট, ডাটাবেস ইন্টিগ্রিটি চেক |
| **ব্যবহারকারী** | ভূমিকা (মালিক/অ্যাডমিন/ম্যানেজার/ক্যাশিয়ার/…), অধিকার, পাসওয়ার্ড, অমুছ অডিট লগ |
| **নিরাপত্তা** | সব হিসাব লেনদেন এক ট্রানজেকশনে — আধা অবস্থা সম্ভব না; ডাবল-সাবমিশন প্রোটেকশন; টাকা = পয়সা (ফ্লোট নয়) |

## সিস্টেম রিকোয়ারমেন্ট

- Windows 10/11 (64-bit)
- ইন্টারনেট লাগে **না** — ইনস্টল করার পরে সম্পূর্ণ অফলাইন চলে
- ডেটা এই মেশিনেই থাকে (SQLite) — নিয়মিত ব্যাকআপ নেওয়া জরুরি

## চালানোর পদ্ধায় (ডেভেলপার)

```bash
npm install          # ডিপেন্ডেন্সি
npm run rebuild:electron   # better-sqlite3 Electron-এর জন্য রিবিল্ড
npm run dev          # ডেভ মোড (হট রিলোডসহ)
```

টেস্ট ও টাইপ-চেক:

```bash
npm test             # vitest — ইউনিট + ইন্টিগ্রেশন + E2E (ডোমেইন লেভেলে)
npm run typecheck    # TypeScript (renderer + main)
```

## Windows ইনস্টলার তৈরি

```bash
npm run dist:win         # NSIS সেটআপ + পোর্টেবল EXE (release/ ফোল্ডারে)
npm run dist:portable    # শুধু পোর্টেবল EXE
npm run dist:dir         # আনপ্যাকেজড ফোল্ডার (টেস্টের জন্য)
```

> নোট: `release/` ফোল্ডার জেনারেট আউটপুট — Git-এ রাখা হয় না।

## আর্কিটেকচার

```
┌─────────────────────────── Electron ───────────────────────────┐
│  Renderer (React 19 + TS)          Main (Node + TS)            │
│  ┌────────────────┐   IPC (typed)  ┌────────────────────────┐ │
│  │ Modules (UI)   │ ─────────────► │ IPC registry (handlers)│ │
│  │ UI kit, styles │ ◄───────────── │ auth + permission gate │ │
│  └────────────────┘   typed result └───────────┬────────────┘ │
│                                                ▼               │
│                              Domain services (pure TS)         │
│                              sales/purchases/returns/inventory │
│                              MFS/shifts/accounts/backup/reports│
│                                                ▼               │
│                              Repositories (better-sqlite3)     │
│                              migrations 0001→0003 (versioned)  │
└────────────────────────────────────────────────────────────────┘
```

- **স্তরবদ্ধ ডিজাইন**: UI → IPC → service → pure-TS domain → repository → SQLite।
  Domain স্তর Electron-মুক্ত — টেস্টে সরাসরি চলে।
- **atomic লেনদেন**: বিক্রয় = স্টক কমানো + হিসাব বাড়ানো + লিডজার লেখা — এক
  ট্রানজেকশনে; ব্যর্থ হলে সব বাতিল (rollback)।
- **টাকা**: সব সংখ্যা পিসায় (integer) — ৳ 12,500.00 ফরম্যাট, কোনো ফ্লোটিং-পয়েন্ট নয়।
- **অডিট**: ক্রিটিক্যাল সব অ্যাকশন (বিল বাতিল, স্টক অ্যাডজাস্ট, রিস্টোর…) অমুছ
  অডিট টেবিলে লেখা হয় — মুছে যায় না।
- **মাইগ্রেশন**: সংস্করন-সহ স্কিমা আপগ্রেড; পুরোনো ডাটাবেস নিরাপদে খোলে।

## মডিউল সম্মিলন

প্রতিটি মডিউল `src/renderer/modules/<name>/`-এ, ডোমেইন সার্ভিস `src/domain/services/`-এ:

```
pos/          — POS স্ক্রিন (বিক্রয়)
products/     — পণ্য ক্যাটালগ
inventory/    — স্টক, অ্যাডজাস্টমেন্ট, ব্যাচ
purchases/    — ক্রয় বিল
sales/        — বিক্রয়ের হিসাব, বাতিল, ফেরত
customers/    — কাস্টমার + বকেয়া
suppliers/    — সাপ্লায়ার + দেয়াদায়ী
expenses/     — খরচ
accounts/     — নগদ/ব্যাংক/MFS হিসাব
shift/        — ক্যাশ শিফট
mfs/          — MFS এজেন্ট
reports/      — রিপোর্ট
datacenter/   — ব্যাকআপ, ইমপোর্ট/এক্সপোর্ট
users/        — ব্যবহারকারী, ভূমিকা, অডিট
settings/     — সেটিংস
shell/        — নেভিগেশন শেল
dashboard/    — ড্যাশবোর্ড
wizard/       — প্রথম সেটআপ
login/        — লগইন
```

## নিরাপত্তা ও গোপনীয়তা

- কোনো ইন্টারনেট কল নেই, কোনো টেলিমেট্রি নেই, কোনো সাবস্ক্রিপশন নেই।
- ব্যবসার সব ডেটা স্থানীয় SQLite ফাইলে (AppData) — ব্যাকআপ = ফাইল কপি।
- পাসওয়ার্ড salt+hash-এ রাখা হয়; লগইন-ব্যর্থ-লকআউট আছে।
- ব্যবহারকারীভিত্তিক অধিকার — ক্যাশিয়ার লাভ/খরচদাম দেখতে পারে না (ডিফল্ট)।

## লাইসেন্স

কপিরাইট © ২০২৬ MERQO।

---

### English summary

MERQO is an **offline-first Windows desktop app** for Bangladeshi retail shops:
POS with HID barcode scanning, weighted-average inventory, purchase/sales
ledgers with atomic transactions, customer/supplier credit, expenses,
cash/bank/MFS accounts, cashier shifts, MFS agent bookkeeping (manual, no
provider APIs), reconciliation-first reporting, thermal/A4 receipts + PDF,
backup/restore, CSV import/export with preview, RBAC with an immutable audit
log, and a first-run setup wizard. Stack: Electron + React 19 + TypeScript +
better-sqlite3, layered (UI → typed IPC → services → pure-TS domain →
repositories → SQLite) with versioned migrations. All money is integer
paise; all financial writes are single-transaction with rollback and
idempotency keys.
