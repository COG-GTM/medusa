GapDemo.register({
  id: "t7-promotion-usage",
  ticket: "Ticket 7",
  title: "Promotion usage counted once per code",
  description:
    "A stylist discount is applied to two lines (same code) plus a manual price adjustment with no code.",
  expected: {
    fixed:
      "Promotion used once, campaign spend $15.00, code-less adjustment ignored.",
    bug: "registerUsage gets one row per adjustment: the code twice plus a row with no code.",
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
    {
      label: "Enter San Francisco shipping address",
      run: (shop) => shop.setAddress(),
    },
    { label: "Choose Standard Shipping", run: (shop) => shop.selectShipping() },
    {
      label: "BACKSTAGE: stylist discount on 2 lines + manual $2.50 adjustment",
      run: async (shop, ctx) => {
        Object.assign(ctx, await shop.backstage("injectAdjustments"))
        await shop.refresh()
        return `${ctx.code}: $10 + $5, plus code-less $2.50`
      },
    },
    { label: "Start payment", run: (shop) => shop.startPayment() },
    {
      label: "Place order",
      run: async (shop, ctx) => {
        ctx.result = await shop.placeOrder()
        ctx.usage = await shop.backstage("promotionUsage", {
          promotion_id: ctx.promotion_id,
        })
        return ctx.result.ok
          ? `order placed; promo used ${ctx.usage.used}x, spend ${shop.money(
              ctx.usage.budget_used
            )}`
          : ctx.result.error
      },
    },
  ],
  verdict: (shop, ctx) => {
    const { used, budget_used, register_usage_input: input = [] } = ctx.usage
    const payload = `registerUsage received: ${JSON.stringify(input)}`
    const clean =
      input.length === 1 && input[0].code === ctx.code && input[0].amount === 15
    return ctx.result.ok && clean && used === 1 && budget_used === 15
      ? {
          pass: true,
          title: "Usage registered once",
          detail: `${payload}<br/>Promotion used ${used}x, campaign spend ${shop.money(
            budget_used
          )}`,
        }
      : {
          pass: false,
          title: "Usage corrupted",
          detail: `${
            ctx.result.ok ? "Order placed" : ctx.result.error
          }<br/>${payload}<br/>Promotion used ${used}x (expected 1), campaign spend ${shop.money(
            budget_used
          )} (expected $15.00)`,
        }
  },
})
