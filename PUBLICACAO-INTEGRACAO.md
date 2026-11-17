# Pacote de revisão — Integração Perowba Gestão → Perowba Sports

Este pacote foi extraído dos dois ZIPs enviados e passou por verificação sintática dos arquivos JavaScript com Node.js 22. Não foi feito deploy nem qualquer alteração nos projetos Firebase de produção.

## O que já está implementado no código

- O Gestão contém os campos `sku`, `color` e `publishToSports` no formulário de produtos.
- O Gestão contém a Cloud Function `sincronizarProdutoPerowbaSports`, acionada por escrita em `empresas/{companyId}/produtos/{productId}`.
- A função só prossegue se o documento `empresas/{companyId}` tiver `sportsIntegration.enabled: true` e `sportsIntegration.sportsCompanyId: "perowba-sports"`.
- O destino é `empresas/perowba-sports/produtos`.
- O vínculo usa `origemGestao.companyId` e `origemGestao.productId`.
- O Sports preserva fotos e campos editoriais; a interface impede edição/exclusão de estoque de produtos vinculados.
- Há regras Firestore no pacote Sports que restringem escrita e protegem campos sincronizados.

## NÃO publique ainda — itens obrigatórios

1. **Credencial servidor-servidor:** criar uma conta de serviço no projeto `perowba-sports` e guardar a chave JSON no Secret Manager do projeto `perowba-finance` como `SPORTS_FIREBASE_SERVICE_ACCOUNT_JSON`. A chave não está incluída neste pacote e não deve ser colocada no código.
2. **Empresa correta:** confirmar o `companyId` real da sua empresa no Gestão. O ZIP não contém dados de produção que permitam confirmar esse identificador. Habilitar `sportsIntegration` somente no documento dessa empresa.
3. **Admin UID do Sports:** as regras e o painel usam o UID `bSJntb0JQhSTFluXm46sI9SMrhT2`. Confirmar no Firebase Authentication que esse é realmente o usuário administrador autorizado antes de publicar as regras.
4. **Regras atuais do Sports:** comparar `firebase/firestore.rules` com as regras atualmente publicadas. O pacote não inclui as regras de Storage do Sports; não publique configuração de Storage a partir deste pacote.
5. **Estoque por tamanho:** vendas e cancelamentos do Gestão atualizam o documento do produto e os tamanhos; o gatilho replica o estado resultante. Porém, as funções atuais `registrarMovimentacaoEstoque` e `receberCompra` trabalham com estoque geral do produto e não recebem tamanho. Se usar essas rotinas para produtos com tamanhos, o estoque por tamanho pode ficar inconsistente. Não declarar sincronização completa desses fluxos sem adaptar a operação para identificar o tamanho.
6. **Teste controlado:** testar com um SKU exclusivo em um produto de teste, verificando venda, cancelamento, desativação, preservação das imagens/descrição e isolamento de outra empresa. Não use um produto de venda real como primeiro teste.

## Ordem de publicação após cumprir os itens acima

### Gestão (`perowba-finance`)
No diretório do projeto Gestão:
```bash
cd functions
npm ci
cd ..
firebase use perowba-finance
firebase functions:secrets:set SPORTS_FIREBASE_SERVICE_ACCOUNT_JSON
firebase deploy --only functions:sincronizarProdutoPerowbaSports
```

Depois de configurar o documento da empresa correta:
```json
{
  "sportsIntegration": {
    "enabled": true,
    "sportsCompanyId": "perowba-sports"
  }
}
```

### Sports (`perowba-sports`)
No diretório do projeto Sports:
```bash
firebase deploy --project perowba-sports --only firestore:rules
```

Antes, confirmar que o UID administrador nas regras é o correto e que as regras atuais foram revisadas/backup feito.

## Verificação técnica executada
- Node.js v22.16.0.
- `node --check` sem erros para:
  - Gestão: `functions/index.js`, `scripts/app.js`.
  - Sports: `scripts/admin.js`, `scripts/catalogo.js`, `scripts/firebase-service.js`.

## Limite deste pacote
A verificação sintática não equivale a teste integrado no Firebase. Não foram criados segredos, contas de serviço, documentos de empresa, nem executadas publicações. Essas etapas exigem acesso/autorização ao Firebase e confirmação dos identificadores de produção.
