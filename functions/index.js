import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();

setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10
});

const db = getFirestore();
const auth = getAuth();

// Depois que o App Check estiver configurado e testado,
// troque para true.
const ENFORCE_APP_CHECK = false;

const callableOptions = {
  enforceAppCheck: ENFORCE_APP_CHECK,
  timeoutSeconds: 60,
  memory: "256MiB"
};

const nowISO = () => new Date().toISOString();

const validRoles = [
  "admin",
  "gerente",
  "vendedor",
  "estoquista",
  "financeiro"
];


/* =========================================================
   AUTENTICAÇÃO E PERMISSÕES
   ========================================================= */

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError(
      "unauthenticated",
      "Faça login para continuar."
    );
  }

  return request.auth.uid;
}


async function getProfile(uid) {
  const snapshot = await db.doc(`usuarios/${uid}`).get();

  if (!snapshot.exists) {
    throw new HttpsError(
      "permission-denied",
      "Perfil do usuário não encontrado."
    );
  }

  const data = snapshot.data();

  const profile = {
    uid,
    name: data.name || data.nome || "Usuário",
    email: data.email || "",
    role: data.role || data.funcao || "vendedor",
    companyId: data.companyId || data.empresaId,
    active: data.active ?? data.ativo ?? true
  };

  if (!profile.active) {
    throw new HttpsError(
      "permission-denied",
      "Usuário desativado."
    );
  }

  if (!profile.companyId) {
    throw new HttpsError(
      "failed-precondition",
      "Usuário sem empresa vinculada."
    );
  }

  return profile;
}


function requireRole(profile, roles) {
  if (!roles.includes(profile.role)) {
    throw new HttpsError(
      "permission-denied",
      "Seu perfil não tem permissão para esta operação."
    );
  }
}


/* =========================================================
   ADMINISTRADOR DA PLATAFORMA
   ========================================================= */

async function requirePlatformAdmin(uid) {
  const snapshot = await db
    .doc(`plataformaAdmins/${uid}`)
    .get();

  if (
    !snapshot.exists ||
    snapshot.data()?.active !== true
  ) {
    throw new HttpsError(
      "permission-denied",
      "Somente o administrador da plataforma pode realizar esta operação."
    );
  }

  return true;
}


/* =========================================================
   VALIDAÇÕES
   ========================================================= */

function positiveInteger(value, field) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `${field} deve ser um número inteiro positivo.`
    );
  }

  return number;
}


function nonNegativeNumber(value, field) {
  const number = Number(value || 0);

  if (!Number.isFinite(number) || number < 0) {
    throw new HttpsError(
      "invalid-argument",
      `${field} deve ser um número válido e não negativo.`
    );
  }

  return number;
}


/* =========================================================
   AUDITORIA
   ========================================================= */

function auditRef(companyId) {
  return db
    .collection(`empresas/${companyId}/auditoria`)
    .doc();
}


function auditData(
  profile,
  action,
  entity,
  details
) {
  return {
    userId: profile.uid,
    userName: profile.name,
    action,
    entity,
    details,
    createdAt: nowISO(),
    serverCreatedAt: FieldValue.serverTimestamp()
  };
}


/* =========================================================
   FINALIZAR VENDA
   ========================================================= */

