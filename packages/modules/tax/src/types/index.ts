import {
  ModuleProviderExports,
  ModuleServiceInitializeOptions,
} from "@medusajs/framework/types"

/**
 * Events emitted by the Tax Module that are not tied to a data model mutation.
 */
export const TaxModuleEvents = {
  /**
   * Emitted when tax lines are requested for an address whose country has no
   * tax region. Payload: `{ country_code: string, province_code: string | null }`.
   */
  TAX_REGION_MISSING: "tax.region_missing",
} as const

/**
 * How `getTaxLines` behaves when no tax region matches the address' country.
 *
 * - `warn` (default): log a warning, emit the `tax.region_missing` event, and return no tax lines.
 * - `throw`: throw a `MedusaError` of type `INVALID_DATA`.
 * - `ignore`: silently return no tax lines.
 */
export type MissingTaxRegionBehavior = "warn" | "throw" | "ignore"

export type TaxModuleOptions = Partial<ModuleServiceInitializeOptions> & {
  /**
   * Providers to be registered
   */
  providers?: {
    /**
     * The module provider to be registered
     */
    resolve: string | ModuleProviderExports
    /**
     * The id of the provider
     */
    id: string
    /**
     * key value pair of the configuration to be passed to the provider constructor
     */
    options?: Record<string, unknown>
  }[]
  /**
   * How to handle tax calculation for an address whose country has no tax region.
   *
   * @defaultValue "warn"
   */
  missing_tax_region_behavior?: MissingTaxRegionBehavior
}

declare module "@medusajs/types" {
  interface ModuleOptions {
    "@medusajs/tax": TaxModuleOptions
    "@medusajs/medusa/tax": TaxModuleOptions
  }
}
