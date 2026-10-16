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
 * - The cart's region has countries and the shipping address's country isn't one of them.
 * - A tax line of an item or shipping method was calculated from a tax rate whose tax region
 * doesn't match the shipping address's country or province, meaning the tax lines are stale.
 * - A tax line was calculated from a country-level rate, but the shipping address's province has a
 * default tax rate, which takes precedence.
 * - The region has automatic taxes enabled, the shipping address resolves to a tax region with a
 * default tax rate, and an item (other than a gift card) or shipping method has no tax lines.
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

    const regionCountries = (region.countries ?? []).map((country) =>
      normalizeCode(country?.iso_2)
    )

    // A region without countries doesn't restrict the shipping address.
    if (regionCountries.length && !regionCountries.includes(countryCode)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Country with code ${countryCode} is not within region ${region.name}`
      )
    }

    const taxLineOwners: {
      id: string
      tax_lines?: { tax_rate_id?: string | null }[]
    }[] = [
      ...(cart.items ?? []).filter((item) => !item.is_giftcard),
      ...(cart.shipping_methods ?? []),
    ]
    const taxRateIds = [
      ...new Set(
        taxLineOwners
          .flatMap((owner) => owner.tax_lines ?? [])
          .map((taxLine) => taxLine.tax_rate_id)
          .filter((id): id is string => !!id)
      ),
    ]

    const { data: countryTaxRegions } = await query.graph({
      entity: "tax_region",
      fields: ["id", "province_code", "tax_rates.is_default"],
      filters: { country_code: countryCode },
    })

    const hasDefaultTaxRate = (taxRegion: (typeof countryTaxRegions)[0]) =>
      (taxRegion.tax_rates ?? []).some((taxRate) => taxRate?.is_default)

    // The tax module always prefers a province's default rate over any
    // country-level rate.
    const provinceHasDefaultTaxRate =
      !!provinceCode &&
      countryTaxRegions.some(
        (taxRegion) =>
          normalizeCode(taxRegion.province_code) === provinceCode &&
          hasDefaultTaxRate(taxRegion)
      )

    const staleTaxLinesError = new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The tax lines of cart ${cart.id} don't match its shipping address (${addressDescription}). Recalculate the cart's taxes before completing it.`
    )

    if (taxRateIds.length) {
      const { data: taxRates } = await query.graph({
        entity: "tax_rate",
        fields: ["id", "tax_region.country_code", "tax_region.province_code"],
        filters: { id: taxRateIds },
      })

      const taxRateRegions = new Map(
        taxRates
          .filter((taxRate) => !!taxRate.tax_region)
          .map((taxRate) => [
            taxRate.id,
            {
              country: normalizeCode(taxRate.tax_region.country_code),
              province: normalizeCode(taxRate.tax_region.province_code),
            },
          ])
      )

      for (const owner of taxLineOwners) {
        const rateRegions = (owner.tax_lines ?? [])
          .map((taxLine) => taxRateRegions.get(taxLine.tax_rate_id!))
          .filter((rateRegion) => !!rateRegion)

        if (!rateRegions.length) {
          continue
        }

        const hasMismatchingRate = rateRegions.some(
          (rateRegion) =>
            rateRegion.country !== countryCode ||
            (!!rateRegion.province && rateRegion.province !== provinceCode)
        )
        const isMissingProvinceRate =
          provinceHasDefaultTaxRate &&
          !rateRegions.some((rateRegion) => !!rateRegion.province)

        if (hasMismatchingRate || isMissingProvinceRate) {
          throw staleTaxLinesError
        }
      }
    }

    if (!region.automatic_taxes) {
      return new StepResponse(void 0)
    }

    const ownersWithoutTaxLines = taxLineOwners.filter(
      (owner) => !owner.tax_lines?.length
    )

    if (!ownersWithoutTaxLines.length) {
      return new StepResponse(void 0)
    }

    // A default rate applies to every item and shipping method, so they must
    // all have tax lines.
    const requiresTaxLines =
      provinceHasDefaultTaxRate ||
      countryTaxRegions.some(
        (taxRegion) => !taxRegion.province_code && hasDefaultTaxRate(taxRegion)
      )

    if (requiresTaxLines) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `The line items or shipping methods ${ownersWithoutTaxLines
          .map((owner) => owner.id)
          .join(", ")} of cart ${
          cart.id
        } are missing tax lines required for its shipping address (${addressDescription}). Recalculate the cart's taxes before completing it.`
      )
    }

    return new StepResponse(void 0)
  }
)
