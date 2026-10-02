---
"@medusajs/core-flows": patch
---

fix(core-flows): only delete stale payment sessions when refreshing a cart's payment collection, refuse to delete authorized/captured/pending-authorization sessions, and raise the refresh lock timeout
