import {
  ChangeActionType,
  MathBN,
  MedusaError,
} from "@medusajs/framework/utils"
import { OrderChangeProcessing } from "../calculate-order-change"
import { getItemQuantityAvailable } from "../item-quantity-available"
import { setActionReference } from "../set-action-reference"

OrderChangeProcessing.registerActionType(ChangeActionType.WRITE_OFF_ITEM, {
  operation({ action, currentOrder, options }) {
    const existing = currentOrder.items.find(
      (item) => item.id === action.details.reference_id
    )!

    existing.detail.written_off_quantity ??= 0
    existing.detail.written_off_quantity = MathBN.add(
      existing.detail.written_off_quantity,
      action.details.quantity
    )

    setActionReference(existing, action, options)
  },
  validate({ action, actions, currentOrder, options }) {
    const refId = action.details?.reference_id
    if (refId == null) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Details reference ID is required."
      )
    }

    const existing = currentOrder.items.find((item) => item.id === refId)

    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Item ID "${refId}" not found.`
      )
    }

    if (!action.details?.quantity) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Quantity to write-off item ${refId} is required.`
      )
    }

    const quantityAvailable = getItemQuantityAvailable({
      detail: existing.detail,
      action,
      actions,
      claimReturnedQuantity: options?.claimReturnedQuantities?.[refId],
    })
    const greater = MathBN.gt(action.details?.quantity, quantityAvailable)
    if (greater) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cannot claim more items than what was fulfilled for item ${refId}.`
      )
    }
  },
})
