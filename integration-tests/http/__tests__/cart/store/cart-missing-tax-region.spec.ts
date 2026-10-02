import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules, ProductStatus } from "@medusajs/utils"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"

jest.setTimeout(100000)

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

medusaIntegrationTestRunner({
  env,
  testSuite: ({ dbConnection, getContainer, api }) => {
    let appContainer

    beforeAll(async () => {
      appContainer = getContainer()
    })

    describe("Cart with an address in a country without a tax region", () => {
      let storeHeaders
      let region
      let product
      let salesChannel
      let shippingOption

      beforeEach(async () => {
        await createAdminUser(dbConnection, adminHeaders, appContainer)
        const publishableKey = await generatePublishableKey(appContainer)
        storeHeaders = generateStoreHeaders({ publishableKey })

        const shippingProfile = (
          await api.post(
            "/admin/shipping-profiles",
            { name: "default", type: "default" },
            adminHeaders
          )
        ).data.shipping_profile

        // A tax region exists for another country only; IT is misconfigured.
        await appContainer.resolve(Modules.TAX).createTaxRegions([
          {
            country_code: "US",
            provider_id: "tp_system",
            default_tax_rate: { name: "US Default", rate: 2, code: "US" },
          },
        ])

        region = (
          await api.post(
            "/admin/regions",
            {
              name: "Italy",
              currency_code: "eur",
              countries: ["it"],
              automatic_taxes: true,
              payment_providers: ["pp_system_default"],
            },
            adminHeaders
          )
        ).data.region

        salesChannel = (
          await api.post(
            "/admin/sales-channels",
            { name: "IT Webshop" },
            adminHeaders
          )
        ).data.sales_channel

        product = (
          await api.post(
            "/admin/products",
            {
              title: "Test Product",
              status: ProductStatus.PUBLISHED,
              shipping_profile_id: shippingProfile.id,
              sales_channels: [{ id: salesChannel.id }],
              options: [{ title: "Size", values: ["S"] }],
              variants: [
                {
                  title: "S",
                  manage_inventory: false,
                  options: { Size: "S" },
                  prices: [{ amount: 1000, currency_code: "eur" }],
                },
              ],
            },
            adminHeaders
          )
        ).data.product

        const stockLocation = (
          await api.post(
            `/admin/stock-locations`,
            { name: "IT location" },
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
            { name: "IT fulfillment", type: "shipping" },
            adminHeaders
          )
        ).data.stock_location.fulfillment_sets

        const fulfillmentSet = (
          await api.post(
            `/admin/fulfillment-sets/${fulfillmentSets[0].id}/service-zones`,
            {
              name: "IT zone",
              geo_zones: [{ type: "country", country_code: "it" }],
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
              name: "IT shipping",
              service_zone_id: fulfillmentSet.service_zones[0].id,
              shipping_profile_id: shippingProfile.id,
              provider_id: "manual_test-provider",
              price_type: "flat",
              type: {
                label: "Standard",
                description: "Standard shipping",
                code: "standard",
              },
              prices: [{ currency_code: "eur", amount: 500 }],
              rules: [],
            },
            adminHeaders
          )
        ).data.shipping_option
      })

      afterEach(() => {
        jest.restoreAllMocks()
      })

      it("should surface a tax.region_missing event instead of silently producing a zero-tax order", async () => {
        const eventBus = appContainer.resolve(Modules.EVENT_BUS)
        const emitSpy = jest.spyOn(eventBus, "emit")

        const cart = (
          await api.post(
            `/store/carts`,
            {
              currency_code: "eur",
              region_id: region.id,
              sales_channel_id: salesChannel.id,
              email: "tax@test.com",
              shipping_address: {
                address_1: "Via Roma 1",
                city: "Rome",
                country_code: "it",
                postal_code: "00100",
              },
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
            `/store/payment-collections`,
            { cart_id: cart.id },
            storeHeaders
          )
        ).data.payment_collection

        await api.post(
          `/store/payment-collections/${paymentCollection.id}/payment-sessions`,
          { provider_id: "pp_system_default" },
          storeHeaders
        )

        const response = await api.post(
          `/store/carts/${cart.id}/complete`,
          {},
          storeHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.type).toEqual("order")
        expect(response.data.order.tax_total).toEqual(0)

        const missingRegionEvents = emitSpy.mock.calls
          .flatMap(([messages]) => [messages].flat())
          .filter((message) => message.name === "tax.region_missing")

        expect(missingRegionEvents.length).toBeGreaterThan(0)
        expect(missingRegionEvents[0]).toEqual(
          expect.objectContaining({
            name: "tax.region_missing",
            data: { country_code: "it", province_code: null },
          })
        )
      })
    })
  },
})
