import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules, PaymentSessionStatus, ProductStatus } from "@medusajs/utils"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"

jest.setTimeout(100000)

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

const pendingAuthProviderId = "pp_pending-auth_pending-auth"

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
    let region
    let salesChannel
    let product
    let shippingProfile
    let cart

    beforeAll(async () => {
      appContainer = getContainer()
    })

    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, appContainer)

      const publishableKey = await generatePublishableKey(appContainer)
      storeHeaders = generateStoreHeaders({ publishableKey })

      region = (
        await api.post(
          "/admin/regions",
          {
            payment_providers: ["pp_system_default", pendingAuthProviderId],
            name: "Test Region",
            currency_code: "usd",
            countries: ["US"],
            automatic_taxes: false,
          },
          adminHeaders
        )
      ).data.region

      salesChannel = (
        await api.post(
          "/admin/sales-channels",
          { name: "Test SC", is_disabled: false },
          adminHeaders
        )
      ).data.sales_channel

      shippingProfile = (
        await api.post(
          "/admin/shipping-profiles",
          { name: "Test Profile", type: "default" },
          adminHeaders
        )
      ).data.shipping_profile

      product = (
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
            type: {
              label: "Test",
              description: "Test",
              code: "test-code",
            },
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
            email: "customer@medusa.js",
            shipping_address: shippingAddressData,
            items: [{ variant_id: product.variants[0].id, quantity: 1 }],
          },
          storeHeaders
        )
      ).data.cart

      cart = (
        await api.post(
          `/store/carts/${cart.id}/shipping-methods`,
          { option_id: shippingOption.id },
          storeHeaders
        )
      ).data.cart
    })

    const initiatePaymentSession = async (providerId: string) => {
      const paymentCollection = (
        await api.post(
          "/store/payment-collections",
          { cart_id: cart.id },
          storeHeaders
        )
      ).data.payment_collection

      const updatedCollection = (
        await api.post(
          `/store/payment-collections/${paymentCollection.id}/payment-sessions`,
          { provider_id: providerId },
          storeHeaders
        )
      ).data.payment_collection

      return {
        paymentCollection: updatedCollection,
        paymentSession: updatedCollection.payment_sessions[0],
      }
    }

    describe("refresh payment collection after a cart change", () => {
      it.each([
        ["pp_system_default", PaymentSessionStatus.AUTHORIZED],
        [pendingAuthProviderId, PaymentSessionStatus.PENDING_AUTHORIZATION],
      ])(
        "should preserve an in-flight %s payment session (%s) and still complete the cart",
        async (providerId, expectedStatus) => {
          const paymentModule = appContainer.resolve(Modules.PAYMENT)
          const { paymentCollection, paymentSession } =
            await initiatePaymentSession(providerId)

          expect(paymentCollection.amount).toEqual(cart.total)

          // The customer authorizes the session (e.g. on the provider's hosted page)
          // while the cart has not been completed yet.
          await paymentModule.authorizePaymentSession(paymentSession.id, {})

          const [authorizedSession] = await paymentModule.listPaymentSessions({
            id: paymentSession.id,
          })
          expect(authorizedSession.status).toEqual(expectedStatus)

          // A concurrent cart change triggers a payment collection refresh
          const error = await api
            .post(
              `/store/carts/${cart.id}/line-items`,
              { variant_id: product.variants[0].id, quantity: 1 },
              storeHeaders
            )
            .catch((e) => e)

          const sessions = await paymentModule.listPaymentSessions({
            payment_collection_id: paymentCollection.id,
          })

          expect(sessions).toEqual([
            expect.objectContaining({
              id: paymentSession.id,
              status: expectedStatus,
            }),
          ])

          expect(error.response?.status).toEqual(400)
          expect(error.response?.data).toEqual(
            expect.objectContaining({
              type: "invalid_data",
              message: expect.stringContaining(paymentSession.id),
            })
          )

          const refreshedCart = (
            await api.get(`/store/carts/${cart.id}`, storeHeaders)
          ).data.cart
          expect(refreshedCart.total).toEqual(cart.total)
          expect(refreshedCart.items).toHaveLength(1)

          const completed = (
            await api.post(`/store/carts/${cart.id}/complete`, {}, storeHeaders)
          ).data

          expect(completed.type).toEqual("order")
          expect(completed.order.total).toEqual(cart.total)
        }
      )

      it("should only delete payment sessions whose amount is stale", async () => {
        const paymentModule = appContainer.resolve(Modules.PAYMENT)
        const { paymentCollection, paymentSession: staleSession } =
          await initiatePaymentSession("pp_system_default")

        const newTotal = cart.total + product.variants[0].prices[0].amount

        const upToDateSession = await paymentModule.createPaymentSession(
          paymentCollection.id,
          {
            provider_id: "pp_system_default",
            currency_code: "usd",
            amount: newTotal,
            data: {},
          }
        )

        const updatedCart = (
          await api.post(
            `/store/carts/${cart.id}/line-items`,
            { variant_id: product.variants[0].id, quantity: 1 },
            storeHeaders
          )
        ).data.cart

        expect(updatedCart.total).toEqual(newTotal)

        const updatedCollection = await paymentModule.retrievePaymentCollection(
          paymentCollection.id,
          { relations: ["payment_sessions"] }
        )

        expect(updatedCollection.amount).toEqual(newTotal)
        expect(updatedCollection.payment_sessions).toEqual([
          expect.objectContaining({ id: upToDateSession.id }),
        ])
        expect(
          updatedCollection.payment_sessions!.find(
            (s) => s.id === staleSession.id
          )
        ).toBeUndefined()
      })
    })
  },
})
