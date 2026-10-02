---
"@medusajs/tax": patch
---

fix(tax): surface a `tax.region_missing` event and warning when no tax region matches the address, with a `missing_tax_region_behavior` module option (`warn` | `throw` | `ignore`)
