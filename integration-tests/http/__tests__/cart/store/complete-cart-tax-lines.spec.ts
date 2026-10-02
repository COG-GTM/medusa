import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/utils"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"
import { setupTaxStructure } from "../../../../modules/__tests__/fixtures"
import { medusaTshirtProduct } from "../../../__fixtures__/product"

jest.setTimeout(100000)

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

const californiaAddress = {
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
    let salesChannel
    let shippingProfile
    let product
    let shippingOption
    let taxSeedData

    beforeAll(async () => {
      appContainer = getContainer()
    })

    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, appContainer)
      const publishableKey = await generatePublishableKey(appContainer)
      storeHeaders = generateStoreHeaders({ publishableKey })

      taxSeedData = await setupTaxStructure(appContainer.resolve(Modules.TAX))

      shippingProfile = (
        await api.post(
          `/admin/shipping-profiles`,
          { name: "default", type: "default" },
          adminHeaders
        )
      ).data.shipping_profile

      salesChannel = (
        await api.post(
          "/admin/sales-channels",
          { name: "Webshop", description: "channel" },
          adminHeaders
        )
      ).data.sales_channel

      product = (
        await api.post(
          "/admin/products",
          { ...medusaTshirtProduct, shipping_profile_id: shippingProfile.id },
          adminHeaders
        )
      ).data.product

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

    const createRegion = async (automaticTaxes: boolean) =>
      (
        await api.post(
          "/admin/regions",
          {
            payment_providers: ["pp_system_default"],
            name: "US",
            currency_code: "usd",
            countries: ["us"],
            automatic_taxes: automaticTaxes,
          },
          adminHeaders
        )
      ).data.region

    const createCartReadyForCompletion = async (regionId: string) => {
      const cart = (
        await api.post(
          `/store/carts`,
          {
            currency_code: "usd",
            sales_channel_id: salesChannel.id,
            region_id: regionId,
            shipping_address: californiaAddress,
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

      return cart
    }

    const addPaymentSession = async (cartId: string) => {
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

    const completeAndFetchOrder = async (cartId: string) => {
      const response = await api.post(
        `/store/carts/${cartId}/complete`,
        {},
        storeHeaders
      )

      expect(response.status).toEqual(200)
      expect(response.data.type).toEqual("order")

      return (
        await api.get(
          `/admin/orders/${response.data.order.id}?fields=*items,*items.tax_lines,*shipping_methods,*shipping_methods.tax_lines,shipping_address.*`,
          adminHeaders
        )
      ).data.order
    }

    const getCartTaxLines = async (cartId: string) => {
      const cart = (
        await api.get(
          `/store/carts/${cartId}?fields=*items.tax_lines,*shipping_methods.tax_lines`,
          storeHeaders
        )
      ).data.cart

      return {
        items: cart.items.flatMap((i) => i.tax_lines),
        shipping: cart.shipping_methods.flatMap((sm) => sm.tax_lines),
      }
    }

    describe("POST /store/carts/:id/complete tax line recomputation", () => {
      it("should compute the order tax lines from the shipping address at completion when it changed without a tax refresh", async () => {
        const region = await createRegion(true)
        const cart = await createCartReadyForCompletion(region.id)

        const before = await getCartTaxLines(cart.id)
        expect(before.items).toEqual([
          expect.objectContaining({ code: "CADEFAULT", rate: 5 }),
        ])
        expect(before.shipping).toEqual([
          expect.objectContaining({ code: "CADEFAULT", rate: 5 }),
        ])

        // Move the address to a different tax region (NY) without going
        // through a workflow that refreshes tax lines (e.g. a custom flow or
        // an integration writing to the Cart Module directly).
        const cartModule = appContainer.resolve(Modules.CART)
        const [{ shipping_address }] = await cartModule.listCarts(
          { id: cart.id },
          { relations: ["shipping_address"] }
        )
        await cartModule.updateAddresses([
          {
            id: shipping_address!.id,
            city: "New York",
            province: "NY",
            postal_code: "10001",
          },
        ])

        const stale = await getCartTaxLines(cart.id)
        expect(stale.items).toEqual([
          expect.objectContaining({ code: "CADEFAULT", rate: 5 }),
        ])

        await addPaymentSession(cart.id)
        const order = await completeAndFetchOrder(cart.id)

        expect(order.shipping_address).toEqual(
          expect.objectContaining({ province: expect.stringMatching(/^ny$/i) })
        )
        expect(order.items[0].tax_lines).toEqual([
          expect.objectContaining({ code: "NYDEFAULT", rate: 6 }),
        ])
        expect(order.shipping_methods[0].tax_lines).toEqual([
          expect.objectContaining({ code: "NYDEFAULT", rate: 6 }),
        ])
      })

      it("should compute the order tax lines from the current tax rates when they changed after the last tax refresh", async () => {
        const region = await createRegion(true)
        const cart = await createCartReadyForCompletion(region.id)

        const taxService = appContainer.resolve(Modules.TAX)
        const [caDefaultRate] = await taxService.listTaxRates({
          tax_region_id: taxSeedData.us.children.cal.province.id,
          is_default: true,
        })
        await taxService.updateTaxRates(caDefaultRate.id, { rate: 8 })

        await addPaymentSession(cart.id)
        const order = await completeAndFetchOrder(cart.id)

        expect(order.items[0].tax_lines).toEqual([
          expect.objectContaining({ code: "CADEFAULT", rate: 8 }),
        ])
        expect(order.shipping_methods[0].tax_lines).toEqual([
          expect.objectContaining({ code: "CADEFAULT", rate: 8 }),
        ])
      })

      it("should keep the cart's tax lines on the order when the region does not calculate taxes automatically", async () => {
        const region = await createRegion(false)
        const cart = await createCartReadyForCompletion(region.id)

        await api.post(`/store/carts/${cart.id}/taxes`, {}, storeHeaders)

        const before = await getCartTaxLines(cart.id)
        expect(before.items).toEqual([
          expect.objectContaining({ code: "CADEFAULT", rate: 5 }),
        ])

        await addPaymentSession(cart.id)
        const order = await completeAndFetchOrder(cart.id)

        expect(order.items[0].tax_lines).toEqual([
          expect.objectContaining({ code: "CADEFAULT", rate: 5 }),
        ])
        expect(order.shipping_methods[0].tax_lines).toEqual([
          expect.objectContaining({ code: "CADEFAULT", rate: 5 }),
        ])
      })
    })
  },
})
