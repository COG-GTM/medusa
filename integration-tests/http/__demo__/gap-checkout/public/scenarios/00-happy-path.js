// Baseline: a normal Gap checkout should place exactly one order.
GapDemo.register({
  id: "happy-path",
  ticket: "Baseline",
  title: "Standard checkout places an order",
  description:
    "Hoodie + jeans, GAP40, ship to San Francisco, pay, place order.",
  expected: {
    fixed: "Order is placed and the charged total matches the bag total.",
    bug: "n/a (sanity check)",
  },
  steps: [
    {
      label: "Add Vintage Soft Arch Logo Hoodie to bag",
      run: (shop) => shop.addToBag("vintage-soft-hoodie"),
    },
    {
      label: "Add 90s Loose Jeans to bag",
      run: (shop) => shop.addToBag("90s-loose-jean"),
    },
    { label: "Apply promo GAP40", run: (shop) => shop.applyPromo("GAP40") },
    {
      label: "Enter San Francisco shipping address",
      run: (shop) => shop.setAddress(),
    },
    { label: "Choose Standard Shipping", run: (shop) => shop.selectShipping() },
    {
      label: "Start payment (system provider)",
      run: (shop) => shop.startPayment(),
    },
    {
      label: "Place order",
      run: async (shop, ctx) => {
        ctx.bagTotal = shop.cart.total
        ctx.result = await shop.placeOrder()
        return ctx.result.ok ? `order ${ctx.result.order.id}` : ctx.result.error
      },
    },
  ],
  verdict: (shop, ctx) =>
    ctx.result.ok && Number(ctx.result.order.total) === Number(ctx.bagTotal)
      ? {
          pass: true,
          title: "Order placed",
          detail: `Charged ${shop.money(ctx.result.order.total)}`,
        }
      : {
          pass: false,
          title: "Checkout failed",
          detail: ctx.result.error || "total mismatch",
        },
})
