import { IPromotionModuleService } from "@medusajs/framework/types"
import { CampaignBudgetType, Modules } from "@medusajs/framework/utils"
import { moduleIntegrationTestRunner, SuiteOptions } from "@medusajs/test-utils"
import { createCampaigns } from "../../../__fixtures__/campaigns"
import { createDefaultPromotion } from "../../../__fixtures__/promotion"

jest.setTimeout(30000)

moduleIntegrationTestRunner({
  moduleName: Modules.PROMOTION,
  testSuite: ({
    MikroOrmWrapper,
    service,
  }: SuiteOptions<IPromotionModuleService>) => {
    describe("Promotion Service: campaign usage", () => {
      beforeEach(async () => {
        await createCampaigns(MikroOrmWrapper.forkManager())
      })

      describe("revertUsage", () => {
        it("should revert usage for type spend", async () => {
          const createdPromotion = await createDefaultPromotion(service, {})
          const createdPromotion2 = await createDefaultPromotion(service, {
            code: "PROMO_2",
            campaign_id: createdPromotion.campaign?.id,
          })
          const createdPromotion3 = await createDefaultPromotion(service, {
            code: "PROMO_3",
            campaign_id: createdPromotion.campaign?.id,
          })

          await service.registerUsage([
            { amount: 200, code: createdPromotion.code! },
            { amount: 100, code: createdPromotion.code! },
          ])

          await service.registerUsage([
            { amount: 100, code: createdPromotion2.code! },
            { amount: 200, code: createdPromotion2.code! },
          ])

          await service.registerUsage([
            { amount: 50, code: createdPromotion3.code! },
            { amount: 250, code: createdPromotion3.code! },
          ])

          await service.revertUsage([
            { amount: 200, code: createdPromotion.code! },
            { amount: 100, code: createdPromotion.code! },
          ])

          await service.revertUsage([
            { amount: 50, code: createdPromotion3.code! },
            { amount: 250, code: createdPromotion3.code! },
          ])

          const campaign = await service.retrieveCampaign(
            createdPromotion.campaign?.id!,
            { relations: ["budget"] }
          )

          expect(campaign.budget).toEqual(
            expect.objectContaining({
              type: "spend",
              limit: 1000,
              used: 300,
            })
          )
        })

        it("should revert usage for type usage", async () => {
          const campaignId = "campaign-id-2"
          const createdPromotion = await createDefaultPromotion(service, {
            code: "PROMO_1",
            campaign_id: campaignId,
          })
          const createdPromotion2 = await createDefaultPromotion(service, {
            code: "PROMO_2",
            campaign_id: campaignId,
          })
          const createdPromotion3 = await createDefaultPromotion(service, {
            code: "PROMO_3",
            campaign_id: campaignId,
          })

          await service.registerUsage([
            { amount: 200, code: createdPromotion.code! },
            { amount: 500, code: createdPromotion.code! },
          ])

          await service.registerUsage([
            { amount: 200, code: createdPromotion2.code! },
            { amount: 500, code: createdPromotion3.code! },
          ])

          await service.revertUsage([
            { amount: 200, code: createdPromotion.code! },
            { amount: 500, code: createdPromotion.code! },
          ])

          await service.revertUsage([
            { amount: 200, code: createdPromotion2.code! },
            { amount: 500, code: createdPromotion3.code! },
          ])

          const campaign = await service.retrieveCampaign(campaignId, {
            relations: ["budget"],
          })

          expect(campaign.budget).toEqual(
            expect.objectContaining({
              type: "usage",
              limit: 1000,
              used: 0,
            })
          )
        })

        it("should not lose decrements when the same promotion usage is reverted concurrently", async () => {
          const [usageCampaign] = await service.createCampaigns([
            {
              name: "concurrent-revert-usage",
              campaign_identifier: "concurrent-revert-usage",
              budget: { type: CampaignBudgetType.USAGE, limit: 10 },
            },
          ])
          const promotion = await createDefaultPromotion(service, {
            code: "CONCURRENT_REVERT",
            campaign_id: usageCampaign.id,
            limit: 10,
          })

          const [attributeCampaign] = await service.createCampaigns([
            {
              name: "concurrent-revert-attribute",
              campaign_identifier: "concurrent-revert-attribute",
              budget: {
                type: CampaignBudgetType.USE_BY_ATTRIBUTE,
                attribute: "customer_id",
                limit: 10,
              },
            },
          ])
          const attributePromotion = await createDefaultPromotion(service, {
            code: "CONCURRENT_REVERT_ATTR",
            campaign_id: attributeCampaign.id,
          })

          const actions = [
            { amount: 100, code: promotion.code! },
            { amount: 100, code: attributePromotion.code! },
          ]
          const context = {
            customer_id: "customer-id-1",
            customer_email: "c1@email.com",
          }
          const uses = 5

          for (let i = 0; i < uses; i++) {
            await service.registerUsage(actions, context)
          }

          await Promise.all(
            Array.from({ length: uses }, () =>
              service.revertUsage(actions, context)
            )
          )

          const revertedPromotion = await service.retrievePromotion(
            promotion.id
          )
          expect(revertedPromotion.used).toBe(0)

          const revertedUsageCampaign = await service.retrieveCampaign(
            usageCampaign.id,
            { relations: ["budget"] }
          )
          expect(revertedUsageCampaign.budget!.used).toBe(0)

          const revertedAttributeCampaign = await service.retrieveCampaign(
            attributeCampaign.id,
            { relations: ["budget", "budget.usages"] }
          )
          expect(revertedAttributeCampaign.budget!.used).toBe(0)
          expect(revertedAttributeCampaign.budget!.usages).toHaveLength(0)
        })

        it("should not throw an error when compute action with code does not exist", async () => {
          const response = await service
            .revertUsage([{ amount: 200, code: "DOESNOTEXIST" }])
            .catch((e) => e)

          expect(response).toEqual(undefined)
        })
      })
    })
  },
})
