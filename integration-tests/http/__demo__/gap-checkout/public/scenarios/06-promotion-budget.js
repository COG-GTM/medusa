GapDemo.register({
  id: "t6-promotion-budget",
  ticket: "Ticket 6",
  title: "Rolled-back checkouts give their promo budget back",
  description:
    "A $1,000 launch campaign gives $20 off. Four shoppers check out at the same moment, but a downstream outage rolls every checkout back after the discount was booked.",
  expected: {
    fixed:
      "All four checkouts fail and the campaign budget returns to $0.00 used.",
    bug: "Concurrent rollbacks overwrite each other and budget stays consumed by orders that never happened.",
  },
  steps: [
    {
      label: "BACKSTAGE: marketing creates a $1,000 spend-budget campaign",
      run: async (shop, ctx) => {
        Object.assign(
          ctx,
          await shop.backstage("createSingleUsePromo", { spend_limit: 1000 })
        )
        return `${ctx.code}: $20 off, budget $1,000`
      },
    },
    {
      label: "Add Vintage Soft Arch Logo Hoodie to bag",
      run: (shop) => shop.addToBag("vintage-soft-hoodie"),
    },
    {
      label: "Apply the launch promo",
      run: (shop, ctx) => shop.applyPromo(ctx.code),
    },
    {
      label: "Enter San Francisco shipping address",
      run: (shop) => shop.setAddress(),
    },
    { label: "Choose Standard Shipping", run: (shop) => shop.selectShipping() },
    { label: "Start payment", run: (shop) => shop.startPayment() },
    {
      label: "BACKSTAGE: three more shoppers check out with the same promo",
      run: async (shop, ctx) => {
        ctx.otherCarts = []
        for (let i = 0; i < 3; i++) {
          ctx.otherCarts.push(
            (
              await shop.backstage("secondShopperCart", {
                code: ctx.code,
                handle: "vintage-soft-hoodie",
              })
            ).cart_id
          )
        }
        return `${ctx.otherCarts.length} more carts ready`
      },
    },
    {
      label: "All four click Place Order; order sync outage rolls them back",
      run: async (shop, ctx) => {
        const runs = await shop.backstage("completeCartsConcurrently", {
          cart_ids: [shop.cart.id, ...ctx.otherCarts],
          fail_after_usage: true,
        })
        ctx.results = runs.map((r) => ({ ok: !!r.order_id, error: r.error }))
        shop.showResult(
          runs[0].order_id
            ? {
                order: {
                  id: runs[0].order_id,
                  currency_code: "usd",
                  total: shop.cart.total,
                },
              }
            : { error: runs[0].error }
        )
        ctx.usage = await shop.backstage("campaignUsage", {
          campaign_id: ctx.campaign_id,
        })
        return `failed checkouts: ${
          ctx.results.filter((r) => !r.ok).length
        }/4, budget used ${shop.money(ctx.usage.used)}`
      },
    },
  ],
  verdict: (shop, ctx) => {
    const failed = ctx.results.filter((r) => !r.ok).length
    return failed === 4 && ctx.usage.used === 0
      ? {
          pass: true,
          title: "Budget fully returned",
          detail: `4 checkouts rolled back, budget used ${shop.money(
            ctx.usage.used
          )} of ${shop.money(ctx.usage.limit)}`,
        }
      : {
          pass: false,
          title: "Budget leaked by rolled-back checkouts",
          detail: `${failed}/4 checkouts rolled back, but ${shop.money(
            ctx.usage.used
          )} of budget is still marked used`,
        }
  },
})
