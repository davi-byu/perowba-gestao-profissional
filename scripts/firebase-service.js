import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app-check.js";


const COLLECTION_MAP = {
  products: "produtos",
  customers: "clientes",
  suppliers: "fornecedores",
  sales: "vendas",
  purchases: "compras",
  stockMovements: "movimentacoesEstoque",
  financialEntries: "financeiro",
  cashSessions: "caixas",
  audit: "auditoria"
};


const DIRECT_SYNC_KEYS = [
  "products",
  "customers",
  "suppliers",
  "stockMovements",
  "financialEntries",
  "cashSessions",
  "audit"
];


const clone = value =>
  JSON.parse(
    JSON.stringify(value)
  );


const stable = value =>
  JSON.stringify(
    value ?? null
  );


export class FirebaseService {

  constructor(settings) {

    this.enabled =
      Boolean(
        settings?.enabled
      );

    this.settings =
      settings;

    this.companyId =
      null;

    this.profile =
      null;

    this.snapshots =
      {};

    this.syncChain =
      Promise.resolve();

    this.errorHandler =
      console.error;


    if (!this.enabled) {
      return;
    }


    this.app =
      initializeApp(
        settings.firebaseConfig
      );


    this.auth =
      getAuth(
        this.app
      );


    this.db =
      getFirestore(
        this.app
      );


    this.functions =
      getFunctions(
        this.app,
        settings.region ||
          "southamerica-east1"
      );


    this.storage =
      getStorage(
        this.app
      );


    if (
      settings.appCheckSiteKey
    ) {

      initializeAppCheck(
        this.app,
        {
          provider:
            new ReCaptchaEnterpriseProvider(
              settings.appCheckSiteKey
            ),

          isTokenAutoRefreshEnabled:
            true
        }
      );
    }
  }


  // =========================================================
  // TRATAMENTO DE ERROS
  // =========================================================

  setErrorHandler(handler) {

    this.errorHandler =
      typeof handler === "function"
        ? handler
        : console.error;
  }


  // =========================================================
  // AUTENTICAÇÃO
  // =========================================================

  onAuth(callback) {

    if (!this.enabled) {
      return () => {};
    }

    return onAuthStateChanged(
      this.auth,
      callback
    );
  }


  async signIn(
    email,
    password
  ) {

    return signInWithEmailAndPassword(
      this.auth,
      email,
      password
    );
  }


  async createAccount(
    email,
    password
  ) {

    return createUserWithEmailAndPassword(
      this.auth,
      email,
      password
    );
  }


  async signOut() {

    return firebaseSignOut(
      this.auth
    );
  }


  async resetPassword(email) {

    return sendPasswordResetEmail(
      this.auth,
      email
    );
  }


  // =========================================================
  // PERFIL DO USUÁRIO
  // =========================================================

  async loadProfile(uid) {

    const snapshot =
      await getDoc(
        doc(
          this.db,
          "usuarios",
          uid
        )
      );


    if (!snapshot.exists()) {

      throw new Error(
        "Seu usuário existe no Authentication, mas ainda não possui perfil no Firestore."
      );
    }


    const data =
      snapshot.data();


    if (
      data.active === false ||
      data.ativo === false
    ) {

      throw new Error(
        "Este usuário está desativado."
      );
    }


    const profile = {

      id:
        uid,

      name:
        data.name ||
        data.nome ||
        "Usuário",

      email:
        data.email ||
        this.auth.currentUser?.email ||
        "",

      role:
        data.role ||
        data.funcao ||
        "vendedor",

      active:
        data.active ??
        data.ativo ??
        true,

      companyId:
        data.companyId ||
        data.empresaId
    };


    if (!profile.companyId) {

      throw new Error(
        "O perfil não possui empresaId/companyId."
      );
    }


    this.profile =
      profile;

    this.companyId =
      profile.companyId;


    return profile;
  }


  // =========================================================
  // CARREGAR DADOS DA EMPRESA
  // =========================================================

