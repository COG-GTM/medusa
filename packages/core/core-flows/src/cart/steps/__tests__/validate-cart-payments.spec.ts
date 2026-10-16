import { MedusaContainer } from "@medusajs/framework"
import { createContainer } from "@medusajs/framework/awilix"
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk"
import { validateCartPaymentsStep } from "../validate-cart-payments"

const buildCart = ({
  total,
  collectionAmount,
  sessionAmount,
}: {
  total: number
  collectionAmount: number
  sessionAmount: number
}) =>
  ({
    id: "cart_123",
    total,
    raw_total: { value: `${total}`, precision: 20 },
    credit_line_total: 0,
    payment_collection: {
      id: "paycol_123",
      amount: collectionAmount,
      raw_amount: { value: `${collectionAmount}`, precision: 20 },
      payment_sessions: [
        {
          id: "payses_123",
          amount: sessionAmount,
          status: "pending",
          provider_id: "pp_system_default",
        },
      ],
    },
  } as any)

describe("validateCartPaymentsStep", () => {
  let container!: MedusaContainer

  const workflow = createWorkflow(
    "validate-cart-payments-step-test",
    (input: any) => {
      const result = validateCartPaymentsStep({ cart: input.cart })
      return new WorkflowResponse(result)
    }
  )

  beforeAll(() => {
    container = createContainer() as unknown as MedusaContainer
  })

  it("should return the payment sessions when amounts match the cart total", async () => {
    const { result } = await workflow(container).run({
      input: {
        cart: buildCart({
          total: 3000,
          collectionAmount: 3000,
          sessionAmount: 3000,
        }),
      },
    })

    expect(result).toEqual([expect.objectContaining({ id: "payses_123" })])
  })

  it("should throw when the payment collection amount is stale", async () => {
    const { errors } = await workflow(container).run({
      input: {
        cart: buildCart({
          total: 4000,
          collectionAmount: 3000,
          sessionAmount: 3000,
        }),
      },
      throwOnError: false,
    })

    expect(errors[0].error).toEqual(
      expect.objectContaining({
        type: "invalid_data",
        message:
          "Payment collection paycol_123 amount (3000) does not match the cart total (4000). Refresh the cart's payment collection and payment sessions before completing the cart.",
      })
    )
  })

  it("should throw when the payment session amount is stale", async () => {
    const { errors } = await workflow(container).run({
      input: {
        cart: buildCart({
          total: 4000,
          collectionAmount: 4000,
          sessionAmount: 3000,
        }),
      },
      throwOnError: false,
    })

    expect(errors[0].error).toEqual(
      expect.objectContaining({
        type: "invalid_data",
        message:
          "Payment session payses_123 amount (3000) does not match the cart total (4000). Refresh the cart's payment sessions before completing the cart.",
      })
    )
  })

  it("should skip validation when the cart total is zero", async () => {
    const { result } = await workflow(container).run({
      input: {
        cart: buildCart({
          total: 0,
          collectionAmount: 3000,
          sessionAmount: 3000,
        }),
      },
    })

    expect(result).toEqual([])
  })

  it("should only validate the payment session that will be authorized", async () => {
    const cart = buildCart({
      total: 4000,
      collectionAmount: 4000,
      sessionAmount: 4000,
    })
    cart.payment_collection.payment_sessions.push({
      id: "payses_456",
      amount: 3000,
      status: "pending",
      provider_id: "pp_system_default",
    })

    const { result } = await workflow(container).run({
      input: { cart },
    })

    expect(result).toEqual([
      expect.objectContaining({ id: "payses_123" }),
      expect.objectContaining({ id: "payses_456" }),
    ])
  })

  it("should skip amount validation when the cart is already completed", async () => {
    const cart = buildCart({
      total: 4000,
      collectionAmount: 3000,
      sessionAmount: 3000,
    })
    cart.completed_at = new Date()

    const { result } = await workflow(container).run({
      input: { cart },
    })

    expect(result).toEqual([expect.objectContaining({ id: "payses_123" })])
  })
})
