/* Gap checkout demo storefront + scenario runner. Talks to the real Medusa
 * store API through the harness proxy (/store/*) and to scenario-specific
 * server actions through /demo/action/:name. */
;(function () {
  const $ = (id) => document.getElementById(id)
  const scenarios = []
  let config = null
  let cart = null
  let lastOrder = null

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const STEP_DELAY = parseInt(
    new URLSearchParams(location.search).get("delay") || "900"
  )

  const money = (v, cur) => {
    const n =
      typeof v === "object" && v !== null
        ? Number(v.value ?? v)
        : Number(v ?? 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (cur || cart?.currency_code || "usd").toUpperCase(),
    }).format(n)
  }

  const log = (cls, text) => {
    const d = document.createElement("div")
    d.className = cls
    d.textContent = text
    $("log").appendChild(d)
    $("log").scrollTop = $("log").scrollHeight
  }

  const toast = (t) => {
    $("toast").textContent = t
    $("toast").classList.add("show")
    clearTimeout(toast._t)
    toast._t = setTimeout(() => $("toast").classList.remove("show"), 2200)
  }

  const pulse = (el) => {
    if (!el) return
    el.classList.add("pulse")
    setTimeout(() => el.classList.remove("pulse"), 1100)
  }

  async function http(method, path, body) {
    const started = performance.now()
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let data = null
    try {
      data = await res.json()
    } catch (e) {
      data = null
    }
    const ms = Math.round(performance.now() - started)
    const isBk = path.startsWith("/demo/action")
    log(
      isBk ? "bk" : `s${String(res.status)[0]}`,
      `${isBk ? "BACKSTAGE " : ""}${method} ${path.split("?")[0]} -> ${
        res.status
      } (${ms}ms)${
        res.status >= 400 && data?.message ? " " + data.message : ""
      }`
    )
    return { status: res.status, ok: res.ok, data }
  }

  const CART_FIELDS =
    "fields=+completed_at,+credit_line_total,*items,*items.tax_lines,*items.adjustments,*shipping_methods,*shipping_methods.tax_lines,*promotions,*payment_collection,*payment_collection.payment_sessions,*shipping_address,*region"

  const garment = (p, size = 90) => {
    const c = p.color
    const shapes = {
      hoodie: `<path d="M30 20 L45 10 Q50 22 55 10 L70 20 L85 40 L75 48 L70 40 L70 90 L30 90 L30 40 L25 48 L15 40 Z" fill="${c}"/><text x="50" y="62" font-size="11" text-anchor="middle" fill="#fff" font-family="Georgia" letter-spacing="2">GAP</text>`,
      jean: `<path d="M32 10 L68 10 L72 90 L54 90 L50 35 L46 90 L28 90 Z" fill="${c}"/><rect x="32" y="10" width="36" height="6" fill="#3a5573"/>`,
      tee: `<path d="M30 18 L42 12 Q50 20 58 12 L70 18 L84 32 L74 40 L68 34 L68 88 L32 88 L32 34 L26 40 L16 32 Z" fill="${c}"/>`,
      giftcard: `<rect x="14" y="28" width="72" height="44" rx="4" fill="${c}"/><text x="50" y="56" font-size="13" text-anchor="middle" fill="#fff" font-family="Georgia" letter-spacing="3">GAP</text>`,
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100">${
      shapes[p.kind] || shapes.tee
    }</svg>`
  }

  function renderGrid() {
    $("grid").innerHTML = config.seed.products
      .map(
        (p) => `
      <div class="card" id="card-${p.handle}">
        <div class="img">${garment(p, 110)}</div>
        <div class="title">${p.title}</div>
        <div class="price">${money(p.price, "usd")}</div>
        <div class="add">ADD TO BAG</div>
      </div>`
      )
      .join("")
  }

  function showView(name) {
    document
      .querySelectorAll(".view")
      .forEach((v) => v.classList.remove("active"))
    $(`view-${name}`).classList.add("active")
  }

  function renderCart() {
    if (!cart) {
      $("bag-count").textContent = "0"
      return
    }
    const cur = cart.currency_code
    $("bag-count").textContent = String(
      (cart.items || []).reduce((a, i) => a + Number(i.quantity), 0)
    )
    const productByVariant = Object.fromEntries(
      config.seed.products.map((p) => [p.variant_id, p])
    )
    $("bag-lines").innerHTML =
      (cart.items || [])
        .map((i) => {
          const p = productByVariant[i.variant_id] || {
            kind: "tee",
            color: "#999",
          }
          const taxes = (i.tax_lines || [])
            .map(
              (t) => `<span class="tag">${t.code || "tax"} ${t.rate}%</span>`
            )
            .join("")
          const noTax = i.is_giftcard
            ? `<span class="tag">gift card - not taxed</span>`
            : !(i.tax_lines || []).length
            ? `<span class="tag warn">no tax line</span>`
            : ""
          const adj = (i.adjustments || [])
            .map(
              (a) =>
                `<span class="tag">${a.code || "promo (no code)"} -${money(
                  a.amount,
                  cur
                )}</span>`
            )
            .join("")
          return `<div class="line"><div class="thumb">${garment(p, 36)}</div>
        <div class="meta">${
          i.title || i.product_title
        }<small>Size M &middot; Qty ${i.quantity} &middot; ${money(
            i.unit_price,
            cur
          )} each</small>${taxes}${noTax}${adj}</div>
        <div class="lp">${money(i.total ?? i.subtotal, cur)}</div></div>`
        })
        .join("") || `<div class="muted">Your bag is empty</div>`

    const a = cart.shipping_address
    $("address-box").innerHTML =
      a && a.country_code
        ? `${a.first_name || ""} ${a.last_name || ""}<br/>${
            a.address_1 || ""
          }, ${a.city || ""} ${a.province ? a.province.toUpperCase() : ""} ${
            a.postal_code || ""
          } <b>${(
            a.country_code || ""
          ).toUpperCase()}</b> <span class="tag">region: ${
            cart.region?.name || cart.region_id
          }</span>`
        : `<span class="muted">Not entered yet</span>`
    $("address-box").className = a && a.country_code ? "" : "muted"

    const sm = (cart.shipping_methods || [])[0]
    $("delivery-box").innerHTML = sm
      ? `${sm.name} &middot; ${money(sm.amount, cur)}`
      : `<span class="muted">Not selected</span>`

    const pc = cart.payment_collection
    if (pc) {
      const sessions = (pc.payment_sessions || [])
        .map((s) => {
          const stale = Number(s.amount) !== Number(cart.total)
          return `<div class="line"><div class="meta">${
            s.provider_id
          }<small>session ${s.id.slice(-8)} &middot; ${
            s.status
          }</small></div><div class="lp">${money(s.amount, cur)} ${
            stale ? '<span class="tag warn">differs from total</span>' : ""
          }</div></div>`
        })
        .join("")
      $("payment-box").innerHTML = `Payment collection ${money(
        pc.amount,
        cur
      )} ${
        Number(pc.amount) !== Number(cart.total)
          ? '<span class="tag warn">stale vs bag total</span>'
          : '<span class="tag">matches bag</span>'
      }${sessions}`
    } else {
      $("payment-box").innerHTML = `<span class="muted">Not started</span>`
    }

    $("promo-chips").innerHTML = (cart.promotions || [])
      .map((p) => `<span class="chip">${p.code} applied</span>`)
      .join("")
    $("sum-subtotal").textContent = money(
      cart.item_subtotal ?? cart.subtotal,
      cur
    )
    $("sum-discount").textContent = "-" + money(cart.discount_total, cur)
    $("sum-shipping").textContent = money(cart.shipping_total, cur)
    $("sum-tax").textContent = money(cart.tax_total, cur)
    const credit = Number(cart.credit_line_total || 0)
    $("credit-row").style.display = credit ? "" : "none"
    $("sum-credit").textContent = "-" + money(credit, cur)
    $("sum-total").textContent = money(cart.total, cur)
    $("place-order").disabled = !(cart.items || []).length
  }

  const shop = {
    ctx: {},
    sleep,
    toast,
    http,
    get cart() {
      return cart
    },
    get config() {
      return config
    },
    get lastOrder() {
      return lastOrder
    },
    product(handle) {
      const p = config.seed.products.find(
        (x) => x.handle === handle || x.kind === handle
      )
      if (!p) throw new Error(`Unknown product ${handle}`)
      return p
    },
    async refresh(cartId) {
      const id = cartId || cart?.id
      if (!id) return null
      const r = await http("GET", `/store/carts/${id}?${CART_FIELDS}`)
      if (r.ok) {
        cart = r.data.cart
        renderCart()
      }
      return cart
    },
    async newCart(opts = {}) {
      const r = await http("POST", `/store/carts`, {
        region_id: opts.region_id || config.seed.region.id,
        sales_channel_id: config.seed.salesChannel.id,
        email: opts.email || "shopper@gap-demo.com",
        ...(opts.body || {}),
      })
      if (!r.ok)
        throw new Error(r.data?.message || `create cart failed (${r.status})`)
      cart = r.data.cart
      lastOrder = null
      $("confirm").classList.add("hidden")
      $("order-banner").innerHTML = ""
      await shop.refresh()
      return cart
    },
    async addToBag(handle, quantity = 1) {
      const p = shop.product(handle)
      showView("browse")
      pulse($(`card-${p.handle}`))
      await sleep(Math.min(STEP_DELAY, 700))
      if (!cart || cart.completed_at) await shop.newCart()
      const r = await http("POST", `/store/carts/${cart.id}/line-items`, {
        variant_id: p.variant_id,
        quantity,
      })
      if (!r.ok)
        throw new Error(r.data?.message || `add to bag failed (${r.status})`)
      await shop.refresh()
      showView("checkout")
      pulse($("co-bag"))
      return `${quantity} x ${p.title}`
    },
    lineFor(handle) {
      const p = shop.product(handle)
      return (cart.items || []).find((i) => i.variant_id === p.variant_id)
    },
    async setQuantity(handle, quantity) {
      const li = shop.lineFor(handle)
      const r = await http(
        "POST",
        `/store/carts/${cart.id}/line-items/${li.id}`,
        { quantity }
      )
      if (!r.ok)
        throw new Error(r.data?.message || `update qty failed (${r.status})`)
      await shop.refresh()
      pulse($("co-bag"))
      return `qty -> ${quantity}`
    },
    async applyPromo(code) {
      $("promo-input").value = code
      pulse($("co-summary"))
      await sleep(400)
      const r = await http("POST", `/store/carts/${cart.id}/promotions`, {
        promo_codes: [code],
      })
      if (!r.ok)
        throw new Error(r.data?.message || `promo failed (${r.status})`)
      await shop.refresh()
      $("promo-input").value = ""
      return `${code} applied, total ${money(cart.total)}`
    },
    async setAddress(address = {}) {
      const shipping_address = {
        first_name: "Jamie",
        last_name: "Rivera",
        address_1: "2 Folsom St",
        city: "San Francisco",
        province: "ca",
        postal_code: "94105",
        country_code: "us",
        ...address,
      }
      const r = await http("POST", `/store/carts/${cart.id}`, {
        shipping_address,
      })
      if (!r.ok)
        throw new Error(r.data?.message || `address failed (${r.status})`)
      await shop.refresh()
      pulse($("co-address"))
      return `${
        shipping_address.city
      }, ${shipping_address.country_code.toUpperCase()}`
    },
    async selectShipping(optionId) {
      const r = await http("POST", `/store/carts/${cart.id}/shipping-methods`, {
        option_id: optionId || config.seed.shippingOption.id,
      })
      if (!r.ok)
        throw new Error(r.data?.message || `shipping failed (${r.status})`)
      await shop.refresh()
      pulse($("co-delivery"))
      return config.seed.shippingOption.name
    },
    async startPayment(provider_id = "pp_system_default") {
      let pcId = cart.payment_collection?.id
      if (!pcId) {
        const r = await http("POST", `/store/payment-collections`, {
          cart_id: cart.id,
        })
        if (!r.ok)
          throw new Error(
            r.data?.message || `payment collection failed (${r.status})`
          )
        pcId = r.data.payment_collection.id
      }
      const s = await http(
        "POST",
        `/store/payment-collections/${pcId}/payment-sessions`,
        { provider_id }
      )
      if (!s.ok)
        throw new Error(
          s.data?.message || `payment session failed (${s.status})`
        )
      await shop.refresh()
      pulse($("co-payment"))
      return `${provider_id} session for ${money(
        cart.payment_collection?.amount
      )}`
    },
    async placeOrder(opts = {}) {
      const btn = $("place-order")
      if (!opts.silent) {
        pulse(btn)
        await sleep(500)
      }
      const r = await http(
        "POST",
        `/store/carts/${opts.cartId || cart.id}/complete`,
        {}
      )
      const order = r.ok && r.data?.type === "order" ? r.data.order : null
      const error = order
        ? null
        : r.data?.error?.message || r.data?.message || `HTTP ${r.status}`
      if (!opts.silent) shop.showResult({ order, error })
      if (order) lastOrder = order
      return { ok: !!order, status: r.status, order, error, data: r.data }
    },
    showResult({ order, error }) {
      if (order) {
        const cur = order.currency_code
        $("confirm-body").innerHTML = `
          <div class="muted">Order #${order.display_id || ""} &middot; ${
          order.id
        }</div>
          <div class="sum-row"><span>Items</span><span>${money(
            order.item_subtotal ?? order.subtotal,
            cur
          )}</span></div>
          <div class="sum-row"><span>Promos</span><span>-${money(
            order.discount_total,
            cur
          )}</span></div>
          <div class="sum-row"><span>Shipping</span><span>${money(
            order.shipping_total,
            cur
          )}</span></div>
          <div class="sum-row"><span>Tax</span><span>${money(
            order.tax_total,
            cur
          )}</span></div>
          <div class="sum-row total"><span>Charged</span><span>${money(
            order.total,
            cur
          )}</span></div>`
        $("confirm").classList.remove("hidden")
        $(
          "order-banner"
        ).innerHTML = `<div class="banner ok">Order placed: ${order.id}</div>`
      } else {
        $(
          "order-banner"
        ).innerHTML = `<div class="banner err"><b>We couldn't place your order.</b><br/>${error}</div>`
        pulse($("co-summary"))
      }
    },
    hideConfirm() {
      $("confirm").classList.add("hidden")
    },
    async backstage(name, body = {}) {
      const r = await http("POST", `/demo/action/${name}`, {
        cart_id: cart?.id,
        ...body,
      })
      if (!r.ok) {
        const err = new Error(r.data?.message || `backstage ${name} failed`)
        err.response = r
        throw err
      }
      return r.data.result
    },
    money,
  }

  window.GapDemo = {
    shop,
    register(s) {
      scenarios.push(s)
      const opt = document.createElement("option")
      opt.value = s.id
      opt.textContent = `${s.ticket ? s.ticket + " - " : ""}${s.title}`
      $("scenario-select").appendChild(opt)
    },
  }

  function renderMeta(s) {
    $("scenario-meta").innerHTML = s
      ? `<div class="ticket">${s.ticket || ""}</div><div>${
          s.description || ""
        }</div>
      <div class="exp"><b>Expected after fix:</b> ${
        s.expected?.fixed || ""
      }</div>
      <div class="exp"><b>Bug on develop:</b> ${s.expected?.bug || ""}</div>`
      : ""
    $("steps").innerHTML = s
      ? s.steps.map((st) => `<li>${st.label}</li>`).join("")
      : ""
    $("verdict").innerHTML = ""
  }

  async function runScenario() {
    const s = scenarios.find((x) => x.id === $("scenario-select").value)
    if (!s) return
    $("run-btn").disabled = true
    renderMeta(s)
    cart = null
    lastOrder = null
    shop.ctx = {}
    $("log").innerHTML = ""
    $("order-banner").innerHTML = ""
    $("confirm").classList.add("hidden")
    showView("browse")
    renderCart()
    const lis = [...$("steps").children]
    let crashed = null
    for (let i = 0; i < s.steps.length; i++) {
      const li = lis[i]
      li.className = "running"
      try {
        const detail = await s.steps[i].run(shop, shop.ctx)
        li.className = "done"
        if (detail) li.innerHTML += `<span class="detail">${detail}</span>`
      } catch (e) {
        li.className = "failed"
        li.innerHTML += `<span class="detail">${e.message}</span>`
        crashed = e
        break
      }
      await sleep(STEP_DELAY)
    }
    let v
    try {
      v = crashed
        ? { pass: false, title: "Scenario errored", detail: crashed.message }
        : await s.verdict(shop, shop.ctx)
    } catch (e) {
      v = { pass: false, title: "Verdict errored", detail: e.message }
    }
    $("verdict").innerHTML = `<div class="v ${v.pass ? "pass" : "fail"}"><b>${
      v.pass ? "PASS" : "FAIL"
    } - ${v.title}</b>${v.detail || ""}</div>`
    document.title = `${v.pass ? "PASS" : "FAIL"} | ${s.id}`
    $("run-btn").disabled = false
  }

  async function boot() {
    const r = await fetch("/demo/config")
    config = await r.json()
    const g = config.git
    const isDevelop =
      /^(develop|main)$/.test(g.branch) || /unpatched|develop/i.test(g.branch)
    $("git-badge").textContent = `${g.branch} @ ${g.sha}${
      g.dirty ? " (+local changes)" : ""
    }`
    $("git-badge").className = `git-badge ${isDevelop ? "develop" : "fix"}`
    $("git-badge").title = g.subject
    renderGrid()
    for (const file of config.scenarios) {
      await new Promise((resolve) => {
        const el = document.createElement("script")
        el.src = `scenarios/${file}`
        el.onload = resolve
        el.onerror = resolve
        document.body.appendChild(el)
      })
    }
    const params = new URLSearchParams(location.search)
    if (params.get("scenario"))
      $("scenario-select").value = params.get("scenario")
    $("scenario-select").onchange = () =>
      renderMeta(scenarios.find((x) => x.id === $("scenario-select").value))
    renderMeta(scenarios.find((x) => x.id === $("scenario-select").value))
    $("run-btn").onclick = runScenario
    if (params.get("autorun")) runScenario()
  }

  boot()
})()
