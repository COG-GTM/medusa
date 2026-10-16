import { IPromotionModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
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

        it("should not lose decrements when spend budget reverts run concurrently", async () => {
          const createdPromotion = await createDefaultPromotion(service, {})

          await service.updateCampaigns({
            id: "campaign-id-1",
            budget: { used: 500, limit: 1000 },
          })

          // Ten concurrent -10 reverts. A read-modify-write revert lets each
          // call read used=500 and write 490, losing the other decrements.
          await Promise.all(
            Array.from({ length: 10 }, () =>
              service.revertUsage(
                [{ amount: 10, code: createdPromotion.code! }],
                { customer_email: null, customer_id: null }
              )
            )
          )

          const campaign = await service.retrieveCampaign("campaign-id-1", {
            relations: ["budget"],
          })

          expect(campaign.budget!.used).toEqual(400)
        })

        it("should keep the spend budget consistent when registrations and reverts run concurrently", async () => {
          const createdPromotion = await createDefaultPromotion(service, {})

          await service.updateCampaigns({
            id: "campaign-id-1",
            budget: { used: 500, limit: 1000 },
          })

          const context = { customer_email: null, customer_id: null }
          const actions = [{ amount: 10, code: createdPromotion.code! }]

          // Five +10 registrations interleaved with five -10 reverts must net out
          await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
              i % 2 === 0
                ? service.registerUsage(actions, context)
                : service.revertUsage(actions, context)
            )
          )

          const campaign = await service.retrieveCampaign("campaign-id-1", {
            relations: ["budget"],
          })

          expect(campaign.budget!.used).toEqual(500)
        })

        it("should not lose decrements when promotion limit reverts run concurrently", async () => {
          const createdPromotion = await createDefaultPromotion(service, {
            limit: 10,
          })

          for (let i = 0; i < 5; i++) {
            await service.registerUsage(
              [{ amount: 10, code: createdPromotion.code! }],
              { customer_email: null, customer_id: null }
            )
          }

          await Promise.all(
            Array.from({ length: 5 }, () =>
              service.revertUsage(
                [{ amount: 10, code: createdPromotion.code! }],
                { customer_email: null, customer_id: null }
              )
            )
          )

          const promotion = await service.retrievePromotion(createdPromotion.id)

          expect(promotion.used).toEqual(0)
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
