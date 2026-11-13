# Perowba Gestão — versão Firebase

Sistema responsivo de vendas, estoque, compras, caixa, financeiro, usuários, relatórios e auditoria.

## Comece aqui

Leia o arquivo:

```text
GUIA-CONFIGURACAO-FIREBASE.md
```

## Modos de funcionamento

- `firebaseSettings.enabled: false`: demonstração local com `localStorage`.
- `firebaseSettings.enabled: true`: Firebase Authentication, Firestore, Storage e Cloud Functions.

## Operações protegidas no servidor

- Finalização de venda e baixa de estoque.
- Ajuste de estoque.
- Recebimento de compra.
- Criação e ativação de usuários.

## Estrutura principal

```text
scripts/firebase-config.js    configuração do aplicativo Web
firebase/firestore.rules       regras do banco
firebase/storage.rules         regras dos arquivos
functions/index.js             operações sensíveis
scripts/firebase-service.js    integração do navegador
scripts/app.js                 interface e regras do sistema
firebase.json                  deploy e emuladores
```

## Login local de demonstração

Enquanto o Firebase estiver desativado:

- `admin@perowba.com` / `123456`
- `vendedor@perowba.com` / `123456`

Essas credenciais não existem automaticamente no Firebase. No modo Firebase, crie o primeiro administrador conforme o guia.

## Aviso

Não use dados comerciais reais antes de configurar regras, funções, App Check, backups, testes de concorrência e um projeto de produção separado.
