import { z } from '@nitrostack/core';
import type { AuditEvent, AuditStore } from '../audit/audit-store.js';
import { asDomainError } from '../domain/types.js';

export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type ToolResponse<T> = { ok: true; data: T } | { ok: false; error: z.infer<typeof errorSchema> };

export interface ToolDependencies {
  audit: AuditStore;
}

export async function runAudited<T>(input: {
  dependencies: ToolDependencies;
  requestId: string;
  action: string;
  audit: Omit<AuditEvent, 'timestamp' | 'requestId' | 'action' | 'outcome'>;
  operation: () => Promise<T> | T;
}): Promise<ToolResponse<T>> {
  const base = { ...input.audit, requestId: input.requestId, action: input.action };
  await input.dependencies.audit.record({ ...base, outcome: 'started' });
  try {
    const data = await input.operation();
    await input.dependencies.audit.record({ ...base, outcome: 'success' });
    return { ok: true, data };
  } catch (error) {
    const normalized = asDomainError(error);
    const outcome = normalized.code === 'CHECKOUT_CHANGED' || normalized.code.includes('MISMATCH') || normalized.code.includes('UNAUTHORIZED')
      || normalized.code.includes('EXPIRED') || normalized.code.includes('OUT_OF_STOCK')
      ? 'blocked'
      : 'failure';
    await input.dependencies.audit.record({ ...base, outcome, reason: normalized.code });
    return { ok: false, error: normalized };
  }
}
