import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { IPromotionModuleService } from "@medusajs/types"
import { Modules, PromotionStatus, PromotionType } from "@medusajs/utils"
import {
  adminHeaders,
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"
import { medusaTshirtProduct } from "../../../__fixtures__/product"

jest.setTimeout(100000)

const env = {}

const shippingAddressData = {
  address_1: "test address 1",
  city: "SF",
  country_code: "US",
  province: "CA",
  postal_code: "94016",
}

medusaIntegrationTestRunner({
  env,
  testSuite: ({ dbConnection, getContainer, api, dbUtils }) => {
    describe("Store Carts API: promotion usage limit under concurrency", () => {
      let appContainer
      let promotionModuleService: IPromotionModuleService
      let storeHeaders
      let region
      let product
      let salesChannel
      let shippingOption

      beforeAll(async () => {
        appContainer = getContainer()
        promotionModuleService = appContainer.resolve(Modules.PROMOTION)
      })

      beforeEach(async () => {
        await createAdminUser(dbConnection, adminHeaders, appContainer)
        const publishableKey = await generatePublishableKey(appContainer)
        storeHeaders = generateStoreHeaders({ publishableKey })

        const shippingProfile = (
          await api.post(
            `/admin/shipping-profiles`,
            { name: "default", type: "default" },
            adminHeaders
          )
        ).data.shipping_profile

        region = (
          await api.post(
            "/admin/regions",
            {
              payment_providers: ["pp_system_default"],
              name: "US",
              currency_code: "usd",
              countries: ["us"],
            },
            adminHeaders
          )
        ).data.region

        product = (
          await api.post(
            "/admin/products",
            { ...medusaTshirtProduct, shipping_profile_id: shippingProfile.id },
            adminHeaders
          )
        ).data.product

        salesChannel = (
          await api.post(
            "/admin/sales-channels",
            { name: "Webshop", description: "channel" },
            adminHeaders
          )
        ).data.sales_channel

        const stockLocation = (
          await api.post(
            `/admin/stock-locations`,
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
            { name: "Test fulfillment set", type: "test-type" },
            adminHeaders
          )
        ).data.stock_location.fulfillment_sets

        const fulfillmentSet = (
          await api.post(
            `/admin/fulfillment-sets/${fulfillmentSets[0].id}/service-zones`,
            {
              name: "Test service zone",
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
            `/admin/shipping-options`,
            {
              name: "Test shipping option",
              service_zone_id: fulfillmentSet.service_zones[0].id,
              shipping_profile_id: shippingProfile.id,
              provider_id: "manual_test-provider",
              price_type: "flat",
              type: {
                label: "Test type",
                description: "Test description",
                code: "test-code",
              },
              prices: [{ currency_code: "usd", amount: 1000 }],
              rules: [],
            },
            adminHeaders
          )
        ).data.shipping_option
      })

      const createLimitedPromotion = async (code: string) =>
        await promotionModuleService.createPromotions({
          code,
          type: PromotionType.STANDARD,
          status: PromotionStatus.ACTIVE,
          limit: 1,
          application_method: {
            type: "fixed",
            target_type: "items",
            allocation: "each",
            value: 100,
            max_quantity: 1,
            currency_code: "usd",
          },
        })

      const createCart = async () =>
        (
          await api.post(
            `/store/carts`,
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

      const prepareCartForCompletion = async (cartId: string) => {
        await api.post(
          `/store/carts/${cartId}/shipping-methods`,
          { option_id: shippingOption.id },
          storeHeaders
        )

        const paymentCollection = (
          await api.post(
            `/store/payment-collections`,
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

      const getPromoAdjustments = async (cartId: string, code: string) => {
        const cart = (
          await api.get(
            `/store/carts/${cartId}?fields=*items,*items.adjustments,*promotions`,
            storeHeaders
          )
        ).data.cart

        return {
          cart,
          adjustments: cart.items.flatMap((item) =>
            item.adjustments.filter((a) => a.code === code)
          ),
        }
      }

      it("should apply a limit: 1 promotion once when it is sent concurrently to the same cart", async () => {
        const promotion = await createLimitedPromotion("LIMIT_ONE_SAME_CART")
        const cart = await createCart()

        const results = await Promise.all(
          Array.from({ length: 2 }, () =>
            api
              .post(
                `/store/carts/${cart.id}/promotions`,
                { promo_codes: [promotion.code] },
                storeHeaders
              )
              .catch((e) => e)
          )
        )

        expect(
          results.filter((r) => r.status === 200).length
        ).toBeGreaterThanOrEqual(1)

        const { cart: finalCart, adjustments } = await getPromoAdjustments(
          cart.id,
          promotion.code!
        )

        expect(adjustments).toHaveLength(1)
        expect(
          finalCart.promotions.filter((p) => p.code === promotion.code)
        ).toHaveLength(1)

        // Applying a code does not consume usage; only completion does.
        const [refreshed] = await promotionModuleService.listPromotions({
          id: promotion.id,
        })
        expect(refreshed.used).toBe(0)
      })

      it("should let only one cart consume a limit: 1 promotion when two carts apply and complete concurrently", async () => {
        const promotion = await createLimitedPromotion("LIMIT_ONE_TWO_CARTS")
        const [cartA, cartB] = await Promise.all([createCart(), createCart()])

        await Promise.all([
          prepareCartForCompletion(cartA.id),
          prepareCartForCompletion(cartB.id),
        ])

        const applyResults = await Promise.all(
          [cartA, cartB].map((cart) =>
            api
              .post(
                `/store/carts/${cart.id}/promotions`,
                { promo_codes: [promotion.code] },
                storeHeaders
              )
              .catch((e) => e)
          )
        )

        // Applying a promotion is advisory: `used` is only incremented by
        // `registerUsage` at cart completion, so both carts may hold the code.
        expect(applyResults.map((r) => r.status)).toEqual([200, 200])

        // Refresh the payment sessions so they match the discounted totals.
        await Promise.all([
          prepareCartForCompletion(cartA.id),
          prepareCartForCompletion(cartB.id),
        ])

        const completeResults = await Promise.all(
          [cartA, cartB].map((cart) =>
            api
              .post(`/store/carts/${cart.id}/complete`, {}, storeHeaders)
              .catch((e) => e)
          )
        )

        const successes = completeResults.filter(
          (r) => r.status === 200 && r.data.type === "order"
        )
        const failures = completeResults.filter(
          (r) => !(r.status === 200 && r.data.type === "order")
        )

        expect(successes).toHaveLength(1)
        expect(failures).toHaveLength(1)

        const failure = failures[0]
        const failureMessage =
          failure.response?.data?.message ?? failure.data?.error?.message
        expect(failureMessage).toEqual("Promotion usage exceeds the limit.")

        const [refreshed] = await promotionModuleService.listPromotions({
          id: promotion.id,
        })
        expect(refreshed.used).toBe(1)

        const orders = (
          await api.get(`/admin/orders?fields=id,*promotions`, adminHeaders)
        ).data.orders
        expect(orders).toHaveLength(1)

        const losingCartId =
          completeResults[0] === failure ? cartA.id : cartB.id
        const losingCart = (
          await api.get(`/store/carts/${losingCartId}`, storeHeaders)
        ).data.cart
        expect(losingCart.completed_at).toBeNull()
      })
    })
  },
})
