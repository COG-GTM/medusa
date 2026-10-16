import { MedusaContainer } from "@medusajs/framework"
import { asValue, createContainer } from "@medusajs/framework/awilix"
import { Modules } from "@medusajs/framework/utils"
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk"
import { getItemTaxLinesStep } from "../get-item-tax-lines"

describe("getItemTaxLinesStep", () => {
  let container!: MedusaContainer
  const getTaxLines = jest.fn()

  const workflow = createWorkflow(
    "get-item-tax-lines-step-giftcard-test",
    (input: any) => {
      return new WorkflowResponse(getItemTaxLinesStep(input))
    }
  )

  const orderOrCart = {
    id: "cart_123",
    currency_code: "usd",
    region: { automatic_taxes: true },
    shipping_address: { country_code: "us" },
  }

  beforeEach(() => {
    getTaxLines.mockReset()
    getTaxLines.mockResolvedValue([])

    container = createContainer() as unknown as MedusaContainer
    container.register(Modules.TAX, asValue({ getTaxLines }))
  })

  it("should only exclude items explicitly flagged as gift cards from taxation", async () => {
    await workflow(container).run({
      input: {
        orderOrCart,
        items: [
          { id: "item_undefined", quantity: 1, unit_price: 100 },
          { id: "item_null", is_giftcard: null, quantity: 1, unit_price: 100 },
          { id: "item_false", is_giftcard: false, quantity: 1, unit_price: 100 },
          { id: "item_true", is_giftcard: true, quantity: 1, unit_price: 100 },
        ],
        shipping_methods: [],
      },
    })

    expect(getTaxLines).toHaveBeenCalledTimes(1)

    const taxedItemIds = getTaxLines.mock.calls[0][0].map((item) => item.id)
    expect(taxedItemIds).toEqual(["item_undefined", "item_null", "item_false"])
  })
})
