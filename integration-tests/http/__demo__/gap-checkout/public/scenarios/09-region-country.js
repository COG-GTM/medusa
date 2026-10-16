GapDemo.register({
  id: "t9-region-country",
  ticket: "Ticket 9",
  title: "Shipping country must belong to the cart's region",
  description:
    "After US taxes were set, the shipping address is changed to Copenhagen, Denmark outside the store API's checks.",
  expected: {
    fixed: "Place Order is rejected: Denmark is not within the US region.",
    bug: "A US-region order ships to Denmark carrying California tax lines.",
  },
  steps: [
    {
      label: "Add 90s Loose Jeans to bag",
      run: (shop) => shop.addToBag("90s-loose-jean"),
    },
    {
      label: "Enter San Francisco shipping address",
      run: (shop) => shop.setAddress(),
    },
    { label: "Choose Standard Shipping", run: (shop) => shop.selectShipping() },
    { label: "Start payment", run: (shop) => shop.startPayment() },
    {
      label: "BACKSTAGE: address changed to Copenhagen, DK",
      run: async (shop) => {
        await shop.backstage("moveShippingAddress", {
          country_code: "dk",
          city: "Copenhagen",
          postal_code: "1050",
        })
        await shop.refresh()
        return "shipping country now DK, tax lines unchanged"
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
  verdict: (shop, ctx) => {
    if (ctx.result.ok)
      return {
        pass: false,
        title: "Out-of-region order placed",
        detail: `US-region order ${ctx.result.order.id} shipping to DK with stale tax lines.`,
      }
    return /not within region/.test(ctx.result.error)
      ? {
          pass: true,
          title: "Region mismatch rejected",
          detail: ctx.result.error,
        }
      : {
          pass: false,
          title: "Rejected for an unexpected reason",
          detail: ctx.result.error,
        }
  },
})
