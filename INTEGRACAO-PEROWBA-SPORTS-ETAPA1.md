# Integração Perowba Gestão → Perowba Sports (etapa de preparação)

## Implementação presente no código
- Campos `sku`, `color` e `publishToSports` no cadastro de produtos do Gestão.
- Trigger Firestore `sincronizarProdutoPerowbaSports` para alterações em `empresas/{companyId}/produtos/{productId}`.
- A integração só continua quando `empresas/{companyId}.sportsIntegration.enabled == true` e `sportsCompanyId == "perowba-sports"`.
- O Sports recebe SKU, cor, preço, tamanhos e estoque por tamanho.
- Fotos e descrição existentes no Sports são preservadas.
- Despublicação ou inativação do produto no Gestão desativa o item vinculado no Sports.

## Configuração obrigatória antes do primeiro teste
1. Criar no projeto Firebase `perowba-sports` uma conta de serviço com permissão mínima de gravação/leitura no Firestore (por exemplo, papel Cloud Datastore User, conforme política do projeto).
2. Gerar a chave JSON e guardá-la fora do repositório.
3. No diretório `functions` do projeto `perowba-finance`, executar:

```bash
firebase use perowba-finance
firebase functions:secrets:set SPORTS_FIREBASE_SERVICE_ACCOUNT_JSON
```

Quando o CLI solicitar, colar o conteúdo integral do JSON da conta de serviço. Nunca inserir esse conteúdo no JavaScript, no HTML ou no Git.

4. No documento `empresas/{companyId}` do Gestão, configurar:

```json
{
  "sportsIntegration": {
    "enabled": true,
    "sportsCompanyId": "perowba-sports"
  }
}
```

Ative isso somente no documento da empresa que é dona do Perowba Sports. Não habilite para outras empresas.

5. Implantar somente a função de sincronização:

```bash
firebase deploy --only functions:sincronizarProdutoPerowbaSports
```

## Testes obrigatórios antes de produção
- Produto sem SKU/cor não deve ser publicado.
- Produto não vinculado não deve aparecer no Sports.
- Produto publicado deve aparecer com SKU, cor, tamanhos e quantidades.
- Alterar estoque no Gestão deve atualizar a quantidade correspondente no Sports.
- Despublicar/inativar no Gestão deve inativar o item no Sports.
- Fotos e descrição do Sports devem permanecer intactas.
- Repetir eventos não pode criar produtos duplicados.
- Uma segunda empresa sem `sportsIntegration.enabled` não pode sincronizar nada.

## Limitação desta etapa
A sincronização é disparada por alterações no documento do produto no Gestão. O comportamento de estoque depende de todas as rotinas de venda, cancelamento e movimentação atualizarem esse documento de produto. Testar esses fluxos é obrigatório antes de declarar a integração concluída.
