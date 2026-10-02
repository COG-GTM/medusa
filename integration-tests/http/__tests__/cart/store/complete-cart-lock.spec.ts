import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/utils"
import { setTimeout } from "timers/promises"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"

jest.setTimeout(100000)

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

// The lock acquired by the complete-cart workflow used to expire after two
// minutes; the slow provider call below advances the clock past that window.
const PREVIOUS_LOCK_TTL_MS = 2 * 60 * 1000
const SLOW_PROVIDER_DELAY_MS = PREVIOUS_LOCK_TTL_MS + 60 * 1000

const shippingAddressData = {
  address_1: "test address 1",
  address_2: "test address 2",
  city: "SF",
  country_code: "US",
  province: "CA",
  postal_code: "94016",
}

medusaIntegrationTestRunner({
  env,
  testSuite: ({ dbConnection, getContainer, api }) => {
    let appContainer
    let storeHeaders
    let cart
    let clockOffset: number

    const realDateNow = Date.now.bind(Date)

    beforeAll(async () => {
      appContainer = getContainer()
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    beforeEach(async () => {
      clockOffset = 0
      jest
        .spyOn(Date, "now")
        .mockImplementation(() => realDateNow() + clockOffset)

      await createAdminUser(dbConnection, adminHeaders, appContainer)

      const publishableKey = await generatePublishableKey(appContainer)
      storeHeaders = generateStoreHeaders({ publishableKey })

      const region = (
        await api.post(
          "/admin/regions",
          {
            payment_providers: ["pp_system_default"],
            name: "Test Region",
            currency_code: "usd",
            countries: ["US"],
            automatic_taxes: false,
          },
          adminHeaders
        )
      ).data.region

      const salesChannel = (
        await api.post(
          "/admin/sales-channels",
          { name: "Test SC", is_disabled: false },
          adminHeaders
        )
      ).data.sales_channel

      const shippingProfile = (
        await api.post(
          "/admin/shipping-profiles",
          { name: "Test Profile", type: "default" },
          adminHeaders
        )
      ).data.shipping_profile

      const product = (
        await api.post(
          "/admin/products",
          {
            title: "Test Product",
            status: ProductStatus.PUBLISHED,
            options: [{ title: "Size", values: ["S"] }],
            variants: [
              {
                title: "Test Variant",
                sku: "TEST-VARIANT",
                prices: [{ currency_code: "usd", amount: 1500 }],
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

      const stockLocation = (
        await api.post(
          "/admin/stock-locations",
          { name: "test location" },
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
          { name: "Test Set", type: "test-type" },
          adminHeaders
        )
      ).data.stock_location.fulfillment_sets

      const fulfillmentSet = (
        await api.post(
          `/admin/fulfillment-sets/${fulfillmentSets[0].id}/service-zones`,
          {
            name: "Test Zone",
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

      const shippingOption = (
        await api.post(
          "/admin/shipping-options",
          {
            name: "Test Shipping",
            service_zone_id: fulfillmentSet.service_zones[0].id,
            shipping_profile_id: shippingProfile.id,
            provider_id: "manual_test-provider",
            price_type: "flat",
            type: { label: "Test", description: "Test", code: "test-code" },
            prices: [{ currency_code: "usd", amount: 1000 }],
            rules: [],
          },
          adminHeaders
        )
      ).data.shipping_option

      cart = (
        await api.post(
          "/store/carts",
          {
            currency_code: "usd",
            sales_channel_id: salesChannel.id,
            region_id: region.id,
            shipping_address: shippingAddressData,
            items: [{ variant_id: product.variants[0].id, quantity: 1 }],
          },
          storeHeaders
        )
      ).data.cart

      await api.post(
        `/store/carts/${cart.id}/shipping-methods`,
        { option_id: shippingOption.id },
        storeHeaders
      )

      const paymentCollection = (
        await api.post(
          "/store/payment-collections",
          { cart_id: cart.id },
          storeHeaders
        )
      ).data.payment_collection

      await api.post(
        `/store/payment-collections/${paymentCollection.id}/payment-sessions`,
        { provider_id: "pp_system_default" },
        storeHeaders
      )
    })

    const completeCart = () =>
      api
        .post(`/store/carts/${cart.id}/complete`, {}, storeHeaders)
        .catch((e) => e.response)

    const getOrdersLinkedToCart = async () => {
      const query = appContainer.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order_cart",
        fields: ["order_id"],
        filters: { cart_id: cart.id },
      })
      return data.map((link) => link.order_id)
    }

    const orderExists = async (orderId: string) => {
      const query = appContainer.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id"],
        filters: { id: orderId },
      })
      return data.length === 1
    }

    /**
     * Makes the next payment authorization behave like a slow PSP call that
     * outlives the previous lock TTL. While it is "in flight", `onSlowCall` is
     * executed (e.g. to fire a concurrent completion of the same cart).
     */
    const mockSlowAuthorization = ({
      onSlowCall,
      outcome,
    }: {
      onSlowCall: () => Promise<void>
      outcome: "authorized" | "declined"
    }) => {
      const paymentModule = appContainer.resolve(Modules.PAYMENT)
      const original = paymentModule.authorizePaymentSession.bind(paymentModule)

      return jest
        .spyOn(paymentModule, "authorizePaymentSession")
        .mockImplementationOnce(async (...args) => {
          clockOffset += SLOW_PROVIDER_DELAY_MS
          await onSlowCall()

          if (outcome === "declined") {
            throw new MedusaError(
              MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
              "Payment authorization failed"
            )
          }

          return original(...args)
        })
    }

    describe("POST /store/carts/:id/complete with a slow payment provider", () => {
      it("should not let a concurrent completion return an order that the slow completion later rolls back", async () => {
        let concurrentCompletion: Promise<any> | undefined

        mockSlowAuthorization({
          outcome: "declined",
          onSlowCall: async () => {
            concurrentCompletion = completeCart()
            await Promise.race([concurrentCompletion, setTimeout(3000)])
          },
        })

        const first = await completeCart()
        const second = await concurrentCompletion

        expect(first.status).toBe(200)
        expect(first.data.type).toBe("cart")

        const linkedOrderIds = await getOrdersLinkedToCart()
        expect(linkedOrderIds.length).toBeLessThanOrEqual(1)

        if (second.data.type === "order") {
          // The order handed to the concurrent request must be a real, persisted
          // order for this cart, not one that is compensated away afterwards.
          expect(await orderExists(second.data.order.id)).toBe(true)
          expect(linkedOrderIds).toEqual([second.data.order.id])
        }
      })

      it("should return the same single order to a concurrent completion while the provider is slow", async () => {
        let concurrentCompletion: Promise<any> | undefined

        mockSlowAuthorization({
          outcome: "authorized",
          onSlowCall: async () => {
            concurrentCompletion = completeCart()
            await Promise.race([concurrentCompletion, setTimeout(3000)])
          },
        })

        const first = await completeCart()
        const second = await concurrentCompletion

        expect(first.status).toBe(200)
        expect(first.data.type).toBe("order")
        expect(second.status).toBe(200)
        expect(second.data.type).toBe("order")
        expect(second.data.order.id).toBe(first.data.order.id)

        expect(await getOrdersLinkedToCart()).toEqual([first.data.order.id])
      })

      it("should not release a cart lock that was re-acquired by another owner after expiring", async () => {
        const locking = appContainer.resolve(Modules.LOCKING)
        const concurrentOwnerId = "concurrent-complete-cart"

        mockSlowAuthorization({
          outcome: "authorized",
          onSlowCall: async () => {
            // Advance far enough that even an extended lock has expired, then
            // let another owner take over the cart lock.
            clockOffset += 60 * 60 * 1000
            await locking.acquire(cart.id, {
              ownerId: concurrentOwnerId,
              expire: 60,
            })
          },
        })

        const first = await completeCart()
        expect(first.status).toBe(200)

        // The lock held by the other owner must survive the first completion
        // finishing (or compensating).
        const releasedByOwner = await locking.release(cart.id, {
          ownerId: concurrentOwnerId,
        })
        expect(releasedByOwner).toBe(true)
      })
    })
  },
})
