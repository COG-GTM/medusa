GapDemo.register({
  id: "t10-double-order",
  ticket: "Ticket 10",
  title: "Racing completions place exactly one order",
  description:
    "Gift card tax check, then a fully comped employee order for the tee ($0, no payment needed). Two servers whose locks don't see each other complete the same cart simultaneously.",
  expected: {
    fixed:
      "Exactly one order; the second completion is rejected as a conflict. Gift card stays untaxed, tee taxed.",
    bug: "Two orders are created from one cart.",
  },
  steps: [
    {
      label: "Add Gap Gift Card to bag",
      run: (shop) => shop.addToBag("gift-card"),
    },
    {
      label: "Add Everyday Crewneck T-Shirt to bag",
      run: (shop) => shop.addToBag("everyday-crew-tee"),
    },
    {
      label: "Enter San Francisco shipping address",
      run: (shop) => shop.setAddress(),
    },
    { label: "Choose Standard Shipping", run: (shop) => shop.selectShipping() },
    {
      label: "Check taxes: tee taxed, gift card not taxed",
      run: async (shop, ctx) => {
        const tee = shop.lineFor("everyday-crew-tee")
        const gc = shop.lineFor("gift-card")
        ctx.taxOk = tee.tax_lines.length > 0 && gc.tax_lines.length === 0
        return `tee: ${tee.tax_lines.length} tax line(s), gift card: ${gc.tax_lines.length}`
      },
    },
    {
      label: "Remove the gift card from the bag",
      run: async (shop) => {
        await shop.http(
          "DELETE",
          `/store/carts/${shop.cart.id}/line-items/${
            shop.lineFor("gift-card").id
          }`
        )
        await shop.refresh()
        return "tee only"
      },
    },
    {
      label: "BACKSTAGE: employee comp promos cover the whole order",
      run: async (shop, ctx) => {
        ctx.codes = (await shop.backstage("createOverDiscountPromos")).codes
        return ctx.codes.join(" + ")
      },
    },
    {
      label: "Apply the comp promo",
      run: (shop, ctx) => shop.applyPromo(ctx.codes[0]),
    },
    {
      label: "Apply the free shipping promo",
      run: (shop, ctx) => shop.applyPromo(ctx.codes[1]),
    },
    {
      label: "BACKSTAGE: two servers complete the cart at the same time",
      run: async (shop, ctx) => {
        ctx.race = await shop.backstage("raceCompletionsWithoutSharedLock")
        const first = ctx.race.runs.find((r) => r.order_id)
        if (first)
          shop.showResult({
            order: {
              id: first.order_id,
              currency_code: "usd",
              total: shop.cart.total,
              tax_total: shop.cart.tax_total,
              shipping_total: shop.cart.shipping_total,
              discount_total: shop.cart.discount_total,
              item_subtotal: shop.cart.item_subtotal,
            },
          })
        return `orders created: ${ctx.race.orders.length}`
      },
    },
  ],
  verdict: (shop, ctx) => {
    const n = ctx.race.orders.length
    const loser = ctx.race.runs.find((r) => r.error)
    if (n === 1 && ctx.taxOk)
      return {
        pass: true,
        title: "Exactly one order",
        detail: `Second completion: ${
          loser?.error || "returned the same order"
        }`,
      }
    return {
      pass: false,
      title: n > 1 ? `${n} orders from one cart` : "Unexpected result",
      detail:
        ctx.race.orders.map((o) => o.id).join("<br/>") +
        (ctx.taxOk ? "" : "<br/>Gift card/tee taxes wrong"),
    }
  },
})
