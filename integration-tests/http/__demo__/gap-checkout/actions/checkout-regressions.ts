// "Backstage" actions for the checkout regression scenarios. Each one
// reproduces a state the storefront can't reach on its own (custom code
// writing to a module, a payment provider webhook, a concurrent request, ...)
// and is shown as a BACKSTAGE line in the demo's API log.
import {
  completeCartWorkflow,
  processPaymentWorkflow,
} from "@medusajs/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/utils"

const CART_COMPLETION_FAILED_EVENT = "payment.cart_completion_failed"
const completionFailedEvents: any[] = []
const originalTaxRates: Record<string, number> = {}
const registerUsageCalls: any[] = []

const query = (container) => container.resolve(ContainerRegistrationKeys.QUERY)

const getCart = async (container, id: string) => {
  const {
    data: [cart],
  } = await query(container).graph({
    entity: "cart",
    filters: { id },
    fields: [
      "id",
      "total",
      "currency_code",
      "completed_at",
      "shipping_address.*",
      "items.*",
      "items.tax_lines.*",
      "shipping_methods.tax_lines.*",
      "payment_collection.*",
      "payment_collection.payment_sessions.*",
    ],
  })
  return cart
}

const ordersForCart = async (container, cartId: string) => {
  const { data } = await query(container).graph({
    entity: "order_cart",
    filters: { cart_id: cartId },
    fields: ["order_id", "order.total", "order.display_id"],
  })
  return data.map((oc) => ({
    id: oc.order_id,
    display_id: oc.order?.display_id,
    total: oc.order?.total,
  }))
}

const paymentState = async (container, cartId: string) => {
  const cart = await getCart(container, cartId)
  const pc = cart?.payment_collection
  if (!pc) {
    return { sessions: [], payments: [] }
  }
  const { data: payments } = await query(container).graph({
    entity: "payment",
    filters: { payment_collection_id: pc.id },
    fields: ["id", "amount", "payment_session_id", "captures.amount"],
  })
  return {
    sessions: pc.payment_sessions.map((s) => ({
      id: s.id,
      status: s.status,
      amount: s.amount,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      captured: (p.captures || []).reduce((a, c) => a + Number(c.amount), 0),
    })),
  }
}

const summarizeRun = ({ result, errors }) => {
  if (errors?.length) {
    return { error: errors[0].error?.message }
  }
  return { order_id: result?.id }
}

const product = (seed, handle: string) =>
  seed.products.find((p) => p.handle === handle)

