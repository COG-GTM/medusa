import "./types"
import { TaxModuleService } from "@services"
import loadProviders from "./loaders/providers"
import { Module, Modules } from "@medusajs/framework/utils"

export default Module(Modules.TAX, {
  service: TaxModuleService,
  loaders: [loadProviders],
})

// Module options types
export {
  MissingTaxRegionBehavior,
  TaxModuleEvents,
  TaxModuleOptions,
} from "./types"