export const finalizarVenda = onCall(
  callableOptions,
  async request => {

    const uid = requireAuth(request);
    const profile = await getProfile(uid);

    requireRole(
      profile,
      ["admin", "gerente", "vendedor"]
    );

    const data = request.data || {};

    if (
      !Array.isArray(data.items) ||
      data.items.length === 0 ||
      data.items.length > 100
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A venda deve conter de 1 a 100 itens."
      );
    }


    const grouped = new Map();

    for (const item of data.items) {
      const productId = String(
        item.productId || ""
      ).trim();

      if (!productId) {
        throw new HttpsError(
          "invalid-argument",
          "Produto inválido."
        );
      }

      const qty = positiveInteger(
        item.qty,
        "Quantidade"
      );

      const size = String(
        item.size || ""
      ).trim();

      const groupKey =
        `${productId}::${size}`;

      const current =
        grouped.get(groupKey);

      if (current) {
        current.qty += qty;
      } else {
        grouped.set(
          groupKey,
          {
            productId,
            size,
            qty
          }
        );
      }
    }

    const payment = String(
      data.payment || ""
    ).trim();

    const allowedPayments = [
      "PIX",
      "Dinheiro",
      "Cartão de débito",
      "Cartão de crédito",
      "Transferência",
      "Venda fiada"
    ];

    if (!allowedPayments.includes(payment)) {
      throw new HttpsError(
        "invalid-argument",
        "Forma de pagamento inválida."
      );
    }


    const discount = nonNegativeNumber(
      data.discount,
      "Desconto"
    );

    const companyId = profile.companyId;

    const companyRef = db.doc(
      `empresas/${companyId}`
    );

    const counterRef = db.doc(
      `empresas/${companyId}/contadores/vendas`
    );

    const saleRef = db
      .collection(
        `empresas/${companyId}/vendas`
      )
      .doc();

    const financeRef = db
      .collection(
        `empresas/${companyId}/financeiro`
      )
      .doc();

    const logRef = auditRef(companyId);


    const result = await db.runTransaction(
      async transaction => {

        const companySnapshot =
          await transaction.get(companyRef);

        if (!companySnapshot.exists) {
          throw new HttpsError(
            "failed-precondition",
            "Empresa não encontrada."
          );
        }

        const company =
          companySnapshot.data();

        const allowNegative =
          company.allowNegativeStock ??
          company.permitirEstoqueNegativo ??
          false;


        const counterSnapshot =
          await transaction.get(counterRef);


        const productEntries = [];

        for (const groupedItem of grouped.values()) {

          const {
            productId,
            size,
            qty
          } = groupedItem;

          const ref = db.doc(
            `empresas/${companyId}/produtos/${productId}`
          );

          const snapshot =
            await transaction.get(ref);

          if (!snapshot.exists) {
            throw new HttpsError(
              "not-found",
              `Produto ${productId} não encontrado.`
            );
          }

          const product =
            snapshot.data();

          if (product.active === false) {
            throw new HttpsError(
              "failed-precondition",
              `${product.name || "Produto"} está inativo.`
            );
          }

          const currentStock =
            Number(
              product.stock || 0
            );

          const sizes =
            Array.isArray(
              product.sizes
            )
              ? product.sizes.map(
                  item => ({
                    ...item
                  })
                )
              : [];

          let sizeIndex =
            -1;

          let currentSizeStock =
            null;

          if (size) {

            sizeIndex =
              sizes.findIndex(
                item =>
                  String(
                    item.size || ""
                  ) ===
                  size
              );

            if (sizeIndex < 0) {
              throw new HttpsError(
                "failed-precondition",
                `Tamanho ${size} não encontrado para ${
                  product.name || productId
                }.`
              );
            }

            currentSizeStock =
              Number(
                sizes[sizeIndex].stock || 0
              );

            if (
              !allowNegative &&
              currentSizeStock < qty
            ) {
              throw new HttpsError(
                "failed-precondition",
                `Estoque insuficiente para ${
                  product.name || productId
                } Tam. ${size}.`
              );
            }

          } else {

            if (
              !allowNegative &&
              currentStock < qty
            ) {
              throw new HttpsError(
                "failed-precondition",
                `Estoque insuficiente para ${
                  product.name || productId
                }.`
              );
            }
          }

          productEntries.push({
            ref,
            productId,
            size,
            qty,
            product,
            currentStock,
            currentSizeStock,
            sizeIndex,
            sizes
          });
        }

        let customerName = "Cliente balcão";
        let customerId = null;

        if (data.customerId) {

          const customerRef = db.doc(
            `empresas/${companyId}/clientes/${String(
              data.customerId
            )}`
          );

          const customerSnapshot =
            await transaction.get(customerRef);

          if (customerSnapshot.exists) {
            customerId =
              customerSnapshot.id;

            customerName =
              customerSnapshot.data().name ||
              customerSnapshot.data().nome ||
              "Cliente";
          }
        }


        let subtotal = 0;
        let cost = 0;

        const items = productEntries.map(
          entry => {

            const price =
              Number(entry.product.price || 0);

            const unitCost =
              Number(entry.product.cost || 0);

            subtotal +=
              price * entry.qty;

            cost +=
              unitCost * entry.qty;

            return {
              productId:
                entry.productId,

              name:
                entry.product.name ||
                "Produto",

              sku:
                entry.product.sku || "",

              size:
                entry.size || "",

              qty:
                entry.qty,

              price,

              cost:
                unitCost
            };
          }
        );


        if (discount > subtotal) {
          throw new HttpsError(
            "invalid-argument",
            "O desconto não pode superar o subtotal."
          );
        }


        const total =
          subtotal - discount;

        const sequence =
          Number(
            counterSnapshot.data()?.value || 0
          ) + 1;

        const number =
          `V${String(sequence).padStart(
            6,
            "0"
          )}`;

        const createdAt = nowISO();


        transaction.set(
          counterRef,
          {
            value: sequence,
            updatedAt: createdAt
          },
          {
            merge: true
          }
        );


        const productUpdates =
          new Map();

        for (const entry of productEntries) {

          let update =
            productUpdates.get(
              entry.productId
            );

          if (!update) {

            update = {
              ref:
                entry.ref,

              product:
                entry.product,

              currentStock:
                entry.currentStock,

              totalQty:
                0,

              sizes:
                Array.isArray(
                  entry.sizes
                )
                  ? entry.sizes.map(
                      item => ({
                        ...item
                      })
                    )
                  : []
            };

            productUpdates.set(
              entry.productId,
              update
            );
          }


          update.totalQty +=
            entry.qty;


          if (entry.size) {

            const sizeIndex =
              update.sizes.findIndex(
                item =>
                  String(
                    item.size || ""
                  ) ===
                  entry.size
              );

            if (sizeIndex < 0) {
              throw new HttpsError(
                "failed-precondition",
                `Tamanho ${entry.size} não encontrado para ${
                  entry.product.name ||
                  entry.productId
                }.`
              );
            }

            const sizeBefore =
              Number(
                update.sizes[
                  sizeIndex
                ].stock || 0
              );

            const sizeAfter =
              sizeBefore -
              entry.qty;

            if (
              !allowNegative &&
              sizeAfter < 0
            ) {
              throw new HttpsError(
                "failed-precondition",
                `Estoque insuficiente para ${
                  entry.product.name ||
                  entry.productId
                } Tam. ${entry.size}.`
              );
            }

            update.sizes[
              sizeIndex
            ] = {
              ...update.sizes[
                sizeIndex
              ],
              stock:
                sizeAfter
            };
          }
        }


        for (
          const [
            productId,
            update
          ] of productUpdates.entries()
        ) {

          const after =
            update.currentStock -
            update.totalQty;

          if (
            !allowNegative &&
            after < 0
          ) {
            throw new HttpsError(
              "failed-precondition",
              `Estoque insuficiente para ${
                update.product.name ||
                productId
              }.`
            );
          }

          const updateData = {
            stock:
              after,

            updatedAt:
              createdAt
          };

          if (
            Array.isArray(
              update.product.sizes
            )
          ) {
            updateData.sizes =
              update.sizes;
          }

          transaction.update(
            update.ref,
            updateData
          );
        }


        for (const entry of productEntries) {

          const productUpdate =
            productUpdates.get(
              entry.productId
            );

          const productAfter =
            productUpdate.currentStock -
            productUpdate.totalQty;

          let sizeBefore =
            null;

          let sizeAfter =
            null;

          if (entry.size) {

            const originalSize =
              Array.isArray(
                entry.product.sizes
              )
                ? entry.product.sizes.find(
                    item =>
                      String(
                        item.size || ""
                      ) ===
                      entry.size
                  )
                : null;

            const updatedSize =
              productUpdate.sizes.find(
                item =>
                  String(
                    item.size || ""
                  ) ===
                  entry.size
              );

            sizeBefore =
              Number(
                originalSize?.stock || 0
              );

            sizeAfter =
              Number(
                updatedSize?.stock || 0
              );
          }


          const movementRef = db
            .collection(
              `empresas/${companyId}/movimentacoesEstoque`
            )
            .doc();


          transaction.set(
            movementRef,
            {
              productId:
                entry.productId,

              productName:
                entry.product.name ||
                "Produto",

              size:
                entry.size || "",

              type:
                "Saída por venda",

              quantity:
                -entry.qty,

              before:
                entry.currentStock,

              after:
                productAfter,

              sizeBefore,

              sizeAfter,

              reason:
                `Venda ${number}`,

              relatedId:
                saleRef.id,

              userId:
                profile.uid,

              userName:
                profile.name,

              createdAt,

              serverCreatedAt:
                FieldValue.serverTimestamp()
            }
          );
        }

        const sale = {
          number,
          items,
          subtotal,
          discount,
          total,
          cost,
          profit: total - cost,

          customerId,
          customerName,

          payment,

          sellerId:
            profile.uid,

          sellerName:
            profile.name,

          status:
            "pago",

          createdAt,

          serverCreatedAt:
            FieldValue.serverTimestamp()
        };


        transaction.set(
          saleRef,
          sale
        );


        transaction.set(
          financeRef,
          {
            type:
              "receita",

            category:
              "Vendas",

            description:
              `Venda ${number}`,

            amount:
              total,

            dueDate:
              createdAt.slice(0, 10),

            status:
              "pago",

            relatedId:
              saleRef.id,

            createdAt,

            serverCreatedAt:
              FieldValue.serverTimestamp()
          }
        );


        transaction.set(
          logRef,
          auditData(
            profile,
            "CRIAR",
            "Venda",
            `Venda ${number} finalizada`
          )
        );


        return {
          id: saleRef.id,
          number,
          total
        };
      }
    );


    return result;
  }
);


