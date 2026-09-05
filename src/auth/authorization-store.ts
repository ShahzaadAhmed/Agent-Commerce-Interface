import { randomUUID } from 'node:crypto';
import { DomainError, PaymentAuthorization } from '../domain/types.js';

export class AuthorizationStore {
  private readonly authorizations = new Map<string, PaymentAuthorization>();

  create(input: {
    checkoutId: string;
    merchantId: string;
    amountPaise: number;
    currency: 'INR';
    expiresAt: string;
  }): PaymentAuthorization {
    const now = new Date().toISOString();
    const authorization: PaymentAuthorization = {
      id: `auth_${randomUUID()}`,
      checkoutId: input.checkoutId,
      merchantId: input.merchantId,
      amountPaise: input.amountPaise,
      currency: input.currency,
      expiresAt: input.expiresAt,
      status: 'pending',
      createdAt: now,
    };
    this.authorizations.set(authorization.id, authorization);
    return structuredClone(authorization);
  }

  get(authorizationId: string): PaymentAuthorization {
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) {
      throw new DomainError('UNAUTHORIZED', 'The supplied payment authorization does not exist.');
    }
    if (authorization.status === 'pending' && Date.parse(authorization.expiresAt) <= Date.now()) {
      authorization.status = 'expired';
    }
    return structuredClone(authorization);
  }

  beginProviderAttempt(authorizationId: string): PaymentAuthorization {
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) throw new DomainError('UNAUTHORIZED', 'The supplied payment authorization does not exist.');
    if (authorization.status !== 'pending') {
      throw new DomainError('AUTHORIZATION_ALREADY_USED', 'This payment authorization can no longer start a provider request.', {
        status: authorization.status,
      });
    }
    authorization.status = 'in_flight';
    authorization.inFlightAt = new Date().toISOString();
    return structuredClone(authorization);
  }

  markUsed(authorizationId: string, razorpayOrderId: string): PaymentAuthorization {
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) throw new DomainError('UNAUTHORIZED', 'The supplied payment authorization does not exist.');
    if (authorization.status !== 'in_flight') {
      throw new DomainError('AUTHORIZATION_ALREADY_USED', 'This payment authorization is not awaiting a provider result.', {
        status: authorization.status,
      });
    }
    authorization.status = 'used';
    authorization.usedAt = new Date().toISOString();
    authorization.razorpayOrderId = razorpayOrderId;
    return structuredClone(authorization);
  }

  markPaymentStateUnknown(authorizationId: string): PaymentAuthorization {
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) throw new DomainError('UNAUTHORIZED', 'The supplied payment authorization does not exist.');
    if (authorization.status !== 'in_flight') {
      throw new DomainError('AUTHORIZATION_ALREADY_USED', 'This payment authorization is not awaiting a provider result.', {
        status: authorization.status,
      });
    }
    authorization.status = 'payment_state_unknown';
    authorization.unknownAt = new Date().toISOString();
    return structuredClone(authorization);
  }
}
