import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export const getCompleteCartLockOwnerStepId = "get-complete-cart-lock-owner"
/**
 * This step returns the owner ID used by the complete cart workflow to acquire, extend,
 * and release the cart's lock. The owner ID is derived from the workflow's transaction ID, so
 * only the transaction that acquired the lock can extend or release it.
 *
 * @example
 * const lockOwnerId = getCompleteCartLockOwnerStep()
 */
export const getCompleteCartLockOwnerStep = createStep(
  getCompleteCartLockOwnerStepId,
  async (_, { transactionId }) => {
    return new StepResponse(
      transactionId ? `complete-cart:${transactionId}` : undefined
    )
  }
)
