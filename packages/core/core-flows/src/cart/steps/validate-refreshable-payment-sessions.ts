import { MedusaError, PaymentSessionStatus } from "@medusajs/framework/utils"
import { createStep } from "@medusajs/framework/workflows-sdk"

/**
 * The payment sessions to validate before they're deleted.
 */
export interface ValidateRefreshablePaymentSessionsStepInput {
  /**
   * The ID of the cart whose payment collection is being refreshed.
   */
  cart_id: string
  /**
   * The payment sessions that are about to be deleted.
   */
  payment_sessions: {
    /**
     * The ID of the payment session.
     */
    id: string
    /**
     * The status of the payment session.
     */
    status?: PaymentSessionStatus | string
  }[]
}

/**
 * The payment session statuses that indicate the customer is authorizing, or has
 * authorized, the payment. Sessions in these statuses must not be deleted when
 * refreshing a cart's payment collection.
 */
export const NON_REFRESHABLE_PAYMENT_SESSION_STATUSES: string[] = [
  PaymentSessionStatus.AUTHORIZED,
  PaymentSessionStatus.CAPTURED,
  PaymentSessionStatus.PENDING_AUTHORIZATION,
]

export const validateRefreshablePaymentSessionsStepId =
  "validate-refreshable-payment-sessions"
/**
 * This step validates that the payment sessions to be deleted when refreshing a cart's
 * payment collection aren't `authorized`, `captured`, or `pending_authorization`.
 * If any of them is, the step throws an error.
 *
 * @example
 * const data = validateRefreshablePaymentSessionsStep({
 *   cart_id: "cart_123",
 *   payment_sessions: [{ id: "payses_123", status: "pending" }],
 * })
 */
export const validateRefreshablePaymentSessionsStep = createStep(
  validateRefreshablePaymentSessionsStepId,
  async (data: ValidateRefreshablePaymentSessionsStepInput) => {
    const nonRefreshable = (data.payment_sessions ?? []).filter((ps) =>
      NON_REFRESHABLE_PAYMENT_SESSION_STATUSES.includes(ps.status as string)
    )

    if (nonRefreshable.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cannot update the payment collection of cart ${
          data.cart_id
        } because its payment session(s) are being or have been authorized: ${nonRefreshable
          .map((ps) => `${ps.id} (${ps.status})`)
          .join(", ")}. Complete the cart or cancel the payment before changing the cart's total.`
      )
    }
  }
)
