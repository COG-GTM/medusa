/**
 * Gap-styled checkout demo harness.
 *
 * Boots the real Medusa server through medusaIntegrationTestRunner, seeds a
 * small "Gap" catalog, and serves a lightweight storefront + scenario runner
 * on http://localhost:${GAP_DEMO_PORT:-7001}. The process stays alive until
 * killed (or GAP_DEMO_TTL_MS elapses) so a browser can drive real
 * /store requests against whatever branch is checked out.
 *
 * Run (from integration-tests/http):
 *   GAP_DEMO=1 DB_HOST=localhost DB_PORT=5439 DB_USERNAME=postgres \
 *   DB_PASSWORD=postgres DB_TEMP_NAME=medusa-gap-demo \
 *   npx jest --forceExit --testTimeout=86400000 __demo__/gap-checkout
 */
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules, ProductStatus, PromotionType } from "@medusajs/utils"
import { execSync } from "child_process"
import express from "express"
import fs from "fs"
import path from "path"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../helpers/create-admin-user"
import { setupTaxStructure } from "../../../modules/__tests__/fixtures"

const DEMO_PORT = parseInt(process.env.GAP_DEMO_PORT || "7001")
const TTL = parseInt(process.env.GAP_DEMO_TTL_MS || `${6 * 60 * 60 * 1000}`)
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

jest.setTimeout(TTL + 600000)

const gitInfo = () => {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { cwd: __dirname }).toString().trim()
    } catch {
      return ""
    }
  }
  return {
    branch:
      process.env.GAP_DEMO_LABEL || run("git rev-parse --abbrev-ref HEAD"),
    sha: run("git rev-parse --short HEAD"),
    subject: run("git log -1 --format=%s"),
    dirty: run("git status --porcelain -- ../../../../packages") !== "",
  }
}

const CATALOG = [
  {
    handle: "vintage-soft-hoodie",
    title: "Vintage Soft Arch Logo Hoodie",
    color: "#1f3a68",
    kind: "hoodie",
    price: 59.95,
    eur: 54.95,
  },
  {
    handle: "90s-loose-jean",
    title: "90s Loose Jeans",
    color: "#4f6d8f",
    kind: "jean",
    price: 69.95,
    eur: 64.95,
  },
  {
    handle: "everyday-crew-tee",
    title: "Everyday Crewneck T-Shirt",
    color: "#b8462f",
    kind: "tee",
    price: 24.95,
    eur: 22.95,
  },
  {
    handle: "gift-card",
    title: "Gap Gift Card",
    color: "#0b1f3f",
    kind: "giftcard",
    price: 50,
    eur: 50,
    is_giftcard: true,
  },
]

const DEMO_RUN = process.env.GAP_DEMO ? describe : describe.skip