/* =========================================================
   MOVIMENTAÇÃO DE ESTOQUE
   ========================================================= */

export const registrarMovimentacaoEstoque =
onCall(
  callableOptions,
  async request => {

    const uid =
      requireAuth(request);

    const profile =
      await getProfile(uid);

    requireRole(
      profile,
      ["admin", "gerente", "estoquista"]
    );


    const data =
      request.data || {};

    const productId =
      String(
        data.productId || ""
      ).trim();

    const type =
      String(
        data.type || ""
      ).trim();

    const reason =
      String(
        data.reason || ""
      ).trim();

    const rawQuantity =
      positiveInteger(
        data.quantity,
        "Quantidade"
      );


    if (
      !productId ||
      !reason
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Produto e motivo são obrigatórios."
      );
    }


    const negativeTypes = [
      "Ajuste negativo",
      "Perda",
      "Produto danificado",
      "Uso interno"
    ];


    const allowedTypes = [
      "Entrada por compra",
      "Ajuste positivo",
      ...negativeTypes,
      "Bonificação",
      "Inventário"
    ];


    if (
      !allowedTypes.includes(type)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Tipo de movimentação inválido."
      );
    }


    const quantity =
      negativeTypes.includes(type)
        ? -rawQuantity
        : rawQuantity;


    const companyId =
      profile.companyId;


    return db.runTransaction(
      async transaction => {

        const companyRef =
          db.doc(
            `empresas/${companyId}`
          );

        const productRef =
          db.doc(
            `empresas/${companyId}/produtos/${productId}`
          );


        const companySnapshot =
          await transaction.get(
            companyRef
          );

        const productSnapshot =
          await transaction.get(
            productRef
          );


        if (
          !companySnapshot.exists ||
          !productSnapshot.exists
        ) {
          throw new HttpsError(
            "not-found",
            "Empresa ou produto não encontrado."
          );
        }


        const company =
          companySnapshot.data();

        const product =
          productSnapshot.data();

        const before =
          Number(
            product.stock || 0
          );

        const after =
          before + quantity;


        const allowNegative =
          company.allowNegativeStock ??
          company.permitirEstoqueNegativo ??
          false;


        if (
          !allowNegative &&
          after < 0
        ) {
          throw new HttpsError(
            "failed-precondition",
            "A movimentação deixaria o estoque negativo."
          );
        }


        const createdAt =
          nowISO();


        const movementRef =
          db.collection(
            `empresas/${companyId}/movimentacoesEstoque`
          ).doc();


        transaction.update(
          productRef,
          {
            stock: after,
            updatedAt: createdAt
          }
        );


        transaction.set(
          movementRef,
          {
            productId,

            productName:
              product.name ||
              "Produto",

            type,

            quantity,

            before,

            after,

            reason,

            userId:
              profile.uid,

            userName:
              profile.name,

            createdAt,

            serverCreatedAt:
              FieldValue.serverTimestamp()
          }
        );


        transaction.set(
          auditRef(companyId),
          auditData(
            profile,
            "MOVIMENTAR",
            "Estoque",
            `${type}: ${
              product.name ||
              productId
            }`
          )
        );


        return {
          movementId:
            movementRef.id,

          after
        };
      }
    );
  }
);


