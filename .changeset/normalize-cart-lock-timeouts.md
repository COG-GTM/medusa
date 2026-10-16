---
"@medusajs/core-flows": patch
---

fix(core-flows): share one cart lock timeout/TTL across cart workflows so mutations wait for an in-flight completion instead of failing, and lock before fetching in updateTaxLinesWorkflow
