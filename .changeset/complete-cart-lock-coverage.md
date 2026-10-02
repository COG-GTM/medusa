---
"@medusajs/core-flows": patch
---

fix(core-flows): fence the complete-cart lock with a per-transaction owner and renew it before payment authorization so a slow payment provider can't let a concurrent completion proceed
