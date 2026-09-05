import { createServer } from '@nitrostack/core';
import { AuditStore } from './audit/audit-store.js';
import { AuthorizationStore } from './auth/authorization-store.js';
import { PaymentPolicy } from './auth/payment-policy.js';
import { DemoMerchantAdapter } from './merchant/demo-merchant-adapter.js';
import { RazorpayAdapter } from './payment/razorpay-adapter.js';
import { registerAuditTools } from './tools/audit-tools.js';
import { registerCartTools } from './tools/cart-tools.js';
import { registerCheckoutTools } from './tools/checkout-tools.js';
import { registerMerchantTools } from './tools/merchant-tools.js';
import { registerPaymentTools } from './tools/payment-tools.js';

const server = createServer({
  name: 'agent-commerce',
  version: '1.0.0',
  description: 'An MCP-native, policy-controlled interface to merchant commerce.',
});

const merchant = new DemoMerchantAdapter();
const audit = new AuditStore();
const authorizations = new AuthorizationStore();
const policy = new PaymentPolicy(merchant, authorizations);
const razorpay = new RazorpayAdapter();
const dependencies = { audit };

registerMerchantTools(server, merchant, dependencies);
registerCartTools(server, merchant, dependencies);
registerCheckoutTools(server, merchant, dependencies);
registerPaymentTools(server, merchant, authorizations, policy, razorpay, dependencies);
registerAuditTools(server, dependencies);

server.start().catch((error: unknown) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