/* =========================================================
   RECEBER COMPRA
   ========================================================= */

export const receberCompra = onCall(
  callableOptions,
  async request => {

    const uid =
      requireAuth(request);

    const profile =
      await getProfile(uid);

    requireRole(
      profile,
      ["admin", "gerente", "estoquista"]
    );


    const data =
      request.data || {};


    const supplierId =
      String(
        data.supplierId || ""
      ).trim();

    const productId =
      String(
        data.productId || ""
      ).trim();

    const quantity =
      positiveInteger(
        data.quantity,
        "Quantidade"
      );

    const unitCost =
      nonNegativeNumber(
        data.unitCost,
        "Custo unitário"
      );

    const freight =
      nonNegativeNumber(
        data.freight,
        "Frete"
      );

    const documentNumber =
      String(
        data.document || ""
      ).trim();


    if (
      !supplierId ||
      !productId
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Fornecedor e produto são obrigatórios."
      );
    }


    const companyId =
      profile.companyId;


    return db.runTransaction(
      async transaction => {

        const supplierRef =
          db.doc(
            `empresas/${companyId}/fornecedores/${supplierId}`
          );

        const productRef =
          db.doc(
            `empresas/${companyId}/produtos/${productId}`
          );


        const supplierSnapshot =
          await transaction.get(
            supplierRef
          );

        const productSnapshot =
          await transaction.get(
            productRef
          );


        if (
          !supplierSnapshot.exists ||
          !productSnapshot.exists
        ) {
          throw new HttpsError(
            "not-found",
            "Fornecedor ou produto não encontrado."
          );
        }


        const supplier =
          supplierSnapshot.data();

        const product =
          productSnapshot.data();

        const before =
          Number(
            product.stock || 0
          );

        const after =
          before + quantity;

        const total =
          quantity * unitCost +
          freight;

        const createdAt =
          nowISO();


        const purchaseRef =
          db.collection(
            `empresas/${companyId}/compras`
          ).doc();

        const movementRef =
          db.collection(
            `empresas/${companyId}/movimentacoesEstoque`
          ).doc();

        const financeRef =
          db.collection(
            `empresas/${companyId}/financeiro`
          ).doc();


        transaction.update(
          productRef,
          {
            stock:
              after,

            cost:
              unitCost,

            updatedAt:
              createdAt
          }
        );


        transaction.set(
          purchaseRef,
          {
            supplierId,

            supplierName:
              supplier.company ||
              supplier.name ||
              "Fornecedor",

            productId,

            productName:
              product.name ||
              "Produto",

            qty:
              quantity,

            unitCost,

            freight,

            total,

            document:
              documentNumber,

            status:
              "recebido",

            createdAt,

            serverCreatedAt:
              FieldValue.serverTimestamp()
          }
        );


        transaction.set(
          movementRef,
          {
            productId,

            productName:
              product.name ||
              "Produto",

            type:
              "Entrada por compra",

            quantity,

            before,

            after,

            reason:
              documentNumber ||
              `Compra ${purchaseRef.id}`,

            relatedId:
              purchaseRef.id,

            userId:
              profile.uid,

            userName:
              profile.name,

            createdAt,

            serverCreatedAt:
              FieldValue.serverTimestamp()
          }
        );


        transaction.set(
          financeRef,
          {
            type:
              "despesa",

            category:
              "Compras",

            description:
              `Compra de ${
                product.name ||
                "produto"
              }`,

            amount:
              total,

            dueDate:
              createdAt.slice(
                0,
                10
              ),

            status:
              "pendente",

            relatedId:
              purchaseRef.id,

            createdAt,

            serverCreatedAt:
              FieldValue.serverTimestamp()
          }
        );


        transaction.set(
          auditRef(companyId),
          auditData(
            profile,
            "CRIAR",
            "Compra",
            `${
              supplier.company ||
              "Fornecedor"
            }: ${
              product.name ||
              productId
            }`
          )
        );


        return {
          purchaseId:
            purchaseRef.id,

          total,

          after
        };
      }
    );
  }
);

/* =========================================================
   CRIAR MINHA EMPRESA
   Cadastro feito pelo próprio cliente
   ========================================================= */

