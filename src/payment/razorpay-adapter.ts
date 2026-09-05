export interface RazorpayOrderRequest {
  amountPaise: number;
  currency: 'INR';
  receipt: string;
  notes: Record<string, string>;
}

export type RazorpayOrderResult =
  | { kind: 'not_configured' }
  | { kind: 'created'; orderId: string; amountPaise: number; currency: 'INR'; receipt: string };

/**
 * Network calls are intentionally deferred until the local commerce/policy flow
 * has been demonstrated. This keeps the payment tool safe in an unconfigured
 * starter while preserving the boundary where Razorpay REST integration belongs.
 */
export class RazorpayAdapter {
  isConfigured(): boolean {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  }

  async createTestOrder(_request: RazorpayOrderRequest): Promise<RazorpayOrderResult> {
    return { kind: 'not_configured' };
  }
}
