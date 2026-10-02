---
"@medusajs/core-flows": patch
---

fix(core-flows): link the order to its cart in the same step that creates it during cart completion, so a retry after a crash can't create a duplicate order
