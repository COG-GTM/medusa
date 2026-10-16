GapDemo.register({
  id: "t5-lock-timeouts",
  ticket: "Ticket 5",
  title: "Tax recalculation waits for an in-flight checkout",
  description:
    "A checkout completion holds the cart lock for 5 seconds while the storefront recalculates taxes.",
  expected: {
    fixed:
      "The tax recalculation waits for the lock and succeeds; the order is then placed.",
    bug: "The tax recalculation gives up after 2 seconds with a lock timeout.",
  },
  steps: [
    {
      label: "Add Vintage Soft Arch Logo Hoodie to bag",
      run: (shop) => shop.addToBag("vintage-soft-hoodie"),
    },
    {
      label: "Enter San Francisco shipping address",
      run: (shop) => shop.setAddress(),
    },
    { label: "Choose Standard Shipping", run: (shop) => shop.selectShipping() },
    { label: "Start payment", run: (shop) => shop.startPayment() },
    {
      label: "BACKSTAGE: checkout completion holds the cart lock (5s)",
      run: async (shop) => {
        await shop.backstage("holdCartLock", { ms: 5000 })
        return "lock held"
      },
    },
    {
      label: "Storefront recalculates taxes",
      run: async (shop, ctx) => {
        const started = performance.now()
        ctx.tax = await shop.http(
          "POST",
          `/store/carts/${shop.cart.id}/taxes`,
          {}
        )
        ctx.waited = Math.round((performance.now() - started) / 100) / 10
        await shop.refresh()
        return ctx.tax.ok
          ? `succeeded after ${ctx.waited}s`
          : `${ctx.tax.data?.message} (after ${ctx.waited}s)`
      },
    },
    {
      label: "Place order",
      run: async (shop, ctx) => {
        ctx.result = await shop.placeOrder()
        return ctx.result.ok ? `order placed` : ctx.result.error
      },
    },
  ],
  verdict: (shop, ctx) =>
    ctx.tax.ok && ctx.result.ok
      ? {
          pass: true,
          title: "Recalculation waited its turn",
          detail: `Taxes recalculated after waiting ${ctx.waited}s; order ${ctx.result.order.id} placed.`,
        }
      : {
          pass: false,
          title: "Recalculation starved by checkout",
          detail: `${ctx.tax.data?.message || ""} after ${ctx.waited}s`,
        },
})
