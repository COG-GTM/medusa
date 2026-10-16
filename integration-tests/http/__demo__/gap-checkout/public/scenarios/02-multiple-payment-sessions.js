GapDemo.register({
  id: "t2-multiple-payment-sessions",
  ticket: "Ticket 2",
  title: "Only one payment session may be processed",
  description:
    "The shopper's payment collection ends up with two live payment sessions (e.g. checkout open in two tabs).",
  expected: {
    fixed: "Place Order is rejected before any session is authorized.",
    bug: "The order is placed after authorizing whichever session happens to be first; the other is left dangling.",
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
    { label: "Start payment (tab 1)", run: (shop) => shop.startPayment() },
    {
      label: "BACKSTAGE: second payment session created (tab 2)",
      run: async (shop) => {
        await shop.backstage("addSecondPaymentSession")
        await shop.refresh()
        return `${shop.cart.payment_collection.payment_sessions.length} sessions on one collection`
      },
    },
    {
      label: "Place order",
      run: async (shop, ctx) => {
        ctx.result = await shop.placeOrder()
        ctx.payment = await shop.backstage("paymentState")
        return ctx.result.ok ? `order placed` : ctx.result.error
      },
    },
  ],
  verdict: (shop, ctx) => {
    const statuses = ctx.payment.sessions.map((s) => s.status).join(", ")
    if (ctx.result.ok) {
      return {
        pass: false,
        title: "Order placed with two live sessions",
        detail: `Session statuses: ${statuses}`,
      }
    }
    const untouched = ctx.payment.sessions.every(
      (s) => s.status !== "authorized"
    )
    return /more than one processable payment session/.test(ctx.result.error) &&
      untouched
      ? {
          pass: true,
          title: "Rejected before authorizing anything",
          detail: `${ctx.result.error}<br/>Session statuses: ${statuses}`,
        }
      : {
          pass: false,
          title: "Unexpected result",
          detail: `${ctx.result.error}<br/>Session statuses: ${statuses}`,
        }
  },
})
