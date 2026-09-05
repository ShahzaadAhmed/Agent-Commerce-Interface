import { DomainError } from '../domain/types.js';

const RAZORPAY_ORDERS_URL = 'https://api.razorpay.com/v1/orders';

export interface RazorpayOrderRequest {
  amountPaise: number;
  currency: 'INR';
  receipt: string;
  notes: Record<string, string>;
}

export interface RazorpayOrderResult {
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  receipt: string;
  status: string;
}

/** A transport failure is conservatively treated as an unknown provider state. */
export class RazorpayRequestUncertainError extends Error {
  constructor() {
    super('The Razorpay request did not complete reliably.');
    this.name = 'RazorpayRequestUncertainError';
  }
}

export class RazorpayAdapter {
  private getCredentials(): { keyId: string; keySecret: string } {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new DomainError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'Razorpay test credentials are not configured; no Razorpay order was created.');
    }
    if (!keyId.startsWith('rzp_test_')) {
      throw new DomainError('TEST_MODE_REQUIRED', 'Only Razorpay test-mode credentials may be used by this server.');
    }
    return { keyId, keySecret };
  }

  assertTestModeConfigured(): void {
    this.getCredentials();
  }

  async createTestOrder(request: RazorpayOrderRequest): Promise<RazorpayOrderResult> {
    const { keyId, keySecret } = this.getCredentials();
    const authorization = Buffer.from(`${keyId}:${keySecret}`, 'utf8').toString('base64');
    let response: Response;

    try {
      response = await fetch(RAZORPAY_ORDERS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorization}`,
          'Content-Type': 'application/json',
        },
        // Razorpay does not document an idempotency header for POST /v1/orders.
        body: JSON.stringify({
          amount: request.amountPaise,
          currency: request.currency,
          receipt: request.receipt,
          notes: request.notes,
        }),
      });
    } catch {
      // A network failure can occur after the request has reached Razorpay. Never retry here.
      throw new RazorpayRequestUncertainError();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RazorpayRequestUncertainError();
    }

    if (!response.ok) {
      // The provider returned a response, but the authorization remains non-retryable by policy.
      throw new DomainError('PAYMENT_PROVIDER_ERROR', 'Razorpay rejected order creation. Verify provider state before attempting another financial action.', {
        providerStatus: response.status,
      });
    }

    if (!isRazorpayOrder(payload)) {
      throw new RazorpayRequestUncertainError();
    }
    if (payload.currency !== request.currency || payload.amount !== request.amountPaise) {
      throw new RazorpayRequestUncertainError();
    }
    return {
      orderId: payload.id,
      amountPaise: payload.amount,
      currency: payload.currency,
      receipt: payload.receipt,
      status: payload.status,
    };
  }
}

function isRazorpayOrder(value: unknown): value is {
  id: string;
  amount: number;
  currency: 'INR';
  receipt: string;
  status: string;
} {
  if (!value || typeof value !== 'object') return false;
  const order = value as Record<string, unknown>;
  return typeof order.id === 'string'
    && typeof order.amount === 'number'
    && order.currency === 'INR'
    && typeof order.receipt === 'string'
    && typeof order.status === 'string';
}
