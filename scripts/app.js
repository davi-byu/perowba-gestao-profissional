(() => {
  "use strict";

  const STORAGE_KEY = "perowba_gestao_v1";
  const SESSION_KEY = "perowba_session_v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = (prefix = "id") => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nowISO = () => new Date().toISOString();
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dateBR = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
  const dateOnlyBR = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "—";
  const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));

  const initialState = () => ({
    settings: {
      companyName: "Perowba Sports",
      cnpj: "",
      phone: "",
      city: "João Pessoa - PB",
      allowNegativeStock: false,
      currency: "BRL"
    },
    users: [
      { id: "usr_admin", name: "Administrador", email: "admin@perowba.com", password: "123456", role: "admin", active: true },
      { id: "usr_vendedor", name: "Vendedor", email: "vendedor@perowba.com", password: "123456", role: "vendedor", active: true }
    ],
    products: [
      { id: "prd_1", sku: "CREA-DL-300", barcode: "789000000001", name: "Creatina Dark Lab 300g", category: "Suplementos", brand: "Dark Lab", unit: "un", cost: 58.50, price: 89.90, stock: 18, minStock: 5, location: "A1", active: true, createdAt: nowISO(), updatedAt: nowISO() },
      { id: "prd_2", sku: "MEIA-ANT-P", barcode: "789000000002", name: "Meia antiderrapante", category: "Acessórios", brand: "Perowba", unit: "par", cost: 12.00, price: 24.90, stock: 7, minStock: 8, location: "B2", active: true, createdAt: nowISO(), updatedAt: nowISO() },
      { id: "prd_3", sku: "JOEL-COMP-M", barcode: "789000000003", name: "Joelheira de compressão M", category: "Ortopédicos", brand: "Perowba", unit: "un", cost: 25.00, price: 49.90, stock: 0, minStock: 4, location: "B1", active: true, createdAt: nowISO(), updatedAt: nowISO() }
    ],
    customers: [
      { id: "cli_1", name: "Cliente balcão", document: "", phone: "", email: "", status: "ativo", createdAt: nowISO() }
    ],
    suppliers: [
      { id: "for_1", company: "Distribuidora Esportiva", document: "", contact: "Comercial", phone: "", email: "", leadTime: 7, status: "ativo", createdAt: nowISO() }
    ],
    sales: [],
    purchases: [],
    stockMovements: [],
    financialEntries: [],
    cashSessions: [],
    audit: [],
    cart: []
  });

  let state = loadState();
  let currentUser = null;
  let currentRoute = "dashboard";
  let deferredInstallPrompt = null;
  let registrationInProgress = false;
  let registrationAuthCreated = false;

  const cloudEnabled = () => Boolean(window.firebaseService?.enabled);

  async function refreshCloudState() {
    if (!cloudEnabled()) return;
    const cart = state.cart || [];
    const fresh = await window.firebaseService.refreshState();
    state = { ...initialState(), ...fresh, cart };
  }

  const routeRoles = {
    dashboard: ["admin", "gerente", "vendedor", "estoquista", "financeiro"],
    pdv: ["admin", "gerente", "vendedor"],
    produtos: ["admin", "gerente", "vendedor", "estoquista"],
    estoque: ["admin", "gerente", "estoquista"],
    clientes: ["admin", "gerente", "vendedor"],
    fornecedores: ["admin", "gerente", "estoquista"],
    compras: ["admin", "gerente", "estoquista"],
    caixa: ["admin", "gerente", "vendedor", "financeiro"],
    financeiro: ["admin", "gerente", "financeiro"],
    relatorios: ["admin", "gerente", "vendedor", "estoquista", "financeiro"],
    usuarios: ["admin"],
    auditoria: ["admin"],
    configuracoes: ["admin"]
  };

  function canAccessRoute(route) {
    return Boolean(currentUser && routeRoles[route]?.includes(currentUser.role));
  }

  const routes = {
    dashboard: ["Painel", "Visão geral da operação"],
    pdv: ["PDV / Vendas", "Registre vendas e dê baixa automática no estoque"],
    produtos: ["Produtos", "Cadastro, preços, categorias e estoque mínimo"],
    estoque: ["Estoque", "Movimentações, ajustes, perdas e inventário"],
    clientes: ["Clientes", "Cadastro e histórico comercial"],
    fornecedores: ["Fornecedores", "Parceiros e prazos de fornecimento"],
    compras: ["Compras", "Pedidos, recebimentos e entrada em estoque"],
    caixa: ["Caixa", "Abertura, movimentações e fechamento"],
    financeiro: ["Financeiro", "Receitas, despesas e vencimentos"],
    relatorios: ["Relatórios", "Vendas, estoque, lucro e exportações"],
    usuarios: ["Usuários", "Acessos, funções e permissões"],
    auditoria: ["Auditoria", "Histórico das operações realizadas"],
    configuracoes: ["Configurações", "Empresa e regras operacionais"]
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...initialState(), ...JSON.parse(raw) } : initialState();
    } catch {
      return initialState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (cloudEnabled() && currentUser) {
      return window.firebaseService.syncState(state, currentUser);
    }
    return Promise.resolve();
  }

  function getSessionUser() {
    const id = sessionStorage.getItem(SESSION_KEY);
    return state.users.find(user => user.id === id && user.active) || null;
  }

  function logAudit(action, entity, details = "", before = null, after = null) {
    state.audit.unshift({
      id: uid("aud"),
      userId: currentUser?.id || "system",
      userName: currentUser?.name || "Sistema",
      action,
      entity,
      details,
      before,
      after,
      createdAt: nowISO()
    });
    state.audit = state.audit.slice(0, 1000);
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function isAdmin() {
    return currentUser?.role === "admin";
  }

  function canManage() {
    return ["admin", "gerente"].includes(currentUser?.role);
  }

  function canManageStock() {
    return ["admin", "gerente", "estoquista"].includes(currentUser?.role);
  }

  function canViewSensitiveValues() {
    return Boolean(
      currentUser &&
      currentUser.role !== "vendedor"
    );
  }

  function stockStatus(product) {
    if (Number(product.stock) <= 0) return '<span class="badge danger">Sem estoque</span>';
    if (Number(product.stock) <= Number(product.minStock)) return '<span class="badge warning">Estoque baixo</span>';
    return '<span class="badge success">Normal</span>';
  }

  function statusBadge(status) {
    const normalized = String(status || "").toLowerCase();
    const cls = ["pago", "ativo", "recebido", "aberto"].includes(normalized) ? "success"
      : ["pendente", "rascunho", "parcial"].includes(normalized) ? "warning"
      : ["cancelado", "vencido", "inativo"].includes(normalized) ? "danger" : "info";
    return `<span class="badge ${cls}">${escapeHTML(status)}</span>`;
  }

  function setRoute(route) {
    if (!routes[route]) return;
    if (!canAccessRoute(route)) {
      toast("Seu perfil não possui permissão para acessar este módulo.");
      return;
    }
    currentRoute = route;
    $$(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.route === route));
    $("#page-title").textContent = routes[route][0];
    $("#page-subtitle").textContent = routes[route][1];
    $("#sidebar").classList.remove("open");
    renderRoute();
  }

  function renderRoute() {
    const renderers = {
      dashboard: renderDashboard,
      pdv: renderPDV,
      produtos: renderProducts,
      estoque: renderStock,
      clientes: renderCustomers,
      fornecedores: renderSuppliers,
      compras: renderPurchases,
      caixa: renderCash,
      financeiro: renderFinance,
      relatorios: renderReports,
      usuarios: renderUsers,
      auditoria: renderAudit,
      configuracoes: renderSettings
    };
    renderers[currentRoute]?.();
  }

  let improvementsNoticeShown = false;

  function showImprovementsNotice() {

    if (improvementsNoticeShown) {
      return;
    }

    const now =
      new Date();

    const start =
      new Date(
        "2026-09-12T00:00:00-03:00"
      );

    const end =
      new Date(
        "2026-09-19T00:00:00-03:00"
      );

    if (
      now < start ||
      now >= end
    ) {
      return;
    }

    improvementsNoticeShown =
      true;

    if (
      document.querySelector(
        "#system-updates-modal"
      )
    ) {
      return;
    }

    const modal =
      document.createElement(
        "div"
      );

    modal.id =
      "system-updates-modal";

    modal.setAttribute(
      "role",
      "dialog"
    );

    modal.setAttribute(
      "aria-modal",
      "true"
    );

    modal.innerHTML = `
      <div style="
        width:min(92vw,520px);
        max-height:90vh;
        overflow:auto;
        background:#ffffff;
        border-radius:18px;
        padding:24px;
        box-shadow:0 24px 70px rgba(15,23,42,.28);
      ">

        <div style="
          font-size:2rem;
          margin-bottom:8px;
        ">
          🚀
        </div>

        <h2 style="
          margin:0 0 8px;
          color:#0f172a;
        ">
          Novidades no Perowba Gest&atilde;o
        </h2>

        <p style="
          margin:0 0 18px;
          color:#475569;
          line-height:1.55;
        ">
          Fizemos novas melhorias para deixar o sistema
          mais seguro, organizado e profissional.
        </p>

        <div style="
          display:grid;
          gap:10px;
          color:#334155;
          line-height:1.45;
        ">

          <div>
            ✅ Painel do vendedor focado nas vendas do dia atual.
          </div>

          <div>
            ✅ Relat&oacute;rios do vendedor limitados &agrave;s vendas do dia.
          </div>

          <div>
            ✅ Custos e lucros protegidos para o perfil vendedor.
          </div>

          <div>
            ✅ Cadastro de Novo Produto removido do vendedor.
          </div>

          <div>
            ✅ Produtos e vendas com carregamento mais seguro.
          </div>

          <div>
            ✅ Melhorias nas permiss&otilde;es e seguran&ccedil;a do sistema.
          </div>

        </div>

        <button
          id="close-system-updates"
          type="button"
          style="
            width:100%;
            margin-top:22px;
            border:0;
            border-radius:12px;
            padding:13px 18px;
            background:#0f172a;
            color:#ffffff;
            font-size:1rem;
            font-weight:700;
            cursor:pointer;
          ">
          Entendi
        </button>

      </div>
    `;

    Object.assign(
      modal.style,
      {
        position:
          "fixed",

        inset:
          "0",

        zIndex:
          "99999",

        display:
          "flex",

        alignItems:
          "center",

        justifyContent:
          "center",

        padding:
          "20px",

        background:
          "rgba(15,23,42,.65)"
      }
    );

    document.body.appendChild(
      modal
    );

    document
      .querySelector(
        "#close-system-updates"
      )
      ?.addEventListener(
        "click",
        () =>
          modal.remove()
      );
  }


  function showApp() {
  $("#loading-screen")?.classList.add("hidden");
  $("#login-screen")?.classList.add("hidden");
  $("#app-shell")?.classList.remove("hidden");

  setTimeout(
    showImprovementsNotice,
    350
  );

  $("#brand-company").textContent =
    state.settings.companyName;

  $("#sidebar-user").textContent =
    `${currentUser.name} • ${currentUser.role}`;

  $("#current-date").textContent =
    new Date().toLocaleDateString(
      "pt-BR",
      {
        weekday: "long",
        day: "2-digit",
        month: "long"
      }
    );

  $$(".nav-item").forEach(el =>
    el.classList.toggle(
      "hidden",
      !canAccessRoute(el.dataset.route)
    )
  );

  setRoute(
    canAccessRoute(currentRoute)
      ? currentRoute
      : "dashboard"
  );
}

  function renderDashboard() {
    const today = todayISO();
    const month = today.slice(0, 7);
    const activeSales = state.sales.filter(s => s.status !== "cancelado");
    const todaySales = activeSales.filter(s => s.createdAt.slice(0, 10) === today);
    const monthSales = activeSales.filter(s => s.createdAt.slice(0, 7) === month);
    const salesTodayValue = todaySales.reduce((sum, s) => sum + s.total, 0);
    const salesMonthValue = monthSales.reduce((sum, s) => sum + s.total, 0);
    const profitMonth = monthSales.reduce((sum, s) => sum + (s.profit || 0), 0);
    const lowStock = state.products.filter(p => p.active && p.stock <= p.minStock);
    const ticketMonth =
      monthSales.length
        ? salesMonthValue / monthSales.length
        : 0;

    const ticketToday =
      todaySales.length
        ? salesTodayValue / todaySales.length
        : 0;

    const productTotals = {};
    activeSales.forEach(sale => sale.items.forEach(item => {
      productTotals[item.name] = (productTotals[item.name] || 0) + item.qty;
    }));
    const topProducts = Object.entries(productTotals).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const maxProduct = Math.max(1, ...topProducts.map(item => item[1]));

    $("#content").innerHTML = `
      <div class="grid cards">
        ${metricCard("Vendas hoje", money(salesTodayValue), `${todaySales.length} venda(s)`)}

        ${currentUser?.role !== "vendedor"
          ? metricCard(
              "Vendas no mês",
              money(salesMonthValue),
              `${monthSales.length} venda(s)`
            )
          : ""
        }

        ${canViewSensitiveValues()
          ? metricCard(
              "Lucro estimado",
              money(profitMonth),
              "Mês atual"
            )
          : ""
        }

        ${currentUser?.role === "vendedor"
          ? metricCard(
              "Ticket médio hoje",
              money(ticketToday),
              "Dia atual"
            )
          : metricCard(
              "Ticket médio",
              money(ticketMonth),
              "Mês atual"
            )
        }
      </div>

      <div class="grid two" style="margin-top:18px">
        <article class="card">
          <div class="card-header"><h2>Produtos mais vendidos</h2><button class="btn secondary small-btn" data-go="relatorios">Ver relatórios</button></div>
          <div class="card-body">
            ${topProducts.length ? `<div class="bar-list">${topProducts.map(([name, qty]) => `
              <div class="bar-row">
                <header><span>${escapeHTML(name)}</span><strong>${qty}</strong></header>
                <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, qty / maxProduct * 100)}%"></div></div>
              </div>`).join("")}</div>` : `<div class="empty-state">Nenhuma venda registrada ainda.</div>`}
          </div>
        </article>

        <article class="card">
          <div class="card-header"><h2>Alertas de estoque</h2><button class="btn secondary small-btn" data-go="estoque">Abrir estoque</button></div>
          <div class="table-wrap">
            ${lowStock.length ? `<table>
              <thead><tr><th>Produto</th><th>Atual</th><th>Mínimo</th><th>Status</th></tr></thead>
              <tbody>${lowStock.slice(0,8).map(p => `<tr><td>${escapeHTML(p.name)}</td><td>${p.stock}</td><td>${p.minStock}</td><td>${stockStatus(p)}</td></tr>`).join("")}</tbody>
            </table>` : `<div class="empty-state">Todos os produtos estão com estoque adequado.</div>`}
          </div>
        </article>
      </div>

      <article class="card" style="margin-top:18px">
        <div class="card-header"><h2>Últimas vendas</h2><button class="btn primary small-btn" data-go="pdv">Nova venda</button></div>
        <div class="table-wrap">${salesTable(state.sales.slice(0,8))}</div>
      </article>
    `;

    $$("[data-go]").forEach(btn => btn.addEventListener("click", () => setRoute(btn.dataset.go)));
  }

  function metricCard(label, value, note) {
    return `<article class="card metric"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><div class="metric-note">${note}</div></article>`;
  }

    // =========================================================
  // TABELA DE VENDAS + DETALHES DA VENDA
  // =========================================================

  function salesTable(sales) {

    if (!sales.length) {
      return `
        <div class="empty-state">
          Nenhuma venda registrada.
        </div>
      `;
    }


    return `
      <table>

        <thead>
          <tr>
            <th>Número</th>
            <th>Data</th>
            <th>Cliente</th>
            <th>Pagamento</th>
            <th>Total</th>
            <th>Status</th>
          </tr>
        </thead>


        <tbody>

          ${sales
            .map(
              sale => {

                const saleKey =
                  String(
                    sale.id ||
                    sale.number ||
                    ""
                  );


                return `
                  <tr
                    data-sale-id="${escapeHTML(saleKey)}"
                    tabindex="0"
                    role="button"
                    title="Clique para visualizar os detalhes da venda"
                    style="cursor:pointer">

                    <td>
                      <strong>
                        ${escapeHTML(
                          sale.number ||
                          "—"
                        )}
                      </strong>
                    </td>


                    <td>
                      ${dateBR(
                        sale.createdAt
                      )}
                    </td>


                    <td>
                      ${escapeHTML(
                        sale.customerName ||
                        "Cliente balcão"
                      )}
                    </td>


                    <td>
                      ${escapeHTML(
                        sale.payment ||
                        "—"
                      )}
                    </td>


                    <td>
                      ${money(
                        sale.total ||
                        0
                      )}
                    </td>


                    <td>
                      ${statusBadge(
                        sale.status
                      )}
                    </td>

                  </tr>
                `;
              }
            )
            .join("")}

        </tbody>

      </table>
    `;
  }


  // =========================================================
  // FECHAR DETALHES DA VENDA
  // =========================================================

  function closeSaleDetails() {

    const modal =
      document.querySelector(
        "#sale-details-modal"
      );


    if (modal) {

      modal.remove();

    }
  }


  // =========================================================
  // ABRIR DETALHES DA VENDA
  // =========================================================

  function openSaleDetails(
    saleKey
  ) {

    const sale =
      state.sales.find(
        item =>
          String(
            item.id ||
            item.number ||
            ""
          ) ===
          String(
            saleKey ||
            ""
          )
      );


    if (!sale) {

      toast(
        "Venda não encontrada."
      );

      return;
    }


    closeSaleDetails();


    const items =
      Array.isArray(
        sale.items
      )
        ? sale.items
        : [];


    // =======================================================
    // PRODUTOS DA VENDA
    // =======================================================

    const itemsMarkup =
      items.length

        ? items
            .map(
              item => {

                const product =
                  state.products.find(
                    productItem =>
                      productItem.id ===
                      item.productId
                  );


                const productName =
                  item.name ||
                  item.productName ||
                  product?.name ||
                  "Produto";


                const size =
                  String(
                    item.size ||
                    ""
                  ).trim();


                const quantity =
                  Number(
                    item.qty ??
                    item.quantity ??
                    0
                  );


                const rawPrice =
                  item.price ??
                  item.unitPrice ??
                  item.unitValue ??
                  item.salePrice ??
                  product?.price;


                const unitPrice =
                  Number(
                    rawPrice ||
                    0
                  );


                const hasPrice =
                  rawPrice !== undefined &&
                  rawPrice !== null &&
                  rawPrice !== "" &&
                  Number.isFinite(
                    unitPrice
                  );


                const itemTotal =
                  hasPrice
                    ? unitPrice *
                      quantity
                    : 0;


                return `
                  <tr>

                    <td>

                      <strong>
                        ${escapeHTML(
                          productName
                        )}
                      </strong>

                    </td>


                    <td>

                      ${
                        size
                          ? `Tam. ${escapeHTML(size)}`
                          : "—"
                      }

                    </td>


                    <td>

                      ${quantity}

                    </td>


                    <td>

                      ${
                        hasPrice
                          ? money(
                              unitPrice
                            )
                          : "—"
                      }

                    </td>


                    <td>

                      ${
                        hasPrice
                          ? money(
                              itemTotal
                            )
                          : "—"
                      }

                    </td>

                  </tr>
                `;
              }
            )
            .join("")

        : `
            <tr>

              <td
                colspan="5"
                style="
                  padding:24px;
                  text-align:center;
                  color:#64748b;
                ">

                Esta venda não possui
                produtos detalhados no registro.

              </td>

            </tr>
          `;


    // =======================================================
    // MODAL
    // =======================================================

    const modal =
      document.createElement(
        "div"
      );


    modal.id =
      "sale-details-modal";


    modal.setAttribute(
      "role",
      "dialog"
    );


    modal.setAttribute(
      "aria-modal",
      "true"
    );


    modal.setAttribute(
      "aria-label",
      `Detalhes da venda ${sale.number || ""}`
    );


    modal.innerHTML = `
      <div
        style="
          width:min(94vw,850px);
          max-height:90vh;
          overflow:auto;
          background:#ffffff;
          border-radius:18px;
          box-shadow:
            0 24px 70px
            rgba(15,23,42,.30);
        ">


        <!-- CABEÇALHO -->

        <div
          style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:16px;
            padding:20px 22px;
            border-bottom:
              1px solid #e2e8f0;
          ">


          <div>

            <div
              style="
                font-size:.8rem;
                color:#64748b;
                margin-bottom:4px;
              ">

              Detalhes da venda

            </div>


            <h2
              style="
                margin:0;
                color:#0f172a;
              ">

              ${escapeHTML(
                sale.number ||
                "Venda"
              )}

            </h2>

          </div>


          <button
            id="close-sale-details"
            type="button"
            aria-label="Fechar"
            style="
              width:38px;
              height:38px;
              border:0;
              border-radius:10px;
              background:#f1f5f9;
              color:#334155;
              font-size:1.2rem;
              cursor:pointer;
            ">

            ✕

          </button>

        </div>


        <!-- CONTEÚDO -->

        <div
          style="
            padding:20px 22px;
          ">


          <!-- INFORMAÇÕES -->

          <div
            style="
              display:grid;
              grid-template-columns:
                repeat(
                  auto-fit,
                  minmax(170px,1fr)
                );
              gap:12px;
              margin-bottom:22px;
            ">


            <div
              style="
                padding:14px;
                background:#f8fafc;
                border-radius:12px;
              ">

              <small
                style="
                  color:#64748b;
                ">

                Data

              </small>


              <div
                style="
                  margin-top:4px;
                  font-weight:700;
                  color:#0f172a;
                ">

                ${dateBR(
                  sale.createdAt
                )}

              </div>

            </div>


            <div
              style="
                padding:14px;
                background:#f8fafc;
                border-radius:12px;
              ">

              <small
                style="
                  color:#64748b;
                ">

                Cliente

              </small>


              <div
                style="
                  margin-top:4px;
                  font-weight:700;
                  color:#0f172a;
                ">

                ${escapeHTML(
                  sale.customerName ||
                  "Cliente balcão"
                )}

              </div>

            </div>


            <div
              style="
                padding:14px;
                background:#f8fafc;
                border-radius:12px;
              ">

              <small
                style="
                  color:#64748b;
                ">

                Pagamento

              </small>


              <div
                style="
                  margin-top:4px;
                  font-weight:700;
                  color:#0f172a;
                ">

                ${escapeHTML(
                  sale.payment ||
                  "—"
                )}

              </div>

            </div>


            <div
              style="
                padding:14px;
                background:#f8fafc;
                border-radius:12px;
              ">

              <small
                style="
                  color:#64748b;
                ">

                Vendedor

              </small>


              <div
                style="
                  margin-top:4px;
                  font-weight:700;
                  color:#0f172a;
                ">

                ${escapeHTML(
                  sale.sellerName ||
                  "—"
                )}

              </div>

            </div>

          </div>


          <!-- PRODUTOS -->

          <div
            style="
              display:flex;
              align-items:center;
              justify-content:space-between;
              gap:15px;
              margin-bottom:10px;
            ">

            <h3
              style="
                margin:0;
                color:#0f172a;
              ">

              Produtos vendidos

            </h3>


            ${statusBadge(
              sale.status
            )}

          </div>


          <div
            style="
              overflow-x:auto;
              border:
                1px solid #e2e8f0;
              border-radius:12px;
            ">

            <table
              style="
                width:100%;
              ">

              <thead>

                <tr>

                  <th>
                    Produto
                  </th>

                  <th>
                    Tamanho
                  </th>

                  <th>
                    Qtd.
                  </th>

                  <th>
                    Unitário
                  </th>

                  <th>
                    Subtotal
                  </th>

                </tr>

              </thead>


              <tbody>

                ${itemsMarkup}

              </tbody>

            </table>

          </div>


          <!-- TOTAIS -->

          <div
            style="
              margin-top:20px;
              margin-left:auto;
              width:min(100%,360px);
            ">


            <div
              style="
                display:flex;
                justify-content:space-between;
                padding:7px 0;
                color:#475569;
              ">

              <span>
                Subtotal
              </span>


              <strong>

                ${money(
                  sale.subtotal ??
                  sale.total ??
                  0
                )}

              </strong>

            </div>


            <div
              style="
                display:flex;
                justify-content:space-between;
                padding:7px 0;
                color:#475569;
              ">

              <span>
                Desconto
              </span>


              <strong>

                ${money(
                  sale.discount ||
                  0
                )}

              </strong>

            </div>


            <div
              style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                padding:12px 0 0;
                margin-top:5px;
                border-top:
                  1px solid #e2e8f0;
                color:#0f172a;
                font-size:1.1rem;
              ">

              <span>
                Total
              </span>


              <strong>

                ${money(
                  sale.total ||
                  0
                )}

              </strong>

            </div>

          </div>


          <!-- BOTÕES -->

<div
  style="
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    flex-wrap:wrap;
    margin-top:22px;
  ">

  ${
    canManage() &&
    String(
      sale.status || ""
    ).toLowerCase() !==
      "cancelado" &&
    sale.imported !== true &&
    sale.id &&
    cloudEnabled()

      ? `
          <button
            id="cancel-sale-details"
            type="button"
            class="btn danger">

            Cancelar venda

          </button>
        `

      : `<span></span>`
  }


  <button
    id="close-sale-details-bottom"
    type="button"
    class="btn secondary">

    Fechar

  </button>

</div>

        </div>

      </div>
    `;


    // =======================================================
    // FUNDO DO MODAL
    // =======================================================

    Object.assign(
      modal.style,
      {

        position:
          "fixed",

        inset:
          "0",

        zIndex:
          "100000",

        display:
          "flex",

        alignItems:
          "center",

        justifyContent:
          "center",

        padding:
          "20px",

        background:
          "rgba(15,23,42,.65)"

      }
    );


    document.body.appendChild(
      modal
    );


    // =======================================================
    // FECHAR MODAL
    // =======================================================

    const close =
      () => {

        modal.remove();

      };


    modal
      .querySelector(
        "#close-sale-details"
      )
      ?.addEventListener(
        "click",
        close
      );


    modal
      .querySelector(
        "#close-sale-details-bottom"
      )
      ?.addEventListener(
        "click",
        close
      );
      
        // =======================================================
    // CANCELAR VENDA
    // =======================================================

    const cancelSaleButton =
      modal.querySelector(
        "#cancel-sale-details"
      );


    cancelSaleButton
      ?.addEventListener(
        "click",
        async () => {

          const reasonInput =
            window.prompt(
              `Informe o motivo do cancelamento da venda ${
                sale.number ||
                ""
              }:`
            );


          if (
            reasonInput === null
          ) {
            return;
          }


          const reason =
            String(
              reasonInput
            ).trim();


          if (
            reason.length < 3
          ) {

            toast(
              "Informe um motivo válido para o cancelamento."
            );

            return;
          }


          const confirmed =
            window.confirm(
              `Deseja realmente cancelar a venda ${
                sale.number ||
                ""
              }?\n\n` +
              "Os produtos serão devolvidos ao estoque e o lançamento financeiro será cancelado."
            );


          if (!confirmed) {
            return;
          }


          cancelSaleButton.disabled =
            true;


          cancelSaleButton.textContent =
            "Cancelando...";


          try {

            const result =
              await window
                .firebaseService
                .cancelSale({
                  saleId:
                    sale.id,

                  reason
                });


            await refreshCloudState();


            close();


            renderRoute();


            if (
              result?.alreadyCancelled
            ) {

              toast(
                `Venda ${
                  sale.number
                } já estava cancelada.`
              );

            } else {

              toast(
                `Venda ${
                  sale.number
                } cancelada com sucesso.`
              );
            }


          } catch (error) {

            console.error(
              "Erro ao cancelar venda:",
              error
            );


            cancelSaleButton.disabled =
              false;


            cancelSaleButton.textContent =
              "Cancelar venda";


            toast(
              error?.message ||
              "Não foi possível cancelar a venda."
            );
          }
        }
      );


    modal.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          modal
        ) {

          close();

        }
      }
    );
  }


  // =========================================================
  // CLIQUE NAS VENDAS
  // =========================================================

  document.addEventListener(
    "click",
    event => {

      const target =
        event.target instanceof Element
          ? event.target
          : null;


      const saleRow =
        target?.closest(
          "[data-sale-id]"
        );


      if (!saleRow) {
        return;
      }


      openSaleDetails(
        saleRow.dataset.saleId
      );
    }
  );


  // =========================================================
  // ENTER / ESPAÇO NAS VENDAS
  // =========================================================

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }


      const target =
        event.target instanceof Element
          ? event.target
          : null;


      const saleRow =
        target?.closest(
          "[data-sale-id]"
        );


      if (!saleRow) {
        return;
      }


      event.preventDefault();


      openSaleDetails(
        saleRow.dataset.saleId
      );
    }
  );

  function renderPDV() {
    const activeProducts = state.products.filter(p => p.active);
    const cartTotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const cartCost = state.cart.reduce((sum, item) => sum + item.cost * item.qty, 0);
    

    $("#content").innerHTML = `
      <div class="pdv-layout">
        <section>
          <div class="section-actions pdv-section-actions">
            <div class="pdv-search-row">

              <input
                id="pdv-search"
                type="search"
                autocomplete="off"
                inputmode="search"
                placeholder="Leia o código de barras ou busque por nome / SKU">

              <button
                id="open-camera-scanner"
                type="button"
                class="secondary-btn camera-scan-btn">
                📷 Usar câmera
              </button>

            </div>
          </div>

          <div
            id="camera-scanner-modal"
            class="camera-scanner-modal hidden"
            aria-hidden="true">

            <div class="camera-scanner-card">

              <div class="camera-scanner-header">

                <div>
                  <h3>Ler código de barras</h3>
                  <p>Aponte a câmera para o código do produto.</p>
                </div>

                <button
                  id="close-camera-scanner"
                  type="button"
                  class="camera-close-btn"
                  aria-label="Fechar câmera">
                  ✕
                </button>

              </div>

              <div
                id="camera-reader"
                class="camera-reader">

                <div class="camera-placeholder">
                  <span>📷</span>
                  <strong>Câmera pronta para configuração</strong>
                  <small>
                    A leitura do código será conectada na próxima etapa.
                  </small>
                </div>

              </div>

              <button
                id="cancel-camera-scanner"
                type="button"
                class="secondary-btn camera-cancel-btn">
                Cancelar câmera
              </button>

            </div>

          </div>
          <div
            class="pdv-shortcuts-hint"
            aria-label="Atalhos de teclado do PDV">

            <span>
              <kbd>F2</kbd>
              Buscar
            </span>

            <span>
              <kbd>F4</kbd>
              Quantidade
            </span>

            <span>
              <kbd>F8</kbd>
              Cliente
            </span>

            <span>
              <kbd>F10</kbd>
              Finalizar
            </span>

          </div>
          <div id="product-picker" class="product-picker">
            ${productTiles(activeProducts)}
          </div>
        </section>

        <aside class="card">
          <div class="card-header"><h2>Carrinho</h2><button id="clear-cart" class="btn danger small-btn" type="button">Limpar</button></div>
          <div class="card-body">
            <div id="cart-lines">
              ${state.cart.length ? state.cart.map(cartLine).join("") : `<div class="empty-state">Adicione produtos para iniciar uma venda.</div>`}
            </div>

            <div class="summary-list">
              <div class="summary-row"><span>Subtotal</span><strong>${money(cartTotal)}</strong></div>
              ${canViewSensitiveValues() ? `<div class="summary-row"><span>Lucro estimado</span><strong>${money(cartTotal - cartCost)}</strong></div>` : ""}
              <div class="summary-row total"><span>Total</span><strong>${money(cartTotal)}</strong></div>
            </div>

            <div class="form-grid one-column">
              <label>Cliente
                <select id="sale-customer">
                  ${state.customers.filter(c => c.status === "ativo").map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join("")}
                </select>
              </label>
              <label>Forma de pagamento
                <select id="sale-payment">
                  <option>PIX</option><option>Dinheiro</option><option>Cartão de débito</option>
                  <option>Cartão de crédito</option><option>Transferência</option><option>Venda fiada</option>
                </select>
              </label>
              <label>Desconto (R$)
                <input id="sale-discount" type="number" min="0" step="0.01" value="0">
              </label>
              <button id="finish-sale" class="btn primary full" type="button">Finalizar venda</button>
            </div>
          </div>
        </aside>
      </div>
    `;

    const pdvSearch =
      $("#pdv-search");


    // =======================================================
    // LEITOR DE CÓDIGO DE BARRAS
    // =======================================================

    let scannerTimer =
      null;


    const findScannedProduct =
      code => {

        const normalizedCode =
          String(code || "")
            .trim()
            .toLowerCase();


        if (!normalizedCode) {
          return null;
        }


        // Primeiro procura pelo código principal do produto.
        const directProduct =
          activeProducts.find(
            item =>
              String(
                item.barcode || ""
              )
                .trim()
                .toLowerCase() ===
                normalizedCode
          );


        if (directProduct) {
          return {
            ...directProduct,
            scannedSize: ""
          };
        }


        // Depois procura pelo código de barras específico
        // de cada tamanho do produto.
        for (
          const item
          of activeProducts
        ) {

          const sizes =
            Array.isArray(
              item.sizes
            )
              ? item.sizes
              : [];


          const matchedSize =
            sizes.find(
              sizeItem =>
                String(
                  sizeItem.barcode || ""
                )
                  .trim()
                  .toLowerCase() ===
                  normalizedCode
            );


          if (matchedSize) {

            return {
              ...item,

              scannedSize:
                String(
                  matchedSize.size || ""
                ),

              scannedSizeStock:
                Number(
                  matchedSize.stock || 0
                ),

              scannedBarcode:
                String(
                  matchedSize.barcode || ""
                )
            };
          }
        }


        // Mantém também a pesquisa pelo SKU.
        const skuProduct =
          activeProducts.find(
            item =>
              String(
                item.sku || ""
              )
                .trim()
                .toLowerCase() ===
                normalizedCode
          );


        if (skuProduct) {
          return {
            ...skuProduct,
            scannedSize: ""
          };
        }


        return null;
      };

    // =======================================================
    // PDV SCAN FEEDBACK
    // Som + confirmação visual
    // =======================================================

    let pdvAudioContext =
      null;

    let pdvFeedbackTimer =
      null;


    const playScanBeep =
      () => {

        try {

          const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;


          if (
            !AudioContextClass
          ) {
            return;
          }


          if (
            !pdvAudioContext
          ) {

            pdvAudioContext =
              new AudioContextClass();
          }


          const sound =
            () => {

              const now =
                pdvAudioContext.currentTime;


              // Tom principal:
              // bip curto, agudo e seco como leitor de caixa.

              const oscillator1 =
                pdvAudioContext.createOscillator();


              const gain1 =
                pdvAudioContext.createGain();


              oscillator1.type =
                "square";


              oscillator1.frequency.setValueAtTime(
                2350,
                now
              );


              gain1.gain.setValueAtTime(
                0.0001,
                now
              );


              gain1.gain.exponentialRampToValueAtTime(
                0.11,
                now + 0.004
              );


              gain1.gain.setValueAtTime(
                0.11,
                now + 0.055
              );


              gain1.gain.exponentialRampToValueAtTime(
                0.0001,
                now + 0.095
              );


              oscillator1.connect(
                gain1
              );


              gain1.connect(
                pdvAudioContext.destination
              );


              // Segundo tom mais fraco para dar
              // aquele som metálico típico do scanner.

              const oscillator2 =
                pdvAudioContext.createOscillator();


              const gain2 =
                pdvAudioContext.createGain();


              oscillator2.type =
                "sine";


              oscillator2.frequency.setValueAtTime(
                3525,
                now
              );


              gain2.gain.setValueAtTime(
                0.0001,
                now
              );


              gain2.gain.exponentialRampToValueAtTime(
                0.035,
                now + 0.004
              );


              gain2.gain.exponentialRampToValueAtTime(
                0.0001,
                now + 0.075
              );


              oscillator2.connect(
                gain2
              );


              gain2.connect(
                pdvAudioContext.destination
              );


              oscillator1.start(
                now
              );


              oscillator2.start(
                now
              );


              oscillator2.stop(
                now + 0.08
              );


              oscillator1.stop(
                now + 0.10
              );

            };


          if (
            pdvAudioContext.state ===
            "suspended"
          ) {

            pdvAudioContext
              .resume()
              .then(
                sound
              )
              .catch(
                () => {}
              );

          } else {

            sound();
          }


        } catch (error) {

          // Se o navegador bloquear o áudio,
          // a venda continua funcionando normalmente.

        }
      };

    const unlockPdvAudio =
      () => {

        try {

          const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;


          if (
            !AudioContextClass
          ) {
            return;
          }


          if (
            !pdvAudioContext
          ) {

            pdvAudioContext =
              new AudioContextClass();
          }


          if (
            pdvAudioContext.state ===
            "suspended"
          ) {

            pdvAudioContext
              .resume()
              .catch(
                () => {}
              );
          }


          // Oscilador silencioso para liberar o áudio
          // durante a interação direta do usuário.

          const oscillator =
            pdvAudioContext.createOscillator();


          const gain =
            pdvAudioContext.createGain();


          gain.gain.setValueAtTime(
            0.0001,
            pdvAudioContext.currentTime
          );


          oscillator.connect(
            gain
          );


          gain.connect(
            pdvAudioContext.destination
          );


          oscillator.start();


          oscillator.stop(
            pdvAudioContext.currentTime +
            0.01
          );


        } catch (error) {

          // Não interfere no funcionamento do PDV.

        }
      };

    const showScanSuccess =
      product => {

        clearTimeout(
          pdvFeedbackTimer
        );


        document
          .querySelector(
            "#pdv-scan-feedback"
          )
          ?.remove();


        const feedback =
          document.createElement(
            "div"
          );


        feedback.id =
          "pdv-scan-feedback";


        feedback.className =
          "pdv-scan-feedback";


        feedback.innerHTML =
          `
            <div class="pdv-scan-feedback-icon">
              ✓
            </div>

            <div class="pdv-scan-feedback-text">
              <strong></strong>
              <span>Adicionado ao carrinho</span>
            </div>
          `;


        const productNameElement =
          feedback.querySelector(
            ".pdv-scan-feedback-text strong"
          );


        if (
          productNameElement
        ) {

          productNameElement.textContent =
            String(
              product.name ||
              "Produto"
            );
        }


        document.body.appendChild(
          feedback
        );


        requestAnimationFrame(
          () => {

            feedback.classList.add(
              "show"
            );
          }
        );


        pdvFeedbackTimer =
          setTimeout(
            () => {

              feedback.classList.remove(
                "show"
              );


              setTimeout(
                () => {
                  feedback.remove();
                },
                250
              );

            },
            1100
          );
      };

    const addScannedProduct =
      product => {

        if (!product) {
          return false;
        }


        const scannedSize =
          String(
            product.scannedSize || ""
          ).trim();


        const sizeData =
          scannedSize
            ? (
                Array.isArray(
                  product.sizes
                )
                  ? product.sizes.find(
                      item =>
                        String(
                          item.size || ""
                        ) ===
                        scannedSize
                    )
                  : null
              )
            : null;


        const availableStock =
          scannedSize
            ? Number(
                sizeData?.stock || 0
              )
            : Number(
                product.stock || 0
              );


        if (
          availableStock <= 0 &&
          !state.settings.allowNegativeStock
        ) {

          toast(
            scannedSize
              ? `${product.name} Tam. ${scannedSize} está sem estoque.`
              : `${product.name} está sem estoque.`
          );

          pdvSearch.value =
            "";

          pdvSearch.focus();

          return false;
        }


        const existing =
          state.cart.find(
            item =>
              item.productId ===
                product.id &&
              String(
                item.size || ""
              ) ===
                scannedSize
          );


        const currentQty =
          existing?.qty ||
          0;


        if (
          !state.settings.allowNegativeStock &&
          currentQty >=
            availableStock
        ) {

          toast(
            scannedSize
              ? `Estoque máximo de ${product.name} Tam. ${scannedSize} atingido.`
              : `Estoque máximo de ${product.name} atingido.`
          );

          pdvSearch.value =
            "";

          pdvSearch.focus();

          return false;
        }


        if (existing) {

          existing.qty +=
            1;

        } else {

          state.cart.push({
            productId:
              product.id,

            name:
              product.name,

            price:
              Number(
                product.price
              ),

            cost:
              Number(
                product.cost
              ),

            qty:
              1,

            size:
              scannedSize,

            barcode:
              scannedSize
                ? String(
                    sizeData?.barcode ||
                    product.scannedBarcode ||
                    ""
                  )
                : String(
                    product.barcode ||
                    ""
                  )
          });
        }


        saveState();


        playScanBeep();

        showScanSuccess(
          product
        );


        toast(
          scannedSize
            ? `${product.name} Tam. ${scannedSize} adicionado ao carrinho.`
            : `${product.name} adicionado ao carrinho.`
        );


        renderPDV();


        return true;
      };

    // =======================================================
    // ENTER DO LEITOR
    // =======================================================

    pdvSearch.addEventListener(
      "keydown",
      event => {

        if (
          event.key !== "Enter"
        ) {
          return;
        }


        event.preventDefault();


        clearTimeout(
          scannerTimer
        );


        const code =
          pdvSearch.value
            .trim();


        if (!code) {
          return;
        }


        const product =
          findScannedProduct(
            code
          );


        if (!product) {

          toast(
            `Produto não encontrado: ${code}`
          );

          pdvSearch.select();

          return;
        }


        addScannedProduct(
          product
        );
      }
    );


    // =======================================================
    // FALLBACK PARA LEITORES CUJO ENTER NÃO É CAPTURADO
    //
    // Quando o código completo corresponde exatamente ao
    // código de barras de um produto, adicionamos o item
    // automaticamente após uma pequena espera.
    // =======================================================

    pdvSearch.addEventListener(
      "input",
      event => {

        clearTimeout(
          scannerTimer
        );


        const term =
          event.target.value
            .trim()
            .toLowerCase();


        const filtered =
          activeProducts.filter(
            product =>
              [
                product.name,
                product.sku,
                product.barcode
              ].some(
                value =>
                  String(value || "")
                    .toLowerCase()
                    .includes(term)
              )
          );


        $("#product-picker").innerHTML =
          productTiles(
            filtered
          );


        bindProductTiles();


        if (!term) {
          return;
        }


        const exactBarcodeProduct =
          findScannedProduct(
            term
          );

if (
          exactBarcodeProduct
        ) {

          scannerTimer =
            setTimeout(
              () => {

                addScannedProduct(
                  exactBarcodeProduct
                );

              },
              120
            );
        }
      }
    );


    bindProductTiles();

    // =======================================================
    // JANELA CAMERA PDV
    // =======================================================

    const cameraModal =
      $("#camera-scanner-modal");

    const cameraReader =
      $("#camera-reader");

    const openCameraButton =
      $("#open-camera-scanner");

    const closeCameraButton =
      $("#close-camera-scanner");

    const cancelCameraButton =
      $("#cancel-camera-scanner");

    const cameraSearch =
      $("#pdv-search");

        // Mantém a câmera acima de toda a interface no celular
    const cameraModalOriginalParent =
      cameraModal?.parentNode ||
      null;

    const cameraModalOriginalNextSibling =
      cameraModal?.nextSibling ||
      null;


    const moveCameraModalToBody =
      () => {

        if (
          cameraModal &&
          cameraModal.parentNode !==
            document.body
        ) {

          document.body.appendChild(
            cameraModal
          );
        }
      };


    const restoreCameraModal =
      () => {

        if (
          !cameraModal ||
          !cameraModalOriginalParent
        ) {
          return;
        }


        if (
          cameraModalOriginalNextSibling &&
          cameraModalOriginalNextSibling.parentNode ===
            cameraModalOriginalParent
        ) {

          cameraModalOriginalParent.insertBefore(
            cameraModal,
            cameraModalOriginalNextSibling
          );

        } else {

          cameraModalOriginalParent.appendChild(
            cameraModal
          );
        }
      };
    

    let cameraScanner =
      null;

    let cameraScannerStarting =
      false;

    let cameraReadLocked =
      false;

    let lastCameraCode =
      "";

    let lastCameraReadAt =
      0;


    // =======================================================
    // CARREGAR BIBLIOTECA DO LEITOR
    // =======================================================

    const loadCameraLibrary =
      () => {

        if (
          window.Html5Qrcode
        ) {
          return Promise.resolve();
        }


        if (
          window.__perowbaBarcodeLibraryPromise
        ) {
          return window.__perowbaBarcodeLibraryPromise;
        }


        window.__perowbaBarcodeLibraryPromise =
          new Promise(
            (
              resolve,
              reject
            ) => {

              const existingScript =
                document.querySelector(
                  'script[data-perowba-barcode-library="true"]'
                );


              if (
                existingScript
              ) {

                if (
                  window.Html5Qrcode
                ) {
                  resolve();
                  return;
                }


                existingScript.addEventListener(
                  "load",
                  () => {
                    resolve();
                  },
                  {
                    once: true
                  }
                );


                existingScript.addEventListener(
                  "error",
                  () => {

                    window.__perowbaBarcodeLibraryPromise =
                      null;

                    reject(
                      new Error(
                        "Falha ao carregar biblioteca do leitor."
                      )
                    );
                  },
                  {
                    once: true
                  }
                );


                return;
              }


              const script =
                document.createElement(
                  "script"
                );


              script.src =
                "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js";


              script.integrity =
                "sha512-r6rDA7W6ZeQhvl8S7yRVQUKVHdexq+GAlNkNNqVC7YyIV+NwqCTJe2hDWCiffTyRNOeGEzRRJ9ifvRm/HCzGYg==";


              script.crossOrigin =
                "anonymous";


              script.referrerPolicy =
                "no-referrer";


              script.dataset.perowbaBarcodeLibrary =
                "true";


              script.addEventListener(
                "load",
                () => {

                  if (
                    window.Html5Qrcode
                  ) {

                    resolve();

                  } else {

                    window.__perowbaBarcodeLibraryPromise =
                      null;

                    reject(
                      new Error(
                        "Biblioteca carregada, mas Html5Qrcode não foi encontrado."
                      )
                    );
                  }
                }
              );


              script.addEventListener(
                "error",
                () => {

                  window.__perowbaBarcodeLibraryPromise =
                    null;

                  reject(
                    new Error(
                      "Não foi possível carregar a biblioteca do leitor."
                    )
                  );
                }
              );


              document.head.appendChild(
                script
              );
            }
          );


        return window.__perowbaBarcodeLibraryPromise;
      };


    // =======================================================
    // PARAR CAMERA
    // =======================================================

    const stopCameraScanner =
      async () => {

        const scanner =
          cameraScanner;


        cameraScanner =
          null;


        if (
          !scanner
        ) {
          return;
        }


        try {

          await scanner.stop();

        } catch (error) {

          // Pode acontecer se a câmera ainda estiver iniciando.

        }


        try {

          await scanner.clear();

        } catch (error) {

          // Não precisamos interromper o fechamento por isso.

        }
      };


    // =======================================================
    // FECHAR CAMERA
    // =======================================================

    const closeCameraModal =
      async () => {

        cameraReadLocked =
          true;


        await stopCameraScanner();


        cameraModal?.classList.add(
          "hidden"
        );


        cameraModal?.setAttribute(
          "aria-hidden",
          "true"
        );

        restoreCameraModal();

        if (
          cameraReader
        ) {

          cameraReader.innerHTML =
            `
              <div class="camera-placeholder">
                <span>📷</span>
                <strong>Câmera pronta</strong>
                <small>
                  Toque em Usar câmera para iniciar uma nova leitura.
                </small>
              </div>
            `;
        }


        setTimeout(
          () => {
            $("#pdv-search")?.focus();
          },
          50
        );
      };


    // =======================================================
    // CODIGO RECONHECIDO
    // =======================================================

    const handleCameraBarcode =
      async decodedText => {

        if (
          cameraReadLocked
        ) {
          return;
        }


        const code =
          String(
            decodedText ||
            ""
          ).trim();


        if (
          !code
        ) {
          return;
        }


        const now =
          Date.now();


        // Impede dezenas de mensagens iguais enquanto
        // a câmera continua olhando para o mesmo código.
        if (
          code === lastCameraCode &&
          now - lastCameraReadAt < 1800
        ) {
          return;
        }


        lastCameraCode =
          code;

        lastCameraReadAt =
          now;


        const product =
          findScannedProduct(
            code
          );


        if (
          !product
        ) {

          toast(
            `Produto não encontrado: ${code}`
          );

          return;
        }


        // Bloqueia leituras repetidas assim que encontramos
        // um produto válido.
        cameraReadLocked =
          true;


        await closeCameraModal();


        addScannedProduct(
          product
        );
      };


    // =======================================================
    // INICIAR CAMERA
    // =======================================================

    const startCameraScanner =
      async () => {

        if (
          cameraScannerStarting ||
          cameraScanner
        ) {
          return;
        }


        cameraScannerStarting =
          true;

        cameraReadLocked =
          false;

        lastCameraCode =
          "";

        lastCameraReadAt =
          0;


        cameraSearch?.blur();

        moveCameraModalToBody();

        cameraModal?.classList.remove(
          "hidden"
        );


        cameraModal?.setAttribute(
          "aria-hidden",
          "false"
        );


        if (
          cameraReader
        ) {

          cameraReader.innerHTML =
            `
              <div class="camera-placeholder">
                <span>📷</span>
                <strong>Abrindo câmera...</strong>
                <small>
                  Permita o acesso à câmera quando o navegador solicitar.
                </small>
              </div>
            `;
        }


        try {

          await loadCameraLibrary();


          if (
            !window.Html5Qrcode
          ) {

            throw new Error(
              "Html5Qrcode indisponível."
            );
          }


          if (
            cameraReader
          ) {
            cameraReader.innerHTML =
              "";
          }


          const scanner =
            new window.Html5Qrcode(
              "camera-reader"
            );


          cameraScanner =
            scanner;


          await scanner.start(

            {
              facingMode:
                "environment"
            },

            {
              fps: 10
            },

            decodedText => {

              handleCameraBarcode(
                decodedText
              );

            },

            () => {

              // Falhas normais de leitura de cada quadro
              // são ignoradas enquanto procuramos o código.

            }
          );


        } catch (error) {

          console.error(
            "Erro ao abrir câmera:",
            error
          );


          const failedScanner =
            cameraScanner;


          cameraScanner =
            null;


          if (
            failedScanner
          ) {

            try {

              await failedScanner.clear();

            } catch (clearError) {

              // Ignora falha de limpeza.

            }
          }


          if (
            cameraReader
          ) {

            cameraReader.innerHTML =
              `
                <div class="camera-placeholder">
                  <span>⚠️</span>
                  <strong>Não foi possível abrir a câmera</strong>
                  <small>
                    Verifique a permissão da câmera e tente novamente.
                    No celular, use o endereço HTTPS do GitHub Pages.
                  </small>
                </div>
              `;
          }


          toast(
            "Não foi possível acessar a câmera."
          );

        } finally {

          cameraScannerStarting =
            false;

        }
      };


    // =======================================================
    // EVENTOS DA CAMERA
    // =======================================================

    openCameraButton?.addEventListener(
      "click",
      () => {

        unlockPdvAudio();

        startCameraScanner();
      }
    );


    closeCameraButton?.addEventListener(
      "click",
      () => {
        closeCameraModal();
      }
    );


    cancelCameraButton?.addEventListener(
      "click",
      () => {
        closeCameraModal();
      }
    );


    cameraModal?.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          cameraModal
        ) {

          closeCameraModal();

        }
      }
    );

    bindCartActions();


    // Mantém o campo pronto para receber o leitor.
    setTimeout(
      () => {
        $("#pdv-search")
          ?.focus();
      },
      50
    );

    $("#clear-cart").addEventListener("click", () => {
      state.cart = [];
      saveState();
      renderPDV();
    });

    // =======================================================
    // PDV KEYBOARD SHORTCUTS
    // =======================================================

    if (
      window.__perowbaPdvShortcutHandler
    ) {

      document.removeEventListener(
        "keydown",
        window.__perowbaPdvShortcutHandler,
        true
      );
    }


    const pdvShortcutHandler =
      event => {

        if (
          event.repeat
        ) {
          return;
        }


        if (
          event.ctrlKey ||
          event.metaKey
        ) {
          return;
        }


        const key =
          event.key;


        const functionShortcut =
          [
            "F2",
            "F4",
            "F8",
            "F10"
          ].includes(key);


        if (
          !functionShortcut
        ) {
          return;
        }


        // Só ativa os atalhos se o PDV estiver realmente
        // aberto na tela.

        const searchInput =
          $("#pdv-search");

        const finishButton =
          $("#finish-sale");


        if (
          !searchInput ||
          !finishButton
        ) {
          return;
        }


        // Enquanto a câmera estiver aberta,
        // não executa atalhos do caixa.

        const cameraModal =
          $("#camera-scanner-modal");


        if (
          cameraModal &&
          !cameraModal.classList.contains(
            "hidden"
          )
        ) {
          return;
        }


        event.preventDefault();

        event.stopPropagation();


        // ===================================================
        // F2 - BUSCAR PRODUTO
        // ===================================================

        if (
          key === "F2"
        ) {

          searchInput.focus();

          searchInput.select();

          return;
        }


        // ===================================================
        // F8 - CLIENTE
        // ===================================================

        if (
          key === "F8"
        ) {

          const customerSelect =
            $("#sale-customer");


          if (
            !customerSelect
          ) {
            return;
          }


          customerSelect.focus();


          // Navegadores modernos podem abrir
          // o select diretamente.

          if (
            typeof customerSelect.showPicker ===
            "function"
          ) {

            try {

              customerSelect.showPicker();

            } catch (error) {

              // O foco já foi aplicado.
            }
          }


          return;
        }


        // ===================================================
        // F10 - FINALIZAR VENDA
        // ===================================================

        if (
          key === "F10"
        ) {

          finishButton.click();

          return;
        }


        // ===================================================
        // F4 - QUANTIDADE DO ULTIMO PRODUTO
        // ===================================================

        if (
          key === "F4"
        ) {

          if (
            !state.cart.length
          ) {

            toast(
              "Adicione um produto antes de alterar a quantidade."
            );

            return;
          }


          const lastItem =
            state.cart[
              state.cart.length - 1
            ];

          const lastItemSize =
            String(
              lastItem.size || ""
            ).trim();

          const itemDescription =
            lastItemSize
              ? `${lastItem.name} - Tam. ${lastItemSize}`
              : lastItem.name;

          const resposta =
            window.prompt(
              `Quantidade de "${itemDescription}"` +
              `\nDigite 0 para remover o item:`,
              String(
                lastItem.qty
              )
            );

          if (
            resposta === null
          ) {
            return;
          }

          const quantity =
            Number(
              String(resposta)
                .trim()
            );

          if (
            !Number.isInteger(quantity) ||
            quantity < 0
          ) {

            toast(
              "Digite uma quantidade inteira válida."
            );

            return;
          }

          if (
            quantity === 0
          ) {

            state.cart =
              state.cart.filter(
                item => {
                  const itemSize =
                    String(
                      item.size || ""
                    ).trim();

                  return !(
                    item.productId ===
                      lastItem.productId &&
                    itemSize ===
                      lastItemSize
                  );
                }
              );

            saveState();

            renderPDV();

            toast(
              `${itemDescription} removido do carrinho.`
            );

            return;
          }

          const product =
            state.products.find(
              item =>
                item.id ===
                lastItem.productId
            );

          let availableStock =
            Number(
              product?.stock || 0
            );

          if (
            product &&
            lastItemSize
          ) {

            const sizeData =
              Array.isArray(product.sizes)
                ? product.sizes.find(
                    item =>
                      String(
                        item.size || ""
                      ).trim() ===
                        lastItemSize
                  )
                : null;

            if (!sizeData) {

              toast(
                `Tamanho ${lastItemSize} não encontrado neste produto.`
              );

              return;
            }

            availableStock =
              Number(
                sizeData.stock || 0
              );
          }

          if (
            product &&
            !state.settings.allowNegativeStock &&
            quantity >
              availableStock
          ) {

            toast(
              lastItemSize
                ? `Estoque disponível do tamanho ${lastItemSize}: ${availableStock}.`
                : `Estoque disponível: ${availableStock}.`
            );

            return;
          }

          lastItem.qty =
            quantity;

          saveState();

          renderPDV();

          toast(
            `Quantidade de ${itemDescription}: ${quantity}.`
          );

          return;
        }
      };


    window.__perowbaPdvShortcutHandler =
      pdvShortcutHandler;


    document.addEventListener(
      "keydown",
      pdvShortcutHandler,
      true
    );

    $("#finish-sale").addEventListener("click", finishSale);
  }

  function productTiles(products) {
    if (!products.length) return `<div class="empty-state">Nenhum produto encontrado.</div>`;
    return products.map(p => `<button class="product-tile" type="button" data-add-product="${p.id}" ${p.stock <= 0 ? "disabled" : ""}>
      <strong>${escapeHTML(p.name)}</strong>
      <span>${escapeHTML(p.sku)} • Estoque: ${p.stock}</span>
      <span>${money(p.price)}</span>
    </button>`).join("");
  }

  function cartLine(item) {

    const itemSize =
      String(
        item.size || ""
      ).trim();

    const sizeMarkup =
      itemSize
        ? `<small><strong>Tam. ${escapeHTML(itemSize)}</strong></small>`
        : "";

    return `<div class="cart-line">
      <div>
        <strong>${escapeHTML(item.name)}</strong>
        ${sizeMarkup}
        <small>${money(item.price)} cada</small>
      </div>

      <div class="cart-qty">
        <button
          type="button"
          data-cart-dec="${item.productId}"
          data-cart-size="${escapeHTML(itemSize)}">−</button>

        <span>${item.qty}</span>

        <button
          type="button"
          data-cart-inc="${item.productId}"
          data-cart-size="${escapeHTML(itemSize)}">+</button>
      </div>

      <strong>${money(item.price * item.qty)}</strong>
    </div>`;
  }

  function bindProductTiles() {

    $$("[data-add-product]").forEach(
      btn =>
        btn.addEventListener(
          "click",
          () => {

            const product =
              state.products.find(
                p =>
                  p.id ===
                  btn.dataset.addProduct
              );

            if (!product) {
              return;
            }


            const hasSizes =
              Boolean(product.useSizes) ||
              (
                Array.isArray(product.sizes) &&
                product.sizes.length > 0
              );


            if (hasSizes) {

              const availableSizes =
                (
                  Array.isArray(product.sizes)
                    ? product.sizes
                    : []
                )
                  .filter(
                    item =>
                      state.settings.allowNegativeStock ||
                      Number(item.stock || 0) > 0
                  );


              if (!availableSizes.length) {
                toast(
                  "Nenhum tamanho disponível em estoque."
                );
                return;
              }


              const optionsText =
                availableSizes
                  .map(
                    item =>
                      `${item.size} (${Number(item.stock || 0)} em estoque)`
                  )
                  .join("\n");


              const selectedSize =
                String(
                  prompt(
                    `Escolha o tamanho:\n\n${optionsText}`,
                    availableSizes[0]?.size || ""
                  ) || ""
                ).trim();


              if (!selectedSize) {
                return;
              }


              const sizeData =
                availableSizes.find(
                  item =>
                    String(item.size || "") ===
                    selectedSize
                );


              if (!sizeData) {
                toast(
                  "Tamanho inválido."
                );
                return;
              }


              const availableStock =
                Number(
                  sizeData.stock || 0
                );


              const existing =
                state.cart.find(
                  item =>
                    item.productId ===
                      product.id &&
                    String(
                      item.size || ""
                    ) ===
                      selectedSize
                );


              const currentQty =
                existing?.qty || 0;


              if (
                !state.settings.allowNegativeStock &&
                currentQty >= availableStock
              ) {
                toast(
                  `Estoque máximo do Tam. ${selectedSize} atingido.`
                );
                return;
              }


              if (existing) {
                existing.qty += 1;
              } else {
                state.cart.push({
                  productId:
                    product.id,

                  name:
                    product.name,

                  price:
                    Number(product.price),

                  cost:
                    Number(product.cost),

                  qty:
                    1,

                  size:
                    selectedSize,

                  barcode:
                    String(
                      sizeData.barcode || ""
                    )
                });
              }


              saveState();
              renderPDV();
              return;
            }


            if (
              Number(product.stock || 0) <= 0 &&
              !state.settings.allowNegativeStock
            ) {
              return;
            }


            const existing =
              state.cart.find(
                item =>
                  item.productId ===
                    product.id &&
                  !String(
                    item.size || ""
                  )
              );


            const currentQty =
              existing?.qty || 0;


            if (
              !state.settings.allowNegativeStock &&
              currentQty >=
                Number(product.stock || 0)
            ) {
              toast(
                "Quantidade máxima disponível atingida."
              );
              return;
            }


            if (existing) {
              existing.qty += 1;
            } else {
              state.cart.push({
                productId:
                  product.id,

                name:
                  product.name,

                price:
                  Number(product.price),

                cost:
                  Number(product.cost),

                qty:
                  1,

                size:
                  "",

                barcode:
                  String(
                    product.barcode || ""
                  )
              });
            }


            saveState();
            renderPDV();
          }
        )
    );
  }

  function bindCartActions() {

    $$("[data-cart-inc]").forEach(
      btn =>
        btn.addEventListener(
          "click",
          () => {

            const productId =
              btn.dataset.cartInc;

            const itemSize =
              String(
                btn.dataset.cartSize || ""
              );

            const item =
              state.cart.find(
                cartItem =>
                  cartItem.productId ===
                    productId &&
                  String(
                    cartItem.size || ""
                  ) ===
                    itemSize
              );

            if (!item) {
              return;
            }


            const product =
              state.products.find(
                productItem =>
                  productItem.id ===
                  item.productId
              );

            if (!product) {
              return toast(
                "Produto não encontrado."
              );
            }


            const sizeData =
              itemSize &&
              Array.isArray(
                product.sizes
              )
                ? product.sizes.find(
                    sizeItem =>
                      String(
                        sizeItem.size || ""
                      ) ===
                      itemSize
                  )
                : null;


            const availableStock =
              itemSize
                ? Number(
                    sizeData?.stock || 0
                  )
                : Number(
                    product.stock || 0
                  );


            if (
              !state.settings.allowNegativeStock &&
              item.qty >=
                availableStock
            ) {

              return toast(
                itemSize
                  ? `Quantidade máxima disponível do Tam. ${itemSize} atingida.`
                  : "Quantidade máxima disponível atingida."
              );
            }


            item.qty +=
              1;

            saveState();

            renderPDV();
          }
        )
    );


    $$("[data-cart-dec]").forEach(
      btn =>
        btn.addEventListener(
          "click",
          () => {

            const productId =
              btn.dataset.cartDec;

            const itemSize =
              String(
                btn.dataset.cartSize || ""
              );

            const item =
              state.cart.find(
                cartItem =>
                  cartItem.productId ===
                    productId &&
                  String(
                    cartItem.size || ""
                  ) ===
                    itemSize
              );

            if (!item) {
              return;
            }


            item.qty -=
              1;


            state.cart =
              state.cart.filter(
                cartItem =>
                  cartItem.qty > 0
              );


            saveState();

            renderPDV();
          }
        )
    );
  }

  async function finishSale() {
    if (cloudEnabled()) return finishSaleCloud();

    if (!state.cart.length) {
      return toast("Adicione pelo menos um produto.");
    }

    const discount =
      Math.max(
        0,
        Number(
          $("#sale-discount").value || 0
        )
      );

    const subtotal =
      state.cart.reduce(
        (sum, item) =>
          sum +
          item.price * item.qty,
        0
      );

    if (discount > subtotal) {
      return toast(
        "O desconto não pode ser maior que o valor da venda."
      );
    }

    for (const item of state.cart) {

      const product =
        state.products.find(
          p =>
            p.id === item.productId
        );

      if (!product) {
        return toast(
          `Produto ${item.name} não encontrado.`
        );
      }

      const itemSize =
        String(
          item.size || ""
        ).trim();

      const hasSizes =
        Boolean(product.useSizes) ||
        (
          Array.isArray(product.sizes) &&
          product.sizes.length > 0
        );

      if (
        hasSizes &&
        !itemSize
      ) {
        return toast(
          `Selecione o tamanho de ${item.name}.`
        );
      }

      if (itemSize) {

        const sizeData =
          Array.isArray(product.sizes)
            ? product.sizes.find(
                sizeItem =>
                  String(
                    sizeItem.size || ""
                  ).trim() ===
                    itemSize
              )
            : null;

        if (!sizeData) {
          return toast(
            `Tamanho ${itemSize} não encontrado para ${item.name}.`
          );
        }

        const sizeStock =
          Number(
            sizeData.stock || 0
          );

        if (
          !state.settings.allowNegativeStock &&
          sizeStock < item.qty
        ) {
          return toast(
            `Estoque insuficiente para ${item.name} - Tam. ${itemSize}. Disponível: ${sizeStock}.`
          );
        }

      } else {

        if (
          !state.settings.allowNegativeStock &&
          Number(product.stock || 0) <
            item.qty
        ) {
          return toast(
            `Estoque insuficiente para ${item.name}.`
          );
        }
      }
    }

    const customer =
      state.customers.find(
        c =>
          c.id ===
          $("#sale-customer").value
      );

    const total =
      subtotal - discount;

    const cost =
      state.cart.reduce(
        (sum, item) =>
          sum +
          item.cost * item.qty,
        0
      );

    const sale = {
      id: uid("ven"),
      number:
        `V${String(
          state.sales.length + 1
        ).padStart(6, "0")}`,
      items:
        structuredClone(
          state.cart
        ),
      subtotal,
      discount,
      total,
      cost,
      profit:
        total - cost,
      customerId:
        customer?.id || null,
      customerName:
        customer?.name ||
        "Cliente balcão",
      payment:
        $("#sale-payment").value,
      sellerId:
        currentUser.id,
      sellerName:
        currentUser.name,
      status:
        "pago",
      createdAt:
        nowISO()
    };

    sale.items.forEach(
      item => {

        const product =
          state.products.find(
            p =>
              p.id ===
              item.productId
          );

        const itemSize =
          String(
            item.size || ""
          ).trim();

        const before =
          Number(
            product.stock || 0
          );

        let sizeBefore = null;
        let sizeAfter = null;

        if (itemSize) {

          const sizeData =
            Array.isArray(product.sizes)
              ? product.sizes.find(
                  sizeItem =>
                    String(
                      sizeItem.size || ""
                    ).trim() ===
                      itemSize
                )
              : null;

          if (sizeData) {

            sizeBefore =
              Number(
                sizeData.stock || 0
              );

            sizeData.stock =
              sizeBefore -
              item.qty;

            sizeAfter =
              Number(
                sizeData.stock
              );
          }
        }

        product.stock =
          before -
          item.qty;

        product.updatedAt =
          nowISO();

        state.stockMovements.unshift({
          id:
            uid("mov"),
          productId:
            product.id,
          productName:
            product.name,
          size:
            itemSize || "",
          type:
            "Saída por venda",
          quantity:
            -item.qty,
          before,
          after:
            product.stock,
          sizeBefore,
          sizeAfter,
          reason:
            `Venda ${sale.number}`,
          userId:
            currentUser.id,
          userName:
            currentUser.name,
          createdAt:
            nowISO()
        });
      }
    );

    state.sales.unshift(
      sale
    );

    state.financialEntries.unshift({
      id:
        uid("fin"),
      type:
        "receita",
      category:
        "Vendas",
      description:
        `Venda ${sale.number}`,
      amount:
        total,
      dueDate:
        todayISO(),
      status:
        "pago",
      relatedId:
        sale.id,
      createdAt:
        nowISO()
    });

    logAudit(
      "CRIAR",
      "Venda",
      `Venda ${sale.number} finalizada`,
      null,
      sale
    );

    state.cart = [];

    saveState();

    toast(
      `Venda ${sale.number} finalizada com sucesso.`
    );

    renderPDV();
  }

  async function finishSaleCloud() {
    if (!state.cart.length) {
      return toast("Adicione pelo menos um produto.");
    }

    const discount = Math.max(0, Number($("#sale-discount").value || 0));
    const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);

    if (discount > subtotal) {
      return toast("O desconto não pode ser maior que o valor da venda.");
    }

    try {
      const result = await window.firebaseService.finalizeSale({
        items: state.cart.map(item => ({
          productId: item.productId,
          qty: item.qty,
          size: String(
            item.size || ""
          ).trim()
        })),
        customerId: $("#sale-customer").value || null,
        payment: $("#sale-payment").value,
        discount
      });

      state.cart = [];

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(state)
      );

      await refreshCloudState();

      toast(`Venda ${result.number} finalizada com segurança.`);

      renderPDV();

    } catch (error) {
      toast(
        error.message ||
        "Não foi possível finalizar a venda."
      );
    }
  }

  // =========================================================
  // PRODUCT BARCODE GENERATOR
  // =========================================================

  function generateInternalProductBarcode(
    excludeProductId = ""
  ) {

    const createDigits =
      () => {

        let digits =
          "";


        if (
          window.crypto &&
          typeof window.crypto.getRandomValues ===
            "function"
        ) {

          const values =
            new Uint32Array(3);


          window.crypto.getRandomValues(
            values
          );


          digits =
            Array.from(values)
              .map(
                value =>
                  String(
                    value % 10000
                  ).padStart(
                    4,
                    "0"
                  )
              )
              .join("");

        } else {

          digits =
            String(
              Math.floor(
                Math.random() *
                1000000000000
              )
            ).padStart(
              12,
              "0"
            );
        }


        return digits.slice(
          0,
          12
        );
      };


    for (
      let attempt = 0;
      attempt < 100;
      attempt += 1
    ) {

      const code =
        `PWB${createDigits()}`;


      const alreadyExists =
        state.products.some(
          product =>
            product.id !==
              excludeProductId &&

            String(
              product.barcode ||
              ""
            )
              .trim()
              .toLowerCase() ===
              code.toLowerCase()
        );


      if (
        !alreadyExists
      ) {

        return code;
      }
    }


    throw new Error(
      "Não foi possível gerar um código interno único."
    );
  }


  function updateProductBarcodeMode() {

    const barcodeInput =
      $("#product-barcode");

    const manualMode =
      $("#barcode-mode-manual");

    const generatedMode =
      $("#barcode-mode-generated");

    const generateButton =
      $("#generate-product-barcode");


    if (
      !barcodeInput ||
      !manualMode ||
      !generatedMode ||
      !generateButton
    ) {

      return;
    }


    const generated =
      generatedMode.checked;


    barcodeInput.readOnly =
      generated;


    generateButton.classList.toggle(
      "hidden",
      !generated
    );


    barcodeInput.placeholder =
      generated
        ? "Clique em Gerar código"
        : "Digite ou passe o leitor";


    if (
      generated &&
      !barcodeInput.value.trim()
    ) {

      try {

        barcodeInput.value =
          generateInternalProductBarcode(
            $("#product-id")?.value ||
            ""
          );

      } catch (error) {

        toast(
          error.message ||
          "Não foi possível gerar o código."
        );
      }
    }
  }


  function generateProductSizeBarcode(
    productBarcode,
    size
  ) {

    const rawBase =
      String(
        productBarcode || ""
      ).trim();

    const productSize =
      String(
        size || ""
      ).trim();

    if (
      !rawBase ||
      !productSize
    ) {
      return "";
    }

    const base =
      rawBase.replace(
        /-\d{1,3}$/,
        ""
      );

    return `${base}-${productSize}`;
  }

  function bindProductBarcodeControls() {

    const manualMode =
      $("#barcode-mode-manual");

    const generatedMode =
      $("#barcode-mode-generated");

    const generateButton =
      $("#generate-product-barcode");

    const barcodeInput =
      $("#product-barcode");


    if (
      !manualMode ||
      !generatedMode ||
      !generateButton ||
      !barcodeInput
    ) {

      return;
    }


    manualMode.addEventListener(
      "change",
      updateProductBarcodeMode
    );


    generatedMode.addEventListener(
      "change",
      updateProductBarcodeMode
    );


    generateButton.addEventListener(
      "click",
      () => {

        try {

          barcodeInput.value =
            generateInternalProductBarcode(
              $("#product-id")?.value ||
              ""
            );


          barcodeInput.focus();

          barcodeInput.select();


          toast(
            "Novo código interno gerado."
          );

        } catch (error) {

          toast(
            error.message ||
            "Não foi possível gerar o código."
          );
        }
      }
    );


    updateProductBarcodeMode();
  }


  function setProductBarcodeMode(
    barcode
  ) {

    const code =
      String(
        barcode ||
        ""
      ).trim();


    const barcodeInput =
      $("#product-barcode");

    const manualMode =
      $("#barcode-mode-manual");

    const generatedMode =
      $("#barcode-mode-generated");


    if (
      !barcodeInput ||
      !manualMode ||
      !generatedMode
    ) {

      return;
    }


    barcodeInput.value =
      code;


    const isInternal =
      code
        .toUpperCase()
        .startsWith(
          "PWB"
        );


    generatedMode.checked =
      isInternal;


    manualMode.checked =
      !isInternal;


    updateProductBarcodeMode();
  }

  function renderProducts() {
    $("#content").innerHTML = `
      <div class="grid two">
        <article class="card ${canManage() ? "" : "hidden"}">
          <div class="card-header"><h2>Novo produto</h2></div>
          <div class="card-body">
            <form id="product-form" class="form-grid two-columns">
              <input type="hidden" id="product-id">
              <label>Nome*<input id="product-name" required></label>
              <label>SKU*<input id="product-sku" required></label>
              <div class="product-barcode-field">

                <span class="product-barcode-label">
                  Código de barras
                </span>

                <div class="barcode-mode-options">

                  <label>
                    <input
                      id="barcode-mode-manual"
                      name="barcode-mode"
                      type="radio"
                      value="manual"
                      checked>

                    Inserir manualmente
                  </label>

                  <label>
                    <input
                      id="barcode-mode-generated"
                      name="barcode-mode"
                      type="radio"
                      value="generated">

                    Gerar código interno
                  </label>

                </div>

                <div class="barcode-input-row">

                  <input
                    id="product-barcode"
                    type="text"
                    autocomplete="off"
                    placeholder="Digite ou passe o leitor">

                  <button
                    id="generate-product-barcode"
                    class="btn secondary hidden"
                    type="button">
                    Gerar código
                  </button>

                </div>

                <small class="barcode-help">
                  Para produtos com código de fábrica, use o código original.
                  Para produtos sem código, gere um código interno Perowba.
                </small>

              </div>
              <label>Categoria<input id="product-category"></label>
              <label>Marca<input id="product-brand"></label>

              <div
                style="
                  grid-column:1 / -1;
                  border:1px solid #dbe3ec;
                  border-radius:10px;
                  padding:12px 14px;
                  background:#f8fafc;
                ">

                <label
                  style="
                    display:flex;
                    align-items:flex-start;
                    gap:10px;
                    cursor:pointer;
                    margin:0;
                  ">

                  <input
                    id="product-use-sizes"
                    type="checkbox"
                    style="
                      width:18px;
                      height:18px;
                      margin-top:2px;
                      flex:0 0 auto;
                    ">

                  <span>
                    <strong
                      style="
                        display:block;
                        margin-bottom:3px;
                      ">
                      Controlar estoque por tamanhos
                    </strong>

                    <small class="muted">
                      Ative para informar a quantidade disponível em cada tamanho.
                    </small>
                  </span>

                </label>
              </div>

              <div
                id="product-sizes-container"
                class="hidden"
                style="grid-column:1 / -1">

                <span style="display:block;font-weight:600;margin-bottom:8px">
                  Tamanhos e quantidades
                </span>

                <div
                  id="product-sizes-grid"
                  style="
                    display:grid;
                    grid-template-columns:repeat(8,minmax(52px,1fr));
                    gap:8px;
                    align-items:start;
                  ">

                  ${["26","27","28","29","30","31","32","33","34","35","36","37","38","39","40","41","42","43","44","45","46","47"].map(size => `
                    <div
                      style="
                        border:1px solid #d9e2ec;
                        border-radius:8px;
                        background:#fff;
                        padding:6px;
                        text-align:center;
                      ">

                      <div
                        style="
                          font-size:12px;
                          font-weight:700;
                          margin-bottom:4px;
                        ">
                        ${size}
                      </div>

                      <input
                        class="product-size-stock"
                        data-size="${size}"
                        type="number"
                        min="0"
                        step="1"
                        value="0"
                        style="
                          width:100%;
                          height:30px;
                          border-radius:6px;
                          text-align:center;
                          padding:2px 4px;
                          font-size:13px;
                        ">
                    </div>
                  `).join("")}

                </div>

                <small class="muted">
                  Informe a quantidade disponível de cada tamanho.
                </small>
              </div>

              <label>Unidade<select id="product-unit"><option>un</option><option>par</option><option>kg</option><option>cx</option></select></label>
              ${canViewSensitiveValues()
                ? `<label>Preço de custo*<input id="product-cost" type="number" min="0" step="0.01" required></label>`
                : `<input id="product-cost" type="hidden" value="0">`
              }
              <label>Preço de venda*<input id="product-price" type="number" min="0" step="0.01" required></label>
              <label>Estoque inicial<input id="product-stock" type="number" min="0" step="1" value="0"></label>
              <label>Estoque mínimo<input id="product-min-stock" type="number" min="0" step="1" value="0"></label>
              <label>Localização<input id="product-location"></label>
              <label>Imagem do produto<input id="product-image" type="file" accept="image/*"></label>
              <label>Status<select id="product-active"><option value="true">Ativo</option><option value="false">Inativo</option></select></label>
              <div class="form-actions">
                <button id="cancel-product-edit" class="btn secondary hidden" type="button">Cancelar</button>
                <button class="btn primary" type="submit">Salvar produto</button>
              </div>
            </form>
          </div>
        </article>

        <article class="card">
          <div class="card-header"><h2>Resumo do catálogo</h2></div>
          <div class="card-body">
            <div class="kpi-inline">
              <div><strong>${state.products.length}</strong><span>Produtos cadastrados</span></div>
              <div><strong>${state.products.filter(p => p.active).length}</strong><span>Produtos ativos</span></div>
              ${canViewSensitiveValues()
                ? `<div><strong>${money(state.products.reduce((sum,p) => sum + p.cost * p.stock,0))}</strong><span>Valor em custo</span></div>`
                : ""
              }
              <div><strong>${state.products.filter(p => p.stock <= p.minStock).length}</strong><span>Alertas de estoque</span></div>
            </div>
            <div class="notice" style="margin-top:18px">Cada alteração registra data, usuário e histórico. No ambiente Firebase, o ajuste de estoque deverá ser protegido por transações.</div>
          </div>
        </article>
      </div>

      <article class="card" style="margin-top:18px">
        <div class="card-header">
          <h2>Produtos cadastrados</h2>
          <input id="product-filter" type="search" placeholder="Filtrar produtos" style="max-width:280px">
        </div>
        <div id="products-table" class="table-wrap">${productsTable(state.products)}</div>
      </article>
    `;

    $("#product-form").addEventListener("submit", saveProduct);

    const useSizesInput =
      $("#product-use-sizes");

    const sizesContainer =
      $("#product-sizes-container");

    function calculateProductSizesStock() {
      return $$(".product-size-stock")
        .reduce(
          (sum, input) =>
            sum + Number(input.value || 0),
          0
        );
    }

    function updateProductSizesVisibility() {
      const enabled =
        Boolean(useSizesInput?.checked);

      sizesContainer
        ?.classList
        .toggle(
          "hidden",
          !enabled
        );

      const stockInput =
        $("#product-stock");

      if (stockInput) {
        stockInput.readOnly =
          enabled;

        if (enabled) {
          stockInput.value =
            calculateProductSizesStock();
        }
      }
    }

    useSizesInput
      ?.addEventListener(
        "change",
        updateProductSizesVisibility
      );

    $$(".product-size-stock").forEach(
      input =>
        input.addEventListener(
          "input",
          () => {
            if (
              !useSizesInput?.checked
            ) {
              return;
            }

            $("#product-stock").value =
              calculateProductSizesStock();
          }
        )
    );

    updateProductSizesVisibility();

    bindProductBarcodeControls();

    $("#product-filter").addEventListener("input", event => {
      const term = event.target.value.toLowerCase();

      $("#products-table").innerHTML = productsTable(
        state.products.filter(p =>
          [p.name,p.sku,p.category,p.brand]
            .some(v => String(v || "").toLowerCase().includes(term))
        )
      );

      bindProductTableActions();
    });

    $("#cancel-product-edit").addEventListener(
      "click",
      () => renderProducts()
    );

    bindProductTableActions();
  }

  function productsTable(products) {
    if (!products.length) {
      return `<div class="empty-state">Nenhum produto cadastrado.</div>`;
    }

    return `<table>
      <thead>
        <tr>
          <th>Produto</th>
          <th>SKU</th>
          <th>Categoria</th>
          ${canViewSensitiveValues() ? "<th>Custo</th>" : ""}
          <th>Venda</th>
          <th>Estoque</th>
          <th>Status</th>
          <th>Ações</th>
        </tr>
      </thead>

      <tbody>
        ${products.map(p => `<tr>
          <td>
            ${p.imageUrl
              ? `<img src="${escapeHTML(p.imageUrl)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:8px;vertical-align:middle;margin-right:8px">`
              : ""
            }

            <strong>${escapeHTML(p.name)}</strong>

            <br>

            <span class="muted small">
              ${escapeHTML(p.brand || "")}
            </span>
          </td>

          <td>${escapeHTML(p.sku)}</td>

          <td>${escapeHTML(p.category || "—")}</td>

          ${canViewSensitiveValues() ? `<td>${money(p.cost)}</td>` : ""}

          <td>${money(p.price)}</td>

          <td>${p.stock} ${escapeHTML(p.unit)}</td>

          <td>
            ${p.active
              ? stockStatus(p)
              : '<span class="badge danger">Inativo</span>'
            }
          </td>

          <td>
            <button
              class="btn secondary small-btn ${canManage() ? "" : "hidden"}"
              data-edit-product="${p.id}">
              Editar
            </button>

            <button
              class="btn secondary small-btn"
              type="button"
              data-print-barcode="${p.id}">
              🖨️ Imprimir etiqueta
            </button>
            <button
              class="btn warning small-btn ${canManage() ? "" : "hidden"}"
              data-toggle-product="${p.id}">
              ${p.active ? "Desativar" : "Ativar"}
            </button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  }

  async function saveProduct(event) {
    event.preventDefault();

    if (!canManage()) {
      return toast(
        "Seu perfil não pode cadastrar ou editar produtos."
      );
    }

    const id = $("#product-id").value;

    const targetId =
      id ||
      uid("prd");

    // GARANTIR CODIGO INTERNO

    if (
      $("#barcode-mode-generated")?.checked &&
      !$("#product-barcode").value.trim()
    ) {

      try {

        $("#product-barcode").value =
          generateInternalProductBarcode(
            targetId
          );

      } catch (error) {

        return toast(
          error.message ||
          "Não foi possível gerar o código interno."
        );
      }
    }

    const useSizes =
      Boolean(
        $("#product-use-sizes")?.checked
      );

    const rawProductBarcode =
      $("#product-barcode").value.trim();

    const productBarcode =
      useSizes
        ? rawProductBarcode.replace(
            /-\d{1,3}$/,
            ""
          )
        : rawProductBarcode;

    if (
      useSizes &&
      productBarcode !== rawProductBarcode
    ) {
      $("#product-barcode").value =
        productBarcode;
    }

    const sizes =
      useSizes
        ? Array.from(
            document.querySelectorAll(
              ".product-size-stock"
            )
          ).map(input => {

            const size =
              String(
                input.dataset.size || ""
              ).trim();

            return {
              size,
              stock:
                Number(
                  input.value || 0
                ),
              barcode:
                generateProductSizeBarcode(
                  productBarcode,
                  size
                )
            };
          })
        : [];

    const sizesStockTotal =
      sizes.reduce(
        (sum, item) =>
          sum +
          Number(
            item.stock || 0
          ),
        0
      );

    const payload = {
      name: $("#product-name").value.trim(),
      sku: $("#product-sku").value.trim(),
      barcode: productBarcode,
      category: $("#product-category").value.trim(),
      brand: $("#product-brand").value.trim(),
      unit: $("#product-unit").value,
      cost: Number($("#product-cost").value),
      price: Number($("#product-price").value),
      useSizes,
      sizes,
      stock:
        useSizes
          ? sizesStockTotal
          : Number(
              $("#product-stock").value || 0
            ),
      minStock: Number($("#product-min-stock").value || 0),
      location: $("#product-location").value.trim(),
      active: $("#product-active").value === "true"
    };

    if (!payload.name || !payload.sku) {
      return toast(
        "Nome e SKU são obrigatórios."
      );
    }

    // VALIDAR CODIGO DE BARRAS DUPLICADO

    if (
      payload.barcode
    ) {

      const normalizedBarcode =
        String(
          payload.barcode
        )
          .trim()
          .toLowerCase();


      const duplicateBarcodeProduct =
        state.products.find(
          product =>
            product.id !==
              targetId &&

            String(
              product.barcode ||
              ""
            )
              .trim()
              .toLowerCase() ===
              normalizedBarcode
        );


      if (
        duplicateBarcodeProduct
      ) {

        return toast(
          `Este código já pertence ao produto: ${duplicateBarcodeProduct.name}.`
        );
      }
    }

    if (
      state.products.some(
        p =>
          p.sku.toLowerCase() ===
          payload.sku.toLowerCase() &&
          p.id !== id
      )
    ) {
      return toast(
        "Já existe um produto com este SKU."
      );
    }

    const imageFile =
      $("#product-image")?.files?.[0];

    if (
      imageFile &&
      cloudEnabled()
    ) {
      try {
        payload.imageUrl =
          await window.firebaseService.uploadProductImage(
            imageFile,
            targetId
          );

      } catch (error) {
        return toast(
          error.message ||
          "Não foi possível enviar a imagem."
        );
      }
    }

    if (id) {
      const product =
        state.products.find(
          p => p.id === id
        );

      const before =
        structuredClone(product);

      Object.assign(
        product,
        payload,
        {
          updatedAt:
            nowISO()
        }
      );

      logAudit(
        "ATUALIZAR",
        "Produto",
        product.name,
        before,
        product
      );

    } else {
      const product = {
        id: targetId,
        ...payload,
        createdAt: nowISO(),
        updatedAt: nowISO()
      };

      state.products.unshift(
        product
      );

      if (product.stock > 0) {
        state.stockMovements.unshift({
          id: uid("mov"),
          productId: product.id,
          productName: product.name,
          type: "Estoque inicial",
          quantity: product.stock,
          before: 0,
          after: product.stock,
          reason: "Cadastro do produto",
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: nowISO()
        });
      }

      logAudit(
        "CRIAR",
        "Produto",
        product.name,
        null,
        product
      );
    }

    await saveState();

    toast(
      "Produto salvo com sucesso."
    );

    renderProducts();
  }

  // =========================================================
  // PRODUCT BARCODE PRINTING
  // =========================================================

  const BARCODE_PRINT_SETTINGS_KEY =
    "perowba_barcode_print_settings";


  function loadBarcodePrintLibrary() {

    if (
      window.JsBarcode
    ) {

      return Promise.resolve();
    }


    if (
      window.__perowbaJsBarcodePromise
    ) {

      return window.__perowbaJsBarcodePromise;
    }


    window.__perowbaJsBarcodePromise =
      new Promise(
        (
          resolve,
          reject
        ) => {

          const script =
            document.createElement(
              "script"
            );


          script.src =
            "https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js";


          script.dataset.perowbaJsbarcode =
            "true";


          script.onload =
            () => {

              if (
                window.JsBarcode
              ) {

                resolve();

              } else {

                window.__perowbaJsBarcodePromise =
                  null;

                reject(
                  new Error(
                    "A biblioteca de código de barras não foi carregada."
                  )
                );
              }
            };


          script.onerror =
            () => {

              window.__perowbaJsBarcodePromise =
                null;

              reject(
                new Error(
                  "Não foi possível carregar o gerador de código de barras."
                )
              );
            };


          document.head.appendChild(
            script
          );
        }
      );


    return window.__perowbaJsBarcodePromise;
  }


  function escapeBarcodeLabelHTML(
    value
  ) {

    return String(
      value ??
      ""
    ).replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character]
    );
  }


  function getSavedBarcodePrintSettings() {

    const defaults = {
      size:
        "50x30",

      pageMode:
        "mo5812",

      showPrice:
        true
    };


    try {

      const saved =
        JSON.parse(
          localStorage.getItem(
            BARCODE_PRINT_SETTINGS_KEY
          ) ||
          "{}"
        );


      return {
        ...defaults,
        ...saved
      };

    } catch (error) {

      return defaults;
    }
  }


  function saveBarcodePrintSettings(
    settings
  ) {

    try {

      localStorage.setItem(
        BARCODE_PRINT_SETTINGS_KEY,
        JSON.stringify({
          size:
            settings.size,

          pageMode:
            settings.pageMode,

          showPrice:
            settings.showPrice
        })
      );

    } catch (error) {

      console.warn(
        "Não foi possível salvar preferências de etiqueta.",
        error
      );
    }
  }


  function getBarcodeLabelDimensions(
    size
  ) {

    const dimensions = {
      "40x25": {
        width:
          40,

        height:
          25,

        barcodeHeight:
          8
      },

      "50x30": {
        width:
          50,

        height:
          30,

        barcodeHeight:
          10
      },

      "60x40": {
        width:
          60,

        height:
          40,

        barcodeHeight:
          14
      }
    };


    return (
      dimensions[size] ||
      dimensions["50x30"]
    );
  }


  function closeBarcodePrintDialog() {

    const modal =
      $("#barcode-print-modal");


    if (
      modal
    ) {

      modal.remove();
    }
  }


  function openBarcodePrintDialog(
    product
  ) {

    if (
      !product
    ) {

      return;
    }


    const barcode =
      String(
        product.barcode ||
        ""
      ).trim();


    if (
      !barcode
    ) {

      return toast(
        "Este produto não possui código de barras."
      );
    }


    closeBarcodePrintDialog();


    const settings =
      getSavedBarcodePrintSettings();


    const modal =
      document.createElement(
        "div"
      );


    modal.id =
      "barcode-print-modal";


    modal.className =
      "barcode-print-modal";


    modal.innerHTML =
      `
        <div class="barcode-print-dialog">

          <div class="barcode-print-header">

            <div>

              <h3>
                🖨️ Imprimir etiquetas
              </h3>

              <p>
                ${escapeBarcodeLabelHTML(product.name)}
              </p>

            </div>

            <button
              type="button"
              class="barcode-print-close"
              aria-label="Fechar">
              ×
            </button>

          </div>


          <form id="barcode-print-form">

            <div class="barcode-print-grid">

              ${
                product.useSizes &&
                Array.isArray(product.sizes) &&
                product.sizes.length
                  ? `
                    <div
                      style="
                        grid-column:1 / -1;
                      ">

                      <div
                        style="
                          font-weight:700;
                          margin-bottom:8px;
                        ">
                        Selecione as numerações
                      </div>

                      <div
                        id="barcode-print-sizes-list"
                        style="
                          display:grid;
                          grid-template-columns:
                            repeat(2,minmax(0,1fr));
                          gap:6px;
                        ">

                        ${product.sizes
                          .map(item => `
                            <div
                              style="
                                display:grid;
                                grid-template-columns:24px 1fr auto 58px;
                                align-items:center;
                                gap:5px;
                                border:1px solid #dbe3ec;
                                border-radius:6px;
                                padding:5px 6px;
                                background:#fff;
                              ">

                              <input
                                type="checkbox"
                                class="barcode-print-size-check"
                                data-size="${escapeBarcodeLabelHTML(item.size)}"
                                style="
                                  width:16px;
                                  height:16px;
                                  margin:0;
                                ">

                              <strong
                                style="
                                  font-size:12px;
                                  white-space:nowrap;
                                ">
                                Tam. ${escapeBarcodeLabelHTML(item.size)}
                              </strong>

                              <span
                                style="
                                  font-size:12px;
                                  font-weight:700;
                                  white-space:nowrap;
                                  color:#334155;
                                ">
                                Est. ${Number(item.stock || 0)}
                              </span>

                              <input
                                type="number"
                                class="barcode-print-size-quantity"
                                data-size="${escapeBarcodeLabelHTML(item.size)}"
                                min="1"
                                max="500"
                                step="1"
                                value="1"
                                disabled
                                style="
                                  width:58px;
                                  height:27px;
                                  padding:2px 5px;
                                  font-size:12px;
                                  text-align:center;
                                "
                                aria-label="Quantidade de etiquetas do tamanho ${escapeBarcodeLabelHTML(item.size)}">

                            </div>
                          `)
                          .join("")}

                      </div>

                      <small
                        class="muted"
                        style="
                          display:block;
                          margin-top:8px;
                        ">
                        Marque os tamanhos e informe quantas etiquetas deseja imprimir de cada um.
                      </small>

                    </div>
                  `
                  : `
                    <label>

                      Quantidade

                      <input
                        id="barcode-print-quantity"
                        type="number"
                        min="1"
                        max="500"
                        step="1"
                        value="1"
                        required>

                    </label>
                  `
              }


              <label>

                Tamanho da etiqueta

                <select
                  id="barcode-print-size">

                  <option
                    value="40x25"
                    ${settings.size === "40x25" ? "selected" : ""}>
                    40 × 25 mm
                  </option>

                  <option
                    value="50x30"
                    ${settings.size === "50x30" ? "selected" : ""}>
                    50 × 30 mm
                  </option>

                  <option
                    value="60x40"
                    ${settings.size === "60x40" ? "selected" : ""}>
                    60 × 40 mm
                  </option>

                </select>

              </label>


              <label>

                Tipo de impressão

                <select
                  id="barcode-print-page-mode">

                  <option
                    value="mo5812"
                    ${settings.pageMode === "mo5812" ? "selected" : ""}>
                    Átomo MO-5812 — Bobina 58 mm
                  </option>

                  <option
                    value="a4"
                    ${settings.pageMode === "a4" ? "selected" : ""}>
                    Folha A4 — várias etiquetas
                  </option>

                  <option
                    value="thermal"
                    ${settings.pageMode === "thermal" ? "selected" : ""}>
                    Etiqueta adesiva — configurar depois
                  </option>

                </select>

              </label>


              <label class="barcode-print-checkbox">

                <input
                  id="barcode-print-show-price"
                  type="checkbox"
                  ${settings.showPrice ? "checked" : ""}>

                <span>
                  Mostrar preço na etiqueta
                </span>

              </label>

            </div>


            <div class="barcode-print-preview-info">

              <strong>
                Código:
              </strong>

              ${escapeBarcodeLabelHTML(barcode)}

            </div>


            <div class="barcode-print-actions">

              <button
                type="button"
                class="btn secondary"
                id="barcode-print-cancel">
                Cancelar
              </button>

              <button
                type="submit"
                class="btn primary">
                🖨️ Imprimir
              </button>

            </div>

          </form>

        </div>
      `;


    document.body.appendChild(
      modal
    );


    const quantityInput =
      $("#barcode-print-quantity");


    setTimeout(
      () => {

        quantityInput?.focus();

        quantityInput?.select();

      },
      50
    );


    $(".barcode-print-close")
      ?.addEventListener(
        "click",
        closeBarcodePrintDialog
      );


    $("#barcode-print-cancel")
      ?.addEventListener(
        "click",
        closeBarcodePrintDialog
      );


    $$(".barcode-print-size-check").forEach(
      checkbox => {
        checkbox.addEventListener(
          "change",
          () => {
            const size =
              String(
                checkbox.dataset.size ||
                ""
              );

            const quantityInput =
              $$(".barcode-print-size-quantity")
                .find(
                  input =>
                    String(
                      input.dataset.size ||
                      ""
                    ) === size
                );

            if (
              quantityInput
            ) {
              quantityInput.disabled =
                !checkbox.checked;

              if (
                checkbox.checked
              ) {
                quantityInput.focus();
                quantityInput.select();
              }
            }
          }
        );
      }
    );


    modal.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          modal
        ) {

          closeBarcodePrintDialog();
        }
      }
    );


    $("#barcode-print-form")
      ?.addEventListener(
        "submit",
        event => {

          event.preventDefault();


          const size =
            $("#barcode-print-size")
              .value;


          const pageMode =
            $("#barcode-print-page-mode")
              .value;


          const showPrice =
            $("#barcode-print-show-price")
              .checked;


          let quantity = 1;

          let printItems = [];


          if (
            product.useSizes
          ) {

            const checkedSizes =
              Array.from(
                document.querySelectorAll(
                  ".barcode-print-size-check:checked"
                )
              );


            if (
              !checkedSizes.length
            ) {
              return toast(
                "Selecione pelo menos uma numeração."
              );
            }


            printItems =
              checkedSizes.map(
                checkbox => {

                  const productSize =
                    String(
                      checkbox.dataset.size ||
                      ""
                    ).trim();


                  const quantityInput =
                    Array.from(
                      document.querySelectorAll(
                        ".barcode-print-size-quantity"
                      )
                    ).find(
                      input =>
                        String(
                          input.dataset.size ||
                          ""
                        ) === productSize
                    );


                  const itemQuantity =
                    Number(
                      quantityInput?.value ||
                      0
                    );


                  const sizeData =
                    Array.isArray(
                      product.sizes
                    )
                      ? product.sizes.find(
                          item =>
                            String(
                              item.size
                            ) ===
                            productSize
                        )
                      : null;


                  const itemBarcode =
                    sizeData?.barcode ||
                    generateProductSizeBarcode(
                      product.barcode,
                      productSize
                    );


                  return {
                    size:
                      productSize,

                    quantity:
                      itemQuantity,

                    barcode:
                      itemBarcode
                  };
                }
              );


            const invalidItem =
              printItems.find(
                item =>
                  !Number.isInteger(
                    item.quantity
                  ) ||
                  item.quantity < 1 ||
                  item.quantity > 500
              );


            if (
              invalidItem
            ) {
              return toast(
                `Quantidade inválida para o tamanho ${invalidItem.size}.`
              );
            }


            const totalLabels =
              printItems.reduce(
                (sum, item) =>
                  sum +
                  item.quantity,
                0
              );


            if (
              totalLabels > 500
            ) {
              return toast(
                "O total de etiquetas não pode ultrapassar 500."
              );
            }


            quantity =
              printItems[0].quantity;

          } else {

            quantity =
              Number(
                $("#barcode-print-quantity")
                  ?.value
              );


            if (
              !Number.isInteger(quantity) ||
              quantity < 1 ||
              quantity > 500
            ) {
              return toast(
                "A quantidade deve ser entre 1 e 500."
              );
            }
          }


          const firstPrintItem =
            printItems[0] ||
            null;


          const printSettings = {
            quantity,
            size,
            pageMode,
            showPrice,

            productSize:
              firstPrintItem?.size ||
              "",

            barcode:
              firstPrintItem?.barcode ||
              product.barcode,

            printItems
          };

          saveBarcodePrintSettings(
            printSettings
          );


          // O popup é aberto diretamente durante
          // o clique em Imprimir para evitar bloqueio.

          const printWindow =
            window.open(
              "",
              "_blank",
              "width=1000,height=750"
            );


          if (
            !printWindow
          ) {

            return toast(
              "O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente."
            );
          }


          closeBarcodePrintDialog();


          executeProductBarcodePrint(
            product,
            printSettings,
            printWindow
          );
        }
      );
  }


  async function executeProductBarcodePrint(
    product,
    settings,
    printWindow
  ) {

    const printItems =
      Array.isArray(
        settings.printItems
      ) &&
      settings.printItems.length
        ? settings.printItems
        : [
            {
              size:
                settings.productSize ||
                "",

              quantity:
                settings.quantity,

              barcode:
                settings.barcode ||
                product.barcode
            }
          ];


    printWindow.document.write(
      `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Preparando etiquetas...</title>
        </head>

        <body
          style="
            font-family:Arial,sans-serif;
            padding:30px;
          ">
          Preparando etiquetas...
        </body>
        </html>
      `
    );


    printWindow.document.close();


    try {

      await loadBarcodePrintLibrary();


      const dimensions =
        getBarcodeLabelDimensions(
          settings.size
        );


      const companyName =
        String(
          state.settings?.companyName ||
          "Perowba Gestão"
        );


      const price =
        Number(
          product.price ||
          0
        ).toLocaleString(
          "pt-BR",
          {
            style:
              "currency",

            currency:
              "BRL"
          }
        );


      const safeCompany =
        escapeBarcodeLabelHTML(
          companyName
        );


      const safeProduct =
        escapeBarcodeLabelHTML(
          product.name
        );


      const safePrice =
        escapeBarcodeLabelHTML(
          price
        );


      const priceMarkup =
        settings.showPrice
          ? `
              <div class="label-price">
                ${safePrice}
              </div>
            `
          : "";


      const labels =
        printItems
          .map(
            item => {

              const itemBarcode =
                String(
                  item.barcode ||
                  product.barcode ||
                  ""
                ).trim();


              const itemSize =
                String(
                  item.size ||
                  ""
                ).trim();


              const itemQuantity =
                Number(
                  item.quantity ||
                  0
                );


              if (
                !itemBarcode ||
                !Number.isInteger(
                  itemQuantity
                ) ||
                itemQuantity < 1
              ) {
                return "";
              }


              const barcodeSVG =
                document.createElementNS(
                  "http://www.w3.org/2000/svg",
                  "svg"
                );


              window.JsBarcode(
                barcodeSVG,
                itemBarcode,
                {
                  format:
                    "CODE128",

                  width:
                    2,

                  height:
                    55,

                  displayValue:
                    false,

                  margin:
                    0
                }
              );


              const barcodeMarkup =
                barcodeSVG.outerHTML;


              const safeBarcode =
                escapeBarcodeLabelHTML(
                  itemBarcode
                );


              const productSizeLabel =
                itemSize
                  ? `Tam. ${escapeBarcodeLabelHTML(itemSize)}`
                  : "";


              return Array.from(
                {
                  length:
                    itemQuantity
                },
                () => `
                  <div class="barcode-label">

                    <div class="label-company">
                      ${safeCompany}
                    </div>

                    <div class="label-product">
                      ${safeProduct}
                    </div>

                    ${
                      productSizeLabel
                        ? `
                          <div
                            class="label-size"
                            style="
                              font-weight:700;
                              font-size:11px;
                              margin-top:1px;
                            ">
                            ${productSizeLabel}
                          </div>
                        `
                        : ""
                    }

                    ${priceMarkup}

                    <div class="label-barcode">
                      ${barcodeMarkup}
                    </div>

                    <div class="label-code">
                      ${safeBarcode}
                    </div>

                  </div>
                `
              ).join("");
            }
          )
          .join("");

      const thermal =
        settings.pageMode ===
        "thermal";


      const mo5812 =
        settings.pageMode ===
        "mo5812";


      const bodyDisplay =
        thermal || mo5812
          ? "block"
          : "grid";


      const gridColumns =
        thermal || mo5812
          ? ""
          : `
              grid-template-columns:
                repeat(
                  auto-fill,
                  ${dimensions.width}mm
                );

              grid-auto-rows:
                ${dimensions.height}mm;
            `;


      const thermalLabelRules =
        thermal
          ? `
              .barcode-label {
                margin: 0 !important;

                page-break-after:
                  always;

                break-after:
                  page;
              }

              .barcode-label:last-child {
                page-break-after:
                  auto;

                break-after:
                  auto;
              }
            `
          : "";


      // MO5812 PRINT RULES

      const mo5812Rules =
        mo5812
          ? `
              body {
                width: 58mm !important;
                max-width: 58mm !important;

                margin: 0 !important;
                padding: 0 !important;

                overflow: visible !important;
              }


              .barcode-label {
                width: 48mm !important;
                height: auto !important;
                min-height: 30mm;

                margin:
                  0 auto 2mm auto !important;

                padding:
                  2mm 1.5mm !important;

                border: none !important;

                page-break-after:
                  auto !important;

                break-after:
                  auto !important;
              }


              .label-company {
                font-size:
                  7pt !important;
              }


              .label-product {
                font-size:
                  8pt !important;

                white-space:
                  normal !important;

                overflow:
                  visible !important;

                text-overflow:
                  clip !important;
              }


              .label-price {
                font-size:
                  13pt !important;

                margin:
                  1mm 0 !important;
              }


              .label-barcode {
                width:
                  46mm !important;

                max-width:
                  46mm !important;
              }


              .label-barcode svg {
                width:
                  46mm !important;

                max-width:
                  46mm !important;

                height:
                  13mm !important;
              }


              .label-code {
                font-size:
                  7pt !important;

                letter-spacing:
                  0.2px !important;
              }


              .barcode-label:not(:last-child)::after {
                content: "";

                display:
                  block;

                width:
                  42mm;

                margin-top:
                  2mm;

                border-bottom:
                  0.2mm dashed
                  #999;
              }
            `
          : "";

      const pageRule =
        mo5812
          ? `
              @page {
                margin: 0;
              }
            `
          : thermal
            ? `
                @page {
                  size:
                    ${dimensions.width}mm
                    ${dimensions.height}mm;

                  margin: 0;
                }
              `
            : `
                @page {
                  size: A4;
                  margin: 4mm;
                }
              `;


      const documentPadding =
        thermal || mo5812
          ? "0"
          : "0";


      const documentGap =
        thermal || mo5812
          ? "0"
          : "2mm";


      const productFont =
        dimensions.width <= 40
          ? "7pt"
          : "8pt";


      const priceFont =
        dimensions.width <= 40
          ? "10pt"
          : "12pt";


      const codeFont =
        dimensions.width <= 40
          ? "5.8pt"
          : "6.5pt";


      const printHTML =
        `
          <!DOCTYPE html>

          <html lang="pt-BR">

          <head>

            <meta charset="UTF-8">

            <title>
              Etiquetas - ${safeProduct}
            </title>


            <style>

              * {
                box-sizing:
                  border-box;
              }


              html,
              body {
                margin: 0;

                padding:
                  ${documentPadding};

                background:
                  #fff;

                color:
                  #000;
              }


              body {
                display:
                  ${bodyDisplay};

                ${gridColumns}

                gap:
                  ${documentGap};

                align-content:
                  start;

                font-family:
                  Arial,
                  Helvetica,
                  sans-serif;
              }


              .barcode-label {
                width:
                  ${dimensions.width}mm;

                height:
                  ${dimensions.height}mm;

                display:
                  flex;

                flex-direction:
                  column;

                align-items:
                  center;

                justify-content:
                  center;

                overflow:
                  hidden;

                padding:
                  1.8mm;

                background:
                  #fff;

                text-align:
                  center;

                border:
                  0.2mm dashed
                  #c7c7c7;

                break-inside:
                  avoid;

                page-break-inside:
                  avoid;
              }


              .label-company {
                width:
                  100%;

                overflow:
                  hidden;

                margin-bottom:
                  0.4mm;

                font-size:
                  6.5pt;

                font-weight:
                  700;

                text-overflow:
                  ellipsis;

                white-space:
                  nowrap;
              }


              .label-product {
                width:
                  100%;

                overflow:
                  hidden;

                font-size:
                  ${productFont};

                font-weight:
                  700;

                line-height:
                  1.05;

                text-overflow:
                  ellipsis;

                white-space:
                  nowrap;
              }


              .label-price {
                margin:
                  0.6mm 0;

                font-size:
                  ${priceFont};

                font-weight:
                  800;

                line-height:
                  1;
              }


              .label-barcode {
                width:
                  100%;

                display:
                  flex;

                align-items:
                  center;

                justify-content:
                  center;

                overflow:
                  hidden;

                margin-top:
                  ${settings.showPrice ? "0" : "1mm"};
              }


              .label-barcode svg {
                width:
                  calc(
                    ${dimensions.width}mm
                    - 6mm
                  );

                max-width:
                  100%;

                height:
                  ${dimensions.barcodeHeight}mm;
              }


              .label-code {
                max-width:
                  100%;

                overflow:
                  hidden;

                margin-top:
                  0.3mm;

                font-family:
                  "Courier New",
                  monospace;

                font-size:
                  ${codeFont};

                letter-spacing:
                  0.3px;

                text-overflow:
                  ellipsis;

                white-space:
                  nowrap;
              }


              ${thermalLabelRules}

              ${mo5812Rules}


              @media print {

                .barcode-label {
                  border:
                    none;
                }
              }


              ${pageRule}

            </style>

          </head>


          <body>

            ${labels}

          </body>

          </html>
        `;


      printWindow.document.open();


      printWindow.document.write(
        printHTML
      );


      printWindow.document.close();


      setTimeout(
        () => {

          printWindow.focus();

          printWindow.print();

        },
        400
      );


    } catch (error) {

      console.error(
        "Erro ao gerar etiqueta:",
        error
      );


      try {

        printWindow.close();

      } catch (closeError) {

        // Ignora erro ao fechar popup.
      }


      toast(
        error.message ||
        "Não foi possível gerar as etiquetas."
      );
    }
  }


  function printProductBarcode(
    product
  ) {

    openBarcodePrintDialog(
      product
    );
  }

  function bindProductTableActions() {
    $$("[data-edit-product]").forEach(
      btn =>
        btn.addEventListener(
          "click",
          () => {
            if (!canManage()) {
              return toast(
                "Seu perfil não pode editar produtos."
              );
            }

            const p =
              state.products.find(
                item =>
                  item.id ===
                  btn.dataset.editProduct
              );

            if (!p) return;

            $("#product-id").value = p.id;
            $("#product-name").value = p.name;
            $("#product-sku").value = p.sku;
            setProductBarcodeMode(
              p.barcode ||
              ""
            );
            $("#product-category").value = p.category || "";
            $("#product-brand").value = p.brand || "";
            $("#product-unit").value = p.unit;
            $("#product-cost").value = p.cost;
            $("#product-price").value = p.price;
            $("#product-stock").value = p.stock;
            $("#product-min-stock").value = p.minStock;
            $("#product-location").value = p.location || "";
            $("#product-active").value = String(p.active);

            const savedSizes =
              Array.isArray(p.sizes)
                ? p.sizes
                : [];

            const productUsesSizes =
              Boolean(
                p.useSizes ||
                savedSizes.length
              );

            $("#product-use-sizes").checked =
              productUsesSizes;

            $("#product-sizes-container")
              ?.classList
              .toggle(
                "hidden",
                !productUsesSizes
              );

            $$(".product-size-stock").forEach(
              input => {
                const saved =
                  savedSizes.find(
                    item =>
                      String(item.size) ===
                      String(input.dataset.size)
                  );

                input.value =
                  saved
                    ? Number(saved.stock || 0)
                    : 0;
              }
            );

            $("#cancel-product-edit")
              .classList
              .remove("hidden");

            window.scrollTo({
              top: 0,
              behavior: "smooth"
            });
          }
        )
    );

    // PRINT BARCODE BUTTON EVENTS

    $$("[data-print-barcode]").forEach(
      btn =>
        btn.addEventListener(
          "click",
          () => {

            const product =
              state.products.find(
                item =>
                  item.id ===
                  btn.dataset.printBarcode
              );


            if (
              !product
            ) {

              return toast(
                "Produto não encontrado."
              );
            }


            printProductBarcode(
              product
            );
          }
        )
    );

    $$("[data-toggle-product]").forEach(
      btn =>
        btn.addEventListener(
          "click",
          () => {
            if (!canManage()) {
              return toast(
                "Seu perfil não pode alterar produtos."
              );
            }

            const p =
              state.products.find(
                item =>
                  item.id ===
                  btn.dataset.toggleProduct
              );

            const before =
              structuredClone(p);

            p.active =
              !p.active;

            p.updatedAt =
              nowISO();

            logAudit(
              "ATUALIZAR",
              "Produto",
              `${p.name}: ${
                p.active
                  ? "ativado"
                  : "desativado"
              }`,
              before,
              p
            );

            saveState();

            renderProducts();
          }
        )
    );
  }

  function renderStock() {
    $("#content").innerHTML = `
      <div class="grid two">
        <article class="card">
          <div class="card-header">
            <h2>Registrar movimentação</h2>
          </div>

          <div class="card-body">
            <form id="stock-form" class="form-grid two-columns">
              <label>
                Produto*
                <select id="stock-product" required>
                  ${state.products
                    .filter(p => p.active)
                    .map(
                      p =>
                        `<option value="${p.id}">
                          ${escapeHTML(p.name)} (${p.stock})
                        </option>`
                    )
                    .join("")}
                </select>
              </label>

              <label>
                Tipo*
                <select id="stock-type">
                  <option>Entrada por compra</option>
                  <option>Ajuste positivo</option>
                  <option>Ajuste negativo</option>
                  <option>Perda</option>
                  <option>Produto danificado</option>
                  <option>Uso interno</option>
                  <option>Bonificação</option>
                  <option>Inventário</option>
                </select>
              </label>

              <label>
                Quantidade*
                <input
                  id="stock-quantity"
                  type="number"
                  min="1"
                  step="1"
                  required>
              </label>

              <label>
                Motivo / documento*
                <input
                  id="stock-reason"
                  required>
              </label>

              <div class="form-actions">
                <button
                  class="btn primary"
                  type="submit">
                  Registrar movimentação
                </button>
              </div>
            </form>
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>Posição do estoque</h2>
          </div>

          <div class="card-body">
            <div class="kpi-inline">
              <div>
                <strong>
                  ${state.products.reduce(
                    (s,p) =>
                      s + p.stock,
                    0
                  )}
                </strong>

                <span>
                  Unidades em estoque
                </span>
              </div>

              <div>
                <strong>
                  ${money(
                    state.products.reduce(
                      (s,p) =>
                        s +
                        p.stock *
                        p.cost,
                      0
                    )
                  )}
                </strong>

                <span>
                  Valor pelo custo
                </span>
              </div>

              <div>
                <strong>
                  ${state.products.filter(
                    p =>
                      p.stock <=
                      p.minStock
                  ).length}
                </strong>

                <span>
                  Produtos em alerta
                </span>
              </div>
            </div>

            <div
              class="warning-box"
              style="margin-top:18px">
              Ajustes negativos, perdas e inventários exigem justificativa. Em produção, permissões e aprovação do gerente devem ser aplicadas no banco.
            </div>
          </div>
        </article>
      </div>

      <article
        class="card"
        style="margin-top:18px">

        <div class="card-header">
          <h2>Histórico de movimentações</h2>
        </div>

        <div class="table-wrap">
          ${stockMovementsTable(
            state.stockMovements
          )}
        </div>
      </article>
    `;

    $("#stock-form")
      .addEventListener(
        "submit",
        async event => {

          event.preventDefault();

          if (!canManageStock()) {
            return toast(
              "Seu perfil não pode realizar ajustes manuais."
            );
          }

          const product =
            state.products.find(
              p =>
                p.id ===
                $("#stock-product").value
            );

          const type =
            $("#stock-type").value;

          const rawQty =
            Number(
              $("#stock-quantity").value
            );

          if (cloudEnabled()) {
            try {
              await window.firebaseService
                .registerStockMovement({
                  productId:
                    product.id,

                  type,

                  quantity:
                    rawQty,

                  reason:
                    $("#stock-reason")
                      .value
                      .trim()
                });

              await refreshCloudState();

              toast(
                "Movimentação registrada com segurança."
              );

              renderStock();

            } catch (error) {
              toast(
                error.message ||
                "Não foi possível movimentar o estoque."
              );
            }

            return;
          }

          const negativeTypes = [
            "Ajuste negativo",
            "Perda",
            "Produto danificado",
            "Uso interno"
          ];

          const qty =
            negativeTypes.includes(type)
              ? -rawQty
              : rawQty;

          if (
            !state.settings.allowNegativeStock &&
            product.stock + qty < 0
          ) {
            return toast(
              "Esta movimentação deixaria o estoque negativo."
            );
          }

          const before =
            product.stock;

          product.stock +=
            qty;

          product.updatedAt =
            nowISO();

          const movement = {
            id:
              uid("mov"),

            productId:
              product.id,

            productName:
              product.name,

            type,

            quantity:
              qty,

            before,

            after:
              product.stock,

            reason:
              $("#stock-reason")
                .value
                .trim(),

            userId:
              currentUser.id,

            userName:
              currentUser.name,

            createdAt:
              nowISO()
          };

          state.stockMovements
            .unshift(
              movement
            );

          logAudit(
            "MOVIMENTAR",
            "Estoque",
            `${type}: ${product.name}`,
            {
              stock:
                before
            },
            {
              stock:
                product.stock
            }
          );

          saveState();

          toast(
            "Movimentação registrada."
          );

          renderStock();
        }
      );
  }

  function stockMovementsTable(movements) {
    if (!movements.length) {
      return `<div class="empty-state">Nenhuma movimentação registrada.</div>`;
    }

    return `<table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Produto</th>
          <th>Tipo</th>
          <th>Qtd.</th>
          <th>Antes</th>
          <th>Depois</th>
          <th>Motivo</th>
          <th>Usuário</th>
        </tr>
      </thead>

      <tbody>
        ${movements
          .slice(0,150)
          .map(
            m =>
              `<tr>
                <td>
                  ${dateBR(m.createdAt)}
                </td>

                <td>
                  ${escapeHTML(m.productName)}
                </td>

                <td>
                  ${escapeHTML(m.type)}
                </td>

                <td
                  class="${
                    m.quantity < 0
                      ? "text-danger"
                      : "text-success"
                  }">

                  ${
                    m.quantity > 0
                      ? "+"
                      : ""
                  }${m.quantity}
                </td>

                <td>${m.before}</td>

                <td>${m.after}</td>

                <td>
                  ${escapeHTML(m.reason)}
                </td>

                <td>
                  ${escapeHTML(m.userName)}
                </td>
              </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
  }

  function renderCustomers() {
    renderSimpleRegister({
      entity:
        "cliente",

      title:
        "Novo cliente",

      items:
        state.customers,

      fields: [
        ["name","Nome / razão social","text",true],
        ["document","CPF / CNPJ","text",false],
        ["phone","Telefone / WhatsApp","tel",false],
        ["email","E-mail","email",false],
        ["status","Status","select",false,["ativo","bloqueado"]]
      ],

      columns: [
        "Nome",
        "Documento",
        "Telefone",
        "E-mail",
        "Status"
      ],

      values:
        item => [
          item.name,
          item.document || "—",
          item.phone || "—",
          item.email || "—",
          statusBadge(item.status)
        ],

      onSave:
        payload => {

          const item = {
            id:
              uid("cli"),

            ...payload,

            createdAt:
              nowISO()
          };

          state.customers
            .unshift(item);

          logAudit(
            "CRIAR",
            "Cliente",
            item.name,
            null,
            item
          );
        }
    });
  }

  function renderSuppliers() {
    renderSimpleRegister({
      entity:
        "fornecedor",

      title:
        "Novo fornecedor",

      items:
        state.suppliers,

      fields: [
        ["company","Razão social / nome fantasia","text",true],
        ["document","CNPJ","text",false],
        ["contact","Contato comercial","text",false],
        ["phone","Telefone","tel",false],
        ["email","E-mail","email",false],
        ["leadTime","Prazo médio (dias)","number",false],
        ["status","Status","select",false,["ativo","inativo"]]
      ],

      columns: [
        "Fornecedor",
        "CNPJ",
        "Contato",
        "Telefone",
        "Prazo",
        "Status"
      ],

      values:
        item => [
          item.company,
          item.document || "—",
          item.contact || "—",
          item.phone || "—",
          `${item.leadTime || 0} dias`,
          statusBadge(item.status)
        ],

      onSave:
        payload => {
          payload.leadTime =
            Number(
              payload.leadTime ||
              0
            );

          const item = {
            id:
              uid("for"),

            ...payload,

            createdAt:
              nowISO()
          };

          state.suppliers
            .unshift(item);

          logAudit(
            "CRIAR",
            "Fornecedor",
            item.company,
            null,
            item
          );
        }
    });
  }

  function renderSimpleRegister(config) {
    const fieldHTML =
      config.fields.map(
        (
          [
            key,
            label,
            type,
            required,
            options
          ]
        ) => {
          if (type === "select") {
            return `<label>
              ${label}
              <select
                id="${config.entity}-${key}">
                ${options
                  .map(
                    o =>
                      `<option value="${o}">
                        ${o}
                      </option>`
                  )
                  .join("")}
              </select>
            </label>`;
          }

          return `<label>
            ${label}${required ? "*" : ""}
            <input
              id="${config.entity}-${key}"
              type="${type}"
              ${required ? "required" : ""}>
          </label>`;
        }
      )
      .join("");

    $("#content").innerHTML = `
      <div class="grid two">
        <article class="card">
          <div class="card-header">
            <h2>${config.title}</h2>
          </div>

          <div class="card-body">
            <form
              id="${config.entity}-form"
              class="form-grid two-columns">

              ${fieldHTML}

              <div class="form-actions">
                <button
                  class="btn primary"
                  type="submit">
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>Resumo</h2>
          </div>

          <div class="card-body">
            <div class="kpi-inline">
              <div>
                <strong>
                  ${config.items.length}
                </strong>

                <span>
                  Cadastros totais
                </span>
              </div>

              <div>
                <strong>
                  ${config.items.filter(
                    i =>
                      ["ativo","ativa"]
                        .includes(i.status)
                  ).length}
                </strong>

                <span>
                  Ativos
                </span>
              </div>
            </div>
          </div>
        </article>
      </div>

      <article
        class="card"
        style="margin-top:18px">

        <div class="card-header">
          <h2>
            Lista de ${config.entity}s
          </h2>
        </div>

        <div class="table-wrap">
          ${
            config.items.length
              ? `<table>
                  <thead>
                    <tr>
                      ${config.columns
                        .map(
                          c =>
                            `<th>${c}</th>`
                        )
                        .join("")}
                    </tr>
                  </thead>

                  <tbody>
                    ${config.items
                      .map(
                        item =>
                          `<tr>
                            ${config
                              .values(item)
                              .map(
                                v =>
                                  `<td>${
                                    typeof v === "string" &&
                                    v.startsWith("<span")
                                      ? v
                                      : escapeHTML(v)
                                  }</td>`
                              )
                              .join("")}
                          </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="empty-state">
                  Nenhum cadastro encontrado.
                </div>`
          }
        </div>
      </article>
    `;

    $(`#${config.entity}-form`)
      .addEventListener(
        "submit",
        event => {

          event.preventDefault();

          const payload = {};

          config.fields.forEach(
            ([key]) =>
              payload[key] =
                $(`#${config.entity}-${key}`)
                  .value
                  .trim()
          );

          config.onSave(
            payload
          );

          saveState();

          toast(
            "Cadastro salvo com sucesso."
          );

          renderRoute();
        }
      );
  }

  function renderPurchases() {
    $("#content").innerHTML = `
      <div class="grid two">
        <article class="card">
          <div class="card-header">
            <h2>Registrar compra recebida</h2>
          </div>

          <div class="card-body">
            <form
              id="purchase-form"
              class="form-grid two-columns">

              <label>
                Fornecedor
                <select id="purchase-supplier">
                  ${state.suppliers
                    .filter(
                      s =>
                        s.status === "ativo"
                    )
                    .map(
                      s =>
                        `<option value="${s.id}">
                          ${escapeHTML(s.company)}
                        </option>`
                    )
                    .join("")}
                </select>
              </label>

              <label>
                Produto
                <select id="purchase-product">
                  ${state.products
                    .filter(
                      p => p.active
                    )
                    .map(
                      p =>
                        `<option value="${p.id}">
                          ${escapeHTML(p.name)}
                        </option>`
                    )
                    .join("")}
                </select>
              </label>

              <label>
                Quantidade
                <input
                  id="purchase-qty"
                  type="number"
                  min="1"
                  required>
              </label>

              <label>
                Custo unitário
                <input
                  id="purchase-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  required>
              </label>

              <label>
                Frete
                <input
                  id="purchase-freight"
                  type="number"
                  min="0"
                  step="0.01"
                  value="0">
              </label>

              <label>
                Documento / NF
                <input
                  id="purchase-document">
              </label>

              <div class="form-actions">
                <button
                  class="btn primary"
                  type="submit">
                  Receber e dar entrada
                </button>
              </div>
            </form>
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>Fluxo profissional</h2>
          </div>

          <div class="card-body">
            <p class="muted">
              Este protótipo registra compras já recebidas. A versão completa terá pedido, aprovação, recebimento parcial, impostos, anexos e contas a pagar.
            </p>

            <div class="notice">
              Ao receber, o estoque é atualizado e uma movimentação é criada automaticamente.
            </div>
          </div>
        </article>
      </div>

      <article
        class="card"
        style="margin-top:18px">

        <div class="card-header">
          <h2>Compras registradas</h2>
        </div>

        <div class="table-wrap">
          ${
            state.purchases.length
              ? `<table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Fornecedor</th>
                      <th>Produto</th>
                      <th>Qtd.</th>
                      <th>Total</th>
                      <th>Documento</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${state.purchases
                      .map(
                        p =>
                          `<tr>
                            <td>${dateBR(p.createdAt)}</td>
                            <td>${escapeHTML(p.supplierName)}</td>
                            <td>${escapeHTML(p.productName)}</td>
                            <td>${p.qty}</td>
                            <td>${money(p.total)}</td>
                            <td>${escapeHTML(p.document || "—")}</td>
                            <td>${statusBadge(p.status)}</td>
                          </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="empty-state">
                  Nenhuma compra registrada.
                </div>`
          }
        </div>
      </article>
    `;

    $("#purchase-product")
      .addEventListener(
        "change",
        event => {

          const product =
            state.products.find(
              p =>
                p.id ===
                event.target.value
            );

          $("#purchase-cost").value =
            product?.cost || "";
        }
      );

    $("#purchase-product")
      .dispatchEvent(
        new Event("change")
      );

    $("#purchase-form")
      .addEventListener(
        "submit",
        async event => {

          event.preventDefault();

          if (!canManageStock()) {
            return toast(
              "Seu perfil não pode registrar compras."
            );
          }

          const supplier =
            state.suppliers.find(
              s =>
                s.id ===
                $("#purchase-supplier").value
            );

          const product =
            state.products.find(
              p =>
                p.id ===
                $("#purchase-product").value
            );

          const qty =
            Number(
              $("#purchase-qty").value
            );

          const unitCost =
            Number(
              $("#purchase-cost").value
            );

          const freight =
            Number(
              $("#purchase-freight").value ||
              0
            );

          const total =
            qty *
            unitCost +
            freight;

          if (cloudEnabled()) {
            try {
              await window.firebaseService
                .receivePurchase({
                  supplierId:
                    supplier.id,

                  productId:
                    product.id,

                  quantity:
                    qty,

                  unitCost,

                  freight,

                  document:
                    $("#purchase-document")
                      .value
                      .trim()
                });

              await refreshCloudState();

              toast(
                "Compra recebida e estoque atualizado com segurança."
              );

              renderPurchases();

            } catch (error) {
              toast(
                error.message ||
                "Não foi possível registrar a compra."
              );
            }

            return;
          }

          const purchase = {
            id:
              uid("com"),

            supplierId:
              supplier.id,

            supplierName:
              supplier.company,

            productId:
              product.id,

            productName:
              product.name,

            qty,

            unitCost,

            freight,

            total,

            document:
              $("#purchase-document")
                .value
                .trim(),

            status:
              "recebido",

            createdAt:
              nowISO()
          };

          const before =
            product.stock;

          product.stock +=
            qty;

          product.cost =
            unitCost;

          product.updatedAt =
            nowISO();

          state.purchases
            .unshift(
              purchase
            );

          state.stockMovements
            .unshift({
              id:
                uid("mov"),

              productId:
                product.id,

              productName:
                product.name,

              type:
                "Entrada por compra",

              quantity:
                qty,

              before,

              after:
                product.stock,

              reason:
                purchase.document ||
                `Compra ${purchase.id}`,

              userId:
                currentUser.id,

              userName:
                currentUser.name,

              createdAt:
                nowISO()
            });

          state.financialEntries
            .unshift({
              id:
                uid("fin"),

              type:
                "despesa",

              category:
                "Compras",

              description:
                `Compra de ${product.name}`,

              amount:
                total,

              dueDate:
                todayISO(),

              status:
                "pendente",

              relatedId:
                purchase.id,

              createdAt:
                nowISO()
            });

          logAudit(
            "CRIAR",
            "Compra",
            `${supplier.company}: ${product.name}`,
            null,
            purchase
          );

          saveState();

          toast(
            "Compra recebida e estoque atualizado."
          );

          renderPurchases();
        }
      );
  }

  function getOpenCash() {
    return state.cashSessions.find(
      c =>
        c.status === "aberto" &&
        c.userId === currentUser.id
    );
  }

  function renderCash() {
    const openCash =
      getOpenCash();

    const relatedSales =
      openCash
        ? state.sales.filter(
            s =>
              s.createdAt >= openCash.openedAt &&
              s.status !== "cancelado"
          )
        : [];

    const expected =
      openCash
        ? openCash.openingAmount +
          relatedSales.reduce(
            (sum,s) =>
              sum + s.total,
            0
          )
        : 0;

    $("#content").innerHTML = `
      <div class="grid two">
        <article class="card">
          <div class="card-header">
            <h2>
              ${openCash
                ? "Caixa aberto"
                : "Abrir caixa"}
            </h2>
          </div>

          <div class="card-body">
            ${openCash
              ? `
                <div class="kpi-inline">
                  <div>
                    <strong>
                      ${money(openCash.openingAmount)}
                    </strong>
                    <span>Valor inicial</span>
                  </div>

                  <div>
                    <strong>
                      ${money(
                        relatedSales.reduce(
                          (s,v) =>
                            s + v.total,
                          0
                        )
                      )}
                    </strong>
                    <span>Vendas após abertura</span>
                  </div>

                  <div>
                    <strong>
                      ${money(expected)}
                    </strong>
                    <span>Esperado</span>
                  </div>
                </div>

                <form
                  id="close-cash-form"
                  class="form-grid one-column"
                  style="margin-top:18px">

                  <label>
                    Valor contado
                    <input
                      id="cash-counted"
                      type="number"
                      min="0"
                      step="0.01"
                      required>
                  </label>

                  <label>
                    Observação
                    <textarea
                      id="cash-note">
                    </textarea>
                  </label>

                  <button
                    class="btn warning"
                    type="submit">
                    Fechar caixa
                  </button>
                </form>
              `
              : `
                <form
                  id="open-cash-form"
                  class="form-grid one-column">

                  <label>
                    Valor inicial
                    <input
                      id="cash-opening"
                      type="number"
                      min="0"
                      step="0.01"
                      value="0"
                      required>
                  </label>

                  <button
                    class="btn primary"
                    type="submit">
                    Abrir caixa
                  </button>
                </form>
              `
            }
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>Regras de caixa</h2>
          </div>

          <div class="card-body">
            <div class="notice">
              Cada operador possui sua própria sessão. O fechamento registra valor esperado, contado, diferença e justificativa.
            </div>
          </div>
        </article>
      </div>

      <article
        class="card"
        style="margin-top:18px">

        <div class="card-header">
          <h2>Histórico de caixas</h2>
        </div>

        <div class="table-wrap">
          ${
            state.cashSessions.length
              ? `<table>
                  <thead>
                    <tr>
                      <th>Operador</th>
                      <th>Abertura</th>
                      <th>Fechamento</th>
                      <th>Inicial</th>
                      <th>Esperado</th>
                      <th>Contado</th>
                      <th>Diferença</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${state.cashSessions
                      .map(
                        c =>
                          `<tr>
                            <td>${escapeHTML(c.userName)}</td>
                            <td>${dateBR(c.openedAt)}</td>
                            <td>${dateBR(c.closedAt)}</td>
                            <td>${money(c.openingAmount)}</td>
                            <td>${money(c.expectedAmount)}</td>
                            <td>${money(c.countedAmount)}</td>
                            <td>${money(c.difference)}</td>
                            <td>${statusBadge(c.status)}</td>
                          </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="empty-state">
                  Nenhum caixa registrado.
                </div>`
          }
        </div>
      </article>
    `;

    $("#open-cash-form")
      ?.addEventListener(
        "submit",
        event => {

          event.preventDefault();

          const cash = {
            id:
              uid("cx"),

            userId:
              currentUser.id,

            userName:
              currentUser.name,

            openingAmount:
              Number(
                $("#cash-opening").value
              ),

            status:
              "aberto",

            openedAt:
              nowISO(),

            closedAt:
              null,

            expectedAmount:
              null,

            countedAmount:
              null,

            difference:
              null
          };

          state.cashSessions
            .unshift(cash);

          logAudit(
            "ABRIR",
            "Caixa",
            `Caixa aberto por ${currentUser.name}`,
            null,
            cash
          );

          saveState();

          renderCash();
        }
      );

    $("#close-cash-form")
      ?.addEventListener(
        "submit",
        event => {

          event.preventDefault();

          const counted =
            Number(
              $("#cash-counted").value
            );

          openCash.status =
            "fechado";

          openCash.closedAt =
            nowISO();

          openCash.expectedAmount =
            expected;

          openCash.countedAmount =
            counted;

          openCash.difference =
            counted -
            expected;

          openCash.note =
            $("#cash-note")
              .value
              .trim();

          logAudit(
            "FECHAR",
            "Caixa",
            `Diferença: ${money(openCash.difference)}`,
            null,
            openCash
          );

          saveState();

          toast(
            "Caixa fechado."
          );

          renderCash();
        }
      );
  }

  function renderFinance() {
    const income =
  state.financialEntries
    .filter(
      e =>
        e.type === "receita" &&
        e.status !== "cancelado"
    )

    const expense =
  state.financialEntries
    .filter(
      e =>
        e.type === "despesa" &&
        e.status !== "cancelado"
    )

    $("#content").innerHTML = `
      <div class="grid cards">
        ${metricCard(
          "Receitas",
          money(income),
          "Todos os registros"
        )}

        ${metricCard(
          "Despesas",
          money(expense),
          "Todos os registros"
        )}

        ${metricCard(
          "Saldo",
          money(income - expense),
          "Resultado simples"
        )}

        ${metricCard(
          "Pendências",
          state.financialEntries.filter(
            e =>
              e.status === "pendente"
          ).length,
          "Lançamentos pendentes"
        )}
      </div>

      <div
        class="grid two"
        style="margin-top:18px">

        <article class="card">
          <div class="card-header">
            <h2>Novo lançamento</h2>
          </div>

          <div class="card-body">
            <form
              id="finance-form"
              class="form-grid two-columns">

              <label>
                Tipo
                <select id="finance-type">
                  <option value="receita">
                    Receita
                  </option>

                  <option value="despesa">
                    Despesa
                  </option>
                </select>
              </label>

              <label>
                Categoria
                <input
                  id="finance-category"
                  required>
              </label>

              <label>
                Descrição
                <input
                  id="finance-description"
                  required>
              </label>

              <label>
                Valor
                <input
                  id="finance-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required>
              </label>

              <label>
                Vencimento
                <input
                  id="finance-due-date"
                  type="date"
                  value="${todayISO()}"
                  required>
              </label>

              <label>
                Status
                <select id="finance-status">
                  <option>pendente</option>
                  <option>pago</option>
                  <option>vencido</option>
                </select>
              </label>

              <div class="form-actions">
                <button
                  class="btn primary"
                  type="submit">
                  Salvar lançamento
                </button>
              </div>
            </form>
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>Conceitos</h2>
          </div>

          <div class="card-body">
            <p>
              <strong>Faturamento:</strong>
              total vendido.
            </p>

            <p>
              <strong>Lucro bruto:</strong>
              vendas menos custo dos produtos.
            </p>

            <p>
              <strong>Lucro líquido:</strong>
              lucro bruto menos despesas, taxas e outros custos.
            </p>
          </div>
        </article>
      </div>

      <article
        class="card"
        style="margin-top:18px">

        <div class="card-header">
          <h2>Lançamentos</h2>
        </div>

        <div class="table-wrap">
          ${
            state.financialEntries.length
              ? `<table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Tipo</th>
                      <th>Categoria</th>
                      <th>Descrição</th>
                      <th>Vencimento</th>
                      <th>Valor</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${state.financialEntries
                      .map(
                        e =>
                          `<tr>
                            <td>${dateBR(e.createdAt)}</td>
                            <td>${escapeHTML(e.type)}</td>
                            <td>${escapeHTML(e.category)}</td>
                            <td>${escapeHTML(e.description)}</td>
                            <td>${dateOnlyBR(e.dueDate)}</td>
                            <td>${money(e.amount)}</td>
                            <td>${statusBadge(e.status)}</td>
                          </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="empty-state">
                  Nenhum lançamento financeiro.
                </div>`
          }
        </div>
      </article>
    `;

    $("#finance-form")
      .addEventListener(
        "submit",
        event => {

          event.preventDefault();

          const entry = {
            id:
              uid("fin"),

            type:
              $("#finance-type").value,

            category:
              $("#finance-category")
                .value
                .trim(),

            description:
              $("#finance-description")
                .value
                .trim(),

            amount:
              Number(
                $("#finance-amount").value
              ),

            dueDate:
              $("#finance-due-date").value,

            status:
              $("#finance-status").value,

            createdAt:
              nowISO()
          };

          state.financialEntries
            .unshift(entry);

          logAudit(
            "CRIAR",
            "Financeiro",
            entry.description,
            null,
            entry
          );

          saveState();

          toast(
            "Lançamento salvo."
          );

          renderFinance();
        }
      );
  }

  function renderReports() {
    const sellerOnlyToday =
      currentUser?.role === "vendedor";

    const reportToday =
      todayISO();

    const monthStart =
      sellerOnlyToday
        ? reportToday
        : `${reportToday.slice(0,7)}-01`;

    $("#content").innerHTML = `
      <article class="card">
        <div class="card-header">
          <h2>Filtros</h2>
        </div>

        <div class="card-body">
          <div class="form-grid">
            <label>
              Data inicial
              <input
                id="report-start"
                type="date"
                value="${monthStart}"
                ${sellerOnlyToday ? "disabled" : ""}>
            </label>

            <label>
              Data final
              <input
                id="report-end"
                type="date"
                value="${reportToday}"
                ${sellerOnlyToday ? "disabled" : ""}>
            </label>

            <label>
              Status
              <select id="report-status">
                <option value="">
                  Todos
                </option>

                <option>pago</option>

                <option>cancelado</option>
              </select>
            </label>

            <div class="form-actions">
              <button
                id="apply-report"
                class="btn primary"
                type="button">
                Aplicar filtros
              </button>

              <button
                id="export-sales"
                class="btn secondary"
                type="button">
                Exportar vendas CSV
              </button>

              <button
                id="export-stock"
                class="btn secondary"
                type="button">
                Exportar estoque CSV
              </button>

              <button
                class="btn secondary"
                type="button"
                onclick="window.print()">
                Imprimir
              </button>
            </div>
          </div>
        </div>
      </article>

      <div
        id="report-result"
        style="margin-top:18px">
      </div>
    `;

    const apply = () => {
      const start =
        $("#report-start").value;

      const end =
        $("#report-end").value;

      const status =
        $("#report-status").value;

      const filtered =
        state.sales.filter(
          s => {

            const date =
              s.createdAt.slice(
                0,
                10
              );

            return (
              (
                sellerOnlyToday
                  ? date === reportToday
                  : (
                      (!start || date >= start) &&
                      (!end || date <= end)
                    )
              ) &&
              (!status || s.status === status)
            );
          }
        );

      const revenue =
        filtered
          .filter(
            s =>
              s.status !== "cancelado"
          )
          .reduce(
            (sum,s) =>
              sum + s.total,
            0
          );

      const profit =
        filtered
          .filter(
            s =>
              s.status !== "cancelado"
          )
          .reduce(
            (sum,s) =>
              sum + s.profit,
            0
          );

      $("#report-result").innerHTML = `
        <div class="grid three">
          ${metricCard(
            "Vendas filtradas",
            filtered.length,
            `${dateOnlyBR(start)} a ${dateOnlyBR(end)}`
          )}

          ${metricCard(
            "Faturamento",
            money(revenue),
            "Exclui canceladas"
          )}

          ${canViewSensitiveValues()
            ? metricCard(
                "Lucro estimado",
                money(profit),
                "Antes das despesas gerais"
              )
            : ""
          }
        </div>

        <article
          class="card"
          style="margin-top:18px">

          <div class="card-header">
            <h2>${sellerOnlyToday ? "Vendas de hoje" : "Vendas por período"}</h2>
          </div>

          <div class="table-wrap">
            ${salesTable(filtered)}
          </div>
        </article>

        <article
          class="card"
          style="margin-top:18px">

          <div class="card-header">
            <h2>Estoque atual</h2>
          </div>

          <div class="table-wrap">
            ${productsTable(state.products)}
          </div>
        </article>
      `;
    };

    apply();

    $("#apply-report")
      .addEventListener(
        "click",
        apply
      );

    $("#export-sales")
      .addEventListener(
        "click",
        () =>
          exportCSV(
            "vendas.csv",
            [
              [
                "Numero",
                "Data",
                "Cliente",
                "Vendedor",
                "Pagamento",
                "Subtotal",
                "Desconto",
                "Total",
                ...(canViewSensitiveValues() ? ["Lucro"] : []),
                "Status"
              ],

              ...(sellerOnlyToday
                ? state.sales.filter(
                    s =>
                      String(s.createdAt || "")
                        .slice(0, 10) === reportToday
                  )
                : state.sales
              ).map(
                s => [
                  s.number,
                  s.createdAt,
                  s.customerName,
                  s.sellerName,
                  s.payment,
                  s.subtotal,
                  s.discount,
                  s.total,
                  ...(canViewSensitiveValues() ? [s.profit] : []),
                  s.status
                ]
              )
            ]
          )
      );

    $("#export-stock")
      .addEventListener(
        "click",
        () =>
          exportCSV(
            "estoque.csv",
            [
              [
                "SKU",
                "Produto",
                "Categoria",
                ...(canViewSensitiveValues() ? ["Custo"] : []),
                "Preco",
                "Estoque",
                "Minimo",
                "Status"
              ],

              ...state.products.map(
                p => [
                  p.sku,
                  p.name,
                  p.category,
                  ...(canViewSensitiveValues() ? [p.cost] : []),
                  p.price,
                  p.stock,
                  p.minStock,
                  p.active
                    ? "ativo"
                    : "inativo"
                ]
              )
            ]
          )
      );
  }

  function exportCSV(filename, rows) {
    const csv =
      rows
        .map(
          row =>
            row
              .map(
                value =>
                  `"${String(value ?? "")
                    .replace(
                      /"/g,
                      '""'
                    )}"`
              )
              .join(";")
        )
        .join("\n");

    const blob =
      new Blob(
        [
          "\uFEFF" +
          csv
        ],
        {
          type:
            "text/csv;charset=utf-8"
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const a =
      document.createElement(
        "a"
      );

    a.href =
      url;

    a.download =
      filename;

    a.click();

    URL.revokeObjectURL(
      url
    );

    logAudit(
      "EXPORTAR",
      "Relatório",
      filename
    );

    saveState();
  }

  function renderUsers() {
    $("#content").innerHTML = `
      <div class="grid two">
        <article class="card">
          <div class="card-header">
            <h2>Novo usuário</h2>
          </div>

          <div class="card-body">
            <div
              class="warning-box"
              style="margin-bottom:16px">

              Com o Firebase ativado, a conta é criada no Authentication por uma Cloud Function. A senha nunca é salva no Firestore.
            </div>

            <form
              id="user-form"
              class="form-grid two-columns">

              <label>
                Nome
                <input
                  id="user-name"
                  required>
              </label>

              <label>
                E-mail
                <input
                  id="user-email"
                  type="email"
                  required>
              </label>

              <label>
                Senha temporária
                <input
                  id="user-password"
                  type="password"
                  minlength="6"
                  required>
              </label>

              <label>
                Função
                <select id="user-role">
                  <option value="admin">
                    Administrador
                  </option>

                  <option value="gerente">
                    Gerente
                  </option>

                  <option value="vendedor">
                    Vendedor
                  </option>

                  <option value="estoquista">
                    Estoquista
                  </option>

                  <option value="financeiro">
                    Financeiro
                  </option>
                </select>
              </label>

              <div class="form-actions">
                <button
                  class="btn primary"
                  type="submit">
                  Criar usuário
                </button>
              </div>
            </form>
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>Permissões resumidas</h2>
          </div>

          <div class="card-body">
            <p>
              <strong>Administrador:</strong>
              acesso total.
            </p>

            <p>
              <strong>Gerente:</strong>
              produtos, compras, estoque, caixa e relatórios.
            </p>

            <p>
              <strong>Vendedor:</strong>
              vendas, clientes e consulta de produtos.
            </p>

            <p>
              <strong>Estoquista:</strong>
              entradas, inventários e movimentações.
            </p>

            <p>
              <strong>Financeiro:</strong>
              pagamentos, despesas e relatórios financeiros.
            </p>
          </div>
        </article>
      </div>

      <article
        class="card"
        style="margin-top:18px">

        <div class="card-header">
          <h2>Usuários</h2>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Função</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>

            <tbody>
              ${state.users
                .map(
                  u =>
                    `<tr>
                      <td>${escapeHTML(u.name)}</td>
                      <td>${escapeHTML(u.email)}</td>
                      <td>${escapeHTML(u.role)}</td>

                      <td>
                        ${u.active
                          ? statusBadge("ativo")
                          : statusBadge("inativo")
                        }
                      </td>

                      <td>
                        <button
                          class="btn warning small-btn"
                          data-toggle-user="${u.id}"
                          ${u.id === currentUser.id ? "disabled" : ""}>

                          ${u.active
                            ? "Desativar"
                            : "Ativar"
                          }
                        </button>
                      </td>
                    </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </article>
    `;

    $("#user-form")
      .addEventListener(
        "submit",
        async event => {

          event.preventDefault();

          const email =
            $("#user-email")
              .value
              .trim()
              .toLowerCase();

          if (
            state.users.some(
              u =>
                u.email.toLowerCase() ===
                email
            )
          ) {
            return toast(
              "Já existe usuário com este e-mail."
            );
          }

          if (cloudEnabled()) {
            try {
              await window.firebaseService
                .createUser({
                  name:
                    $("#user-name")
                      .value
                      .trim(),

                  email,

                  password:
                    $("#user-password")
                      .value,

                  role:
                    $("#user-role")
                      .value
                });

              await refreshCloudState();

              toast(
                "Usuário criado no Firebase Authentication."
              );

              renderUsers();

            } catch (error) {
              toast(
                error.message ||
                "Não foi possível criar o usuário."
              );
            }

            return;
          }

          const user = {
            id:
              uid("usr"),

            name:
              $("#user-name")
                .value
                .trim(),

            email,

            password:
              $("#user-password")
                .value,

            role:
              $("#user-role")
                .value,

            active:
              true
          };

          state.users.push(
            user
          );

          logAudit(
            "CRIAR",
            "Usuário",
            `${user.name} (${user.role})`,
            null,
            {
              ...user,
              password:
                "[oculta]"
            }
          );

          saveState();

          toast(
            "Usuário criado."
          );

          renderUsers();
        }
      );

    $$("[data-toggle-user]")
      .forEach(
        btn =>
          btn.addEventListener(
            "click",
            async () => {

              const user =
                state.users.find(
                  u =>
                    u.id ===
                    btn.dataset.toggleUser
                );

              if (cloudEnabled()) {
                try {
                  await window.firebaseService
                    .setUserActive({
                      uid:
                        user.id,

                      active:
                        !user.active
                    });

                  await refreshCloudState();

                  toast(
                    "Status do usuário atualizado."
                  );

                  renderUsers();

                } catch (error) {
                  toast(
                    error.message ||
                    "Não foi possível alterar o usuário."
                  );
                }

                return;
              }

              user.active =
                !user.active;

              logAudit(
                "ATUALIZAR",
                "Usuário",
                `${user.name}: ${
                  user.active
                    ? "ativado"
                    : "desativado"
                }`
              );

              saveState();

              renderUsers();
            }
          )
      );
  }

  function renderAudit() {
    $("#content").innerHTML = `
      <article class="card">
        <div class="card-header">
          <h2>Registro de auditoria</h2>

          <span class="badge info">
            ${state.audit.length} eventos
          </span>
        </div>

        <div class="table-wrap">
          ${
            state.audit.length
              ? `<table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Usuário</th>
                      <th>Ação</th>
                      <th>Entidade</th>
                      <th>Detalhes</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${state.audit
                      .map(
                        a =>
                          `<tr>
                            <td>${dateBR(a.createdAt)}</td>
                            <td>${escapeHTML(a.userName)}</td>
                            <td>${escapeHTML(a.action)}</td>
                            <td>${escapeHTML(a.entity)}</td>
                            <td>${escapeHTML(a.details)}</td>
                          </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="empty-state">
                  Nenhum evento registrado.
                </div>`
          }
        </div>
      </article>
    `;
  }

  function renderSettings() {
    $("#content").innerHTML = `
      <div class="grid two">
        <article class="card">
          <div class="card-header">
            <h2>Dados da empresa</h2>
          </div>

          <div class="card-body">
            <form
              id="settings-form"
              class="form-grid two-columns">

              <label>
                Nome da empresa
                <input
                  id="settings-company"
                  value="${escapeHTML(state.settings.companyName)}"
                  required>
              </label>

              <label>
                CNPJ
                <input
                  id="settings-cnpj"
                  value="${escapeHTML(state.settings.cnpj || "")}">
              </label>

              <label>
                Telefone
                <input
                  id="settings-phone"
                  value="${escapeHTML(state.settings.phone || "")}">
              </label>

              <label>
                Cidade
                <input
                  id="settings-city"
                  value="${escapeHTML(state.settings.city || "")}">
              </label>

              <label>
                Permitir estoque negativo
                <select id="settings-negative">
                  <option
                    value="false"
                    ${!state.settings.allowNegativeStock ? "selected" : ""}>
                    Não
                  </option>

                  <option
                    value="true"
                    ${state.settings.allowNegativeStock ? "selected" : ""}>
                    Sim
                  </option>
                </select>
              </label>

              <div class="form-actions">
                <button
                  class="btn primary"
                  type="submit">
                  Salvar configurações
                </button>
              </div>
            </form>
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>Dados e manutenção</h2>
          </div>

          <div class="card-body">
            <div class="section-actions">
              <button
                id="export-backup"
                class="btn secondary"
                type="button">
                Exportar backup JSON
              </button>

              <label
                class="btn secondary"
                style="display:inline-flex;align-items:center">

                Importar backup

                <input
                  id="import-backup"
                  type="file"
                  accept=".json"
                  hidden>
              </label>

              <button
                id="reset-demo"
                class="btn danger"
                type="button">
                Restaurar dados de demonstração
              </button>
            </div>

            <div class="warning-box">
              A exportação local é apenas uma segurança manual. Em produção, configure backups automáticos e teste a restauração.
            </div>
          </div>
        </article>
      </div>

      <article
        class="card"
        style="margin-top:18px">

        <div class="card-header">
          <h2>Módulos avançados planejados</h2>
        </div>

        <div class="card-body">
          <div class="grid three">
            <div class="notice">
              NF-e / NFC-e com certificado digital, CSC, XML, DANFE e contingência.
            </div>

            <div class="notice">
              Gateway de pagamento sem armazenar número completo ou código de segurança do cartão.
            </div>

            <div class="notice">
              PWA offline, código de barras pela câmera, múltiplas lojas e transferências.
            </div>
          </div>
        </div>
      </article>
    `;

    $("#settings-form")
      .addEventListener(
        "submit",
        event => {

          event.preventDefault();

          const before =
            structuredClone(
              state.settings
            );

          state.settings.companyName =
            $("#settings-company")
              .value
              .trim();

          state.settings.cnpj =
            $("#settings-cnpj")
              .value
              .trim();

          state.settings.phone =
            $("#settings-phone")
              .value
              .trim();

          state.settings.city =
            $("#settings-city")
              .value
              .trim();

          state.settings.allowNegativeStock =
            $("#settings-negative").value ===
            "true";

          logAudit(
            "ATUALIZAR",
            "Configurações",
            "Dados da empresa",
            before,
            state.settings
          );

          saveState();

          $("#brand-company").textContent =
            state.settings.companyName;

          toast(
            "Configurações salvas."
          );
        }
      );

    $("#export-backup")
      .addEventListener(
        "click",
        () => {

          const blob =
            new Blob(
              [
                JSON.stringify(
                  state,
                  null,
                  2
                )
              ],
              {
                type:
                  "application/json"
              }
            );

          const url =
            URL.createObjectURL(
              blob
            );

          const a =
            document.createElement(
              "a"
            );

          a.href =
            url;

          a.download =
            `backup-perowba-${todayISO()}.json`;

          a.click();

          URL.revokeObjectURL(
            url
          );
        }
      );

    $("#import-backup").addEventListener("change", async event => {
      const file = event.target.files[0];

      if (!file) return;

      try {
        const parsed =
          JSON.parse(
            await file.text()
          );

        if (
          !parsed ||
          typeof parsed !== "object"
        ) {
          throw new Error(
            "Backup inválido."
          );
        }

        /*
         * MODO FIREBASE
         *
         * Não substitui todo o state.
         * Envia somente as vendas históricas
         * para a Cloud Function protegida.
         */
        if (cloudEnabled()) {
          const sales =
            Array.isArray(
              parsed.sales
            )
              ? parsed.sales
              : [];

          if (!sales.length) {
            toast(
              "O backup não possui vendas para importar."
            );

            event.target.value =
              "";

            return;
          }

          let imported = 0;
          let skipped = 0;

          /*
           * A Cloud Function aceita até
           * 400 vendas por chamada.
           */
          for (
            let i = 0;
            i < sales.length;
            i += 400
          ) {
            const chunk =
              sales.slice(
                i,
                i + 400
              );

            const result =
              await window
                .firebaseService
                .importOldSales(
                  chunk
                );

            imported +=
              Number(
                result?.imported ||
                0
              );

            skipped +=
              Number(
                result?.skipped ||
                0
              );
          }

          /*
           * Recarrega tudo diretamente
           * do Firestore.
           *
           * Assim, as vendas antigas e
           * as vendas atuais passam a
           * aparecer juntas.
           */
          await refreshCloudState();

          /*
           * Atualiza somente o cache
           * local.
           *
           * Não chamamos saveState()
           * aqui para não reenviar todo
           * o state ao Firebase.
           */
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(
              state
            )
          );

          toast(
            `Importação concluída: ${imported} venda(s) importada(s), ${skipped} ignorada(s).`
          );

          renderSettings();

          event.target.value =
            "";

          return;
        }

        /*
         * MODO LOCAL
         *
         * Mantém o funcionamento antigo
         * quando o Firebase estiver
         * desativado.
         */
        state = {
          ...initialState(),
          ...parsed
        };

        await saveState();

        toast(
          "Backup importado."
        );

        renderSettings();

        event.target.value =
          "";

      } catch (error) {
        console.error(
          "Erro ao importar backup:",
          error
        );

        toast(
          error?.message ||
          "Arquivo de backup inválido."
        );

        event.target.value =
          "";
      }
    });

    $("#reset-demo")
      .addEventListener(
        "click",
        () => {

          if (cloudEnabled()) {
            return toast(
              "A restauração de demonstração fica desativada no modo Firebase."
            );
          }

          if (
            !confirm(
              "Restaurar os dados de demonstração? Os dados atuais serão apagados."
            )
          ) {
            return;
          }

          state =
            initialState();

          saveState();

          currentUser =
            state.users[0];

          sessionStorage.setItem(
            SESSION_KEY,
            currentUser.id
          );

          toast(
            "Dados de demonstração restaurados."
          );

          showApp();
        }
      );
  }

  function showLogin() {
  $("#loading-screen")?.classList.add("hidden");
  $("#app-shell")?.classList.add("hidden");
  $("#login-screen")?.classList.remove("hidden");
}

  function initEvents() {

    // =======================================================
    // LOGIN / CRIAR CONTA
    // =======================================================

    const showRegisterArea = () => {

      $("#login-area")
        ?.classList
        .add("hidden");

      $("#register-area")
        ?.classList
        .remove("hidden");

      $("#register-error").textContent =
        "";

      $("#register-success").textContent =
        "";

      $("#register-name")
        ?.focus();
    };


    const showLoginArea = () => {

      $("#register-area")
        ?.classList
        .add("hidden");

      $("#login-area")
        ?.classList
        .remove("hidden");

      $("#register-error").textContent =
        "";

      $("#register-success").textContent =
        "";

      $("#login-email")
        ?.focus();
    };


    $("#create-account-btn")
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();

          showRegisterArea();
        }
      );


    $("#back-to-login-btn")
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();

          showLoginArea();
        }
      );


    $("#register-form")
      ?.addEventListener(
        "submit",
        async event => {

          event.preventDefault();


          const errorElement =
            $("#register-error");

          const successElement =
            $("#register-success");

          const submitButton =
            $("#register-submit-btn");


          errorElement.textContent =
            "";

          successElement.textContent =
            "";


          const name =
            $("#register-name")
              .value
              .trim();


          const companyName =
            $("#register-company")
              .value
              .trim();


          const email =
            $("#register-email")
              .value
              .trim()
              .toLowerCase();


          const password =
            $("#register-password")
              .value;


          const passwordConfirm =
            $("#register-password-confirm")
              .value;


          const city =
            $("#register-city")
              ?.value
              .trim() ||
            "";


          const phone =
            $("#register-phone")
              ?.value
              .trim() ||
            "";


          const cnpj =
            $("#register-cnpj")
              ?.value
              .trim() ||
            "";


          if (!cloudEnabled()) {

            errorElement.textContent =
              "O Firebase precisa estar ativado para criar uma conta.";

            return;
          }


          if (
            !name ||
            !companyName ||
            !email ||
            !password
          ) {

            errorElement.textContent =
              "Preencha nome, empresa, e-mail e senha.";

            return;
          }


          if (
            password.length < 6
          ) {

            errorElement.textContent =
              "A senha precisa ter pelo menos 6 caracteres.";

            return;
          }


          if (
            password !==
            passwordConfirm
          ) {

            errorElement.textContent =
              "As senhas não são iguais.";

            return;
          }


          registrationInProgress =
            true;


          submitButton.disabled =
            true;


          const originalButtonText =
            submitButton.textContent;


          submitButton.textContent =
            "Criando conta...";


          try {

            const credential =
              await window
                .firebaseService
                .createAccount(
                  email,
                  password
                );


            registrationAuthCreated =
              true;


            await window
              .firebaseService
              .createMyCompany({
                name,
                companyName,
                city,
                phone,
                cnpj
              });


            const profile =
              await window
                .firebaseService
                .loadProfile(
                  credential.user.uid
                );


            const cloudState =
              await window
                .firebaseService
                .loadCompanyState(
                  profile
                );


            state = {
              ...initialState(),
              ...cloudState,
              cart: []
            };


            currentUser =
              profile;


            registrationInProgress =
              false;

            registrationAuthCreated =
              false;


            successElement.textContent =
              "Conta e empresa criadas com sucesso.";


            $("#register-area")
              ?.classList
              .add("hidden");


            $("#login-area")
              ?.classList
              .remove("hidden");


            showApp();


          } catch (error) {

            console.error(
              "Erro ao criar conta:",
              error
            );


            let cleanupResult =
              null;


            // Se o Authentication foi criado, verificamos no
            // servidor se o cadastro da empresa ficou incompleto.
            // O servidor só remove a conta se NÃO existir perfil.

            if (
              registrationAuthCreated
            ) {

              try {

                cleanupResult =
                  await window
                    .firebaseService
                    .cancelIncompleteRegistration();


                if (
                  cleanupResult?.removed
                ) {

                  try {

                    await window
                      .firebaseService
                      .signOut();

                  } catch {}
                }


              } catch (
                cleanupError
              ) {

                console.error(
                  "Não foi possível verificar a limpeza do cadastro:",
                  cleanupError
                );
              }
            }


            registrationInProgress =
              false;

            registrationAuthCreated =
              false;


            // Se o perfil existe, a empresa provavelmente foi
            // criada e ocorreu apenas uma falha ao carregar
            // o sistema. Não apagamos a conta.

            if (
              cleanupResult?.reason ===
              "profile-exists"
            ) {

              errorElement.textContent =
                "Sua conta e empresa foram criadas, mas não foi possível abrir o painel. Volte para o login e entre novamente.";

              try {

                await window
                  .firebaseService
                  .signOut();

              } catch {}

              return;
            }


            const errorMessages = {

              "auth/email-already-in-use":
                "Este e-mail já possui uma conta.",

              "auth/invalid-email":
                "Digite um endereço de e-mail válido.",

              "auth/weak-password":
                "A senha é muito fraca. Use pelo menos 6 caracteres.",

              "auth/network-request-failed":
                "Não foi possível conectar ao Firebase. Verifique sua internet.",

              "functions/unauthenticated":
                "Não foi possível autenticar a nova conta.",

              "functions/already-exists":
                "Esta conta ou empresa já foi cadastrada.",

              "functions/permission-denied":
                "O Firebase não autorizou a criação da empresa."
            };


            errorElement.textContent =
              errorMessages[
                error?.code
              ] ||
              error?.message ||
              "Não foi possível criar sua conta.";


          } finally {

            submitButton.disabled =
              false;


            submitButton.textContent =
              originalButtonText;
          }
        }
      );

    $("#login-form")
      .addEventListener(
        "submit",
        async event => {

          event.preventDefault();

          $("#login-error").textContent =
            "";

          const email =
            $("#login-email")
              .value
              .trim()
              .toLowerCase();

          const password =
            $("#login-password")
              .value;

          if (cloudEnabled()) {
            try {
              await window
                .firebaseService
                .signIn(
                  email,
                  password
                );

            } catch (error) {
              $("#login-error").textContent =
                "Não foi possível entrar. Verifique o e-mail, a senha e o cadastro do usuário.";
            }

            return;
          }

          const user =
            state.users.find(
              u =>
                u.email.toLowerCase() ===
                  email &&
                u.password ===
                  password &&
                u.active
            );

          if (!user) {
            $("#login-error").textContent =
              "E-mail, senha ou situação do usuário inválidos.";

            return;
          }

          currentUser =
            user;

          sessionStorage.setItem(
            SESSION_KEY,
            user.id
          );

          logAudit(
            "LOGIN",
            "Autenticação",
            `Login realizado por ${user.name}`
          );

          saveState();

          showApp();
        }
      );

    $("#reset-password-btn")
      .addEventListener(
        "click",
        async () => {

          const email =
            $("#login-email")
              .value
              .trim()
              .toLowerCase();

          if (!email) {
            return toast(
              "Informe seu e-mail para recuperar a senha."
            );
          }

          if (!cloudEnabled()) {
            return toast(
              "A recuperação de senha está disponível quando o Firebase estiver ativado."
            );
          }

          try {
            await window
              .firebaseService
              .resetPassword(
                email
              );

            toast(
              "E-mail de recuperação enviado."
            );

          } catch (error) {
            toast(
              "Não foi possível enviar o e-mail de recuperação."
            );
          }
        }
      );

    $("#logout-btn")
      .addEventListener(
        "click",
        async () => {

          if (cloudEnabled()) {
            await window
              .firebaseService
              .signOut();

            return;
          }

          logAudit(
            "LOGOUT",
            "Autenticação",
            `Logout realizado por ${currentUser.name}`
          );

          saveState();

          sessionStorage.removeItem(
            SESSION_KEY
          );

          currentUser =
            null;

          showLogin();
        }
      );

    $$(".nav-item")
      .forEach(
        btn =>
          btn.addEventListener(
            "click",
            () =>
              setRoute(
                btn.dataset.route
              )
          )
      );

    $("#menu-toggle")
      .addEventListener(
        "click",
        () =>
          $("#sidebar")
            .classList
            .toggle("open")
      );

    window.addEventListener(
      "beforeinstallprompt",
      event => {

        event.preventDefault();

        deferredInstallPrompt =
          event;

        $("#install-btn")
          .classList
          .remove("hidden");
      }
    );

    $("#install-btn")
      .addEventListener(
        "click",
        async () => {

          if (!deferredInstallPrompt) {
            return;
          }

          deferredInstallPrompt
            .prompt();

          await deferredInstallPrompt
            .userChoice;

          deferredInstallPrompt =
            null;

          $("#install-btn")
            .classList
            .add("hidden");
        }
      );
  }

  async function init() {
    initEvents();

    if (cloudEnabled()) {
      $(".demo-box")
        ?.classList
        .add("hidden");

      window.firebaseService
        .setErrorHandler(
          error =>
            toast(
              error.message ||
              "Falha ao salvar no Firebase."
            )
        );

      window.firebaseService
        .onAuth(
          async firebaseUser => {

            if (
              registrationInProgress &&
              firebaseUser
            ) {
              return;
            }

            if (!firebaseUser) {
              currentUser =
                null;

              showLogin();

              return;
            }

            try {
              const profile =
                await window
                  .firebaseService
                  .loadProfile(
                    firebaseUser.uid
                  );

              const cloudState =
                await window
                  .firebaseService
                  .loadCompanyState(
                    profile
                  );

              const localCart =
                loadState().cart ||
                [];

              state = {
                ...initialState(),
                ...cloudState,
                cart:
                  localCart
              };

              currentUser =
                profile;

              showApp();

            } catch (error) {
              $("#login-error").textContent =
                error.message ||
                "O perfil do usuário não está configurado corretamente.";

              await window
                .firebaseService
                .signOut();
            }
          }
        );

    } else {
  currentUser =
    getSessionUser();

  if (currentUser) {
    showApp();
  } else {
    showLogin();
  }
}

    if (
      "serviceWorker" in navigator &&
      location.protocol.startsWith("http")
    ) {
      try {
        await navigator
          .serviceWorker
          .register(
            "./sw.js"
          );
      } catch {}
    }
  }

  init();
})();
