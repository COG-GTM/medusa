GapDemo.register({
  id: "t1-stale-payment-amount",
  ticket: "Ticket 1",
  title: "Payment amount must match the bag total",
  description:
    "Shopper starts payment for a hoodie, then a pair of jeans lands in the bag without the payment being refreshed.",
  expected: {
    fixed:
      "Place Order is rejected: the payment amount no longer matches the bag total.",
    bug: "The order is placed and the shopper is charged only for the hoodie.",
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
      label: "BACKSTAGE: jeans added to the cart without refreshing payment",
      run: async (shop, ctx) => {
        const r = await shop.backstage("addItemWithoutPaymentRefresh", {
          handle: "90s-loose-jean",
        })
        await shop.refresh()
        ctx.bagTotal = shop.cart.total
        ctx.paymentAmount = shop.cart.payment_collection.amount
        return `bag ${shop.money(r.cart_total)} vs payment ${shop.money(
          r.payment_collection_amount
        )}`
      },
    },
    {
      label: "Place order",
      run: async (shop, ctx) => {
        ctx.result = await shop.placeOrder()
        return ctx.result.ok
          ? `order placed, charged ${shop.money(ctx.result.order.total)}`
          : ctx.result.error
      },
    },
  ],
  verdict: (shop, ctx) => {
    if (ctx.result.ok) {
      return {
        pass: false,
        title: "Order placed against a stale payment",
        detail: `Bag total ${shop.money(
          ctx.bagTotal
        )} but the payment was only for ${shop.money(ctx.paymentAmount)}.`,
      }
    }
    return /does not match the cart total/.test(ctx.result.error)
      ? {
          pass: true,
          title: "Stale payment rejected",
          detail: ctx.result.error,
        }
      : {
          pass: false,
          title: "Rejected for an unexpected reason",
          detail: ctx.result.error,
        }
  },
})
