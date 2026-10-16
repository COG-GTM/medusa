GapDemo.register({
  id: "t4-webhook-completion-failure",
  ticket: "Ticket 4",
  title: "Captured webhook that can't complete the order raises an alert",
  description:
    "The payment provider captures the money, but the webhook-triggered checkout fails (no delivery method chosen).",
  expected: {
    fixed:
      "payment.cart_completion_failed is emitted so ops can refund or follow up.",
    bug: "The money is captured, no order exists, and the failure is swallowed silently.",
  },
  steps: [
    {
      label: "Add Everyday Crewneck T-Shirt to bag",
      run: (shop) => shop.addToBag("everyday-crew-tee"),
    },
    {
      label: "Enter San Francisco shipping address",
      run: (shop) => shop.setAddress(),
    },
    {
      label: "Start payment (delivery not chosen yet)",
      run: (shop) => shop.startPayment(),
    },
    {
      label: "BACKSTAGE: payment provider sends 'captured' webhook",
      run: async (shop, ctx) => {
        ctx.r = await shop.backstage("sendCapturedWebhook")
        await shop.refresh()
        const captured = ctx.r.payment.payments.reduce(
          (a, p) => a + p.captured,
          0
        )
        ctx.captured = captured
        return `captured ${shop.money(captured)}, orders: ${
          ctx.r.orders.length
        }, alerts: ${ctx.r.alerts.length}`
      },
    },
  ],
  verdict: (shop, ctx) => {
    const { orders, alerts } = ctx.r
    if (orders.length) {
      return {
        pass: false,
        title: "Unexpected order",
        detail: JSON.stringify(orders),
      }
    }
    return alerts.length
      ? {
          pass: true,
          title: "Failure surfaced as an alert",
          detail: `${alerts[0].name}: ${
            alerts[0].error
          }<br/>Captured ${shop.money(ctx.captured)}, no order.`,
        }
      : {
          pass: false,
          title: "Silent failure",
          detail: `Captured ${shop.money(
            ctx.captured
          )}, no order, no alert emitted.`,
        }
  },
})
