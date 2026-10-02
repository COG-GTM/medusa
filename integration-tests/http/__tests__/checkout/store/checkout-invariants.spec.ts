import { createCartCreditLinesWorkflow } from "@medusajs/core-flows"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  Modules,
  ProductStatus,
  PromotionStatus,
  PromotionType,
} from "@medusajs/utils"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"
import { setupTaxStructure } from "../../../../modules/__tests__/fixtures"

jest.setTimeout(100000)

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

// US / CA resolves to the 5% "CA Default Rate" from `setupTaxStructure`
const shippingAddressData = {
  address_1: "test address 1",
  address_2: "test address 2",
  city: "SF",
  country_code: "US",
  province: "CA",
  postal_code: "94016",
}

const SHIPPING_PRICE = 1000

// Totals that must be identical on the cart right before completion and on
// the order created from it.
const RECONCILED_TOTAL_FIELDS = [
  "total",
  "subtotal",
  "tax_total",
  "discount_total",
  "discount_tax_total",
  "original_total",
  "item_total",
  "item_subtotal",
  "item_tax_total",
  "shipping_total",
  "shipping_subtotal",
  "shipping_tax_total",
  "credit_line_total",
] as const

const ORDER_FIELDS = [
  ...RECONCILED_TOTAL_FIELDS,
  "id",
  "currency_code",
  "+summary",
  "+payment_status",
  "*items",
  "*items.adjustments",
  "*items.tax_lines",
  "*shipping_methods",
  "*shipping_methods.adjustments",
  "*shipping_methods.tax_lines",
  "*credit_lines",
  "*payment_collections",
  "*payment_collections.payments",
  "*payment_collections.payments.captures",
].join(",")

const CART_FIELDS = [
  "+items.total",
  "+items.tax_total",
  "+items.discount_total",
  "+items.original_total",
  "*items.adjustments",
  "*items.tax_lines",
  "+shipping_methods.total",
  "+shipping_methods.tax_total",
  "+shipping_methods.discount_total",
  "*shipping_methods.adjustments",
  "*shipping_methods.tax_lines",
].join(",")

const PRECISION = 4

type Adjustment = { code: string; amount: number }

const sumOf = (values: number[]) => values.reduce((acc, v) => acc + v, 0)

const normalizeAdjustments = (adjustments: Adjustment[] = []) =>
  adjustments
    .map((a) => ({ code: a.code, amount: Number(a.amount) }))
    .sort((a, b) => a.code.localeCompare(b.code))

const normalizeTaxLines = (taxLines: { code: string; rate: number }[] = []) =>
  taxLines
    .map((t) => ({ code: t.code, rate: Number(t.rate) }))
    .sort((a, b) => a.code.localeCompare(b.code))

