import { randomUUID } from 'node:crypto';
import {
  Cart,
  CheckoutItem,
  CheckoutSnapshot,
  DomainError,
  Product,
  ProductVariant,
} from '../domain/types.js';
import type { MerchantAdapter, MerchantDescriptor } from './merchant-adapter.js';

const merchant: MerchantDescriptor = {
  id: 'demo-electronics-india',
  name: 'Demo Electronics India',
  capabilities: ['catalog.search', 'product.variants', 'cart', 'checkout.preview', 'razorpay.test-order'],
};

export class DemoMerchantAdapter implements MerchantAdapter {
  private readonly carts = new Map<string, Cart>();
  private readonly checkouts = new Map<string, CheckoutSnapshot>();
  private readonly catalog: Product[] = [
    this.product('phone-pro', 'Orbit Phone Pro', 'Flagship Android phone with a pro-grade camera system.', 'Phones', [
      this.variant('black-256', 'Midnight Black · 256 GB', { color: 'Midnight Black', storage: '256 GB' }, 2_899_900, 12),
      this.variant('silver-512', 'Silver · 512 GB', { color: 'Silver', storage: '512 GB' }, 3_299_900, 6),
    ]),
    this.product('noise-cancelling-headphones', 'Auralis NC 700', 'Over-ear wireless headphones with adaptive noise cancellation.', 'Audio', [
      this.variant('graphite', 'Graphite', { color: 'Graphite' }, 24_999, 24),
      this.variant('sand', 'Sand', { color: 'Sand' }, 24_999, 8),
    ]),
    this.product('smartwatch', 'Pulse Watch 3', 'Fitness and notification smartwatch with a five-day battery.', 'Wearables', [
      this.variant('42-black', '42 mm · Black', { size: '42 mm', color: 'Black' }, 18_499, 18),
      this.variant('46-blue', '46 mm · Blue', { size: '46 mm', color: 'Blue' }, 19_999, 9),
    ]),
    this.product('mechanical-keyboard', 'Keystone 75', 'Hot-swappable compact mechanical keyboard.', 'Accessories', [
      this.variant('linear', 'Linear switches', { switches: 'Linear' }, 8_999, 30),
      this.variant('tactile', 'Tactile switches', { switches: 'Tactile' }, 9_499, 20),
    ]),
    this.product('portable-speaker', 'Harbor Mini', 'Water-resistant portable Bluetooth speaker.', 'Audio', [
      this.variant('coral', 'Coral', { color: 'Coral' }, 5_499, 16),
      this.variant('navy', 'Navy', { color: 'Navy' }, 5_499, 16),
    ]),
    this.product('usb-c-charger', 'Volt 65W GaN Charger', 'Compact dual-port USB-C fast charger.', 'Accessories', [
      this.variant('india', 'India plug', { plug: 'India' }, 3_299, 50),
    ]),
  ];

  discover(): MerchantDescriptor {
    return merchant;
  }

