import { ITaxModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  MockEventBusService,
  moduleIntegrationTestRunner,
} from "@medusajs/test-utils"

jest.setTimeout(30000)

const item = {
  id: "item_test",
  product_id: "product_id_test",
  quantity: 1,
}

const calculationContext = {
  address: {
    country_code: "IT",
  },
}

moduleIntegrationTestRunner<ITaxModuleService>({
  moduleName: Modules.TAX,
  injectedDependencies: {
    [Modules.EVENT_BUS]: new MockEventBusService(),
  },
  testSuite: ({ service }) => {
    describe("TaxModuleService - getTaxLines without a matching tax region", () => {
      afterEach(() => {
        jest.restoreAllMocks()
      })

      it("should emit a tax.region_missing event when no tax region matches the address", async () => {
        await service.createTaxRegions([
          {
            country_code: "US",
            provider_id: "tp_system",
            default_tax_rate: { name: "US Default", rate: 2, code: "US" },
          },
        ])

        const eventBusSpy = jest.spyOn(MockEventBusService.prototype, "emit")

        const taxLines = await service.getTaxLines([item], calculationContext)

        expect(taxLines).toEqual([])
        expect(eventBusSpy).toHaveBeenCalledWith(
          [
            expect.objectContaining({
              name: "tax.region_missing",
              data: { country_code: "it", province_code: null },
            }),
          ],
          { internal: true }
        )
      })

      it("should not emit tax.region_missing when a tax region matches the address", async () => {
        await service.createTaxRegions([
          {
            country_code: "IT",
            provider_id: "tp_system",
            default_tax_rate: { name: "IT Default", rate: 22, code: "IT" },
          },
        ])

        const eventBusSpy = jest.spyOn(MockEventBusService.prototype, "emit")

        const taxLines = await service.getTaxLines([item], calculationContext)

        expect(taxLines).toEqual([
          expect.objectContaining({ line_item_id: item.id, rate: 22 }),
        ])
        expect(eventBusSpy).not.toHaveBeenCalledWith(
          [expect.objectContaining({ name: "tax.region_missing" })],
          expect.anything()
        )
      })
    })
  },
})
