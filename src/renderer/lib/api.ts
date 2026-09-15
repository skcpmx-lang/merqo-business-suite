/** Typed access to window.merqo (defined by preload) + error helpers. */
import type { MerqoApi, IpcError } from '@shared/ipc';

declare global {
  interface Window {
    merqo: MerqoApi;
  }
}

export const api: MerqoApi = window.merqo;

export interface ApiError {
  code: IpcError['code'];
  message: string;
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && (e as Error & ApiError).code !== undefined && e.name === 'MerqoBridgeError';
}

/** Turn any thrown value into a user-presentable Bangla message. */
export function errMsg(e: unknown, fallback = 'কাজটি সম্পন্ন করা যায়নি।'): string {
  if (isApiError(e)) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** A fresh idempotency key for one write operation (double-submission safe). */
export function idemKey(): string {
  return crypto.randomUUID();
}