export const criarMinhaEmpresa =
onCall(
  callableOptions,
  async request => {

    // =======================================================
    // AUTENTICAÇÃO
    // =======================================================

    const uid =
      requireAuth(request);


    const data =
      request.data || {};


    // =======================================================
    // DADOS DO CADASTRO
    // =======================================================

    const name =
      String(
        data.name || ""
      )
        .trim();


    const companyName =
      String(
        data.companyName || ""
      )
        .trim();


    const city =
      String(
        data.city || ""
      )
        .trim();


    const phone =
      String(
        data.phone || ""
      )
        .trim();


    const cnpj =
      String(
        data.cnpj || ""
      )
        .trim();


    const email =
      String(
        request.auth?.token?.email || ""
      )
        .trim()
        .toLowerCase();


    // =======================================================
    // VALIDAÇÕES
    // =======================================================

    if (!name) {

      throw new HttpsError(
        "invalid-argument",
        "Informe seu nome."
      );
    }


    if (name.length > 120) {

      throw new HttpsError(
        "invalid-argument",
        "O nome informado é muito longo."
      );
    }


    if (!companyName) {

      throw new HttpsError(
        "invalid-argument",
        "Informe o nome da empresa."
      );
    }


    if (companyName.length > 160) {

      throw new HttpsError(
        "invalid-argument",
        "O nome da empresa é muito longo."
      );
    }


    if (!email) {

      throw new HttpsError(
        "failed-precondition",
        "Não foi possível identificar o e-mail da conta."
      );
    }


    if (city.length > 120) {

      throw new HttpsError(
        "invalid-argument",
        "A cidade informada é muito longa."
      );
    }


    if (phone.length > 30) {

      throw new HttpsError(
        "invalid-argument",
        "O telefone informado é inválido."
      );
    }


    if (cnpj.length > 30) {

      throw new HttpsError(
        "invalid-argument",
        "O CNPJ informado é inválido."
      );
    }


    // =======================================================
    // REFERÊNCIAS
    // =======================================================

    const userRef =
      db.doc(
        `usuarios/${uid}`
      );


    // Os IDs são gerados antes da transação.
    // Se houver nova tentativa, nenhum documento órfão é criado.

    const companyRef =
      db
        .collection("empresas")
        .doc();


    const companyId =
      companyRef.id;


    const counterRef =
      db.doc(
        `empresas/${companyId}/contadores/vendas`
      );


    const platformAuditRef =
      db
        .collection(
          "plataformaAuditoria"
        )
        .doc();


    const createdAt =
      nowISO();


    // =======================================================
    // TRANSAÇÃO
    // =======================================================

    try {

      const result =
        await db.runTransaction(
          async transaction => {

            // -------------------------------------------------
            // PRIMEIRO VERIFICA O PERFIL
            // -------------------------------------------------

            const existingProfile =
              await transaction.get(
                userRef
              );


            // -------------------------------------------------
            // CADASTRO JÁ EXISTE
            //
            // Em vez de gerar erro, devolvemos o cadastro
            // existente. Isso torna a função segura para
            // repetição em caso de falha de rede.
            // -------------------------------------------------

            if (
              existingProfile.exists
            ) {

              const profileData =
                existingProfile.data() ||
                {};


              const existingCompanyId =
                profileData.companyId ||
                profileData.empresaId;


              if (
                !existingCompanyId
              ) {

                throw new HttpsError(
                  "failed-precondition",
                  "A conta já possui um perfil, mas não possui empresa vinculada."
                );
              }


              return {
                alreadyCreated:
                  true,

                companyId:
                  existingCompanyId
              };
            }


            // -------------------------------------------------
            // CRIA A EMPRESA
            // -------------------------------------------------

            transaction.set(
              companyRef,
              {
                companyName,

                allowNegativeStock:
                  false,

                currency:
                  "BRL",

                city,

                phone,

                cnpj,

                active:
                  true,

                createdAt,

                updatedAt:
                  createdAt,

                createdBy:
                  uid,

                ownerId:
                  uid,

                serverCreatedAt:
                  FieldValue.serverTimestamp()
              }
            );


            // -------------------------------------------------
            // CRIA O ADMINISTRADOR DA EMPRESA
            // -------------------------------------------------

            transaction.set(
              userRef,
              {
                name,

                email,

                role:
                  "admin",

                active:
                  true,

                companyId,

                createdAt,

                updatedAt:
                  createdAt,

                createdBy:
                  uid,

                serverCreatedAt:
                  FieldValue.serverTimestamp()
              }
            );


            // -------------------------------------------------
            // CONTADOR DE VENDAS
            // -------------------------------------------------

            transaction.set(
              counterRef,
              {
                value:
                  0,

                createdAt,

                updatedAt:
                  createdAt,

                serverCreatedAt:
                  FieldValue.serverTimestamp()
              }
            );


            // -------------------------------------------------
            // AUDITORIA DA PLATAFORMA
            // -------------------------------------------------

            transaction.set(
              platformAuditRef,
              {
                action:
                  "AUTO_CADASTRO_EMPRESA",

                companyId,

                companyName,

                userId:
                  uid,

                userName:
                  name,

                email,

                createdAt,

                serverCreatedAt:
                  FieldValue.serverTimestamp()
              }
            );


            return {
              alreadyCreated:
                false,

              companyId,

              companyName
            };
          }
        );


      // =====================================================
      // SE A CONTA JÁ TINHA EMPRESA
      // =====================================================

      if (
        result.alreadyCreated
      ) {

        const existingCompanyRef =
          db.doc(
            `empresas/${result.companyId}`
          );


        const existingCompanySnapshot =
          await existingCompanyRef.get();


        if (
          !existingCompanySnapshot.exists
        ) {

          throw new HttpsError(
            "failed-precondition",
            "O perfil possui uma empresa vinculada, mas o cadastro da empresa não foi encontrado."
          );
        }


        const existingCompanyData =
          existingCompanySnapshot.data() ||
          {};


        return {
          success:
            true,

          companyId:
            result.companyId,

          companyName:
            existingCompanyData.companyName ||
            existingCompanyData.nome ||
            companyName,

          role:
            "admin",

          alreadyCreated:
            true,

          message:
            "Empresa já cadastrada. Cadastro recuperado com sucesso."
        };
      }


      // =====================================================
      // NOVO CADASTRO CONCLUÍDO
      // =====================================================

      return {
        success:
          true,

        companyId,

        companyName,

        role:
          "admin",

        alreadyCreated:
          false,

        message:
          "Empresa cadastrada com sucesso."
      };


    } catch (error) {

      console.error(
        "Erro ao criar empresa:",
        error
      );


      // =====================================================
      // ERROS CONTROLADOS
      // =====================================================

      if (
        error instanceof HttpsError
      ) {

        throw error;
      }


      // =====================================================
      // RECUPERAÇÃO
      //
      // Se a transação tiver sido concluída, mas a resposta
      // tiver falhado, verificamos se o perfil realmente
      // existe antes de informar erro ao cliente.
      // =====================================================

      try {

        const profileAfterError =
          await userRef.get();


        if (
          profileAfterError.exists
        ) {

          const profileData =
            profileAfterError.data() ||
            {};


          const recoveredCompanyId =
            profileData.companyId ||
            profileData.empresaId;


          if (
            recoveredCompanyId
          ) {

            const recoveredCompanySnapshot =
              await db
                .doc(
                  `empresas/${recoveredCompanyId}`
                )
                .get();


            if (
              recoveredCompanySnapshot.exists
            ) {

              const recoveredCompany =
                recoveredCompanySnapshot.data() ||
                {};


              return {
                success:
                  true,

                companyId:
                  recoveredCompanyId,

                companyName:
                  recoveredCompany.companyName ||
                  recoveredCompany.nome ||
                  companyName,

                role:
                  "admin",

                alreadyCreated:
                  true,

                recovered:
                  true,

                message:
                  "Cadastro recuperado com sucesso."
              };
            }
          }
        }

      } catch (
        recoveryError
      ) {

        console.error(
          "Erro ao verificar recuperação do cadastro:",
          recoveryError
        );
      }


      throw new HttpsError(
        "internal",
        "Não foi possível concluir o cadastro da empresa."
      );
    }
  }
);

