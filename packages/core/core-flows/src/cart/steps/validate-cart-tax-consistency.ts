import type { CartWorkflowDTO } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

/**
 * The data to validate that a cart's region, shipping address, and tax lines are consistent.
 */
export interface ValidateCartTaxConsistencyStepInput {
  /**
   * The cart to validate. It must include its `region_id`, `shipping_address`,
   * `items.tax_lines`, and `shipping_methods.tax_lines`.
   */
  cart: Pick<
    CartWorkflowDTO,
    "id" | "region_id" | "shipping_address" | "items" | "shipping_methods"
  >
}

const normalizeCode = (code?: string | null) => code?.toLowerCase() || null

export const validateCartTaxConsistencyStepId = "validate-cart-tax-consistency"
/**
 * This step validates that a cart's shipping address and tax lines are consistent
 * with its region before the cart is completed. It throws an error if:
 *
 * - The shipping address's country doesn't belong to the cart's region.
 * - A tax line of an item or shipping method was calculated from a tax rate whose tax region
 * doesn't match the shipping address's country or province, meaning the tax lines are stale.
 * - The region has automatic taxes enabled, the shipping address resolves to a tax region with a
 * default tax rate, and an item has no tax lines.
 *
 * If the cart has no shipping address country, the step doesn't perform any validation.
 *
 * @example
 * validateCartTaxConsistencyStep({
 *   cart: {
 *     id: "cart_123",
 *     region_id: "reg_123",
 *     shipping_address: {
 *       id: "addr_123",
 *       country_code: "us",
 *       province: "ca",
 *     },
 *     items: [],
 *     shipping_methods: [],
 *   }
 * })
 */
export const validateCartTaxConsistencyStep = createStep(
  validateCartTaxConsistencyStepId,
  async (data: ValidateCartTaxConsistencyStepInput, { container }) => {
    const { cart } = data
    const countryCode = normalizeCode(cart.shipping_address?.country_code)

    if (!cart.region_id || !countryCode) {
      return new StepResponse(void 0)
    }

    const provinceCode = normalizeCode(cart.shipping_address?.province)
    const addressDescription = provinceCode
      ? `country: ${countryCode}, province: ${provinceCode}`
      : `country: ${countryCode}`

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const {
      data: [region],
    } = await query.graph({
      entity: "region",
      fields: ["id", "name", "automatic_taxes", "countries.iso_2"],
      filters: { id: cart.region_id },
    })

    if (!region) {
      return new StepResponse(void 0)
    }

    const countryInRegion = (region.countries ?? []).some(
      (country) => normalizeCode(country?.iso_2) === countryCode
    )

    if (!countryInRegion) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Country with code ${countryCode} is not within region ${region.name}`
      )
    }

    const taxLines = [
      ...(cart.items ?? []).flatMap((item) => item.tax_lines ?? []),
      ...(cart.shipping_methods ?? []).flatMap((sm) => sm.tax_lines ?? []),
    ]
    const taxRateIds = [
      ...new Set(
        taxLines
          .map((taxLine) => taxLine.tax_rate_id)
          .filter((id): id is string => !!id)
      ),
    ]

    if (taxRateIds.length) {
      const { data: taxRates } = await query.graph({
        entity: "tax_rate",
        fields: ["id", "tax_region.country_code", "tax_region.province_code"],
        filters: { id: taxRateIds },
      })

      const hasStaleTaxLines = taxRates.some((taxRate) => {
        const taxRegion = taxRate.tax_region
        if (!taxRegion) {
          return false
        }

        const rateProvince = normalizeCode(taxRegion.province_code)
        return (
          normalizeCode(taxRegion.country_code) !== countryCode ||
          (!!rateProvince && rateProvince !== provinceCode)
        )
      })

      if (hasStaleTaxLines) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `The tax lines of cart ${cart.id} don't match its shipping address (${addressDescription}). Recalculate the cart's taxes before completing it.`
        )
      }
    }

    if (!region.automatic_taxes) {
      return new StepResponse(void 0)
    }

    const itemsWithoutTaxLines = (cart.items ?? []).filter(
      (item) => !item.tax_lines?.length
    )

    if (!itemsWithoutTaxLines.length) {
      return new StepResponse(void 0)
    }

    const { data: countryTaxRegions } = await query.graph({
      entity: "tax_region",
      fields: ["id", "province_code", "tax_rates.is_default"],
      filters: { country_code: countryCode },
    })

    const taxRegions = countryTaxRegions.filter((taxRegion) => {
      const regionProvince = normalizeCode(taxRegion.province_code)
      return !regionProvince || regionProvince === provinceCode
    })

    if (!taxRegions.some((taxRegion) => !taxRegion.province_code)) {
      return new StepResponse(void 0)
    }

    const hasDefaultTaxRate = taxRegions.some((taxRegion) =>
      (taxRegion.tax_rates ?? []).some((taxRate) => taxRate?.is_default)
    )

    if (hasDefaultTaxRate) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `The line items ${itemsWithoutTaxLines
          .map((item) => item.id)
          .join(", ")} of cart ${
          cart.id
        } are missing tax lines required for its shipping address (${addressDescription}). Recalculate the cart's taxes before completing it.`
      )
    }

    return new StepResponse(void 0)
  }
)
