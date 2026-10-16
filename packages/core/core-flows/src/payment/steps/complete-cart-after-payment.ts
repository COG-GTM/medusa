import { Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { completeCartWorkflowId } from "../../cart/workflows/complete-cart"

/**
 * The data to complete a cart after a payment is captured.
 */
export type CompleteCartAfterPaymentStepInput = {
  /**
   * The ID of the cart to complete.
   */
  cart_id: string
}

/**
 * The result of completing a cart after a payment is captured.
 */
export type CompleteCartAfterPaymentStepOutput = {
  /**
   * The ID of the order placed for the cart, if the completion succeeded.
   */
  order_id?: string
  /**
   * The details of the error, if the completion failed.
   */
  error?: {
    /**
     * The error's message.
     */
    message: string
    /**
     * The error's name.
     */
    name?: string
    /**
     * The error's type, such as a `MedusaError` type.
     */
    type?: string
  }
}

const toErrorDetails = (
  error: any
): NonNullable<CompleteCartAfterPaymentStepOutput["error"]> => ({
  message: error?.message ?? String(error),
  name: error?.name,
  type: error?.type,
})

export const completeCartAfterPaymentStepId = "complete-cart-after-payment-step"
/**
 * This step completes a cart after a payment is captured. A completion failure
 * doesn't fail the step. Instead, the error is returned so that the caller can
 * handle it, for example by emitting an alert event.
 */
export const completeCartAfterPaymentStep = createStep(
  completeCartAfterPaymentStepId,
  async (input: CompleteCartAfterPaymentStepInput, { container }) => {
    const workflowEngine = container.resolve(Modules.WORKFLOW_ENGINE)

    try {
      const { errors, result } = await workflowEngine.run(
        completeCartWorkflowId,
        {
          input: {
            id: input.cart_id,
          },
          throwOnError: false,
        }
      )

      if (errors?.length) {
        return new StepResponse<CompleteCartAfterPaymentStepOutput>({
          error: toErrorDetails(errors[0].error),
        })
      }

      return new StepResponse<CompleteCartAfterPaymentStepOutput>({
        order_id: result?.id,
      })
    } catch (error) {
      return new StepResponse<CompleteCartAfterPaymentStepOutput>({
        error: toErrorDetails(error),
      })
    }
  }
)
