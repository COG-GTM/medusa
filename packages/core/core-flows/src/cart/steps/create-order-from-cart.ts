import { Link } from "@medusajs/framework/modules-sdk"
import type {
  CreateOrderDTO,
  IOrderModuleService,
  LinkDefinition,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

/**
 * The details of the order to create from a cart.
 */
export interface CreateOrderFromCartStepInput {
  /**
   * The ID of the cart the order is created from.
   */
  cart_id: string
  /**
   * The order to create.
   */
  order: CreateOrderDTO
}

export const createOrderFromCartStepId = "create-order-from-cart"
/**
 * This step creates an order from a cart and links the order to the cart in the same step.
 * Linking right away ensures that a retried cart completion finds the existing order
 * instead of creating a duplicate one.
 *
 * @example
 * const data = createOrderFromCartStep({
 *   cart_id: "cart_123",
 *   order: {
 *     region_id: "region_123",
 *     currency_code: "usd",
 *     items: [
 *       {
 *         variant_id: "variant_123",
 *         quantity: 1,
 *         title: "Shirt",
 *         unit_price: 10,
 *       }
 *     ]
 *   }
 * })
 */
export const createOrderFromCartStep = createStep(
  createOrderFromCartStepId,
  async (data: CreateOrderFromCartStepInput, { container }) => {
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
    const link = container.resolve<Link>(ContainerRegistrationKeys.LINK)

    const created = await orderModule.createOrders([data.order])

    const links: LinkDefinition[] = created.map((order) => ({
      [Modules.ORDER]: { order_id: order.id },
      [Modules.CART]: { cart_id: data.cart_id },
    }))

    try {
      await link.create(links)
    } catch (error) {
      await orderModule.deleteOrders(created.map((order) => order.id))
      throw error
    }

    return new StepResponse(created, {
      orderIds: created.map((order) => order.id),
      links,
    })
  },
  async (compensateInput, { container }) => {
    if (!compensateInput?.orderIds?.length) {
      return
    }

    const link = container.resolve<Link>(ContainerRegistrationKeys.LINK)
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)

    await link.dismiss(compensateInput.links)
    await orderModule.deleteOrders(compensateInput.orderIds)
  }
)
