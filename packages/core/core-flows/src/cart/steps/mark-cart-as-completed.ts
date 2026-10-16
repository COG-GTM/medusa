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

// Matches the TTL of the cart completion lock: a claim older than this belongs to
// a completion that was abandoned (e.g. the process crashed) and can be reclaimed.
const ABANDONED_CLAIM_TTL_MS = 2 * 60 * 1000

export const markCartAsCompletedStepId = "mark-cart-as-completed"
/**
 * This step atomically marks a cart as completed. It throws a conflict error if the
 * cart was already completed, which guarantees that only one of several concurrent
 * completions of the same cart can place an order. A cart marked as completed more
 * than two minutes ago without an order is considered abandoned and can be claimed again.
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

    const isMarked = await cartModule.markCartAsCompleted(data.id, {
      reclaimCompletedBefore: new Date(Date.now() - ABANDONED_CLAIM_TTL_MS),
    })

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