/* =========================================================
   CANCELAR CADASTRO INCOMPLETO
   Remove somente contas que ainda não possuem perfil
   ========================================================= */

export const cancelarCadastroIncompleto =
onCall(
  callableOptions,
  async request => {

    // =======================================================
    // AUTENTICAÇÃO
    // =======================================================

    const uid =
      requireAuth(request);


    const userRef =
      db.doc(
        `usuarios/${uid}`
      );


    try {

      // =====================================================
      // VERIFICA SE O CADASTRO REALMENTE FICOU INCOMPLETO
      // =====================================================

      const profileSnapshot =
        await userRef.get();


      // Se existe perfil, a criação da empresa pode ter sido
      // concluída mesmo que o navegador tenha perdido a
      // resposta. Por segurança, NÃO apagamos a conta.

      if (
        profileSnapshot.exists
      ) {

        const profileData =
          profileSnapshot.data() ||
          {};


        return {
          success:
            true,

          removed:
            false,

          reason:
            "profile-exists",

          companyId:
            profileData.companyId ||
            profileData.empresaId ||
            null,

          message:
            "O cadastro possui perfil e não foi removido."
        };
      }


      // =====================================================
      // NÃO EXISTE PERFIL
      //
      // Como criarMinhaEmpresa usa uma transação atômica,
      // se não existe perfil, a empresa também não deveria
      // ter sido concluída por aquela transação.
      // =====================================================

      try {

        await auth.deleteUser(
          uid
        );


        return {
          success:
            true,

          removed:
            true,

          message:
            "Conta incompleta removida com sucesso."
        };


      } catch (deleteError) {

        // Se já não existir no Authentication,
        // consideramos a limpeza concluída.

        if (
          deleteError?.code ===
          "auth/user-not-found"
        ) {

          return {
            success:
              true,

            removed:
              true,

            alreadyRemoved:
              true,

            message:
              "A conta incompleta já havia sido removida."
          };
        }


        throw deleteError;
      }


    } catch (error) {

      console.error(
        "Erro ao cancelar cadastro incompleto:",
        error
      );


      if (
        error instanceof HttpsError
      ) {

        throw error;
      }


      throw new HttpsError(
        "internal",
        "Não foi possível verificar ou remover a conta incompleta."
      );
    }
  }
);

/* =========================================================
   CRIAR USUÁRIO
   ========================================================= */

