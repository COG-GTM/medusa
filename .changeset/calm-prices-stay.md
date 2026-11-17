---
"@medusajs/medusa": patch
"@medusajs/pricing": patch
"@medusajs/core-flows": patch
---

fix: reject negative prices in the Admin API and the pricing module, and return a 400 when a cart gets an item with a negative price
