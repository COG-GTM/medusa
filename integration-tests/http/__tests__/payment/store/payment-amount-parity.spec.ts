import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/utils"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"

jest.setTimeout(100000)

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

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
            name: "Test Region",
            currency_code: "usd",
            countries: ["US"],
            payment_providers: ["pp_system_default"],
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

      const shippingProfile = (
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
            email: "parity@medusa.js",
            sales_channel_id: salesChannel.id,
            region_id: region.id,
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

    const initiatePaymentSession = async () => {
      const paymentCollection = (
        await api.post(
          "/store/payment-collections",
          { cart_id: cart.id },
          storeHeaders
        )
      ).data.payment_collection

      return (
        await api.post(
          `/store/payment-collections/${paymentCollection.id}/payment-sessions`,
          { provider_id: "pp_system_default" },
          storeHeaders
        )
      ).data.payment_collection
    }

    const addLineItemWithoutRefreshingPayment = async () => {
      const cartModule = appContainer.resolve(Modules.CART)
      await cartModule.addLineItems({
        cart_id: cart.id,
        title: "Extra item",
        product_id: product.id,
        variant_id: product.variants[0].id,
        unit_price: 1500,
        quantity: 1,
      })
    }

    describe("POST /store/carts/:id/complete payment amount parity", () => {
      it("should complete the cart when the payment session amount matches the cart total", async () => {
        const paymentCollection = await initiatePaymentSession()

        expect(paymentCollection.payment_sessions[0].amount).toEqual(2500)

        const response = await api.post(
          `/store/carts/${cart.id}/complete`,
          {},
          storeHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.type).toEqual("order")
        expect(response.data.order.total).toEqual(2500)
      })

      it("should reject completion when a line item is added after the payment session was created", async () => {
        const paymentCollection = await initiatePaymentSession()

        expect(paymentCollection.payment_sessions[0].amount).toEqual(2500)

        await addLineItemWithoutRefreshingPayment()

        const updatedCart = (
          await api.get(`/store/carts/${cart.id}`, storeHeaders)
        ).data.cart

        expect(updatedCart.total).toEqual(4000)

        const query = appContainer.resolve(ContainerRegistrationKeys.QUERY)

        const result = await api
          .post(`/store/carts/${cart.id}/complete`, {}, storeHeaders)
          .then(async (res) => {
            const {
              data: [order],
            } = await query.graph({
              entity: "order",
              fields: ["total", "payment_collections.payments.amount"],
              filters: { id: res.data.order?.id },
            })

            return {
              status: res.status,
              type: res.data.type,
              order_total: order?.total,
              authorized_amount:
                order?.payment_collections?.[0]?.payments?.[0]?.amount,
            }
          })
          .catch((e) => ({ status: e.response?.status, ...e.response?.data }))

        expect(result).toEqual({
          status: 400,
          type: "invalid_data",
          message: expect.stringContaining("does not match the cart's total"),
        })

        const { data: orderCarts } = await query.graph({
          entity: "order_cart",
          fields: ["order_id"],
          filters: { cart_id: cart.id },
        })

        expect(orderCarts).toHaveLength(0)
      })

      it("should complete the cart for the new total once the payment collection is refreshed", async () => {
        await initiatePaymentSession()
        await addLineItemWithoutRefreshingPayment()

        // Any store cart update refreshes the payment collection
        await api.post(
          `/store/carts/${cart.id}`,
          { email: "parity-refreshed@medusa.js" },
          storeHeaders
        )

        const refreshed = await initiatePaymentSession()

        expect(refreshed.amount).toEqual(4000)
        expect(refreshed.payment_sessions).toEqual([
          expect.objectContaining({ amount: 4000 }),
        ])

        const response = await api.post(
          `/store/carts/${cart.id}/complete`,
          {},
          storeHeaders
        )

        expect(response.data.type).toEqual("order")
        expect(response.data.order.total).toEqual(4000)
      })
    })
  },
})