export const criarUsuario =
onCall(
  callableOptions,
  async request => {

    const uid =
      requireAuth(request);

    const profile =
      await getProfile(uid);

    requireRole(
      profile,
      ["admin"]
    );


    const data =
      request.data || {};


    const name =
      String(
        data.name || ""
      ).trim();

    const email =
      String(
        data.email || ""
      )
        .trim()
        .toLowerCase();

    const password =
      String(
        data.password || ""
      );

    const role =
      String(
        data.role || ""
      ).trim();


    if (
      !name ||
      !email ||
      password.length < 6 ||
      !validRoles.includes(role)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Nome, e-mail, senha de 6 caracteres e função válida são obrigatórios."
      );
    }


    let newUser;


    try {

      newUser =
        await auth.createUser({
          email,
          password,
          displayName:
            name,
          disabled:
            false
        });


      await db
        .doc(
          `usuarios/${newUser.uid}`
        )
        .set({
          name,

          email,

          role,

          active:
            true,

          companyId:
            profile.companyId,

          createdAt:
            nowISO(),

          createdBy:
            profile.uid,

          serverCreatedAt:
            FieldValue.serverTimestamp()
        });


      await auditRef(
        profile.companyId
      ).set(
        auditData(
          profile,
          "CRIAR",
          "Usuário",
          `${name} (${role})`
        )
      );


      return {
        uid:
          newUser.uid,

        name,

        email,

        role
      };

    } catch (error) {

      if (newUser?.uid) {
        await auth
          .deleteUser(
            newUser.uid
          )
          .catch(() => {});
      }


      if (
        error.code ===
        "auth/email-already-exists"
      ) {
        throw new HttpsError(
          "already-exists",
          "Este e-mail já está cadastrado."
        );
      }


      throw new HttpsError(
        "internal",
        error.message ||
        "Não foi possível criar o usuário."
      );
    }
  }
);


/* =========================================================
   ALTERAR STATUS DO USUÁRIO
   ========================================================= */

export const alterarStatusUsuario =
onCall(
  callableOptions,
  async request => {

    const uid =
      requireAuth(request);

    const profile =
      await getProfile(uid);

    requireRole(
      profile,
      ["admin"]
    );


    const targetUid =
      String(
        request.data?.uid || ""
      ).trim();

    const active =
      Boolean(
        request.data?.active
      );


    if (
      !targetUid ||
      targetUid === uid
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Não é permitido alterar o próprio status."
      );
    }


    const targetRef =
      db.doc(
        `usuarios/${targetUid}`
      );


    const targetSnapshot =
      await targetRef.get();


    if (!targetSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "Usuário não encontrado."
      );
    }


    const target =
      targetSnapshot.data();


    if (
      (
        target.companyId ||
        target.empresaId
      ) !== profile.companyId
    ) {
      throw new HttpsError(
        "permission-denied",
        "Usuário pertence a outra empresa."
      );
    }


    await Promise.all([
      auth.updateUser(
        targetUid,
        {
          disabled:
            !active
        }
      ),

      targetRef.set(
        {
          active,
          updatedAt:
            nowISO()
        },
        {
          merge:
            true
        }
      ),

      auditRef(
        profile.companyId
      ).set(
        auditData(
          profile,
          "ATUALIZAR",
          "Usuário",
          `${
            target.name ||
            targetUid
          }: ${
            active
              ? "ativado"
              : "desativado"
          }`
        )
      )
    ]);


    return {
      uid:
        targetUid,

      active
    };
  }
);


/* =========================================================
   IMPORTAR VENDAS ANTIGAS
   ========================================================= */

