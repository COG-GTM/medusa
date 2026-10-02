import { isDefined, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

/**
 * The details of the cart lock to renew.
 */
export interface RenewCompleteCartLockStepInput {
  /**
   * The ID of the cart whose lock is renewed.
   */
  key: string
  /**
   * The ID of the lock's owner. The lock is only renewed if it's still owned by this owner,
   * or if it has expired and no other owner has acquired it since.
   */
  ownerId?: string
  /**
   * The new expiration time (in seconds) of the lock, starting from now.
   */
  ttl: number
}

export const renewCompleteCartLockStepId = "renew-complete-cart-lock"
/**
 * This step renews the lock acquired by the complete cart workflow, giving the next steps
 * a fresh expiration window. If the lock has been acquired by another owner in the meantime,
 * the step throws an error so the workflow doesn't proceed without holding the lock.
 *
 * The lock isn't released when this step is compensated. It's released by the
 * compensation of the step that originally acquired it.
 *
 * @example
 * const data = renewCompleteCartLockStep({
 *   key: "cart_123",
 *   ownerId: "complete-cart:transaction_123",
 *   ttl: 300,
 * })
 */
export const renewCompleteCartLockStep = createStep(
  renewCompleteCartLockStepId,
  async (
    data: RenewCompleteCartLockStepInput,
    { container, parentStepIdempotencyKey }
  ) => {
    const isSubWorkflow = !!parentStepIdempotencyKey
    if (isSubWorkflow || !isDefined(data.ownerId)) {
      return StepResponse.skip() as any
    }

    const locking = container.resolve(Modules.LOCKING)

    try {
      await locking.acquire(data.key, {
        expire: data.ttl,
        ownerId: data.ownerId,
      })
    } catch (e) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Cart is already being completed by another request"
      )
    }

    return new StepResponse(void 0)
  }
)