export default {
  async setup({ container }) {
    const promotionModule = container.resolve(Modules.PROMOTION)
    const registerUsage = promotionModule.registerUsage.bind(promotionModule)
    promotionModule.registerUsage = async (actions, ...rest) => {
      registerUsageCalls.push(
        (actions || []).map((a) => ({
          code: a.code ?? null,
          amount: Number(a.amount),
        }))
      )
      return await registerUsage(actions, ...rest)
    }
    const eventBus = container.resolve(Modules.EVENT_BUS)
    eventBus.subscribe(
      CART_COMPLETION_FAILED_EVENT,
      async (event) => {
        completionFailedEvents.push(event)
      },
      { subscriberId: "gap-demo-cart-completion-failed" }
    )
  },

  async ordersForCart({ container, body }) {
    return { orders: await ordersForCart(container, body.cart_id) }
  },

  async paymentState({ container, body }) {
    return await paymentState(container, body.cart_id)
  },

  // T1: a line item written straight to the cart module (custom code, an
  // admin edit, a race) leaves the payment collection at the old amount.
  async addItemWithoutPaymentRefresh({ container, seed, body }) {
    const p = product(seed, body.handle)
    await container.resolve(Modules.CART).addLineItems({
      cart_id: body.cart_id,
      title: p.title,
      product_title: p.title,
      variant_id: p.variant_id,
      product_id: p.id,
      unit_price: p.price,
      quantity: 1,
      requires_shipping: true,
      is_tax_inclusive: false,
    })
    const cart = await getCart(container, body.cart_id)
    return {
      cart_total: cart.total,
      payment_collection_amount: cart.payment_collection?.amount,
    }
  },

  // T2: a second processable session on the same collection (two tabs, a
  // retried request, custom code).
  async addSecondPaymentSession({ container, body }) {
    const cart = await getCart(container, body.cart_id)
    const pc = cart.payment_collection
    const session = await container
      .resolve(Modules.PAYMENT)
      .createPaymentSession(pc.id, {
        provider_id: "pp_system_default",
        currency_code: cart.currency_code,
        amount: pc.amount,
        data: {},
      })
    return { session_id: session.id }
  },

  // T3: promotions that discount the whole bag and shipping.
  async createOverDiscountPromos({ api, adminHeaders }) {
    const suffix = Date.now().toString(36).toUpperCase()
    const items = (
      await api.post(
        "/admin/promotions",
        {
          code: `FREEBAG-${suffix}`,
          type: "standard",
          status: "active",
          is_automatic: false,
          application_method: {
            target_type: "items",
            type: "fixed",
            allocation: "across",
            currency_code: "usd",
            value: 100000,
          },
        },
        adminHeaders
      )
    ).data.promotion
    const shipping = (
      await api.post(
        "/admin/promotions",
        {
          code: `FREESHIP-${suffix}`,
          type: "standard",
          status: "active",
          is_automatic: false,
          application_method: {
            target_type: "shipping_methods",
            type: "percentage",
            allocation: "across",
            value: 100,
          },
        },
        adminHeaders
      )
    ).data.promotion
    return { codes: [items.code, shipping.code] }
  },

  // T4: the payment provider's "captured" webhook for the cart's session.
  async sendCapturedWebhook({ container, body }) {
    const cart = await getCart(container, body.cart_id)
    const session = cart.payment_collection.payment_sessions[0]
    const before = completionFailedEvents.length
    const { errors } = await processPaymentWorkflow(container).run({
      input: {
        action: "captured",
        data: { session_id: session.id, amount: session.amount },
      },
      throwOnError: false,
    })
    await new Promise((r) => setTimeout(r, 500))
    const alerts = completionFailedEvents
      .slice(before)
      .filter((e) => e.data?.cart_id === body.cart_id)
      .map((e) => ({ name: e.name, error: e.data?.error?.message }))
    return {
      workflow_errors: (errors || []).map((e) => e.error?.message),
      orders: await ordersForCart(container, body.cart_id),
      payment: await paymentState(container, body.cart_id),
      alerts,
    }
  },

  // T5: an in-flight checkout completion holding the cart lock.
  async holdCartLock({ container, body }) {
    const locking = container.resolve(Modules.LOCKING)
    const ownerId = `gap-demo-${Date.now()}`
    await locking.acquire(body.cart_id, { ownerId, expire: 60 })
    setTimeout(() => {
      locking.release(body.cart_id, { ownerId }).catch(() => {})
    }, body.ms ?? 5000)
    return { held_for_ms: body.ms ?? 5000 }
  },

  // T6: a campaign whose budget allows exactly one redemption.
  async createSingleUsePromo({ api, adminHeaders, body }) {
    const suffix = Date.now().toString(36).toUpperCase()
    const campaign = (
      await api.post(
        "/admin/campaigns",
        {
          name: `Launch drop ${suffix}`,
          campaign_identifier: `LAUNCH-${suffix}`,
          budget: body?.spend_limit
            ? { type: "spend", limit: body.spend_limit, currency_code: "usd" }
            : { type: "usage", limit: 1 },
        },
        adminHeaders
      )
    ).data.campaign
    const promotion = (
      await api.post(
        "/admin/promotions",
        {
          code: `FIRST1-${suffix}`,
          type: "standard",
          status: "active",
          is_automatic: false,
          campaign_id: campaign.id,
          application_method: {
            target_type: "items",
            type: "fixed",
            allocation: "across",
            currency_code: "usd",
            value: 20,
          },
        },
        adminHeaders
      )
    ).data.promotion
    return { code: promotion.code, campaign_id: campaign.id }
  },

  async secondShopperCart({ api, storeHeaders, seed, body }) {
    const cart = (
      await api.post(
        "/store/carts",
        {
          region_id: seed.region.id,
          sales_channel_id: seed.salesChannel.id,
          email: "second-shopper@gap-demo.com",
          shipping_address: {
            first_name: "Sam",
            last_name: "Lee",
            address_1: "1 Market St",
            city: "San Francisco",
            province: "ca",
            postal_code: "94105",
            country_code: "us",
          },
          items: [
            { variant_id: product(seed, body.handle).variant_id, quantity: 1 },
          ],
          promo_codes: [body.code],
        },
        storeHeaders
      )
    ).data.cart
    await api.post(
      `/store/carts/${cart.id}/shipping-methods`,
      { option_id: seed.shippingOption.id },
      storeHeaders
    )
    const pc = (
      await api.post(
        "/store/payment-collections",
        { cart_id: cart.id },
        storeHeaders
      )
    ).data.payment_collection
    await api.post(
      `/store/payment-collections/${pc.id}/payment-sessions`,
      { provider_id: "pp_system_default" },
      storeHeaders
    )
    return { cart_id: cart.id }
  },

  async completeCartsConcurrently({ container, body }) {
    const runs = await Promise.all(
      body.cart_ids.map((id, i) => {
        const workflow = completeCartWorkflow(container)
        if (body.fail_after_usage) {
          // Simulates a failure later in checkout (e.g. a downstream
          // service outage) so each completion's compensation reverts usage.
          workflow.addAction(`gap-demo-fail-after-usage-${i}`, {
            invoke: async function failAfterUsage() {
              throw new Error("Order sync service unavailable")
            },
          })
        }
        return workflow.run({ input: { id }, throwOnError: false })
      })
    )
    return runs.map(summarizeRun)
  },

  async campaignUsage({ api, adminHeaders, body }) {
    const campaign = (
      await api.get(
        `/admin/campaigns/${body.campaign_id}?fields=*budget`,
        adminHeaders
      )
    ).data.campaign
    return {
      type: campaign.budget.type,
      used: Number(campaign.budget.used),
      limit: Number(campaign.budget.limit),
    }
  },

  // T7: adjustments as custom pricing code can leave them: the same code on
  // two lines plus a manual adjustment without a code.
  async injectAdjustments({ container, body }) {
    const promotionModule = container.resolve(Modules.PROMOTION)
    const code = `STYLIST-${Date.now().toString(36).toUpperCase()}`
    const promotion = await promotionModule.createPromotions({
      code,
      type: "standard",
      status: "active",
      limit: 10,
      application_method: {
        type: "fixed",
        target_type: "items",
        allocation: "each",
        value: 10,
        max_quantity: 1,
        currency_code: "usd",
      },
      campaign: {
        name: `${code} campaign`,
        campaign_identifier: `${code}-campaign`,
        budget: { type: "spend", limit: 100000, currency_code: "usd" },
      },
    })
    const cart = await getCart(container, body.cart_id)
    const [a, b] = cart.items
    await container.resolve(Modules.CART).addLineItemAdjustments([
      { item_id: a.id, amount: 10, code, promotion_id: promotion.id },
      { item_id: b.id, amount: 5, code, promotion_id: promotion.id },
      { item_id: a.id, amount: 2.5 },
    ])
    return { code, promotion_id: promotion.id }
  },

  async promotionUsage({ container, body }) {
    const promotion = await container
      .resolve(Modules.PROMOTION)
      .retrievePromotion(body.promotion_id, {
        relations: ["campaign", "campaign.budget"],
      })
    return {
      register_usage_input: registerUsageCalls
        .filter((c) => c.some((a) => a.code === promotion.code))
        .pop(),
      used: Number(promotion.used),
      budget_used: Number(promotion.campaign?.budget?.used ?? 0),
    }
  },

  // T8: the tax team raises the rate after the shopper's tax lines were set.
  async changeCartTaxRates({ container, api, adminHeaders, body }) {
    const cart = await getCart(container, body.cart_id)
    const ids = [
      ...new Set<string>(
        [
          ...cart.items.flatMap((i) => i.tax_lines),
          ...cart.shipping_methods.flatMap((s) => s.tax_lines),
        ]
          .map((t) => t.tax_rate_id)
          .filter(Boolean)
      ),
    ]
    const from: number[] = []
    for (const id of ids) {
      const rate = (await api.get(`/admin/tax-rates/${id}`, adminHeaders)).data
        .tax_rate
      originalTaxRates[id] ??= Number(rate.rate)
      from.push(Number(rate.rate))
      await api.post(
        `/admin/tax-rates/${id}`,
        { rate: body.rate },
        adminHeaders
      )
    }
    return { from, to: body.rate }
  },

  async restoreTaxRates({ api, adminHeaders }) {
    for (const [id, rate] of Object.entries(originalTaxRates)) {
      await api.post(`/admin/tax-rates/${id}`, { rate }, adminHeaders)
      delete originalTaxRates[id]
    }
    return { restored: true }
  },

  async orderTaxes({ api, adminHeaders, body }) {
    const order = (
      await api.get(
        `/admin/orders/${body.order_id}?fields=+tax_total,*items.tax_lines,*shipping_methods.tax_lines`,
        adminHeaders
      )
    ).data.order
    return {
      tax_total: order.tax_total,
      rates: [
        ...new Set(
          [
            ...order.items.flatMap((i) => i.tax_lines),
            ...order.shipping_methods.flatMap((s) => s.tax_lines),
          ].map((t) => Number(t.rate))
        ),
      ],
    }
  },

  // T9: an address written straight to the cart module, skipping the store
  // API's region check.
  async moveShippingAddress({ container, body }) {
    const cart = await getCart(container, body.cart_id)
    await container.resolve(Modules.CART).updateAddresses({
      id: cart.shipping_address.id,
      country_code: body.country_code,
      province: body.province ?? null,
      city: body.city ?? cart.shipping_address.city,
      postal_code: body.postal_code ?? cart.shipping_address.postal_code,
    })
    return { country_code: body.country_code }
  },

  // T10: two completions racing on servers whose cart locks don't see each
  // other (e.g. per-instance in-memory locking).
  async raceCompletionsWithoutSharedLock({ container, body }) {
    const locking = container.resolve(Modules.LOCKING)
    const { acquire, release } = locking
    locking.acquire = async () => true
    locking.release = async () => true
    let runs
    try {
      runs = await Promise.all(
        [0, 1].map(() =>
          completeCartWorkflow(container).run({
            input: { id: body.cart_id },
            throwOnError: false,
          })
        )
      )
    } finally {
      locking.acquire = acquire
      locking.release = release
    }
    return {
      runs: runs.map(summarizeRun),
      orders: await ordersForCart(container, body.cart_id),
    }
  },
}
