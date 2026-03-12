/**
 * Atomic Write Guard
 * 
 * This module enforces "Atomic-Only" writes policy.
 * All database writes MUST go through atomic RPCs (atomic operations).
 * Direct .insert/.update/.upsert/.delete operations are BLOCKED.
 * 
 * @module atomicWriteGuard
 */

export class DirectWriteBlockedError extends Error {
  constructor(opName: string, fileHint?: string) {
    super(
      `DIRECT_WRITE_BLOCKED: Use atomic RPC instead. op=${opName} file=${fileHint || 'unknown'}`
    );
    this.name = 'DirectWriteBlockedError';
  }
}

/**
 * Type guard to check if an error is a DirectWriteBlockedError
 */
export function isDirectWriteBlockedError(e: unknown): e is DirectWriteBlockedError {
  return e instanceof DirectWriteBlockedError || 
    (e instanceof Error && e.name === 'DirectWriteBlockedError');
}

/**
 * Throws an error when a direct write operation is attempted.
 * This function is used to block legacy direct database writes.
 * 
 * @param opName - The name of the blocked operation (e.g., "insert", "update", "delete")
 * @param fileHint - Optional hint about which file/function attempted the write
 * @throws {DirectWriteBlockedError} Always throws to block the operation
 * 
 * @example
 * // Instead of direct .insert/.update operations:
 * // Use:
 * forbidDirectWrite('insert', 'MyComponent.tsx');
 */
export function forbidDirectWrite(opName: string, fileHint?: string): never {
  throw new DirectWriteBlockedError(opName, fileHint);
}

/**
 * Returns a user-friendly Arabic message for blocked writes.
 * Use this in UI components to show a toast/dialog.
 */
export function getBlockedWriteMessage(): { ar: string; en: string } {
  return {
    ar: 'تم إيقاف هذا المسار لأنه غير ذري (Legacy). استخدم المسار الذري (Atomic) أو انتظر تحويل الشاشة.',
    en: 'This path has been blocked because it is not atomic (Legacy). Use the Atomic path or wait for screen conversion.'
  };
}

/**
 * Logs a blocked write attempt for debugging purposes.
 * Does not throw - use forbidDirectWrite for that.
 */
export function logBlockedWrite(opName: string, fileHint?: string, context?: Record<string, unknown>): void {
  console.warn(
    `[ATOMIC_GUARD] Blocked direct write attempt:`,
    {
      operation: opName,
      file: fileHint,
      context,
      timestamp: new Date().toISOString()
    }
  );
}

/**
 * Wrapper that shows a toast message for blocked writes.
 * Returns a rejected promise for use in async contexts.
 */
export function blockWithToast(
  opName: string, 
  fileHint?: string,
  showToast?: (message: string) => void
): Promise<never> {
  const message = getBlockedWriteMessage();
  
  logBlockedWrite(opName, fileHint);
  
  if (showToast) {
    showToast(message.ar);
  }
  
  return Promise.reject(new DirectWriteBlockedError(opName, fileHint));
}
