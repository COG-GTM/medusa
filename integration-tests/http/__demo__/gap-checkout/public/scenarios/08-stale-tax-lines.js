GapDemo.register({
  id: "t8-stale-tax-lines",
  ticket: "Ticket 8",
  title: "Order uses current tax rates, not a stale snapshot",
  description:
    "California's rate changes to 15% after the shopper's taxes were calculated, then the shopper bumps quantity to 2.",
  expected: {
    fixed: "Order tax lines are recalculated at 15%.",
    bug: "Order carries the old rate from the cart's stale tax lines.",
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
    {
      label: "BACKSTAGE: tax team raises the CA rate to 15%",
      run: async (shop, ctx) => {
        ctx.change = await shop.backstage("changeCartTaxRates", { rate: 15 })
        return `${ctx.change.from.join("/")}% -> 15%`
      },
    },
    {
      label: "Change hoodie quantity to 2",
      run: (shop) => shop.setQuantity("vintage-soft-hoodie", 2),
    },
    { label: "Start payment", run: (shop) => shop.startPayment() },
    {
      label: "Place order",
      run: async (shop, ctx) => {
        try {
          ctx.result = await shop.placeOrder()
          if (ctx.result.ok)
            ctx.taxes = await shop.backstage("orderTaxes", {
              order_id: ctx.result.order.id,
            })
        } finally {
          await shop.backstage("restoreTaxRates")
        }
        return ctx.result.ok
          ? `order tax rate(s): ${ctx.taxes.rates.join(", ")}%`
          : ctx.result.error
      },
    },
  ],
  verdict: (shop, ctx) => {
    if (!ctx.result.ok)
      return { pass: false, title: "Checkout failed", detail: ctx.result.error }
    return ctx.taxes.rates.every((r) => r === 15)
      ? {
          pass: true,
          title: "Taxes revalidated at completion",
          detail: `Order taxed at 15%, tax ${shop.money(ctx.taxes.tax_total)}`,
        }
      : {
          pass: false,
          title: "Stale tax lines copied into the order",
          detail: `Order taxed at ${ctx.taxes.rates.join(
            ", "
          )}% instead of 15%`,
        }
  },
})