  async loadCompanyState(
    profile = this.profile
  ) {

    if (!profile?.companyId) {

      throw new Error(
        "Empresa do usuário não identificada."
      );
    }


    this.profile =
      profile;

    this.companyId =
      profile.companyId;


    const companyRef =
      doc(
        this.db,
        "empresas",
        this.companyId
      );


    const companySnapshot =
      await getDoc(
        companyRef
      );


    if (!companySnapshot.exists()) {

      throw new Error(
        `A empresa ${this.companyId} ainda não foi criada no Firestore.`
      );
    }


    const companyData =
      companySnapshot.data();


    const state = {

      settings: {

        companyName:
          companyData.companyName ||
          companyData.nome ||
          "Perowba Sports",

        cnpj:
          companyData.cnpj ||
          "",

        phone:
          companyData.phone ||
          companyData.telefone ||
          "",

        city:
          companyData.city ||
          companyData.cidade ||
          "",

        allowNegativeStock:
          companyData.allowNegativeStock ??
          companyData.permitirEstoqueNegativo ??
          false,

        currency:
          companyData.currency ||
          "BRL"
      },

      users: [],

      cart: []
    };


    const entries =
      await Promise.all(

        Object.entries(
          COLLECTION_MAP
        ).map(

          async (
            [
              stateKey,
              firestoreName
            ]
          ) => {

            const snapshot =
              await getDocs(

                collection(
                  this.db,
                  "empresas",
                  this.companyId,
                  firestoreName
                )
              );


            const rows =
              snapshot.docs.map(

                item => ({
                  id:
                    item.id,

                  ...item.data()
                })
              );


            rows.sort(
              (a, b) =>
                String(
                  b.createdAt ||
                  b.updatedAt ||
                  ""
                ).localeCompare(
                  String(
                    a.createdAt ||
                    a.updatedAt ||
                    ""
                  )
                )
            );


            return [
              stateKey,
              rows
            ];
          }
        )
      );


    for (
      const [
        key,
        rows
      ] of entries
    ) {

      state[key] =
        rows;
    }


    // =======================================================
    // CARREGAR USUÁRIOS
    // =======================================================

    if (
      profile.role === "admin"
    ) {

      const userQuery =
        query(

          collection(
            this.db,
            "usuarios"
          ),

          where(
            "companyId",
            "==",
            this.companyId
          )
        );


      const userSnapshot =
        await getDocs(
          userQuery
        );


      state.users =
        userSnapshot.docs.map(

          item => {

            const data =
              item.data();


            return {

              id:
                item.id,

              name:
                data.name ||
                data.nome ||
                "Usuário",

              email:
                data.email ||
                "",

              role:
                data.role ||
                data.funcao ||
                "vendedor",

              active:
                data.active ??
                data.ativo ??
                true
            };
          }
        );

    } else {

      state.users = [
        profile
      ];
    }


    this.captureSnapshots(
      state
    );


    return state;
  }


  // =========================================================
  // SNAPSHOTS
  // =========================================================

  captureSnapshots(state) {

    this.snapshots.settings =
      clone(
        state.settings ||
        {}
      );


    for (
      const key of
      Object.keys(
        COLLECTION_MAP
      )
    ) {

      this.snapshots[key] =
        new Map(

          (
            state[key] ||
            []
          ).map(

            item => [
              item.id,
              clone(item)
            ]
          )
        );
    }
  }


  // =========================================================
  // SINCRONIZAÇÃO COM FIRESTORE
  // =========================================================

  syncState(
    state,
    currentUser
  ) {

    if (
      !this.enabled ||
      !this.companyId ||
      !currentUser
    ) {

      return Promise.resolve();
    }


    this.syncChain =
      this.syncChain

        .then(
          () =>
            this.#syncStateNow(
              state
            )
        )

        .catch(
          error =>
            this.errorHandler(
              error
            )
        );


