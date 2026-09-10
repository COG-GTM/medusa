import {
  DmlEntity,
  DMLEntitySchemaBuilder,
  model,
} from "@medusajs/framework/utils"
import { OrderShippingMethod } from "./shipping-method"

const _OrderShippingMethodTaxLine = model
  .define(
    {
      tableName: "order_shipping_method_tax_line",
      name: "OrderShippingMethodTaxLine",
    },
    {
      id: model.id({ prefix: "ordsmtxl" }).primaryKey(),
      description: model.text().nullable(),
      tax_rate_id: model.text().nullable(),
      code: model.text(),
      rate: model.bigNumber(),
      provider_id: model.text().nullable(),
      metadata: model.json().nullable(),
      data: model.json().nullable(),
      shipping_method: model.belongsTo<() => typeof OrderShippingMethod>(
        () => OrderShippingMethod,
        {
          mappedBy: "tax_lines",
        }
      ),
    }
  )
  .indexes([
    {
      name: "IDX_order_shipping_method_tax_line_shipping_method_id",
      on: ["shipping_method_id"],
      unique: false,
    },
  ])

interface OrderShippingMethodTaxLineModel
  extends DmlEntity<
    DMLEntitySchemaBuilder<(typeof _OrderShippingMethodTaxLine)["schema"]>,
    {
      tableName: "order_shipping_method_tax_line"
      name: "OrderShippingMethodTaxLine"
    }
  > {}

export const OrderShippingMethodTaxLine: OrderShippingMethodTaxLineModel =
  _OrderShippingMethodTaxLine
