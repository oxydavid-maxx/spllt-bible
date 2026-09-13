export interface CompletionOperationFingerprintInput {
  memberId: string;
  planId: string;
  taskDate: string;
  status: 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED';
}

/**
 * Stable internal scope for an operation id. It is stored server-side only so
 * an idempotent replay cannot be reused by another member or for another
 * command. JSON array order is intentional and must remain stable.
 */
export function buildCompletionOperationFingerprint(input: CompletionOperationFingerprintInput): string {
  return JSON.stringify([
    input.memberId,
    input.planId,
    input.taskDate,
    input.status,
  ]);
}
