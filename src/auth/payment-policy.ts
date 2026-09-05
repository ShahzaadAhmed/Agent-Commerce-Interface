import { AuthorizationStore } from './authorization-store.js';
import { DomainError, PaymentAuthorization } from '../domain/types.js';
import type { MerchantAdapter } from '../merchant/merchant-adapter.js';

export class PaymentPolicy {
  constructor(
    private readonly merchant: MerchantAdapter,
    private readonly authorizations: AuthorizationStore,
  ) {}

  authorize(input: {
    authorizationId: string;
    checkoutId: string;
    merchantId: string;
    amountPaise: number;
    currency: 'INR';
  }): PaymentAuthorization {
    const authorization = this.authorizations.get(input.authorizationId);
    if (authorization.status === 'expired') {
      throw new DomainError('AUTHORIZATION_EXPIRED', 'The payment authorization has expired.');
    }
    if (authorization.status !== 'pending') {
      throw new DomainError('AUTHORIZATION_ALREADY_USED', 'The payment authorization is no longer pending.', {
        status: authorization.status,
      });
    }
    if (authorization.checkoutId !== input.checkoutId) {
      throw new DomainError('UNAUTHORIZED', 'The authorization is not bound to this checkout.');
    }
    if (authorization.merchantId !== input.merchantId) {
      throw new DomainError('MERCHANT_MISMATCH', 'The merchant does not match the approved authorization.');
    }
    if (authorization.currency !== input.currency) {
      throw new DomainError('CURRENCY_MISMATCH', 'The currency does not match the approved authorization.');
    }
    if (authorization.amountPaise !== input.amountPaise) {
      throw new DomainError('AMOUNT_MISMATCH', 'The amount does not match the approved authorization.', {
        approvedAmountPaise: authorization.amountPaise,
        requestedAmountPaise: input.amountPaise,
      });
    }

    const checkout = this.merchant.validateCheckout(input.checkoutId, true);
    if (checkout.merchantId !== input.merchantId) {
      throw new DomainError('MERCHANT_MISMATCH', 'The merchant does not match the checkout snapshot.');
    }
    if (checkout.currency !== input.currency) {
      throw new DomainError('CURRENCY_MISMATCH', 'The currency does not match the checkout snapshot.');
    }
    if (checkout.amountPaise !== input.amountPaise) {
      throw new DomainError('AMOUNT_MISMATCH', 'The amount does not match the current checkout snapshot.');
    }
    return authorization;
  }
}
