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
  moduleOptions: {
    missing_tax_region_behavior: "throw",
  },
  injectedDependencies: {
    [Modules.EVENT_BUS]: new MockEventBusService(),
  },
  testSuite: ({ service }) => {
    describe("TaxModuleService - missing_tax_region_behavior: throw", () => {
      it("should throw INVALID_DATA when no tax region matches the address", async () => {
        const error = await service
          .getTaxLines([item], calculationContext)
          .catch((e) => e)

        expect(error).toBeInstanceOf(MedusaError)
        expect(error.type).toEqual(MedusaError.Types.INVALID_DATA)
        expect(error.message).toEqual(
          "No tax region found for country code: it"
        )
      })
    })
  },
})