    return this.syncChain;
  }


  async #syncStateNow(state) {

    const batch =
      writeBatch(
        this.db
      );


    let operations =
      0;


    // =======================================================
    // CONFIGURAÇÕES DA EMPRESA
    // =======================================================

    if (
      stable(
        state.settings
      ) !==
      stable(
        this.snapshots.settings
      )
    ) {

      batch.set(

        doc(
          this.db,
          "empresas",
          this.companyId
        ),

        clone(
          state.settings
        ),

        {
          merge: true
        }
      );


      operations +=
        1;
    }


    // =======================================================
    // COLEÇÕES SINCRONIZÁVEIS
    // =======================================================

    for (
      const stateKey of
      DIRECT_SYNC_KEYS
    ) {

      const firestoreName =
        COLLECTION_MAP[
          stateKey
        ];


      const previous =
        this.snapshots[
          stateKey
        ] ||
        new Map();


      for (
        const item of
        state[stateKey] ||
        []
      ) {

        if (!item?.id) {
          continue;
        }


        if (
          stable(item) ===
          stable(
            previous.get(
              item.id
            )
          )
        ) {

          continue;
        }


        batch.set(

          doc(
            this.db,
            "empresas",
            this.companyId,
            firestoreName,
            item.id
          ),

          clone(item),

          {
            merge: true
          }
        );


        operations +=
          1;
      }
    }


    if (
      operations > 0
    ) {

      await batch.commit();
    }


    this.captureSnapshots(
      state
    );
  }


  // =========================================================
  // ATUALIZAR ESTADO
  // =========================================================

  async refreshState() {

    return this.loadCompanyState(
      this.profile
    );
  }


  // =========================================================
  // CLOUD FUNCTIONS
  // =========================================================

  async call(
    name,
    payload
  ) {

    const callable =
      httpsCallable(
        this.functions,
        name
      );


    const result =
      await callable(
        payload
      );


    return result.data;
  }


  // =========================================================
  // CRIAR NOVA EMPRESA
  // =========================================================

  createMyCompany(payload) {

    return this.call(
      "criarMinhaEmpresa",
      payload
    );
  }


  // =========================================================
  // CANCELAR CADASTRO INCOMPLETO
  // =========================================================

  cancelIncompleteRegistration() {

    return this.call(
      "cancelarCadastroIncompleto",
      {}
    );
  }


  // =========================================================
  // VENDAS
  // =========================================================

  finalizeSale(payload) {

    return this.call(
      "finalizarVenda",
      payload
    );
  }


  importOldSales(sales) {

    return this.call(
      "importarVendasAntigas",
      {
        sales
      }
    );
  }


  // =========================================================
  // ESTOQUE
  // =========================================================

  registerStockMovement(
    payload
  ) {

    return this.call(
      "registrarMovimentacaoEstoque",
      payload
    );
  }


  // =========================================================
  // COMPRAS
  // =========================================================

  receivePurchase(
    payload
  ) {

    return this.call(
      "receberCompra",
      payload
    );
  }


  // =========================================================
  // USUÁRIOS DA EMPRESA
  // =========================================================

  createUser(payload) {

    return this.call(
      "criarUsuario",
      payload
    );
  }


  setUserActive(payload) {

    return this.call(
      "alterarStatusUsuario",
      payload
    );
  }


  // =========================================================
  // IMAGENS DOS PRODUTOS
  // =========================================================

  async uploadProductImage(
    file,
    productId
  ) {

    if (!file) {
      return "";
    }


    if (
      !file.type.startsWith(
        "image/"
      )
    ) {

      throw new Error(
        "Selecione um arquivo de imagem."
      );
    }


    if (
      file.size >
      5 * 1024 * 1024
    ) {

      throw new Error(
        "A imagem deve ter no máximo 5 MB."
      );
    }


    if (!this.companyId) {

      throw new Error(
        "Empresa não identificada para enviar a imagem."
      );
    }


    const safeName =
      file.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "-"
      );


    const path =
      `empresas/${this.companyId}/produtos/${productId}/${Date.now()}-${safeName}`;


    const fileRef =
      ref(
        this.storage,
        path
      );


    await uploadBytes(
      fileRef,
      file,
      {
        contentType:
          file.type
      }
    );


    return getDownloadURL(
      fileRef
    );
  }
}