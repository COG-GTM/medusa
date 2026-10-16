import type { CartWorkflowDTO } from "@medusajs/framework/types"
import {
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
  /**
   * The ID of the order already placed for the cart, if any. A retried completion
   * doesn't authorize payment again, so multiple processable sessions are allowed.
   */
  order_id?: string
}

export const validateCartPaymentsStepId = "validate-cart-payments"
/**
 * This step validates a cart's payment sessions. Exactly one session must have
 * a processable status (`pending`, `requires_more`, `authorized`, `captured`, or
 * `pending_authorization`), and its payment provider must be enabled in the cart's
 * region. If not valid, the step throws an error.
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
        credit_line_total,
        region_id: regionId,
      },
    } = data

    const canSkipPayment =
      MathBN.convert(credit_line_total).gte(0) && MathBN.convert(total).lte(0)

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

    // Cart completion authorizes exactly one payment session. Authorizing more
    // than one could charge the customer multiple times, so we reject the cart
    // instead of silently picking one. Carts with an order are skipped so retries
    // still return the existing order, as no authorization happens for them.
    if (paymentsToProcess.length > 1 && !data.order_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cart ${
          data.cart.id
        } has more than one processable payment session (${paymentsToProcess
          .map((ps) => ps.id)
          .join(", ")}). Only one payment session can be authorized per cart.`
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
