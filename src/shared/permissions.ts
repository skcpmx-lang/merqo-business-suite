/**
 * Permission catalog — single source of truth.
 * Seeded into the database on business setup; enforced in the main-process
 * service layer (never only in the UI) and used to render the UI.
 */
export const PERMISSIONS = [
  // Sales
  { key: 'sales.view', label: 'বিক্রয় দেখুন' },
  { key: 'sales.create', label: 'বিক্রয় তৈরি করুন' },
  { key: 'sales.hold', label: 'বিক্রয় হোল্ড করুন' },
  { key: 'sales.void', label: 'বিক্রয় বাতিল/বিলগা করুন' },
  { key: 'sales.return', label: 'বিক্রয় ফেরত নিন' },
  { key: 'sales.priceOverride', label: 'দাম পরিবর্তন করুন' },
  { key: 'sales.discount', label: 'ছাড় দিন' },
  { key: 'sales.creditOverride', label: 'উজড় সীমা অতিক্রম করুন (বিশেষ অনুমতি)' },
  // Purchases
  { key: 'purchases.view', label: 'ক্রয় দেখুন' },
  { key: 'purchases.create', label: 'ক্রয় তৈরি করুন' },
  { key: 'purchases.void', label: 'ক্রয় বাতিল করুন' },
  { key: 'purchases.return', label: 'ক্রয় ফেরত করুন' },
  // Products & inventory
  { key: 'products.view', label: 'পণ্য দেখুন' },
  { key: 'products.create', label: 'পণ্য তৈরি করুন' },
  { key: 'products.edit', label: 'পণ্য সম্পাদনা করুন' },
  { key: 'products.delete', label: 'পণ্য মুছুন' },
  { key: 'stock.view', label: 'স্টক দেখুন' },
  { key: 'stock.viewCost', label: 'স্টক খরচদাম দেখুন' },
  { key: 'stock.adjust', label: 'স্টক সমন্বয় করুন' },
  // Parties
  { key: 'customers.view', label: 'কাস্টমার দেখুন' },
  { key: 'customers.manage', label: 'কাস্টমার ব্যবস্থাপনা করুন' },
  { key: 'customers.collect', label: 'কাস্টমারের বকেয়া আদায় করুন' },
  { key: 'suppliers.view', label: 'সাপ্লায়ার দেখুন' },
  { key: 'suppliers.manage', label: 'সাপ্লায়ার ব্যবস্থাপনা করুন' },
  { key: 'suppliers.pay', label: 'সাপ্লায়ারকে পেমেন্ট করুন' },
  // Money
  { key: 'profit.view', label: 'লাভ/মার্জিন দেখুন' },
  { key: 'expenses.create', label: 'খরচ যোগ করুন' },
  { key: 'expenses.edit', label: 'খরচ সম্পাদনা করুন' },
  { key: 'accounts.view', label: 'হিসাব দেখুন' },
  { key: 'accounts.transfer', label: 'হিসাব ট্রান্সফার করুন' },
  { key: 'accounts.adjust', label: 'হিসাব সমন্বয় করুন' },
  { key: 'shift.open', label: 'শিফট খুলুন' },
  { key: 'shift.close', label: 'শিফট বন্ধ করুন' },
  { key: 'shift.adjust', label: 'শিফট সমন্বয় করুন' },
  // MFS agent
  { key: 'mfs.view', label: 'MFS লেনদেন দেখুন' },
  { key: 'mfs.create', label: 'MFS লেনদেন রেকর্ড করুন' },
  { key: 'mfs.manage', label: 'MFS সেটআপ পরিবর্তন করুন' },
  // Documents & reports
  { key: 'reports.view', label: 'রিপোর্ট দেখুন' },
  { key: 'invoices.view', label: 'ইনভয়েস দেখুন' },
  { key: 'exports.run', label: 'এক্সপোর্ট করুন' },
  { key: 'imports.run', label: 'ইমপোর্ট করুন' },
  // Notifications
  { key: 'notifications.view', label: 'নোটিফিকেশন দেখুন' },
  // Administration
  { key: 'users.manage', label: 'ব্যবহারকারী ও ভূমিকা পরিবর্তন করুন' },
  { key: 'settings.manage', label: 'সেটিংস পরিবর্তন করুন' },
  { key: 'backup.create', label: 'ব্যাকআপ তৈরি করুন' },
  { key: 'backup.restore', label: 'ব্যাকআপ পুনরুদ্ধার করুন' },
  { key: 'audit.view', label: 'অডিট লগ দেখুন' },
  { key: 'data.delete', label: 'ডাটা মুছে ফেলুন (নিয়ন্ত্রিত)'}
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);

export const ROLE_CATALOG = [
  { key: 'owner', label: 'মালিক', description: 'সম্পূর্ণ অ্যাক্সেস' },
  { key: 'administrator', label: 'অ্যাডমিনিস্ট্রেটর', description: 'সম্পূর্ণ অ্যাক্সেস' },
  { key: 'manager', label: 'ম্যানেজার', description: 'ব্যবসাসংক্রান্ত সব কাজ, ব্যবহারকারী/ব্যাকআপ ব্যতীত' },
  { key: 'cashier', label: 'ক্যাশিয়ার', description: 'POS, কাস্টমার বকেয়া, নগদ কাজ' },
  { key: 'inventory_manager', label: 'ইনভেন্টরি ম্যানেজার', description: 'পণ্য ও স্টক ব্যবস্থাপনা' },
  { key: 'accountant', label: 'অ্যাকাউন্ট্যান্ট', description: 'হিসাব, খরচ, রিপোর্ট' }
] as const;

export type RoleKey = (typeof ROLE_CATALOG)[number]['key'];

/** Default permission grants per built-in role. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, string[]> = {
  owner: ALL_PERMISSION_KEYS,
  administrator: ALL_PERMISSION_KEYS,
  manager: ALL_PERMISSION_KEYS.filter(
    (k) => !['users.manage', 'backup.restore', 'data.delete'].includes(k)
  ),
  cashier: [
    'sales.view', 'sales.create', 'sales.hold',
    'sales.discount', 'sales.priceOverride',
    'products.view', // POS product grid + barcode lookup need this
    'customers.view', 'customers.collect',
    'stock.view', 'shift.open', 'shift.close',
    'mfs.view', 'mfs.create', 'invoices.view', 'notifications.view', 'exports.run'
  ],
  inventory_manager: [
    'products.view', 'products.create', 'products.edit',
    'stock.view', 'stock.viewCost', 'stock.adjust',
    'purchases.view', 'purchases.create',
    'notifications.view', 'exports.run', 'imports.run'
  ],
  accountant: [
    'profit.view', 'expenses.create', 'expenses.edit',
    'accounts.view', 'accounts.transfer', 'accounts.adjust',
    'customers.view', 'suppliers.view', 'suppliers.pay',
    'reports.view', 'invoices.view', 'exports.run', 'notifications.view'
  ]
};
