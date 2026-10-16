---
"@medusajs/core-flows": patch
---

fix(core-flows): revalidate cart tax lines before creating the order in completeCartWorkflow when the region has automatic taxes, and restore all of the cart's previous tax lines when setTaxLinesForItemsStep is compensated
