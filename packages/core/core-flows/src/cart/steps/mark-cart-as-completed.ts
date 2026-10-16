import { ICartModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

/**
 * The details of the cart to mark as completed.
 */
export interface MarkCartAsCompletedStepInput {
  /**
   * The ID of the cart to mark as completed.
   */
  id: string
}

export const markCartAsCompletedStepId = "mark-cart-as-completed"
/**
 * This step atomically marks a cart as completed. It throws a conflict error if the
 * cart was already completed, which guarantees that only one of several concurrent
 * completions of the same cart can place an order.
 *
 * @example
 * markCartAsCompletedStep({
 *   id: "cart_123",
 * })
 */
export const markCartAsCompletedStep = createStep(
  markCartAsCompletedStepId,
  async (data: MarkCartAsCompletedStepInput, { container }) => {
    const cartModule = container.resolve<ICartModuleService>(Modules.CART)

    const isMarked = await cartModule.markCartAsCompleted(data.id)

    if (!isMarked) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `Cart ${data.id} is already being completed by another request`
      )
    }

    return new StepResponse(void 0, data.id)
  },
  async (cartId, { container }) => {
    if (!cartId) {
      return
    }

    const cartModule = container.resolve<ICartModuleService>(Modules.CART)

    await cartModule.updateCarts(cartId, { completed_at: null })
  }
)
