/** Import column schema — pure data, safe to import from the renderer.
 *  Kept separate from importService (which touches the DB) so the UI can
 *  drive field mapping without pulling native modules into the bundle. */
export type ImportEntity = 'products' | 'customers' | 'suppliers';

export const FIELD_DEFINITIONS: Record<ImportEntity, { key: string; label: string; required: boolean; money?: boolean; number?: boolean }[]> = {
  products: [
    { key: 'name', label: 'পণ্যের নাম', required: true },
    { key: 'sku', label: 'SKU', required: false },
    { key: 'barcode', label: 'বারকোড', required: false },
    { key: 'category', label: 'ক্যাটাগরি', required: false },
    { key: 'unit', label: 'একক', required: false },
    { key: 'purchasePrice', label: 'ক্রয় মূল্য', required: false, money: true },
    { key: 'sellingPrice', label: 'বিক্রয় মূল্য', required: false, money: true },
    { key: 'openingStock', label: 'প্রারম্ভিক স্টক', required: false, number: true },
    { key: 'reorderLevel', label: 'পুনঃ অর্ডার সীমা', required: false, number: true }
  ],
  customers: [
    { key: 'name', label: 'নাম', required: true },
    { key: 'phone', label: 'মোবাইল', required: false },
    { key: 'email', label: 'ইমেইল', required: false },
    { key: 'address', label: 'ঠিকানা', required: false },
    { key: 'creditLimit', label: 'উজড় সীমা', required: false, money: true },
    { key: 'openingDue', label: 'প্রারম্ভিক বকেয়া', required: false, money: true }
  ],
  suppliers: [
    { key: 'name', label: 'নাম', required: true },
    { key: 'company', label: 'কোম্পানি', required: false },
    { key: 'phone', label: 'মোবাইল', required: false },
    { key: 'address', label: 'ঠিকানা', required: false },
    { key: 'contactPerson', label: 'যোগাযোগের নাম', required: false },
    { key: 'openingPayable', label: 'প্রারম্ভিক প্রদেয়', required: false, money: true }
  ]
};
