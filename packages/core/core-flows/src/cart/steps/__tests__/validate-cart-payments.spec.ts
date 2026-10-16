import { MedusaContainer } from "@medusajs/framework"
import { asFunction, createContainer } from "@medusajs/framework/awilix"
import {
  ContainerRegistrationKeys,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk"
import { validateCartPaymentsStep } from "../validate-cart-payments"

const buildCart = (
  sessions: { id: string; status: PaymentSessionStatus }[]
): any => ({
  id: "cart_1",
  region_id: "reg_1",
  total: 3000,
  credit_line_total: 0,
  payment_collection: {
    id: "paycol_1",
    payment_sessions: sessions.map((session) => ({
      ...session,
      provider_id: "pp_system_default",
    })),
  },
})

describe("validateCartPaymentsStep", () => {
  let container!: MedusaContainer

  const workflow = createWorkflow(
    "validate-cart-payments-step-test",
    (input: { cart: any; order_id?: string }) => {
      const result = validateCartPaymentsStep({
        cart: input.cart,
        order_id: input.order_id,
      })
      return new WorkflowResponse(result)
    }
  )

  beforeAll(() => {
    container = createContainer() as unknown as MedusaContainer
    container.register(
      ContainerRegistrationKeys.QUERY,
      asFunction(() => {
        return {
          graph: () =>
            Promise.resolve({
              data: [{ payment_providers: [{ id: "pp_system_default" }] }],
            }),
        } as any
      })
    )
  })

  it("should return the single processable payment session", async () => {
    const { result } = await workflow(container).run({
      input: {
        cart: buildCart([{ id: "ps_1", status: PaymentSessionStatus.PENDING }]),
      },
    })

    expect(result.map((ps) => ps.id)).toEqual(["ps_1"])
  })

  it("should ignore payment sessions that are not processable", async () => {
    const { result } = await workflow(container).run({
      input: {
        cart: buildCart([
          { id: "ps_1", status: PaymentSessionStatus.ERROR },
          { id: "ps_2", status: PaymentSessionStatus.PENDING },
          { id: "ps_3", status: PaymentSessionStatus.CANCELED },
        ]),
      },
    })

    expect(result.map((ps) => ps.id)).toEqual(["ps_2"])
  })

  it("should reject a cart with more than one processable payment session", async () => {
    const { errors } = await workflow(container).run({
      input: {
        cart: buildCart([
          { id: "ps_1", status: PaymentSessionStatus.PENDING },
          { id: "ps_2", status: PaymentSessionStatus.AUTHORIZED },
        ]),
      },
      throwOnError: false,
    })

    expect(errors).toHaveLength(1)
    expect(errors[0].error).toEqual(
      expect.objectContaining({
        type: "invalid_data",
        message:
          "Cart cart_1 has more than one processable payment session (ps_1, ps_2). Only one payment session can be authorized per cart.",
      })
    )
  })

  it("should allow multiple processable payment sessions when the cart already has an order", async () => {
    const { result } = await workflow(container).run({
      input: {
        cart: buildCart([
          { id: "ps_1", status: PaymentSessionStatus.AUTHORIZED },
          { id: "ps_2", status: PaymentSessionStatus.PENDING },
        ]),
        order_id: "order_1",
      },
    })

    expect(result.map((ps) => ps.id)).toEqual(["ps_1", "ps_2"])
  })
})