DEMO_RUN("Gap checkout demo harness", () => {
  medusaIntegrationTestRunner({
    testSuite: ({ dbConnection, getContainer, api }) => {
      it("serves the Gap demo storefront", async () => {
        const container = getContainer()
        await createAdminUser(dbConnection, adminHeaders, container)
        const publishableKey = await generatePublishableKey(container)
        const storeHeaders = generateStoreHeaders({ publishableKey })

        const shippingProfile = (
          await api.post(
            `/admin/shipping-profiles`,
            { name: "default", type: "default" },
            adminHeaders
          )
        ).data.shipping_profile

        await setupTaxStructure(container.resolve(Modules.TAX))

        const region = (
          await api.post(
            "/admin/regions",
            {
              name: "United States",
              currency_code: "usd",
              countries: ["us"],
              payment_providers: ["pp_system_default", "pp_system_default_2"],
            },
            adminHeaders
          )
        ).data.region

        const euRegion = (
          await api.post(
            "/admin/regions",
            {
              name: "Europe",
              currency_code: "eur",
              countries: ["de", "dk"],
              payment_providers: ["pp_system_default"],
            },
            adminHeaders
          )
        ).data.region

        const salesChannel = (
          await api.post(
            "/admin/sales-channels",
            { name: "Gap.com", description: "Gap web store" },
            adminHeaders
          )
        ).data.sales_channel

        await api.post(
          `/admin/api-keys/${publishableKey.id}/sales-channels`,
          { add: [salesChannel.id] },
          adminHeaders
        )

        const products: any[] = []
        for (const p of CATALOG) {
          const created = (
            await api.post(
              "/admin/products",
              {
                title: p.title,
                handle: p.handle,
                status: ProductStatus.PUBLISHED,
                is_giftcard: !!p.is_giftcard,
                shipping_profile_id: shippingProfile.id,
                sales_channels: [{ id: salesChannel.id }],
                options: [{ title: "Size", values: ["M"] }],
                variants: [
                  {
                    title: "M",
                    sku: `GAP-${p.handle.toUpperCase()}-M`,
                    options: { Size: "M" },
                    manage_inventory: false,
                    prices: [
                      { amount: p.price, currency_code: "usd" },
                      { amount: p.eur, currency_code: "eur" },
                    ],
                  },
                ],
              },
              adminHeaders
            )
          ).data.product
          products.push({
            ...p,
            id: created.id,
            variant_id: created.variants[0].id,
          })
        }

        const stockLocation = (
          await api.post(
            `/admin/stock-locations`,
            { name: "Gap Fulfillment Center" },
            adminHeaders
          )
        ).data.stock_location

        await api.post(
          `/admin/stock-locations/${stockLocation.id}/sales-channels`,
          { add: [salesChannel.id] },
          adminHeaders
        )

        const fulfillmentSets = (
          await api.post(
            `/admin/stock-locations/${stockLocation.id}/fulfillment-sets?fields=*fulfillment_sets`,
            { name: "Gap shipping", type: "shipping" },
            adminHeaders
          )
        ).data.stock_location.fulfillment_sets

        const fulfillmentSet = (
          await api.post(
            `/admin/fulfillment-sets/${fulfillmentSets[0].id}/service-zones`,
            {
              name: "US + EU",
              geo_zones: [
                { type: "country", country_code: "us" },
                { type: "country", country_code: "de" },
                { type: "country", country_code: "dk" },
              ],
            },
            adminHeaders
          )
        ).data.fulfillment_set

        await api.post(
          `/admin/stock-locations/${stockLocation.id}/fulfillment-providers`,
          { add: ["manual_test-provider"] },
          adminHeaders
        )

        const shippingOption = (
          await api.post(
            `/admin/shipping-options`,
            {
              name: "Standard Shipping (5-7 days)",
              service_zone_id: fulfillmentSet.service_zones[0].id,
              shipping_profile_id: shippingProfile.id,
              provider_id: "manual_test-provider",
              price_type: "flat",
              type: {
                label: "Standard",
                description: "5-7 business days",
                code: "standard",
              },
              prices: [
                { currency_code: "usd", amount: 7 },
                { currency_code: "eur", amount: 7 },
              ],
              rules: [],
            },
            adminHeaders
          )
        ).data.shipping_option

        const promoCodes = [
          {
            code: "GAP40",
            label: "Extra 40% off your bag",
            application_method: {
              type: "percentage",
              target_type: "order",
              allocation: "across",
              value: 40,
              currency_code: "usd",
            },
          },
          {
            code: "BAG10",
            label: "$10 off your bag",
            application_method: {
              type: "fixed",
              target_type: "order",
              allocation: "across",
              value: 10,
              currency_code: "usd",
            },
          },
        ]
        for (const promo of promoCodes) {
          await api.post(
            `/admin/promotions`,
            {
              code: promo.code,
              type: PromotionType.STANDARD,
              status: "active",
              is_automatic: false,
              application_method: promo.application_method,
            },
            adminHeaders
          )
        }

        const seed: Record<string, any> = {
          publishableKey: publishableKey.token,
          region,
          euRegion,
          salesChannel,
          shippingProfile,
          stockLocation,
          shippingOption,
          products,
          promoCodes: promoCodes.map(({ code, label }) => ({ code, label })),
        }

        // Scenario-specific server actions: actions/*.ts|js export
        // { setup?(ctx), [actionName](ctx) }.
        const actionsDir = path.join(__dirname, "actions")
        const actions: Record<string, Function> = {}
        const baseCtx = { container, api, adminHeaders, storeHeaders, seed }
        for (const file of fs.readdirSync(actionsDir).sort()) {
          if (!/\.(ts|js)$/.test(file)) {
            continue
          }
          const mod = require(path.join(actionsDir, file))
          const { setup, ...rest } = mod.default ?? mod
          if (typeof setup === "function") {
            await setup(baseCtx)
          }
          Object.assign(actions, rest)
        }

        const app = express()
        app.use(express.json())
        app.use(express.static(path.join(__dirname, "public")))

        app.get("/demo/config", (_req, res) => {
          const scenarios = fs
            .readdirSync(path.join(__dirname, "public", "scenarios"))
            .filter((f) => f.endsWith(".js"))
            .sort()
          res.json({
            git: gitInfo(),
            seed: {
              ...seed,
              publishableKey: undefined,
            },
            scenarios,
            actions: Object.keys(actions),
          })
        })

        app.post("/demo/action/:name", async (req, res) => {
          const fn = actions[req.params.name]
          if (!fn) {
            return res
              .status(404)
              .json({ message: `Unknown action ${req.params.name}` })
          }
          try {
            const result = await fn({ ...baseCtx, body: req.body ?? {} })
            res.json({ ok: true, result: result ?? null })
          } catch (e: any) {
            res.status(400).json({
              ok: false,
              type: e?.type,
              message: e?.response?.data?.message ?? e?.message ?? String(e),
            })
          }
        })

        app.all("/store/*", async (req, res) => {
          try {
            const response = await api.request({
              method: req.method,
              url: req.originalUrl,
              data: req.body,
              headers: storeHeaders.headers,
              validateStatus: () => true,
            })
            res.status(response.status).json(response.data)
          } catch (e: any) {
            res.status(500).json({ message: e?.message ?? String(e) })
          }
        })

        const server = app.listen(DEMO_PORT)
        // eslint-disable-next-line no-console
        console.log(
          `\n\n  Gap demo storefront ready: http://localhost:${DEMO_PORT}\n` +
            `  git: ${JSON.stringify(gitInfo())}\n\n`
        )

        await new Promise((resolve) => setTimeout(resolve, TTL))
        server.close()
      })
    },
  })
})
