/**
 * MERQO domain error hierarchy.
 *
 * Every error carries a machine-readable `code` (stable, used by the IPC
 * layer and tests) and a Bangla `message` safe to show to end users.
 * Technical detail goes into `detail` and is only surfaced in the
 * expandable diagnostics section / system log (§71, §95).
 */
export type ErrorCodes =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'INSUFFICIENT_STOCK'
  | 'INSUFFICIENT_FUNDS'
  | 'CREDIT_LIMIT'
  | 'PERMISSION_DENIED'
  | 'UNAUTHORIZED'
  | 'INVALID_STATE'
  | 'DB_ERROR'
  | 'IMPORT_ERROR'
  | 'BACKUP_ERROR'
  | 'PRINT_ERROR'
  | 'UNKNOWN';

export class MerqoError extends Error {
  constructor(
    public readonly code: ErrorCodes,
    message: string,
    public readonly detail?: string,
    public readonly meta?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MerqoError';
  }
}

export class ValidationError extends MerqoError {
  constructor(message: string, public readonly field?: string, detail?: string) {
    super('VALIDATION', message, detail, field ? { field } : undefined);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends MerqoError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', `${entity} পাওয়া যাচ্ছে না।`, id ? `id=${id}` : undefined);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends MerqoError {
  constructor(message: string, detail?: string) {
    super('CONFLICT', message, detail);
    this.name = 'ConflictError';
  }
}

export class DuplicateError extends MerqoError {
  constructor(message: string, detail?: string) {
    super('DUPLICATE', message, detail);
    this.name = 'DuplicateError';
  }
}

export class InsufficientStockError extends MerqoError {
  constructor(
    productName: string,
    available: number,
    requested: number
  ) {
    super(
      'INSUFFICIENT_STOCK',
      `“${productName}”-এর পর্যাপ্ত স্টক নেই। (মজুদ: ${available}, চাওয়া: ${requested})`,
      undefined,
      { productName, available, requested }
    );
    this.name = 'InsufficientStockError';
  }
}

export class InsufficientFundsError extends MerqoError {
  constructor(accountName: string, available: number, requested: number) {
    super(
      'INSUFFICIENT_FUNDS',
      `“${accountName}” হিসাবে পর্যাপ্ত ব্যালেন্স নেই।`,
      undefined,
      { accountName, available, requested }
    );
    this.name = 'InsufficientFundsError';
  }
}

export class CreditLimitError extends MerqoError {
  constructor(customerName: string, limit: number, newDue: number) {
    super(
      'CREDIT_LIMIT',
      `“${customerName}”-এর উজড় সীমা অতিক্রম হবে। অথরিটেশন প্রয়োজন।`,
      undefined,
      { customerName, limit, newDue }
    );
    this.name = 'CreditLimitError';
  }
}

export class PermissionDeniedError extends MerqoError {
  constructor(permission: string) {
    super('PERMISSION_DENIED', 'এই কাজটি করার অনুমতি নেই।', permission);
    this.name = 'PermissionDeniedError';
  }
}

export class UnauthorizedError extends MerqoError {
  constructor(message = 'লগইন করতে হবে।') {
    super('UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class InvalidStateError extends MerqoError {
  constructor(message: string, detail?: string) {
    super('INVALID_STATE', message, detail);
    this.name = 'InvalidStateError';
  }
}

export function toSerializableError(err: unknown): {
  code: ErrorCodes;
  message: string;
  detail?: string;
  meta?: Record<string, unknown>;
} {
  if (err instanceof MerqoError) {
    return { code: err.code, message: err.message, detail: err.detail, meta: err.meta };
  }
  const e = err as Error | undefined;
  return {
    code: 'UNKNOWN',
    message: 'অপ্রত্যাশিত ত্রুটি ঘটেছে। আবার চেষ্টা করুন।',
    detail: e?.message ? `${e.name ?? 'Error'}: ${e.message}` : undefined
  };
}
