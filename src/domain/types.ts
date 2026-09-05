export type Currency = 'INR';

export interface ProductVariant {
  id: string;
  name: string;
  attributes: Record<string, string>;
  pricePaise: number;
  stock: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  variants: ProductVariant[];
}

export interface CartItem {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface Cart {
  id: string;
  sessionId: string;
  merchantId: string;
  items: CartItem[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutItem {
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface CheckoutSnapshot {
  id: string;
  cartId: string;
  sessionId: string;
  merchantId: string;
  currency: Currency;
  items: CheckoutItem[];
  amountPaise: number;
  cartVersion: number;
  expiresAt: string;
  createdAt: string;
  demoPriceChangeOnNextValidation: boolean;
}

export type AuthorizationStatus = 'pending' | 'used' | 'expired' | 'revoked';

export interface PaymentAuthorization {
  id: string;
  checkoutId: string;
  merchantId: string;
  amountPaise: number;
  currency: Currency;
  expiresAt: string;
  status: AuthorizationStatus;
  createdAt: string;
  usedAt?: string;
}

export interface DomainErrorShape {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function asDomainError(error: unknown): DomainErrorShape {
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message, details: error.details };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'The requested commerce operation could not be completed.',
  };
}
