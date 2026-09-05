import type { Cart, CheckoutSnapshot, Product } from '../domain/types.js';

export interface MerchantDescriptor {
  id: string;
  name: string;
  capabilities: string[];
}

export interface MerchantAdapter {
  discover(): MerchantDescriptor;
  searchProducts(query?: string): Product[];
  getProduct(productId: string): Product;
  createCart(sessionId: string): Cart;
  addCartItem(input: {
    cartId: string;
    sessionId: string;
    productId: string;
    variantId: string;
    quantity: number;
  }): Cart;
  getCart(cartId: string, sessionId: string): Cart;
  createCheckoutSnapshot(input: {
    cartId: string;
    sessionId: string;
    expiresAt: string;
    demoPriceChangeOnNextValidation: boolean;
  }): CheckoutSnapshot;
  getCheckout(checkoutId: string): CheckoutSnapshot;
  validateCheckout(checkoutId: string, applyDemoPriceChange?: boolean): CheckoutSnapshot;
}
