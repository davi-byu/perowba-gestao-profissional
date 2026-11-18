# Integração Perowba Gestão → Perowba Sports

## O que foi implementado

- Trigger `sincronizarProdutoPerowbaSports` no Cloud Functions do projeto `perowba-finance`.
- A função observa `empresas/{companyId}/produtos/{productId}`.
- A publicação exige configuração explícita no documento da empresa (`sportsIntegration.enabled` e `sportsIntegration.sportsCompanyId`) e `publishToSports: true` no produto.
- Para produtos ativos, SKU e cor são obrigatórios.
- O documento de destino é `empresas/perowba-sports/produtos/gestao_{companyId}_{productId}` no projeto `perowba-sports`.
- A função envia nome, SKU, cor, categoria, marca, preço, variações por tamanho e estoque.
- Fotos, descrição, condição e destaque já mantidos no Sports são preservados em atualizações.
- Desmarcar publicação, desativar o produto ou excluí-lo no Gestão desativa o produto vinculado no Sports; o documento e as imagens não são apagados.
- O estoque só é refletido quando as rotinas do Gestão atualizam o documento do produto. Os fluxos de venda, cancelamento, movimentação e recebimento devem ser testados individualmente.

## Configuração obrigatória antes do deploy

1. No projeto Firebase `perowba-sports`, crie uma conta de serviço dedicada à integração. Conceda somente a permissão necessária para gravar e ler no Firestore, conforme a política IAM da organização.
2. Gere a chave JSON dessa conta e mantenha-a fora do repositório e dos arquivos do site.
3. No terminal, dentro de `functions` do projeto Gestão, selecione o projeto correto e cadastre o segredo:

   ```bash
   firebase use perowba-finance
   firebase functions:secrets:set SPORTS_FIREBASE_SERVICE_ACCOUNT_JSON
   ```

   Cole o JSON integral quando o CLI solicitar. Nunca coloque a chave em JavaScript do navegador, `.env` versionado ou no Git.
4. No Firestore do projeto `perowba-finance`, localize o documento real `empresas/{companyId}` da empresa que controla o Sports e adicione:

   ```json
   {
     "sportsIntegration": {
       "enabled": true,
       "sportsCompanyId": "perowba-sports"
     }
   }
   ```

   `companyId` é o ID do documento da empresa no Gestão, não o ID do projeto Firebase. Não habilite outras empresas.
5. Faça primeiro deploy somente da função nova:

   ```bash
   firebase deploy --only functions:sincronizarProdutoPerowbaSports
   ```

6. Teste com um produto de teste que tenha SKU, cor e `Publicar no Perowba Sports` marcado.

## Regras e segurança do Sports

O projeto Sports inclui `firebase/firestore.rules`. As regras permitem leitura pública dos produtos da empresa `perowba-sports`, restringem a administração ao UID configurado no arquivo e protegem os campos de produtos vinculados ao Gestão contra edição pelo cliente. O Admin SDK da Cloud Function ignora regras de cliente, mas continua sujeito ao IAM da conta de serviço.

Antes de publicar as regras, confirme que o UID administrador da regra corresponde ao administrador real do Firebase Authentication. Faça backup e publique as regras separadamente, somente depois de validar o painel:

```bash
firebase use perowba-sports
firebase deploy --only firestore:rules
```

Não use esse comando para publicar Hosting.

## Testes obrigatórios

- Produto sem SKU ou cor não fica ativo no catálogo.
- Produto sem `publishToSports: true` não é publicado.
- Produto publicado aparece uma única vez, com vínculo `origemGestao`.
- Alteração de preço e estoque no documento do produto atualiza o Sports.
- Tamanhos e quantidades são enviados como `variacoes`.
- Despublicar, desativar ou excluir o produto no Gestão desativa o vínculo no Sports.
- Fotos e descrição cadastradas no Sports permanecem intactas.
- Produtos criados diretamente no Sports não são alterados pela integração.
- Uma empresa sem `sportsIntegration.enabled: true` não sincroniza.
- Testar separadamente venda, cancelamento, movimentação de estoque e recebimento de compra.

## Limitações conhecidas

- Esta entrega adiciona a rotina servidor-servidor, mas não configura a conta de serviço, o Secret Manager nem o documento `sportsIntegration` da empresa. Essas etapas dependem do administrador dos projetos.
- Não foi feito deploy nem teste real entre os dois projetos nesta entrega.
- O catálogo recebe preço base único e variações por tamanho com esse preço. Preços diferentes por tamanho não fazem parte do modelo de produto do Gestão recebido.
