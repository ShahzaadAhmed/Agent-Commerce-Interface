import { NitroStackServer, Tool, z } from '@nitrostack/core';
import { AuthorizationStore } from '../auth/authorization-store.js';
import { PaymentPolicy } from '../auth/payment-policy.js';
import { DomainError } from '../domain/types.js';
import type { MerchantAdapter } from '../merchant/merchant-adapter.js';
import { RazorpayAdapter } from '../payment/razorpay-adapter.js';
import type { ToolDependencies } from './tool-helpers.js';
import { runAudited } from './tool-helpers.js';

const authorizationSchema = z.object({
  authorizationId: z.string(), checkoutId: z.string(), merchantId: z.string(), amountPaise: z.number().int().positive(), currency: z.literal('INR'), expiresAt: z.string(), status: z.enum(['pending', 'used', 'expired', 'revoked']),
});
const authorizationOutputSchema = z.object({ authorization: authorizationSchema, message: z.string() });
const paymentOutputSchema = z.object({ orderId: z.string(), amountPaise: z.number().int().positive(), currency: z.literal('INR'), paymentStatus: z.literal('order_created'), message: z.string() });

export function registerPaymentTools(
  server: NitroStackServer,
  merchant: MerchantAdapter,
  authorizations: AuthorizationStore,
  policy: PaymentPolicy,
  razorpay: RazorpayAdapter,
  dependencies: ToolDependencies,
): void {
  const authorizeInput = z.object({
    approved: z.literal(true).describe('Must be true to represent explicit user approval.'),
    checkout_id: z.string().min(1), merchant_id: z.string().min(1), amount_paise: z.number().int().positive(), currency: z.literal('INR'),
  });
  server.tool(new Tool<z.infer<typeof authorizeInput>>({
    name: 'authorize_payment', title: 'Authorize payment',
    description: 'Record explicit, short-lived approval for one exact checkout, merchant, amount, and currency. This never calls Razorpay.',
    inputSchema: authorizeInput,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'authorize_payment',
      audit: { checkoutId: input.checkout_id, merchantId: input.merchant_id, amountPaise: input.amount_paise, currency: input.currency },
      operation: () => {
        const checkout = merchant.validateCheckout(input.checkout_id);
        if (checkout.merchantId !== input.merchant_id) throw new DomainError('MERCHANT_MISMATCH', 'The merchant does not match the checkout snapshot.');
        if (checkout.currency !== input.currency) throw new DomainError('CURRENCY_MISMATCH', 'The currency does not match the checkout snapshot.');
        if (checkout.amountPaise !== input.amount_paise) throw new DomainError('AMOUNT_MISMATCH', 'The amount does not match the checkout snapshot.');
        const authorization = authorizations.create({
          checkoutId: checkout.id, merchantId: checkout.merchantId, amountPaise: checkout.amountPaise, currency: checkout.currency,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
        return authorizationOutputSchema.parse({ authorization: presentAuthorization(authorization), message: 'Authorization recorded. Razorpay has not been called.' });
      },
    }),
  }));

  const initiateInput = z.object({
    session_id: z.string().min(3).max(100), authorization_id: z.string().min(1), checkout_id: z.string().min(1), merchant_id: z.string().min(1), amount_paise: z.number().int().positive(), currency: z.literal('INR'),
  });
  server.tool(new Tool<z.infer<typeof initiateInput>>({
    name: 'initiate_razorpay_test_payment', title: 'Initiate Razorpay test payment',
    description: 'Sensitive operation. Verifies explicit, one-time approval and unchanged checkout before creating a Razorpay test order. Creating an order is not payment completion.',
    inputSchema: initiateInput,
    annotations: { destructiveHint: true, idempotentHint: false, readOnlyHint: false, openWorldHint: true },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'initiate_razorpay_test_payment',
      audit: { sessionId: input.session_id, checkoutId: input.checkout_id, authorizationId: input.authorization_id, merchantId: input.merchant_id, amountPaise: input.amount_paise, currency: input.currency },
      operation: async () => {
        const checkout = merchant.getCheckout(input.checkout_id);
        merchant.getCart(checkout.cartId, input.session_id);
        policy.authorize({ authorizationId: input.authorization_id, checkoutId: input.checkout_id, merchantId: input.merchant_id, amountPaise: input.amount_paise, currency: input.currency });
        if (!razorpay.isConfigured()) {
          throw new DomainError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'Razorpay test credentials are not configured; no Razorpay order or payment was created.');
        }
        const result = await razorpay.createTestOrder({
          amountPaise: input.amount_paise, currency: input.currency, receipt: input.checkout_id.slice(0, 40),
          notes: { checkout_id: input.checkout_id, authorization_id: input.authorization_id },
        });
        if (result.kind !== 'created') throw new DomainError('PAYMENT_PROVIDER_ERROR', 'Razorpay did not create an order. No authorization was consumed.');
        authorizations.markUsed(input.authorization_id);
        return paymentOutputSchema.parse({ orderId: result.orderId, amountPaise: result.amountPaise, currency: result.currency, paymentStatus: 'order_created', message: 'Razorpay test order created. Hosted checkout and payment completion require client-side user interaction.' });
      },
    }),
  }));
}

function presentAuthorization(authorization: {
  id: string; checkoutId: string; merchantId: string; amountPaise: number; currency: 'INR'; expiresAt: string; status: 'pending' | 'used' | 'expired' | 'revoked';
}) {
  return { authorizationId: authorization.id, checkoutId: authorization.checkoutId, merchantId: authorization.merchantId, amountPaise: authorization.amountPaise, currency: authorization.currency, expiresAt: authorization.expiresAt, status: authorization.status };
}
