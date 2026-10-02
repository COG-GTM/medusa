import { ITaxModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
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
  moduleOptions: {
    missing_tax_region_behavior: "ignore",
  },
  injectedDependencies: {
    [Modules.EVENT_BUS]: new MockEventBusService(),
  },
  testSuite: ({ service }) => {
    describe("TaxModuleService - missing_tax_region_behavior: ignore", () => {
      it("should return no tax lines without emitting an event", async () => {
        const eventBusSpy = jest.spyOn(MockEventBusService.prototype, "emit")

        const taxLines = await service.getTaxLines([item], calculationContext)

        expect(taxLines).toEqual([])
        expect(eventBusSpy).not.toHaveBeenCalled()

        eventBusSpy.mockRestore()
      })
    })
  },
})
