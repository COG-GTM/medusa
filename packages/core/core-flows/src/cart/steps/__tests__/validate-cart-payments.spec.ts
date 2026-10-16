import { MedusaContainer } from "@medusajs/framework"
import { createContainer } from "@medusajs/framework/awilix"
import { PaymentSessionStatus } from "@medusajs/framework/utils"
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk"
import { validateCartPaymentsStep } from "../validate-cart-payments"

const workflow = createWorkflow(
  "validate-cart-payments-step-test",
  (input: any) => {
    const result = validateCartPaymentsStep({ cart: input.cart })
    return new WorkflowResponse(result)
  }
)

const runWith = async (container: MedusaContainer, cart: any) => {
  return await workflow(container).run({
    input: { cart },
    throwOnError: false,
  })
}

describe("validateCartPaymentsStep", () => {
  let container!: MedusaContainer

  beforeAll(() => {
    container = createContainer() as unknown as MedusaContainer
  })

  it("should require a payment collection when promotions drive the total to zero without credit lines", async () => {
    const { errors } = await runWith(container, {
      id: "cart_1",
      original_total: 2500,
      discount_total: 2500,
      credit_line_total: 0,
      total: 0,
    })

    expect(errors[0].error.message).toEqual(
      "Payment collection has not been initiated for cart"
    )
  })

  it("should require a payment collection when promotions drive the total below zero", async () => {
    const { errors } = await runWith(container, {
      id: "cart_1",
      original_total: 2500,
      discount_total: 3000,
      credit_line_total: 0,
      total: -500,
    })

    expect(errors[0].error.message).toEqual(
      "Payment collection has not been initiated for cart"
    )
  })

  it("should require a payment collection when credit lines do not cover any amount due", async () => {
    const { errors } = await runWith(container, {
      id: "cart_1",
      original_total: 2500,
      discount_total: 2500,
      credit_line_total: 1,
      total: -1,
    })

    expect(errors[0].error.message).toEqual(
      "Payment collection has not been initiated for cart"
    )
  })

  it("should require a payment collection when credit lines only partially cover the total", async () => {
    const { errors } = await runWith(container, {
      id: "cart_1",
      original_total: 2500,
      discount_total: 0,
      credit_line_total: 1000,
      total: 1500,
    })

    expect(errors[0].error.message).toEqual(
      "Payment collection has not been initiated for cart"
    )
  })

  it("should skip payment when credit lines cover the amount due", async () => {
    const { result, errors } = await runWith(container, {
      id: "cart_1",
      original_total: 2500,
      discount_total: 105,
      credit_line_total: 2395,
      total: 0,
    })

    expect(errors).toEqual([])
    expect(result).toEqual([])
  })

  it("should skip payment when nothing is owed on a zero-priced cart", async () => {
    const { result, errors } = await runWith(container, {
      id: "cart_1",
      original_total: 0,
      discount_total: 0,
      credit_line_total: 0,
      total: 0,
    })

    expect(errors).toEqual([])
    expect(result).toEqual([])
  })

  it("should return processable payment sessions for a zero total cart driven by promotions", async () => {
    const { result, errors } = await runWith(container, {
      id: "cart_1",
      original_total: 2500,
      discount_total: 2500,
      credit_line_total: 0,
      total: 0,
      payment_collection: {
        id: "pay_col_1",
        payment_sessions: [
          {
            id: "payses_1",
            provider_id: "pp_system_default",
            status: PaymentSessionStatus.PENDING,
          },
        ],
      },
    })

    expect(errors).toEqual([])
    expect(result).toEqual([expect.objectContaining({ id: "payses_1" })])
  })
})
