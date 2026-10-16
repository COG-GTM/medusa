# Gap checkout demo harness

A Gap-styled storefront that drives a real local Medusa backend through the
checkout regression scenarios for the cart completion tickets. It is skipped
unless `GAP_DEMO` is set.

```bash
cd integration-tests/http
GAP_DEMO=1 DB_HOST=localhost DB_PORT=5439 DB_USERNAME=postgres DB_PASSWORD=postgres \
  DB_TEMP_NAME=medusa-gap-demo \
  npx jest --forceExit --testTimeout=86400000 __demo__/gap-checkout
```

Open `http://localhost:7001/?scenario=<id>` and click "Run scenario"
(`&autorun=1&delay=<ms>` runs it automatically). The badge in the runner shows
the branch and commit the backend was started from. Packages are loaded from
their built `dist`, so run `yarn build` in any changed package before starting.

| Scenario id | Ticket |
| --- | --- |
| `happy-path` | Baseline checkout |
| `t1-stale-payment-amount` | Payment amount vs cart total |
| `t2-multiple-payment-sessions` | Multiple processable payment sessions |
| `t3-zero-total-bypass` | Zero-total credit-line bypass |
| `t4-webhook-completion-failure` | Webhook/completion failure is surfaced |
| `t5-lock-timeouts` | Cart lock timeouts |
| `t6-promotion-budget` | Promotion budget usage under concurrency |
| `t7-promotion-usage` | Promotion usage derivation |
| `t8-stale-tax-lines` | Tax lines revalidated at completion |
| `t9-region-country` | Region/country consistency |
| `t10-double-order` | Gift card taxes + double-order guard |

Scenarios live in `public/scenarios`. Steps marked BACKSTAGE call server-side
actions in `actions/` to reproduce states the storefront cannot reach on its
own (direct module writes, provider webhooks, concurrent completions).
