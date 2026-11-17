import { BigNumberInput } from "@medusajs/framework/types"
import { ChangeActionType, MathBN } from "@medusajs/framework/utils"
import { InternalOrderChangeEvent, VirtualOrder } from "@types"

type OrderItemDetail = VirtualOrder["items"][number]["detail"]

const sumQuantities = (
  actions: InternalOrderChangeEvent[],
  type: string,
  claimId: string
) =>
  actions
    .filter((a) => a.action === type && a.claim_id === claimId)
    .reduce(
      (acc, a) => MathBN.add(acc, a.details?.quantity ?? 0),
      MathBN.convert(0)
    )

const minBN = (a: BigNumberInput, b: BigNumberInput) =>
  MathBN.lt(a, b) ? MathBN.convert(a) : MathBN.convert(b)

/**
 * Returns how many fulfilled units of an item are still free to be returned
 * or claimed by the given action.
 *
 * A unit counts as used once it is in a return (requested, received or
 * dismissed) or written off by a claim. A claim that writes off and returns
 * the same unit uses it once, so the units a claim both writes off and
 * returns are only counted once: `claimReturnedQuantity` holds that overlap
 * for claims already confirmed, and the overlap inside the current order
 * change is derived from its actions.
 */
export function getItemQuantityAvailable({
  detail,
  action,
  actions,
  claimReturnedQuantity,
}: {
  detail: OrderItemDetail | undefined
  action: InternalOrderChangeEvent
  actions: InternalOrderChangeEvent[]
  claimReturnedQuantity?: BigNumberInput
}) {
  const dismissed = detail?.return_dismissed_quantity ?? 0

  const returned = MathBN.add(
    detail?.return_requested_quantity ?? 0,
    detail?.return_received_quantity ?? 0,
    dismissed
  )
  // damaged returns write off the units they dismiss, which are already
  // counted as returned
  const writtenOffByClaims = MathBN.sub(
    detail?.written_off_quantity ?? 0,
    dismissed
  )
  const claimed = MathBN.gt(writtenOffByClaims, 0)
    ? writtenOffByClaims
    : MathBN.convert(0)

  const referenceId = action.details?.reference_id
  const index = actions.indexOf(action)
  const previous = (index === -1 ? [] : actions.slice(0, index)).filter(
    (a) => a.details?.reference_id === referenceId && a.claim_id
  )

  let overlap = MathBN.convert(claimReturnedQuantity ?? 0)
  const claimIds = new Set(previous.map((a) => a.claim_id!))
  for (const claimId of claimIds) {
    overlap = MathBN.add(
      overlap,
      minBN(
        sumQuantities(previous, ChangeActionType.WRITE_OFF_ITEM, claimId),
        sumQuantities(previous, ChangeActionType.RETURN_ITEM, claimId)
      )
    )
  }

  // the overlap can't be more than the units still counted as both returned
  // and claimed
  overlap = minBN(overlap, minBN(returned, claimed))

  let quantityAvailable = MathBN.sub(
    detail?.fulfilled_quantity ?? 0,
    MathBN.sub(MathBN.add(returned, claimed), overlap)
  )

  // the units this claim already wrote off can also be returned by it, and
  // the reverse
  if (action.claim_id) {
    const writtenOff = sumQuantities(
      previous,
      ChangeActionType.WRITE_OFF_ITEM,
      action.claim_id
    )
    const returnedByClaim = sumQuantities(
      previous,
      ChangeActionType.RETURN_ITEM,
      action.claim_id
    )
    const uncovered =
      action.action === ChangeActionType.RETURN_ITEM
        ? MathBN.sub(writtenOff, returnedByClaim)
        : MathBN.sub(returnedByClaim, writtenOff)

    if (MathBN.gt(uncovered, 0)) {
      quantityAvailable = MathBN.add(quantityAvailable, uncovered)
    }
  }

  return quantityAvailable
}
