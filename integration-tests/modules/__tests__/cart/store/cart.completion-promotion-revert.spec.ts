import {
  addToCartWorkflow,
  authorizePaymentSessionStepId,
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartPromotionsWorkflow,
} from "@medusajs/core-flows"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  CreatePromotionDTO,
  ICartModuleService,
  IPromotionModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
} from "@medusajs/types"
import {
  CampaignBudgetType,
  ContainerRegistrationKeys,
  Modules,
  PromotionActions,
  PromotionStatus,
  PromotionType,
} from "@medusajs/utils"
import { linkRegionPaymentProviders } from "../../../../helpers/link-region-payment-providers"

jest.setTimeout(200000)

const env = {}

medusaIntegrationTestRunner({
  env,
  testSuite: ({ getContainer }) => {
    describe("CompleteCartWorkflow: promotion usage revert on failure", () => {
      let appContainer
      let cartModuleService: ICartModuleService
      let regionModuleService: IRegionModuleService
      let scModuleService: ISalesChannelModuleService
      let promotionModule: IPromotionModuleService
      let query

      beforeAll(async () => {
        appContainer = getContainer()
        cartModuleService = appContainer.resolve(Modules.CART)
        regionModuleService = appContainer.resolve(Modules.REGION)
        scModuleService = appContainer.resolve(Modules.SALES_CHANNEL)
        promotionModule = appContainer.resolve(Modules.PROMOTION)
        query = appContainer.resolve(ContainerRegistrationKeys.QUERY)
      })

      const applicationMethod = {
        type: "fixed",
        target_type: "items",
        allocation: "across",
        value: 500,
        currency_code: "usd",
      } as CreatePromotionDTO["application_method"]

      const prepareCart = async (promoCode: string) => {
        const salesChannel = await scModuleService.createSalesChannels({
          name: "Webshop",
        })

        const region = await regionModuleService.createRegions({
          name: "US",
          currency_code: "usd",
        })

        await linkRegionPaymentProviders(appContainer, region.id)

        const cart = await cartModuleService.createCarts({
          currency_code: "usd",
          sales_channel_id: salesChannel.id,
          region_id: region.id,
          email: "buyer@medusa.test",
        })

        await addToCartWorkflow(appContainer).run({
          input: {
            items: [
              {
                title: "Test item",
                requires_shipping: false,
                is_discountable: true,
                is_tax_inclusive: false,
                unit_price: 3000,
                quantity: 1,
              },
            ],
            cart_id: cart.id,
          },
        })

        await updateCartPromotionsWorkflow(appContainer).run({
          input: {
            cart_id: cart.id,
            promo_codes: [promoCode],
            action: PromotionActions.ADD,
          },
        })

        await createPaymentCollectionForCartWorkflow(appContainer).run({
          input: { cart_id: cart.id },
        })

        const {
          data: [cartWithCollection],
        } = await query.graph({
          entity: "cart",
          fields: ["payment_collection.id"],
          filters: { id: cart.id },
        })

        return {
          cart,
          paymentCollection: cartWithCollection.payment_collection,
        }
      }

      const createSession = async (paymentCollectionId: string) => {
        await createPaymentSessionsWorkflow(appContainer).run({
          input: {
            payment_collection_id: paymentCollectionId,
            provider_id: "pp_system_default",
            context: {},
            data: {},
          },
        })
      }

      const failAfterAuthorization = async (cartId: string) => {
        const workflow = completeCartWorkflow(appContainer)

        workflow.appendAction("throw", authorizePaymentSessionStepId, {
          invoke: async function failStep() {
            throw new Error("Simulated payment authorization failure")
          },
        })

        const { errors } = await workflow.run({
          input: { id: cartId },
          throwOnError: false,
        })

        return errors
      }

      const getOrdersForCart = async (cartId: string) => {
        const { data } = await query.graph({
          entity: "order_cart",
          fields: ["order_id"],
          filters: { cart_id: cartId },
        })
        return data
      }

      it("should revert promotion.used when completion fails after usage registration so the code can be used again", async () => {
        const promotion = await promotionModule.createPromotions({
          code: "LIMIT_ONE",
          type: PromotionType.STANDARD,
          status: PromotionStatus.ACTIVE,
          limit: 1,
          application_method: applicationMethod,
        })

        const { cart, paymentCollection } = await prepareCart(promotion.code!)
        await createSession(paymentCollection.id)

        const errors = await failAfterAuthorization(cart.id)

        expect(errors[0].error.message).toBe(
          "Simulated payment authorization failure"
        )

        const reverted = await promotionModule.retrievePromotion(promotion.id)
        expect(reverted.used).toBe(0)
        expect(await getOrdersForCart(cart.id)).toHaveLength(0)

        const { cart: secondCart, paymentCollection: secondCollection } =
          await prepareCart(promotion.code!)
        await createSession(secondCollection.id)

        const { result } = await completeCartWorkflow(appContainer).run({
          input: { id: secondCart.id },
        })

        expect(result.id).toEqual(expect.any(String))

        const used = await promotionModule.retrievePromotion(promotion.id)
        expect(used.used).toBe(1)
      })

      it("should revert a usage campaign budget when completion fails after usage registration", async () => {
        const [campaign] = await promotionModule.createCampaigns([
          {
            name: "usage-campaign",
            campaign_identifier: "usage-campaign",
            budget: {
              type: CampaignBudgetType.USAGE,
              limit: 1,
            },
          },
        ])

        const promotion = await promotionModule.createPromotions({
          code: "USAGE_BUDGET_ONE",
          type: PromotionType.STANDARD,
          status: PromotionStatus.ACTIVE,
          campaign_id: campaign.id,
          application_method: applicationMethod,
        })

        const { cart, paymentCollection } = await prepareCart(promotion.code!)
        await createSession(paymentCollection.id)

        await failAfterAuthorization(cart.id)

        const revertedCampaign = await promotionModule.retrieveCampaign(
          campaign.id,
          { relations: ["budget"] }
        )
        expect(revertedCampaign.budget!.used).toBe(0)

        const { cart: secondCart, paymentCollection: secondCollection } =
          await prepareCart(promotion.code!)
        await createSession(secondCollection.id)

        await completeCartWorkflow(appContainer).run({
          input: { id: secondCart.id },
        })

        const usedCampaign = await promotionModule.retrieveCampaign(
          campaign.id,
          { relations: ["budget"] }
        )
        expect(usedCampaign.budget!.used).toBe(1)
      })

      it("should revert a use-by-attribute campaign budget when completion fails after usage registration", async () => {
        const [campaign] = await promotionModule.createCampaigns([
          {
            name: "attribute-campaign",
            campaign_identifier: "attribute-campaign",
            budget: {
              type: CampaignBudgetType.USE_BY_ATTRIBUTE,
              attribute: "customer_email",
              limit: 1,
            },
          },
        ])

        const promotion = await promotionModule.createPromotions({
          code: "PER_EMAIL_ONE",
          type: PromotionType.STANDARD,
          status: PromotionStatus.ACTIVE,
          campaign_id: campaign.id,
          application_method: applicationMethod,
        })

        const { cart, paymentCollection } = await prepareCart(promotion.code!)
        await createSession(paymentCollection.id)

        await failAfterAuthorization(cart.id)

        const revertedCampaign = await promotionModule.retrieveCampaign(
          campaign.id,
          { relations: ["budget", "budget.usages"] }
        )
        expect(revertedCampaign.budget!.used).toBe(0)
        expect(revertedCampaign.budget!.usages ?? []).toHaveLength(0)

        const { cart: secondCart, paymentCollection: secondCollection } =
          await prepareCart(promotion.code!)
        await createSession(secondCollection.id)

        await completeCartWorkflow(appContainer).run({
          input: { id: secondCart.id },
        })

        const usedCampaign = await promotionModule.retrieveCampaign(
          campaign.id,
          { relations: ["budget", "budget.usages"] }
        )
        expect(usedCampaign.budget!.used).toBe(1)
        expect(usedCampaign.budget!.usages).toEqual([
          expect.objectContaining({
            attribute_value: "buyer@medusa.test",
            used: 1,
          }),
        ])
      })
    })
  },
})