  searchProducts(query?: string): Product[] {
    const needle = query?.trim().toLowerCase();
    return this.catalog
      .filter((product) => !needle || `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(needle))
      .map((product) => this.copyProduct(product));
  }

  getProduct(productId: string): Product {
    return this.copyProduct(this.requireProduct(productId));
  }

  createCart(sessionId: string): Cart {
    const timestamp = new Date().toISOString();
    const cart: Cart = {
      id: `cart_${randomUUID()}`,
      sessionId,
      merchantId: merchant.id,
      items: [],
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.carts.set(cart.id, cart);
    return this.copyCart(cart);
  }

  addCartItem(input: { cartId: string; sessionId: string; productId: string; variantId: string; quantity: number }): Cart {
    const cart = this.requireCart(input.cartId, input.sessionId);
    const variant = this.requireVariant(input.productId, input.variantId);
    const existing = cart.items.find((item) => item.productId === input.productId && item.variantId === input.variantId);
    const requestedQuantity = (existing?.quantity ?? 0) + input.quantity;
    if (requestedQuantity > variant.stock) {
      throw new DomainError('OUT_OF_STOCK', 'The requested quantity exceeds available stock.', {
        availableStock: variant.stock,
        requestedQuantity,
      });
    }

    if (existing) existing.quantity = requestedQuantity;
    else cart.items.push({ productId: input.productId, variantId: input.variantId, quantity: input.quantity });
    cart.version += 1;
    cart.updatedAt = new Date().toISOString();
    return this.copyCart(cart);
  }

  getCart(cartId: string, sessionId: string): Cart {
    return this.copyCart(this.requireCart(cartId, sessionId));
  }

  createCheckoutSnapshot(input: {
    cartId: string;
    sessionId: string;
    expiresAt: string;
    demoPriceChangeOnNextValidation: boolean;
  }): CheckoutSnapshot {
    const cart = this.requireCart(input.cartId, input.sessionId);
    const items = this.resolveCartItems(cart);
    const checkout: CheckoutSnapshot = {
      id: `checkout_${randomUUID()}`,
      cartId: cart.id,
      sessionId: cart.sessionId,
      merchantId: cart.merchantId,
      currency: 'INR',
      items,
      amountPaise: items.reduce((total, item) => total + item.lineTotalPaise, 0),
      cartVersion: cart.version,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
      demoPriceChangeOnNextValidation: input.demoPriceChangeOnNextValidation,
    };
    this.checkouts.set(checkout.id, checkout);
    return this.copyCheckout(checkout);
  }

  getCheckout(checkoutId: string): CheckoutSnapshot {
    return this.copyCheckout(this.requireCheckout(checkoutId));
  }

  validateCheckout(checkoutId: string, applyDemoPriceChange = false): CheckoutSnapshot {
    const checkout = this.requireCheckout(checkoutId);
    if (Date.parse(checkout.expiresAt) <= Date.now()) {
      throw new DomainError('CHECKOUT_EXPIRED', 'The checkout snapshot has expired. Create a new checkout preview.');
    }

    if (applyDemoPriceChange && checkout.demoPriceChangeOnNextValidation) {
      const firstItem = checkout.items[0];
      const variant = this.requireVariant(firstItem.productId, firstItem.variantId);
      // A deliberate, opt-in test hook used to prove that policy blocks stale approvals.
      variant.pricePaise = 3_299_900;
      checkout.demoPriceChangeOnNextValidation = false;
    }

    const cart = this.requireCart(checkout.cartId, checkout.sessionId);
    const currentItems = this.resolveCartItems(cart);
    const currentAmount = currentItems.reduce((total, item) => total + item.lineTotalPaise, 0);
    const changed = cart.version !== checkout.cartVersion
      || currentAmount !== checkout.amountPaise
      || JSON.stringify(currentItems) !== JSON.stringify(checkout.items);
    if (changed) {
      throw new DomainError('CHECKOUT_CHANGED', 'The merchant catalog or cart changed after this checkout was created. No payment was initiated.', {
        authorizedAmountPaise: checkout.amountPaise,
        currentAmountPaise: currentAmount,
        currency: checkout.currency,
      });
    }
    return this.copyCheckout(checkout);
  }

  private resolveCartItems(cart: Cart): CheckoutItem[] {
    if (cart.items.length === 0) throw new DomainError('EMPTY_CART', 'A checkout cannot be created from an empty cart.');
    return cart.items.map((item) => {
      const product = this.requireProduct(item.productId);
      const variant = this.requireVariant(item.productId, item.variantId);
      if (item.quantity > variant.stock) {
        throw new DomainError('OUT_OF_STOCK', 'An item in the cart is no longer available in the requested quantity.', {
          productId: item.productId,
          variantId: item.variantId,
          availableStock: variant.stock,
        });
      }
      return {
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        variantName: variant.name,
        quantity: item.quantity,
        unitPricePaise: variant.pricePaise,
        lineTotalPaise: variant.pricePaise * item.quantity,
      };
    });
  }

  private requireProduct(productId: string): Product {
    const product = this.catalog.find((entry) => entry.id === productId);
    if (!product) throw new DomainError('PRODUCT_NOT_FOUND', 'The requested product does not exist.', { productId });
    return product;
  }

  private requireVariant(productId: string, variantId: string): ProductVariant {
    const variant = this.requireProduct(productId).variants.find((entry) => entry.id === variantId);
    if (!variant) throw new DomainError('VARIANT_NOT_FOUND', 'The requested product variant does not exist.', { productId, variantId });
    return variant;
  }

  private requireCart(cartId: string, sessionId: string): Cart {
    const cart = this.carts.get(cartId);
    if (!cart) throw new DomainError('CART_NOT_FOUND', 'The requested cart does not exist.', { cartId });
    if (cart.sessionId !== sessionId) throw new DomainError('UNAUTHORIZED', 'This cart belongs to a different buyer session.');
    return cart;
  }

  private requireCheckout(checkoutId: string): CheckoutSnapshot {
    const checkout = this.checkouts.get(checkoutId);
    if (!checkout) throw new DomainError('CHECKOUT_NOT_FOUND', 'The requested checkout does not exist.', { checkoutId });
    return checkout;
  }

  private product(id: string, name: string, description: string, category: string, variants: ProductVariant[]): Product {
    return { id, name, description, category, variants };
  }

  private variant(id: string, name: string, attributes: Record<string, string>, pricePaise: number, stock: number): ProductVariant {
    return { id, name, attributes, pricePaise, stock };
  }

  private copyProduct(product: Product): Product {
    return structuredClone(product);
  }

  private copyCart(cart: Cart): Cart {
    return structuredClone(cart);
  }

  private copyCheckout(checkout: CheckoutSnapshot): CheckoutSnapshot {
    return structuredClone(checkout);
  }
}
