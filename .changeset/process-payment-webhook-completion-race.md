---
"@medusajs/core-flows": patch
"@medusajs/utils": patch
---

fix(core-flows): read payment/order state under the cart lock in `processPaymentWorkflow` and emit `payment.cart_completion_failed` instead of silently swallowing a failed webhook-triggered cart completion
