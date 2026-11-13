# Integração Perowba Gestão → Perowba Sports

## Estado desta etapa

Esta versão prepara a publicação de produtos e a sincronização de dados/estoque por gatilho do Firestore. O Gestão continua sendo a fonte oficial do estoque. O Sports preserva as imagens e a descrição editorial já cadastradas.

## Regras

- A sincronização só ocorre quando o documento da empresa no projeto `perowba-finance`, em `empresas/{companyId}`, possui `sportsIntegration.enabled: true` e `sportsIntegration.sportsCompanyId: "perowba-sports"`.
- O produto precisa ter `publishToSports: true`, SKU e cor.
- O destino é `empresas/perowba-sports/produtos` no projeto Firebase `perowba-sports`.
- O documento de destino guarda `origemGestao.companyId` e `origemGestao.productId` para manter o vínculo exato.
- Produtos não vinculados não são alterados.
- Despublicar ou desativar um produto vinculado o deixa inativo no catálogo; não apaga o documento nem as imagens.

## Configuração obrigatória no Firebase

1. No projeto Firebase `perowba-sports`, crie/obtenha uma chave de conta de serviço dedicada para integração servidor-servidor. Conceda a essa conta a permissão mínima necessária para ler/gravar Firestore (por exemplo, Cloud Datastore User).
2. No projeto `perowba-finance`, configure o Secret Manager para a função:

   ```bash
   firebase functions:secrets:set SPORTS_FIREBASE_SERVICE_ACCOUNT_JSON
   ```

   Cole o conteúdo JSON completo da chave de serviço do projeto `perowba-sports`. Nunca coloque esse JSON no site, no repositório ou no ZIP.

3. No Firestore do projeto `perowba-finance`, abra o documento `empresas/{companyId}` da empresa correta e adicione:

   ```json
   {
     "sportsIntegration": {
       "enabled": true,
       "sportsCompanyId": "perowba-sports"
     }
   }
   ```

   Não habilite outras empresas. Confirme o `companyId` pelo perfil de administrador antes de alterar esse documento.

4. Faça deploy das Cloud Functions no projeto `perowba-finance` após revisar o projeto selecionado:

   ```bash
   firebase use perowba-finance
   firebase deploy --only functions
   ```

5. Faça primeiro o teste com um produto de teste com SKU exclusivo, cor preenchida e `Publicar no Perowba Sports` marcado.

## Limitação de segurança que ainda exige configuração

O ZIP do Perowba Sports recebido não contém `firestore.rules` nem `firebase.json`. O código do navegador agora evita sobrescrever estoque/preço/variações de produtos vinculados em operações normais do painel, mas isso **não substitui regras de segurança do Firestore**. Antes de produção, é obrigatório revisar as regras diretamente no projeto `perowba-sports` para impedir que clientes autenticados alterem campos sincronizados (`sku`, `cor`, `preco`, `variacoes`, `tamanhos`, `estoque`, `origemGestao` e `ativo`) em produtos com `origemGestao`.

## Testes pendentes antes de produção

- Validar a conta de serviço e o secret.
- Confirmar o `companyId` correto e habilitar apenas essa empresa.
- Testar publicação, alteração de preço, baixa por venda, cancelamento/devolução e movimentação de estoque.
- Testar despublicação e garantir que produtos não vinculados permaneçam intactos.
- Aplicar regras de Firestore no Sports para bloquear alterações diretas nos campos controlados pelo Gestão.
