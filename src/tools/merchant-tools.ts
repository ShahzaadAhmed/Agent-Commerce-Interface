import { NitroStackServer, Tool, z } from '@nitrostack/core';
import type { MerchantAdapter } from '../merchant/merchant-adapter.js';
import type { ToolDependencies } from './tool-helpers.js';
import { runAudited } from './tool-helpers.js';

const variantSchema = z.object({
  id: z.string(), name: z.string(), attributes: z.record(z.string()), pricePaise: z.number().int(), stock: z.number().int(),
});
const productSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), category: z.string(), variants: z.array(variantSchema),
});
const merchantSchema = z.object({ id: z.string(), name: z.string(), capabilities: z.array(z.string()) });
const merchantsOutputSchema = z.object({ merchants: z.array(merchantSchema) });
const productsOutputSchema = z.object({ products: z.array(productSchema) });
const productOutputSchema = z.object({ product: productSchema });

export function registerMerchantTools(server: NitroStackServer, merchant: MerchantAdapter, dependencies: ToolDependencies): void {
  const discoverInput = z.object({});
  server.tool(new Tool<z.infer<typeof discoverInput>>({
    name: 'discover_merchants',
    title: 'Discover merchants',
    description: 'Discover the demo merchant and its supported agent-commerce capabilities.',
    inputSchema: discoverInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (_input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'discover_merchants', audit: {},
      operation: () => merchantsOutputSchema.parse({ merchants: [merchant.discover()] }),
    }),
  }));

  const searchInput = z.object({
    query: z.string().trim().max(100).optional().describe('Optional product name, category, or keyword.'),
  });
  server.tool(new Tool<z.infer<typeof searchInput>>({
    name: 'search_products',
    title: 'Search products',
    description: 'Search the demo merchant catalog. Returns concise product and variant information.',
    inputSchema: searchInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'search_products', audit: {},
      operation: () => productsOutputSchema.parse({ products: merchant.searchProducts(input.query) }),
    }),
  }));

  const getProductInput = z.object({ product_id: z.string().min(1) });
  server.tool(new Tool<z.infer<typeof getProductInput>>({
    name: 'get_product',
    title: 'Get product details',
    description: 'Get a product, including purchasable variants, stock, and prices in paise.',
    inputSchema: getProductInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'get_product', audit: { details: { productId: input.product_id } },
      operation: () => productOutputSchema.parse({ product: merchant.getProduct(input.product_id) }),
    }),
  }));
}
