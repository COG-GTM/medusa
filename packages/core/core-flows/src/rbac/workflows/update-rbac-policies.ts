import { isDefined } from "@medusajs/framework/utils"
import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { UpdateRbacPolicyDTO } from "@medusajs/types"
import { useQueryGraphStep } from "../../common"
import { updateRbacPoliciesStep } from "../steps/update-rbac-policies"
import { validateUserPermissionsStep } from "../steps/validate-user-permissions"

/**
 * @ignore
 * @featureFlag rbac
 */
export type UpdateRbacPoliciesWorkflowInput = {
  actor_id?: string
  actor?: string
  selector: Record<string, any>
  update: Omit<UpdateRbacPolicyDTO, "id">
}

/**
 * @ignore
 * @featureFlag rbac
 */
export const updateRbacPoliciesWorkflowId = "update-rbac-policies"

/**
 * @ignore
 * @featureFlag rbac
 */
export const updateRbacPoliciesWorkflow = createWorkflow(
  updateRbacPoliciesWorkflowId,
  (input: WorkflowData<UpdateRbacPoliciesWorkflowInput>) => {
    when({ input }, ({ input }) => {
      return (
        !!input.actor_id &&
        (isDefined(input.update.resource) || isDefined(input.update.operation))
      )
    }).then(() => {
      const { data: policies } = useQueryGraphStep({
        entity: "rbac_policy",
        fields: ["id", "resource", "operation"],
        filters: input.selector,
      }).config({ name: "get-rbac-policies-to-update" })

      // For every policy whose grant actually changes, the actor must hold
      // both the current grant and the resulting one.
      const validationData = transform(
        { input, policies },
        ({ input, policies }) => {
          const actions = policies.flatMap((policy) => {
            const resource = isDefined(input.update.resource)
              ? input.update.resource.toLowerCase()
              : policy.resource
            const operation = isDefined(input.update.operation)
              ? input.update.operation.toLowerCase()
              : policy.operation

            if (
              resource === policy.resource &&
              operation === policy.operation
            ) {
              return []
            }

            return [
              { resource: policy.resource, operation: policy.operation },
              { resource, operation },
            ]
          })

          return {
            actor_id: input.actor_id!,
            actor: input.actor,
            actions,
          }
        }
      )

      validateUserPermissionsStep(validationData)
    })

    return new WorkflowResponse(updateRbacPoliciesStep(input))
  }
)
