import { NitroStackServer, Tool, z } from '@nitrostack/core';
import { AuthorizationStore } from '../auth/authorization-store.js';
import { PaymentPolicy } from '../auth/payment-policy.js';
import { DomainError } from '../domain/types.js';
import type { MerchantAdapter } from '../merchant/merchant-adapter.js';
import { RazorpayAdapter, RazorpayRequestUncertainError } from '../payment/razorpay-adapter.js';
import type { ToolDependencies } from './tool-helpers.js';
import { runAudited } from './tool-helpers.js';

const authorizationSchema = z.object({
  authorizationId: z.string(), checkoutId: z.string(), merchantId: z.string(), amountPaise: z.number().int().positive(), currency: z.literal('INR'), expiresAt: z.string(), status: z.enum(['pending', 'in_flight', 'used', 'expired', 'revoked', 'payment_state_unknown']),
});
const authorizationOutputSchema = z.object({ authorization: authorizationSchema, message: z.string() });
const paymentOutputSchema = z.object({ order_id: z.string(), amount_paise: z.number().int().positive(), currency: z.literal('INR'), razorpay_order_status: z.string(), payment_status: z.literal('payment_not_completed'), message: z.string() });

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

  const createOrderInput = z.object({
    session_id: z.string().min(3).max(100), authorization_id: z.string().min(1), checkout_id: z.string().min(1), merchant_id: z.string().min(1), amount_paise: z.number().int().positive(), currency: z.literal('INR'),
  });
  server.tool(new Tool<z.infer<typeof createOrderInput>>({
    name: 'create_razorpay_test_order', title: 'Create Razorpay test order',
    description: 'Sensitive operation. Verifies explicit, one-time approval and an unchanged checkout before creating one Razorpay test order. Order creation does not complete payment.',
    inputSchema: createOrderInput,
    annotations: { destructiveHint: true, idempotentHint: false, readOnlyHint: false, openWorldHint: true },
    handler: async (input, context) => runAudited({
      dependencies, requestId: context.requestId, action: 'create_razorpay_test_order',
      audit: { sessionId: input.session_id, checkoutId: input.checkout_id, authorizationId: input.authorization_id, merchantId: input.merchant_id, amountPaise: input.amount_paise, currency: input.currency },
      operation: async () => {
        const checkout = merchant.getCheckout(input.checkout_id);
        merchant.getCart(checkout.cartId, input.session_id);
        policy.authorize({ authorizationId: input.authorization_id, checkoutId: input.checkout_id, merchantId: input.merchant_id, amountPaise: input.amount_paise, currency: input.currency });
        razorpay.assertTestModeConfigured();
        authorizations.beginProviderAttempt(input.authorization_id);
        await dependencies.audit.record({
          requestId: context.requestId,
          action: 'razorpay_order_request',
          outcome: 'started',
          reason: 'AUTHORIZATION_IN_FLIGHT',
          sessionId: input.session_id,
          checkoutId: input.checkout_id,
          authorizationId: input.authorization_id,
          merchantId: input.merchant_id,
          amountPaise: input.amount_paise,
          currency: input.currency,
        });
        let result;
        try {
          result = await razorpay.createTestOrder({
            amountPaise: input.amount_paise, currency: input.currency, receipt: input.checkout_id.slice(0, 40),
            notes: { checkout_id: input.checkout_id, authorization_id: input.authorization_id },
          });
        } catch (error) {
          authorizations.markPaymentStateUnknown(input.authorization_id);
          const reason = error instanceof DomainError ? error.code : 'PAYMENT_STATE_UNKNOWN';
          await dependencies.audit.record({
            requestId: context.requestId,
            action: 'razorpay_order_request',
            outcome: 'failure',
            reason,
            sessionId: input.session_id,
            checkoutId: input.checkout_id,
            authorizationId: input.authorization_id,
            merchantId: input.merchant_id,
            amountPaise: input.amount_paise,
            currency: input.currency,
          });
          if (error instanceof RazorpayRequestUncertainError) {
            throw new DomainError('PAYMENT_STATE_UNKNOWN', 'Razorpay request state is unknown. Do not retry automatically; verify provider state before another financial action.');
          }
          throw error;
        }
        authorizations.markUsed(input.authorization_id, result.orderId);
        await dependencies.audit.record({
          requestId: context.requestId,
          action: 'razorpay_order_request',
          outcome: 'success',
          reason: 'RAZORPAY_ORDER_CREATED',
          sessionId: input.session_id,
          checkoutId: input.checkout_id,
          authorizationId: input.authorization_id,
          merchantId: input.merchant_id,
          amountPaise: result.amountPaise,
          currency: result.currency,
          details: { razorpayOrderId: result.orderId },
        });
        return paymentOutputSchema.parse({
          order_id: result.orderId,
          amount_paise: result.amountPaise,
          currency: result.currency,
          razorpay_order_status: result.status,
          payment_status: 'payment_not_completed',
          message: 'Razorpay order created; payment not yet completed. Use the returned order_id with Checkout to continue user-authorized payment.',
        });
      },
    }),
  }));
}

function presentAuthorization(authorization: {
  id: string; checkoutId: string; merchantId: string; amountPaise: number; currency: 'INR'; expiresAt: string; status: 'pending' | 'in_flight' | 'used' | 'expired' | 'revoked' | 'payment_state_unknown';
}) {
  return { authorizationId: authorization.id, checkoutId: authorization.checkoutId, merchantId: authorization.merchantId, amountPaise: authorization.amountPaise, currency: authorization.currency, expiresAt: authorization.expiresAt, status: authorization.status };
}