export const importarVendasAntigas =
onCall(
  callableOptions,
  async request => {

    const uid =
      requireAuth(request);

    const profile =
      await getProfile(uid);

    // Somente administrador pode importar vendas antigas.
    requireRole(
      profile,
      ["admin"]
    );


    const sales =
      request.data?.sales;


    if (
      !Array.isArray(sales) ||
      sales.length === 0
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Nenhuma venda foi enviada para importação."
      );
    }


    // Um batch do Firestore suporta no máximo 500 operações.
    // Deixamos margem para contador e auditoria.
    if (sales.length > 400) {
      throw new HttpsError(
        "invalid-argument",
        "Importe no máximo 400 vendas por vez."
      );
    }


    const companyId =
      profile.companyId;


    const salesCollection =
      db.collection(
        `empresas/${companyId}/vendas`
      );


    // Carrega as vendas que já existem no Firebase.
    const existingSnapshot =
      await salesCollection.get();


    // IDs já existentes.
    const existingIds =
      new Set(
        existingSnapshot.docs.map(
          document =>
            document.id
        )
      );


    // Números de venda já utilizados.
    const usedNumbers =
      new Set(
        existingSnapshot.docs
          .map(document =>
            String(
              document.data().number ||
              ""
            ).trim()
          )
          .filter(Boolean)
      );


    let highestSequence = 0;


    // Descobre o maior número V000000 existente.
    for (
      const existingDoc
      of existingSnapshot.docs
    ) {

      const number =
        String(
          existingDoc.data().number ||
          ""
        ).trim();


      const match =
        number.match(
          /^V(\d+)$/i
        );


      if (match) {
        highestSequence =
          Math.max(
            highestSequence,
            Number(match[1])
          );
      }
    }


    const batch =
      db.batch();


    let imported = 0;
    let skipped = 0;


    // Evita duplicar IDs dentro do próprio arquivo importado.
    const incomingIds =
      new Set();


    for (const rawSale of sales) {

      if (
        !rawSale ||
        typeof rawSale !== "object"
      ) {
        skipped += 1;
        continue;
      }


      const originalId =
        String(
          rawSale.id || ""
        ).trim();


      const originalNumber =
        String(
          rawSale.number || ""
        ).trim();


      /*
       * A venda somente é considerada a mesma se o ID
       * original já existir.
       *
       * NÃO usamos apenas o número como identificador,
       * pois uma venda antiga V000001 pode ser diferente
       * de uma venda nova V000001.
       */
      if (
        (
          originalId &&
          existingIds.has(
            originalId
          )
        ) ||
        (
          originalId &&
          incomingIds.has(
            originalId
          )
        )
      ) {
        skipped += 1;
        continue;
      }


      const saleRef =
        originalId &&
        !originalId.includes("/")
          ? salesCollection.doc(
              originalId
            )
          : salesCollection.doc();


      /*
       * Mantém o número antigo quando estiver livre.
       *
       * Se o mesmo número já existir em outra venda,
       * criamos um número LEGACY para não perder
       * nenhuma das duas.
       */
      let finalNumber =
        originalNumber ||
        `IMPORT-${saleRef.id.slice(
          0,
          8
        )}`;


      if (
        usedNumbers.has(
          finalNumber
        )
      ) {
        finalNumber =
          `LEGACY-${
            originalNumber ||
            "VENDA"
          }-${
            saleRef.id.slice(
              0,
              6
            )
          }`;
      }


      // Segurança adicional contra uma rara repetição.
      while (
        usedNumbers.has(
          finalNumber
        )
      ) {
        finalNumber =
          `LEGACY-${
            originalNumber ||
            "VENDA"
          }-${
            Math.random()
              .toString(36)
              .slice(2, 8)
          }`;
      }


      usedNumbers.add(
        finalNumber
      );


      const numberMatch =
        originalNumber.match(
          /^V(\d+)$/i
        );


      if (numberMatch) {
        highestSequence =
          Math.max(
            highestSequence,
            Number(
              numberMatch[1]
            )
          );
      }


      const items =
        Array.isArray(
          rawSale.items
        )
          ? rawSale.items
              .slice(0, 100)
              .map(item => ({
                productId:
                  String(
                    item?.productId ||
                    ""
                  ),

                name:
                  String(
                    item?.name ||
                    "Produto"
                  ),

                sku:
                  String(
                    item?.sku ||
                    ""
                  ),

                qty:
                  Number(
                    item?.qty ||
                    0
                  ),

                price:
                  Number(
                    item?.price ||
                    0
                  ),

                cost:
                  Number(
                    item?.cost ||
                    0
                  )
              }))
          : [];


      const subtotal =
        Number(
          rawSale.subtotal ||
          0
        );

      const discount =
        Number(
          rawSale.discount ||
          0
        );

      const total =
        Number(
          rawSale.total ||
          0
        );

      const cost =
        Number(
          rawSale.cost ||
          0
        );

      const profit =
        Number(
          rawSale.profit ??
          (
            (
              Number.isFinite(total)
                ? total
                : 0
            ) -
            (
              Number.isFinite(cost)
                ? cost
                : 0
            )
          )
        );


      const createdAt =
        String(
          rawSale.createdAt ||
          ""
        ).trim() ||
        nowISO();


      const importedSale = {

        number:
          finalNumber,

        /*
         * Se houve conflito de numeração,
         * guardamos também o número antigo original.
         */
        ...(finalNumber !== originalNumber &&
            originalNumber
          ? {
              originalNumber
            }
          : {}),

        items,

        subtotal:
          Number.isFinite(
            subtotal
          )
            ? subtotal
            : 0,

        discount:
          Number.isFinite(
            discount
          )
            ? discount
            : 0,

        total:
          Number.isFinite(
            total
          )
            ? total
            : 0,

        cost:
          Number.isFinite(
            cost
          )
            ? cost
            : 0,

        profit:
          Number.isFinite(
            profit
          )
            ? profit
            : 0,

        customerId:
          rawSale.customerId
            ? String(
                rawSale.customerId
              )
            : null,

        customerName:
          String(
            rawSale.customerName ||
            "Cliente balcão"
          ),

        payment:
          String(
            rawSale.payment ||
            "Não informado"
          ),

        sellerId:
          rawSale.sellerId
            ? String(
                rawSale.sellerId
              )
            : null,

        sellerName:
          String(
            rawSale.sellerName ||
            "Importação"
          ),

        status:
          String(
            rawSale.status ||
            "pago"
          ),

        createdAt,

        imported:
          true,

        importedAt:
          nowISO(),

        importedBy:
          profile.uid,

        serverCreatedAt:
          FieldValue.serverTimestamp()
      };


      batch.set(
        saleRef,
        importedSale
      );


      incomingIds.add(
        saleRef.id
      );


      imported += 1;
    }


    /*
     * Atualizamos o contador mesmo que existam números
     * antigos maiores que o contador atual.
     *
     * Isso evita que a próxima venda nova receba
     * novamente um número antigo.
     */

    const counterRef =
      db.doc(
        `empresas/${companyId}/contadores/vendas`
      );


    const counterSnapshot =
      await counterRef.get();


    const currentSequence =
      Number(
        counterSnapshot.data()?.value ||
        0
      );


    const newSequence =
      Math.max(
        currentSequence,
        highestSequence
      );


    batch.set(
      counterRef,
      {
        value:
          newSequence,

        updatedAt:
          nowISO()
      },
      {
        merge:
          true
      }
    );


    batch.set(
      auditRef(
        companyId
      ),
      auditData(
        profile,
        "IMPORTAR",
        "Vendas",
        `${imported} venda(s) antiga(s) importada(s); ${skipped} ignorada(s)`
      )
    );


    await batch.commit();


    return {
      imported,
      skipped,

      message:
        imported > 0
          ? `${imported} venda(s) importada(s) com sucesso.`
          : "Nenhuma venda nova precisava ser importada."
    };
  }
);