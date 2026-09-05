import { NitroStackServer, Tool, z } from '@nitrostack/core';
import type { Cart } from '../domain/types.js';
import type { MerchantAdapter } from '../merchant/merchant-adapter.js';
import type { ToolDependencies } from './tool-helpers.js';
import { runAudited } from './tool-helpers.js';

const cartItemSchema = z.object({
  productId: z.string(), variantId: z.string(), quantity: z.number().int().positive(), unitPricePaise: z.number().int().nonnegative(), lineTotalPaise: z.number().int().nonnegative(),
});
const cartSchema = z.object({
  id: z.string(), merchantId: z.string(), sessionId: z.string(), version: z.number().int(), createdAt: z.string(), updatedAt: z.string(),
  items: z.array(cartItemSchema), totalPaise: z.number().int().nonnegative(), currency: z.literal('INR'),
});
const cartOutputSchema = z.object({ cart: cartSchema });

function presentCart(cart: Cart, merchant: MerchantAdapter) {
  const items = cart.items.map((item) => {
    const product = merchant.getProduct(item.productId);
    const variant = product.variants.find((entry) => entry.id === item.variantId);
    if (!variant) throw new Error(`Missing variant ${item.variantId}`);
    return { ...item, unitPricePaise: variant.pricePaise, lineTotalPaise: variant.pricePaise * item.quantity };
  });
  return { ...cart, items, totalPaise: items.reduce((total, item) => total + item.lineTotalPaise, 0), currency: 'INR' as const };
}

export function registerCartTools(server: NitroStackServer, merchant: MerchantAdapter, dependencies: ToolDependencies): void {
  const createInput = z.object({ session_id: z.string().min(3).max(100).describe('Opaque buyer-session identifier.') });
  server.tool(new Tool<z.infer<typeof createInput>>({
    name: 'create_cart', title: 'Create cart', description: 'Create a new cart bound to the supplied buyer session.',
    inputSchema: createInput,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'create_cart', audit: { sessionId: input.session_id },
      operation: () => cartOutputSchema.parse({ cart: presentCart(merchant.createCart(input.session_id), merchant) }),
    }),
  }));

  const addInput = z.object({
    session_id: z.string().min(3).max(100), cart_id: z.string().min(1), product_id: z.string().min(1), variant_id: z.string().min(1), quantity: z.number().int().positive().max(10),
  });
  server.tool(new Tool<z.infer<typeof addInput>>({
    name: 'add_cart_item', title: 'Add cart item', description: 'Add a specific in-stock product variant to a session-bound cart.',
    inputSchema: addInput,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'add_cart_item',
      audit: { sessionId: input.session_id, cartId: input.cart_id, details: { productId: input.product_id, variantId: input.variant_id, quantity: input.quantity } },
      operation: () => cartOutputSchema.parse({ cart: presentCart(merchant.addCartItem({ cartId: input.cart_id, sessionId: input.session_id, productId: input.product_id, variantId: input.variant_id, quantity: input.quantity }), merchant) }),
    }),
  }));

  const getInput = z.object({ session_id: z.string().min(3).max(100), cart_id: z.string().min(1) });
  server.tool(new Tool<z.infer<typeof getInput>>({
    name: 'get_cart', title: 'Get cart', description: 'Get the session-bound cart and its current calculated total.',
    inputSchema: getInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'get_cart', audit: { sessionId: input.session_id, cartId: input.cart_id },
      operation: () => cartOutputSchema.parse({ cart: presentCart(merchant.getCart(input.cart_id, input.session_id), merchant) }),
    }),
  }));
}
