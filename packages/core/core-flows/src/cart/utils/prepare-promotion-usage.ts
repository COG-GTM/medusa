import type {
  BigNumberInput,
  CartWorkflowDTO,
  UsageComputedActions,
} from "@medusajs/framework/types"
import { MathBN } from "@medusajs/framework/utils"

type AdjustmentLike = {
  code?: string | null
  amount: BigNumberInput
}

/**
 * Builds the promotion usage to register for a cart from its item and
 * shipping method adjustments. Adjustments without a promotion code (e.g.
 * manual adjustments) are skipped, and adjustments sharing a code are merged
 * into a single entry whose amount is the sum of the merged amounts.
 */
export function preparePromotionUsageComputedActions(
  cart: Pick<CartWorkflowDTO, "items" | "shipping_methods">
): UsageComputedActions[] {
  const adjustments = [
    ...(cart.items ?? []).flatMap((item) => item.adjustments ?? []),
    ...(cart.shipping_methods ?? []).flatMap(
      (method) => method.adjustments ?? []
    ),
  ] as AdjustmentLike[]

  const usageByCode = new Map<string, UsageComputedActions>()

  for (const adjustment of adjustments) {
    const code = adjustment?.code

    if (typeof code !== "string" || !code.length) {
      continue
    }

    const existing = usageByCode.get(code)

    if (!existing) {
      usageByCode.set(code, { code, amount: adjustment.amount })
      continue
    }

    existing.amount = MathBN.add(existing.amount, adjustment.amount).toNumber()
  }

  return Array.from(usageByCode.values())
}
