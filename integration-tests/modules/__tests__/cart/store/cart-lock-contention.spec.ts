import {
  addToCartWorkflow,
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  refreshCartShippingMethodsWorkflow,
  refreshPaymentCollectionForCartWorkflow,
  updateCartWorkflow,
  updateTaxLinesWorkflow,
} from "@medusajs/core-flows"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ICartModuleService,
  IPaymentModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  ITaxModuleService,
} from "@medusajs/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/utils"
import { setTimeout as sleep } from "timers/promises"
import { linkRegionPaymentProviders } from "../../../../helpers/link-region-payment-providers"

jest.setTimeout(200000)

// Longer than the 2s lock timeout cart mutations used to have, so a mutation
// issued while the lock is held only succeeds if it is allowed to wait.
const HOLD_LOCK_FOR_MS = 4000

const env = {}

medusaIntegrationTestRunner({
  env,
  testSuite: ({ getContainer }) => {
    describe("Cart lock contention", () => {
      let appContainer
      let cartModuleService: ICartModuleService
      let regionModuleService: IRegionModuleService
      let scModuleService: ISalesChannelModuleService
      let paymentModule: IPaymentModuleService
      let taxModule: ITaxModuleService
      let query

      let onCompletionValidate: (() => Promise<void>) | undefined
      let onSetTaxLineContext: (() => Promise<void>) | undefined

      beforeAll(async () => {
        appContainer = getContainer()
        cartModuleService = appContainer.resolve(Modules.CART)
        regionModuleService = appContainer.resolve(Modules.REGION)
        scModuleService = appContainer.resolve(Modules.SALES_CHANNEL)
        paymentModule = appContainer.resolve(Modules.PAYMENT)
        taxModule = appContainer.resolve(Modules.TAX)
        query = appContainer.resolve(ContainerRegistrationKeys.QUERY)

        completeCartWorkflow.hooks.validate(async () => {
          await onCompletionValidate?.()
        })
        updateTaxLinesWorkflow.hooks.setTaxLineContext(async () => {
          await onSetTaxLineContext?.()
        })
      })

      afterEach(() => {
        onCompletionValidate = undefined
        onSetTaxLineContext = undefined
      })

      const createCompletableCart = async () => {
        const salesChannel = await scModuleService.createSalesChannels({
          name: "Webshop",
        })

        const region = await regionModuleService.createRegions({
          name: "US",
          currency_code: "usd",
          countries: ["us"],
        })

        await taxModule.createTaxRegions([
          {
            country_code: "us",
            provider_id: "tp_system",
            default_tax_rate: {
              name: "US Default Rate",
              rate: 10,
              code: "US_DEF",
            },
          },
        ])

        await linkRegionPaymentProviders(appContainer, region.id)

        const cart = await cartModuleService.createCarts({
          currency_code: "usd",
          sales_channel_id: salesChannel.id,
          region_id: region.id,
          email: "buyer@medusa.js",
          shipping_address: { country_code: "us" },
        })

        await addToCartWorkflow(appContainer).run({
          input: {
            cart_id: cart.id,
            items: [
              {
                title: "Test item",
                requires_shipping: false,
                is_tax_inclusive: false,
                unit_price: 3000,
                quantity: 1,
              },
            ],
          },
        })

        await createPaymentCollectionForCartWorkflow(appContainer).run({
          input: { cart_id: cart.id },
        })

        const [paymentCollection] = await paymentModule.listPaymentCollections(
          {}
        )

        await createPaymentSessionsWorkflow(appContainer).run({
          input: {
            payment_collection_id: paymentCollection.id,
            provider_id: "pp_system_default",
            context: {},
            data: {},
          },
        })

        return cart
      }

      // Resolves once the hook runs (i.e. the workflow holds the cart lock),
      // then keeps the lock held for HOLD_LOCK_FOR_MS.
      const holdLockInHook = () => {
        let signalLocked: () => void
        const locked = new Promise<void>((resolve) => {
          signalLocked = resolve
        })
        const handler = async () => {
          signalLocked()
          await sleep(HOLD_LOCK_FOR_MS)
        }
        return { locked, handler }
      }

      it("should serialize a tax recalculation behind an in-flight cart completion instead of timing out on the lock", async () => {
        const cart = await createCompletableCart()

        const { locked, handler } = holdLockInHook()
        onCompletionValidate = handler

        const completion = completeCartWorkflow(appContainer).run({
          input: { id: cart.id },
        })

        await locked

        const taxRecalcError = await updateTaxLinesWorkflow(appContainer)
          .run({ input: { cart_id: cart.id } })
          .then(() => undefined)
          .catch((e) => e)

        const { result: order } = await completion

        expect(order.id).toEqual(expect.any(String))
        expect(taxRecalcError?.message).toEqual(
          `Cart ${cart.id} is already completed.`
        )
      })

      it("should serialize a cart update behind an in-flight cart completion instead of timing out on the lock", async () => {
        const cart = await createCompletableCart()

        const { locked, handler } = holdLockInHook()
        onCompletionValidate = handler

        const completion = completeCartWorkflow(appContainer).run({
          input: { id: cart.id },
        })

        await locked

        const updateError = await updateCartWorkflow(appContainer)
          .run({ input: { id: cart.id, email: "changed@medusa.js" } })
          .then(() => undefined)
          .catch((e) => e)

        const { result: order } = await completion

        expect(order.id).toEqual(expect.any(String))
        expect(updateError?.message).toEqual(
          `Cart ${cart.id} is already completed.`
        )
      })

      it.each([
        ["payment collection refresh", refreshPaymentCollectionForCartWorkflow],
        ["shipping methods refresh", refreshCartShippingMethodsWorkflow],
      ])(
        "should serialize a %s behind an in-flight cart completion and reject the completed cart",
        async (_, workflow: any) => {
          const cart = await createCompletableCart()

          const { locked, handler } = holdLockInHook()
          onCompletionValidate = handler

          const completion = completeCartWorkflow(appContainer).run({
            input: { id: cart.id },
          })

          await locked

          const refreshError = await workflow(appContainer)
            .run({ input: { cart_id: cart.id } })
            .then(() => undefined)
            .catch((e) => e)

          const { result: order } = await completion

          expect(order.id).toEqual(expect.any(String))
          expect(refreshError?.message).toEqual(
            `Cart ${cart.id} is already completed.`
          )

          const [paymentCollection] =
            await paymentModule.listPaymentCollections(
              {},
              { relations: ["payment_sessions"] }
            )
          expect(paymentCollection.payment_sessions).toHaveLength(1)
        }
      )

      it("should complete a cart while a tax recalculation is in-flight and both succeed", async () => {
        const cart = await createCompletableCart()

        const { locked, handler } = holdLockInHook()
        onSetTaxLineContext = handler

        const taxRecalc = updateTaxLinesWorkflow(appContainer).run({
          input: { cart_id: cart.id },
        })

        await locked
        onSetTaxLineContext = undefined

        const [, { result: order }] = await Promise.all([
          taxRecalc,
          completeCartWorkflow(appContainer).run({
            input: { id: cart.id },
          }),
        ])

        const {
          data: [placedOrder],
        } = await query.graph({
          entity: "order",
          filters: { id: order.id },
          fields: ["id", "email", "items.tax_lines.rate"],
        })

        expect(placedOrder).toEqual(
          expect.objectContaining({
            id: order.id,
            email: "buyer@medusa.js",
            items: [
              expect.objectContaining({
                tax_lines: [expect.objectContaining({ rate: 10 })],
              }),
            ],
          })
        )
      })
    })
  },
})
