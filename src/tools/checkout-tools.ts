import { NitroStackServer, Tool, z } from '@nitrostack/core';
import type { CheckoutSnapshot } from '../domain/types.js';
import type { MerchantAdapter } from '../merchant/merchant-adapter.js';
import type { ToolDependencies } from './tool-helpers.js';
import { runAudited } from './tool-helpers.js';

const checkoutItemSchema = z.object({
  productId: z.string(), productName: z.string(), variantId: z.string(), variantName: z.string(), quantity: z.number().int().positive(), unitPricePaise: z.number().int().nonnegative(), lineTotalPaise: z.number().int().nonnegative(),
});
const checkoutSchema = z.object({
  checkoutId: z.string(), cartId: z.string(), merchant: z.object({ id: z.string(), name: z.string() }), items: z.array(checkoutItemSchema), currency: z.literal('INR'), amountPaise: z.number().int().positive(), financialExplanation: z.string(), expiresAt: z.string(),
});
const checkoutOutputSchema = z.object({ checkout: checkoutSchema });

function presentCheckout(checkout: CheckoutSnapshot, merchant: MerchantAdapter) {
  const merchantInfo = merchant.discover();
  return {
    checkoutId: checkout.id,
    cartId: checkout.cartId,
    merchant: { id: merchantInfo.id, name: merchantInfo.name },
    items: checkout.items,
    currency: checkout.currency,
    amountPaise: checkout.amountPaise,
    financialExplanation: `You are authorizing a maximum charge of ${formatInr(checkout.amountPaise)} (INR ${checkout.amountPaise} paise) to ${merchantInfo.name}. Authorization does not create a Razorpay order or complete a payment.`,
    expiresAt: checkout.expiresAt,
  };
}

function formatInr(amountPaise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amountPaise / 100);
}

export function registerCheckoutTools(server: NitroStackServer, merchant: MerchantAdapter, dependencies: ToolDependencies): void {
  const previewInput = z.object({
    session_id: z.string().min(3).max(100),
    cart_id: z.string().min(1),
    demo_price_change_before_payment: z.boolean().default(false).describe('Demo-only: emulate a merchant repricing after approval, so payment is deterministically blocked.'),
  });
  server.tool(new Tool<z.infer<typeof previewInput>>({
    name: 'create_checkout_preview', title: 'Create checkout preview',
    description: 'Re-price and validate a cart, then create an expiring snapshot of the exact amount to authorize.',
    inputSchema: previewInput,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'create_checkout_preview',
      audit: { sessionId: input.session_id, cartId: input.cart_id },
      operation: () => {
        const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
        const checkout = merchant.createCheckoutSnapshot({
          cartId: input.cart_id,
          sessionId: input.session_id,
          expiresAt,
          demoPriceChangeOnNextValidation: input.demo_price_change_before_payment,
        });
        return checkoutOutputSchema.parse({ checkout: presentCheckout(checkout, merchant) });
      },
    }),
  }));
}
