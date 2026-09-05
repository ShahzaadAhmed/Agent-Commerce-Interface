import { NitroStackServer, Tool, z } from '@nitrostack/core';
import type { ToolDependencies } from './tool-helpers.js';
import { runAudited } from './tool-helpers.js';

const eventSchema = z.object({
  timestamp: z.string(), requestId: z.string(), action: z.string(), outcome: z.enum(['started', 'success', 'failure', 'blocked']), reason: z.string().optional(), sessionId: z.string().optional(), cartId: z.string().optional(), checkoutId: z.string().optional(), authorizationId: z.string().optional(), merchantId: z.string().optional(), amountPaise: z.number().int().optional(), currency: z.string().optional(), details: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
const auditOutputSchema = z.object({ events: z.array(eventSchema) });

export function registerAuditTools(server: NitroStackServer, dependencies: ToolDependencies): void {
  const inputSchema = z.object({
    request_id: z.string().min(1).optional(), cart_id: z.string().min(1).optional(), checkout_id: z.string().min(1).optional(), authorization_id: z.string().min(1).optional(),
  }).refine((input) => Object.values(input).some(Boolean), 'Provide at least one identifier.');
  server.tool(new Tool<z.infer<typeof inputSchema>>({
    name: 'get_audit_trail', title: 'Get audit trail', description: 'Return append-only audit events for a request, cart, checkout, or authorization.',
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'get_audit_trail',
      audit: { cartId: input.cart_id, checkoutId: input.checkout_id, authorizationId: input.authorization_id },
      operation: async () => auditOutputSchema.parse({ events: await dependencies.audit.find({ requestId: input.request_id, cartId: input.cart_id, checkoutId: input.checkout_id, authorizationId: input.authorization_id }) }),
    }),
  }));
}
