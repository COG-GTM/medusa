---
"@medusajs/promotion": patch
---

fix(promotion): lock promotion and campaign budget rows in `revertUsage` so concurrent reverts (e.g. complete-cart compensation) no longer lose decrements
