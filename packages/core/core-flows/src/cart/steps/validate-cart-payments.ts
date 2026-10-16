import type { CartWorkflowDTO } from "@medusajs/framework/types"
import {
  isDefined,
  isPresent,
  MathBN,
  MedusaError,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { listRegionPaymentProviderIds } from "../../payment-collection/utils/region-payment-providers"

/**
 * The cart's details.
 */
export interface ValidateCartPaymentsStepInput {
  /**
   * The cart to validate payment sessions for.
   */
  cart: CartWorkflowDTO
}

export const validateCartPaymentsStepId = "validate-cart-payments"
/**
 * This step validates a cart's payment sessions. Their status must
 * be `pending`, `requires_more`, `authorized`, or `captured`, and their payment
 * provider must be enabled in the cart's region. If not valid, the step throws an error.
 *
 * The step skips the validation only if the cart's credit lines cover the full amount due after
 * promotions, or if the cart's original total is zero. A cart whose total is reduced to zero or
 * less by promotions alone still requires a payment session.
 *
 * :::tip
 *
 * You can use the {@link retrieveCartStep} to retrieve a cart's details.
 *
 * :::
 *
 * @example
 * const data = validateCartPaymentsStep({
 *   // retrieve the details of the cart from another workflow
 *   // or in another step using the Cart Module's service
 *   cart
 * })
 */
export const validateCartPaymentsStep = createStep(
  validateCartPaymentsStepId,
  async (data: ValidateCartPaymentsStepInput, { container }) => {
    const {
      cart: {
        payment_collection: paymentCollection,
        total,
        original_total,
        credit_line_total,
        region_id: regionId,
      },
    } = data

    // Amount owed after promotions, before credit lines are applied
    const amountDueBeforeCreditLines = MathBN.add(total, credit_line_total)

    const isCoveredByCreditLines =
      MathBN.gt(credit_line_total, 0) &&
      MathBN.gt(amountDueBeforeCreditLines, 0) &&
      MathBN.lte(total, 0)

    // Genuinely free carts (e.g. zero-priced items without shipping costs)
    // have nothing to collect. Carts driven to zero by promotions still
    // require a payment session.
    const isNothingOwed =
      isDefined(original_total) && MathBN.lte(original_total, 0)

    const canSkipPayment = isCoveredByCreditLines || isNothingOwed

    if (canSkipPayment) {
      return new StepResponse([])
    }

    if (!isPresent(paymentCollection)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Payment collection has not been initiated for cart`
      )
    }

    // We check if any of these payment sessions are present in the cart
    // If not, we throw an error for the consumer to provide a processable payment session
    const processablePaymentStatuses = [
      PaymentSessionStatus.PENDING,
      PaymentSessionStatus.REQUIRES_MORE,
      PaymentSessionStatus.AUTHORIZED, // E.g. payment was authorized, but the cart was not completed
      PaymentSessionStatus.CAPTURED, // E.g. payment was captured, but the cart was not completed
      PaymentSessionStatus.PENDING_AUTHORIZATION, // E.g. async payment method, authorization is deferred
    ]

    const paymentsToProcess = paymentCollection.payment_sessions?.filter((ps) =>
      processablePaymentStatuses.includes(ps.status as PaymentSessionStatus)
    )

    if (!paymentsToProcess?.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Payment sessions are required to complete cart`
      )
    }

    if (regionId) {
      const enabledProviderIds = await listRegionPaymentProviderIds(
        container,
        regionId
      )

      const disabledProviderIds = Array.from(
        new Set(
          paymentsToProcess
            .map((ps) => ps.provider_id)
            .filter((providerId) => !enabledProviderIds.has(providerId))
        )
      )

      if (disabledProviderIds.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Payment provider${
            disabledProviderIds.length > 1 ? "s" : ""
          } ${disabledProviderIds.join(", ")} ${
            disabledProviderIds.length > 1 ? "are" : "is"
          } not enabled in the cart's region ${regionId}.`
        )
      }
    }

    return new StepResponse(paymentsToProcess)
  }
)