medusaIntegrationTestRunner({
  env,
  testSuite: ({ dbConnection, getContainer, api }) => {
    let appContainer
    let storeHeaders
    let region
    let salesChannel
    let shippingProfile
    let shippingOption
    let productA
    let productB

    beforeAll(async () => {
      appContainer = getContainer()
    })

    const enableTaxInclusivePricing = async () => {
      await api.post(
        "/admin/price-preferences",
        { attribute: "currency_code", value: "usd", is_tax_inclusive: true },
        adminHeaders
      )
    }

    const createProduct = async (title: string, amount: number) =>
      (
        await api.post(
          "/admin/products",
          {
            title,
            status: ProductStatus.PUBLISHED,
            options: [{ title: "Size", values: ["S"] }],
            variants: [
              {
                title: `${title} variant`,
                sku: `${title.toLowerCase().replace(/\s/g, "-")}-s`,
                prices: [{ currency_code: "usd", amount }],
                options: { Size: "S" },
                manage_inventory: false,
              },
            ],
            sales_channels: [{ id: salesChannel.id }],
            shipping_profile_id: shippingProfile.id,
          },
          adminHeaders
        )
      ).data.product

    const createPromotion = async (data: Record<string, unknown>) =>
      (await api.post("/admin/promotions", data, adminHeaders)).data.promotion

    const createCartWithShipping = async (
      items: { variant_id: string; quantity: number }[]
    ) => {
      const cart = (
        await api.post(
          "/store/carts",
          {
            currency_code: "usd",
            email: "checkout-invariants@medusa.test",
            sales_channel_id: salesChannel.id,
            region_id: region.id,
            shipping_address: shippingAddressData,
            items,
          },
          storeHeaders
        )
      ).data.cart

      await api.post(
        `/store/carts/${cart.id}/shipping-methods`,
        { option_id: shippingOption.id },
        storeHeaders
      )

      return cart.id as string
    }

    const applyPromoCodes = async (cartId: string, codes: string[]) =>
      (
        await api.post(
          `/store/carts/${cartId}/promotions`,
          { promo_codes: codes },
          storeHeaders
        )
      ).data.cart

    const initiatePaymentSession = async (cartId: string) => {
      const paymentCollection = (
        await api.post(
          "/store/payment-collections",
          { cart_id: cartId },
          storeHeaders
        )
      ).data.payment_collection

      await api.post(
        `/store/payment-collections/${paymentCollection.id}/payment-sessions`,
        { provider_id: "pp_system_default" },
        storeHeaders
      )
    }

    const addCreditLine = async (cartId: string, amount: number) => {
      await createCartCreditLinesWorkflow(appContainer).run({
        input: [
          {
            cart_id: cartId,
            amount,
            reference: "checkout-invariants",
            reference_id: "checkout-invariants",
            metadata: null,
          },
        ],
      })
    }

    const getCart = async (cartId: string) =>
      (
        await api.get(
          `/store/carts/${cartId}?fields=${CART_FIELDS}`,
          storeHeaders
        )
      ).data.cart

    const getOrder = async (orderId: string) =>
      (
        await api.get(
          `/admin/orders/${orderId}?fields=${ORDER_FIELDS}`,
          adminHeaders
        )
      ).data.order

    /**
     * Completes the cart and asserts that the order, its tax totals and its
     * payment transactions all reconcile with the cart at completion:
     *
     *   cart.total == order.total == authorized amount == captured amount
     */
    const completeAndAssertInvariants = async (
      cartId: string,
      { expectPayment }: { expectPayment: boolean }
    ) => {
      const cartBefore = await getCart(cartId)

      // Internal consistency of the cart about to be completed
      expect(cartBefore.tax_total).toBeCloseTo(
        cartBefore.item_tax_total + cartBefore.shipping_tax_total,
        PRECISION
      )
      expect(cartBefore.total).toBeCloseTo(
        cartBefore.item_total +
          cartBefore.shipping_total -
          cartBefore.credit_line_total,
        PRECISION
      )

      if (expectPayment) {
        expect(cartBefore.total).toBeGreaterThan(0)
        expect(cartBefore.payment_collection.amount).toEqual(cartBefore.total)
        const pendingSessions =
          cartBefore.payment_collection.payment_sessions.filter(
            (s) => s.status === "pending"
          )
        expect(pendingSessions).toHaveLength(1)
        expect(pendingSessions[0].amount).toEqual(cartBefore.total)
      } else {
        expect(cartBefore.total).toEqual(0)
      }

      const completion = await api.post(
        `/store/carts/${cartId}/complete`,
        {},
        storeHeaders
      )

      expect(completion.status).toEqual(200)
      expect(completion.data.type).toEqual("order")

      const order = await getOrder(completion.data.order.id)

      // order totals == cart totals at completion
      for (const field of RECONCILED_TOTAL_FIELDS) {
        expect({ field, value: order[field] }).toEqual({
          field,
          value: cartBefore[field],
        })
      }

      // order tax / total internal consistency
      expect(order.tax_total).toBeCloseTo(
        order.item_tax_total + order.shipping_tax_total,
        PRECISION
      )
      expect(order.total).toBeCloseTo(
        sumOf(order.items.map((i) => i.total)) +
          sumOf(order.shipping_methods.map((sm) => sm.total)) -
          order.credit_line_total,
        PRECISION
      )

      // line items, adjustments and tax lines are carried over verbatim
      expect(order.items).toHaveLength(cartBefore.items.length)
      for (const cartItem of cartBefore.items) {
        const orderItem = order.items.find(
          (i) => i.variant_id === cartItem.variant_id
        )

        expect(orderItem).toBeDefined()
        expect({
          variant_id: orderItem.variant_id,
          quantity: orderItem.quantity,
          unit_price: orderItem.unit_price,
          is_tax_inclusive: orderItem.is_tax_inclusive,
          total: orderItem.total,
          tax_total: orderItem.tax_total,
          discount_total: orderItem.discount_total,
          adjustments: normalizeAdjustments(orderItem.adjustments),
          tax_lines: normalizeTaxLines(orderItem.tax_lines),
        }).toEqual({
          variant_id: cartItem.variant_id,
          quantity: cartItem.quantity,
          unit_price: cartItem.unit_price,
          is_tax_inclusive: cartItem.is_tax_inclusive,
          total: cartItem.total,
          tax_total: cartItem.tax_total,
          discount_total: cartItem.discount_total,
          adjustments: normalizeAdjustments(cartItem.adjustments),
          tax_lines: normalizeTaxLines(cartItem.tax_lines),
        })
      }

      expect(order.shipping_methods).toHaveLength(
        cartBefore.shipping_methods.length
      )
      for (const cartMethod of cartBefore.shipping_methods) {
        const orderMethod = order.shipping_methods.find(
          (sm) => sm.shipping_option_id === cartMethod.shipping_option_id
        )

        expect(orderMethod).toBeDefined()
        expect({
          amount: orderMethod.amount,
          is_tax_inclusive: orderMethod.is_tax_inclusive,
          total: orderMethod.total,
          tax_total: orderMethod.tax_total,
          discount_total: orderMethod.discount_total,
          adjustments: normalizeAdjustments(orderMethod.adjustments),
          tax_lines: normalizeTaxLines(orderMethod.tax_lines),
        }).toEqual({
          amount: cartMethod.amount,
          is_tax_inclusive: cartMethod.is_tax_inclusive,
          total: cartMethod.total,
          tax_total: cartMethod.tax_total,
          discount_total: cartMethod.discount_total,
          adjustments: normalizeAdjustments(cartMethod.adjustments),
          tax_lines: normalizeTaxLines(cartMethod.tax_lines),
        })
      }

      expect(
        sumOf((order.credit_lines ?? []).map((cl) => Number(cl.amount)))
      ).toBeCloseTo(cartBefore.credit_line_total, PRECISION)

      if (!expectPayment) {
        expect(order.total).toEqual(0)
        const payments = (order.payment_collections ?? []).flatMap(
          (pc) => pc.payments ?? []
        )
        expect(payments).toHaveLength(0)
        expect(order.summary.current_order_total).toEqual(0)
        expect(order.summary.pending_difference).toEqual(0)

        return { cart: cartBefore, order }
      }

      // authorized amount == order.total == cart.total
      expect(order.payment_status).toEqual("authorized")
      expect(order.payment_collections).toHaveLength(1)
      const [paymentCollection] = order.payment_collections
      expect(paymentCollection.amount).toEqual(order.total)
      expect(paymentCollection.authorized_amount).toEqual(order.total)
      expect(paymentCollection.payments).toHaveLength(1)
      const [payment] = paymentCollection.payments
      expect(payment.amount).toEqual(order.total)
      expect(payment.captures ?? []).toHaveLength(0)

      // captured amount == order.total and the order is fully settled
      await api.post(
        `/admin/payments/${payment.id}/capture`,
        undefined,
        adminHeaders
      )

      const settledOrder = await getOrder(order.id)
      const [settledCollection] = settledOrder.payment_collections
      const captures = settledCollection.payments.flatMap((p) => p.captures)

      expect(settledOrder.payment_status).toEqual("captured")
      expect(settledOrder.total).toEqual(cartBefore.total)
      expect(settledCollection.captured_amount).toEqual(cartBefore.total)
      expect(sumOf(captures.map((c) => Number(c.amount)))).toBeCloseTo(
        cartBefore.total,
        PRECISION
      )
      expect(settledOrder.summary.current_order_total).toEqual(cartBefore.total)
      expect(settledOrder.summary.paid_total).toBeCloseTo(
        cartBefore.total,
        PRECISION
      )
      expect(settledOrder.summary.pending_difference).toBeCloseTo(0, PRECISION)

      return { cart: cartBefore, order: settledOrder }
    }

    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, appContainer)
      const publishableKey = await generatePublishableKey(appContainer)
      storeHeaders = generateStoreHeaders({ publishableKey })

      await setupTaxStructure(appContainer.resolve(Modules.TAX))

      region = (
        await api.post(
          "/admin/regions",
          {
            name: "US",
            currency_code: "usd",
            countries: ["us"],
            payment_providers: ["pp_system_default"],
          },
          adminHeaders
        )
      ).data.region

      salesChannel = (
        await api.post(
          "/admin/sales-channels",
          { name: "Checkout SC", is_disabled: false },
          adminHeaders
        )
      ).data.sales_channel

      shippingProfile = (
        await api.post(
          "/admin/shipping-profiles",
          { name: "Checkout profile", type: "default" },
          adminHeaders
        )
      ).data.shipping_profile

      const stockLocation = (
        await api.post(
          "/admin/stock-locations",
          { name: "Checkout location" },
          adminHeaders
        )
      ).data.stock_location

      await api.post(
        `/admin/stock-locations/${stockLocation.id}/sales-channels`,
        { add: [salesChannel.id] },
        adminHeaders
      )

      const fulfillmentSets = (
        await api.post(
          `/admin/stock-locations/${stockLocation.id}/fulfillment-sets?fields=*fulfillment_sets`,
          { name: "Checkout set", type: "test-type" },
          adminHeaders
        )
      ).data.stock_location.fulfillment_sets

      const fulfillmentSet = (
        await api.post(
          `/admin/fulfillment-sets/${fulfillmentSets[0].id}/service-zones`,
          {
            name: "Checkout zone",
            geo_zones: [{ type: "country", country_code: "US" }],
          },
          adminHeaders
        )
      ).data.fulfillment_set

      await api.post(
        `/admin/stock-locations/${stockLocation.id}/fulfillment-providers`,
        { add: ["manual_test-provider"] },
        adminHeaders
      )

      shippingOption = (
        await api.post(
          "/admin/shipping-options",
          {
            name: "Checkout shipping",
            service_zone_id: fulfillmentSet.service_zones[0].id,
            shipping_profile_id: shippingProfile.id,
            provider_id: "manual_test-provider",
            price_type: "flat",
            type: {
              label: "Standard",
              description: "Standard",
              code: "standard",
            },
            prices: [{ currency_code: "usd", amount: SHIPPING_PRICE }],
            rules: [],
          },
          adminHeaders
        )
      ).data.shipping_option

      productA = await createProduct("Product A", 1500)
      productB = await createProduct("Product B", 2000)
    })

    describe("Checkout invariant: order.total == authorized == captured == cart.total", () => {
      describe("(a) fixed + percentage promotions stacked on tax-inclusive items", () => {
        it.each([
          { promotionsTaxInclusive: true },
          { promotionsTaxInclusive: false },
        ])(
          "should reconcile with promotions is_tax_inclusive=$promotionsTaxInclusive",
          async ({ promotionsTaxInclusive }) => {
            await enableTaxInclusivePricing()

            const fixed = await createPromotion({
              code: "STACK_FIXED",
              type: PromotionType.STANDARD,
              status: PromotionStatus.ACTIVE,
              is_tax_inclusive: promotionsTaxInclusive,
              application_method: {
                type: "fixed",
                target_type: "items",
                allocation: "across",
                currency_code: "usd",
                value: 300,
              },
            })

            const percentage = await createPromotion({
              code: "STACK_PERCENT",
              type: PromotionType.STANDARD,
              status: PromotionStatus.ACTIVE,
              is_tax_inclusive: promotionsTaxInclusive,
              application_method: {
                type: "percentage",
                target_type: "items",
                allocation: "across",
                value: 10,
              },
            })

            const cartId = await createCartWithShipping([
              { variant_id: productA.variants[0].id, quantity: 2 },
              { variant_id: productB.variants[0].id, quantity: 1 },
            ])

            const cart = await applyPromoCodes(cartId, [
              fixed.code,
              percentage.code,
            ])

            const appliedCodes = new Set(
              cart.items.flatMap((i) => i.adjustments.map((a) => a.code))
            )
            expect(appliedCodes).toEqual(new Set([fixed.code, percentage.code]))
            expect(cart.items.every((i) => i.is_tax_inclusive)).toBe(true)
            expect(cart.discount_total).toBeGreaterThan(0)
            expect(cart.tax_total).toBeGreaterThan(0)

            await initiatePaymentSession(cartId)

            await completeAndAssertInvariants(cartId, { expectPayment: true })
          }
        )
      })

      describe("(b) shipping-method promotion with tax", () => {
        it.each([
          { method: "percentage", value: 50, taxInclusive: false },
          { method: "percentage", value: 50, taxInclusive: true },
          { method: "fixed", value: 300, taxInclusive: false },
          { method: "fixed", value: 300, taxInclusive: true },
        ])(
          "should reconcile a $method shipping promotion (tax inclusive prices: $taxInclusive)",
          async ({ method, value, taxInclusive }) => {
            if (taxInclusive) {
              await enableTaxInclusivePricing()
            }

            const shippingPromotion = await createPromotion({
              code: "SHIP_PROMO",
              type: PromotionType.STANDARD,
              status: PromotionStatus.ACTIVE,
              application_method: {
                type: method,
                target_type: "shipping_methods",
                allocation: "each",
                max_quantity: 1,
                value,
                ...(method === "fixed" ? { currency_code: "usd" } : {}),
              },
            })

            const cartId = await createCartWithShipping([
              { variant_id: productA.variants[0].id, quantity: 1 },
            ])

            const cart = await applyPromoCodes(cartId, [shippingPromotion.code])

            expect(cart.shipping_methods).toHaveLength(1)
            expect(cart.shipping_methods[0].adjustments).toEqual([
              expect.objectContaining({ code: shippingPromotion.code }),
            ])
            expect(cart.shipping_tax_total).toBeGreaterThan(0)
            expect(cart.shipping_discount_total).toBeGreaterThan(0)
            expect(cart.shipping_total).toBeLessThan(
              cart.original_shipping_total
            )

            await initiatePaymentSession(cartId)

            await completeAndAssertInvariants(cartId, { expectPayment: true })
          }
        )
      })

      describe("(c) zero-total cart via credit lines", () => {
        it.each([{ taxInclusive: false }, { taxInclusive: true }])(
          "should complete without a payment session (tax inclusive prices: $taxInclusive)",
          async ({ taxInclusive }) => {
            if (taxInclusive) {
              await enableTaxInclusivePricing()
            }

            const promotion = await createPromotion({
              code: "CREDIT_PERCENT",
              type: PromotionType.STANDARD,
              status: PromotionStatus.ACTIVE,
              application_method: {
                type: "percentage",
                target_type: "items",
                allocation: "across",
                value: 10,
              },
            })

            const cartId = await createCartWithShipping([
              { variant_id: productA.variants[0].id, quantity: 2 },
            ])

            const cart = await applyPromoCodes(cartId, [promotion.code])
            expect(cart.tax_total).toBeGreaterThan(0)

            await addCreditLine(cartId, cart.total)

            const { order } = await completeAndAssertInvariants(cartId, {
              expectPayment: false,
            })

            expect(order.payment_collections ?? []).toHaveLength(0)
            expect(order.credit_line_total).toEqual(cart.total)
          }
        )

        it("should complete without authorizing a payment when a session was initiated before the credit lines covered the total", async () => {
          const cartId = await createCartWithShipping([
            { variant_id: productA.variants[0].id, quantity: 1 },
          ])

          await initiatePaymentSession(cartId)

          const cart = await getCart(cartId)
          await addCreditLine(cartId, cart.total)

          const { order } = await completeAndAssertInvariants(cartId, {
            expectPayment: false,
          })

          expect(order.credit_line_total).toEqual(cart.total)
        })

        it("should authorize only the remainder when credit lines partially cover the total", async () => {
          const cartId = await createCartWithShipping([
            { variant_id: productA.variants[0].id, quantity: 1 },
          ])

          const cart = await getCart(cartId)
          await addCreditLine(cartId, 500)

          await initiatePaymentSession(cartId)

          const { order } = await completeAndAssertInvariants(cartId, {
            expectPayment: true,
          })

          expect(order.credit_line_total).toEqual(500)
          expect(order.total).toBeCloseTo(cart.total - 500, PRECISION)
        })
      })

      describe("(d) promotions with max_quantity / apply_to_quantity at completion", () => {
        it.each([{ taxInclusive: false }, { taxInclusive: true }])(
          "should reconcile a fixed `each` promotion capped by max_quantity (tax inclusive prices: $taxInclusive)",
          async ({ taxInclusive }) => {
            if (taxInclusive) {
              await enableTaxInclusivePricing()
            }

            const promotion = await createPromotion({
              code: "MAX_QTY_FIXED",
              type: PromotionType.STANDARD,
              status: PromotionStatus.ACTIVE,
              is_tax_inclusive: taxInclusive,
              application_method: {
                type: "fixed",
                target_type: "items",
                allocation: "each",
                currency_code: "usd",
                value: 200,
                max_quantity: 2,
                target_rules: [
                  {
                    attribute: "items.product.id",
                    operator: "in",
                    values: [productA.id],
                  },
                ],
              },
            })

            const cartId = await createCartWithShipping([
              { variant_id: productA.variants[0].id, quantity: 3 },
              { variant_id: productB.variants[0].id, quantity: 1 },
            ])

            const cart = await applyPromoCodes(cartId, [promotion.code])

            const itemA = cart.items.find(
              (i) => i.variant_id === productA.variants[0].id
            )
            const itemB = cart.items.find(
              (i) => i.variant_id === productB.variants[0].id
            )
            expect(itemA.adjustments).toEqual([
              expect.objectContaining({ code: promotion.code, amount: 400 }),
            ])
            expect(itemB.adjustments).toEqual([])

            await initiatePaymentSession(cartId)

            await completeAndAssertInvariants(cartId, { expectPayment: true })
          }
        )

        it.each([{ taxInclusive: false }, { taxInclusive: true }])(
          "should reconcile a buyget promotion with apply_to_quantity (tax inclusive prices: $taxInclusive)",
          async ({ taxInclusive }) => {
            if (taxInclusive) {
              await enableTaxInclusivePricing()
            }

            const promotion = await createPromotion({
              code: "BUY2_GET1",
              type: PromotionType.BUYGET,
              status: PromotionStatus.ACTIVE,
              application_method: {
                type: "percentage",
                target_type: "items",
                allocation: "each",
                value: 100,
                max_quantity: 1,
                apply_to_quantity: 1,
                buy_rules_min_quantity: 2,
                buy_rules: [
                  {
                    attribute: "items.product.id",
                    operator: "eq",
                    values: [productA.id],
                  },
                ],
                target_rules: [
                  {
                    attribute: "items.product.id",
                    operator: "eq",
                    values: [productB.id],
                  },
                ],
              },
            })

            const cartId = await createCartWithShipping([
              { variant_id: productA.variants[0].id, quantity: 2 },
              { variant_id: productB.variants[0].id, quantity: 2 },
            ])

            await applyPromoCodes(cartId, [promotion.code])
            const cart = await getCart(cartId)

            const itemA = cart.items.find(
              (i) => i.variant_id === productA.variants[0].id
            )
            const itemB = cart.items.find(
              (i) => i.variant_id === productB.variants[0].id
            )
            expect(itemA.adjustments).toEqual([])
            expect(itemB.adjustments).toEqual([
              expect.objectContaining({ code: promotion.code }),
            ])
            // exactly one of the two target units is free, tax included
            expect(itemB.discount_total).toBeCloseTo(
              itemB.original_total / 2,
              PRECISION
            )

            await initiatePaymentSession(cartId)

            await completeAndAssertInvariants(cartId, { expectPayment: true })
          }
        )
      })
    })
  },
})
