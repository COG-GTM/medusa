GapDemo.register({
  id: "t3-zero-total-bypass",
  ticket: "Ticket 3",
  title: "Promo-driven $0 bag still needs a payment session",
  description:
    "Two promotions over-discount the bag and shipping to $0. No credit lines, no payment started.",
  expected: {
    fixed: "Place Order is rejected: payment has not been initiated.",
    bug: "The order is placed with no payment session at all.",
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
      label: "BACKSTAGE: marketing creates two over-generous promos",
      run: async (shop, ctx) => {
        ctx.codes = (await shop.backstage("createOverDiscountPromos")).codes
        return ctx.codes.join(" + ")
      },
    },
    {
      label: "Apply the bag promo",
      run: (shop, ctx) => shop.applyPromo(ctx.codes[0]),
    },
    {
      label: "Apply the free shipping promo",
      run: (shop, ctx) => shop.applyPromo(ctx.codes[1]),
    },
    {
      label: "Place order without starting payment",
      run: async (shop, ctx) => {
        ctx.total = shop.cart.total
        ctx.credit = shop.cart.credit_line_total || 0
        ctx.result = await shop.placeOrder()
        return ctx.result.ok ? `order placed` : ctx.result.error
      },
    },
  ],
  verdict: (shop, ctx) => {
    if (ctx.result.ok) {
      return {
        pass: false,
        title: "Order placed with no payment",
        detail: `Total ${shop.money(ctx.total)}, credit lines ${shop.money(
          ctx.credit
        )}, no payment session.`,
      }
    }
    return /Payment collection has not been initiated/.test(ctx.result.error)
      ? { pass: true, title: "Payment required", detail: ctx.result.error }
      : {
          pass: false,
          title: "Rejected for an unexpected reason",
          detail: ctx.result.error,
        }
  },
})
