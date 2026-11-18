# Integração Perowba Gestão → Perowba Sports

## Estado do código nesta entrega

A Cloud Function `sincronizarProdutoPerowbaSports` foi adicionada a `functions/index.js`. Ela observa alterações em `empresas/{companyId}/produtos/{productId}` e replica os dados permitidos para o projeto Firebase `perowba-sports`, desde que a integração esteja habilitada no documento da empresa e o produto esteja marcado para publicação.

A função preserva conteúdo editorial já cadastrado no Sports e desativa, sem excluir, produtos que forem despublicados, desativados ou removidos do Gestão.

## Configuração externa ainda necessária

- Criar conta de serviço dedicada no projeto `perowba-sports`.
- Armazenar a chave JSON como Secret Manager secret `SPORTS_FIREBASE_SERVICE_ACCOUNT_JSON` no projeto `perowba-finance`.
- Configurar `sportsIntegration.enabled: true` e `sportsIntegration.sportsCompanyId: "perowba-sports"` no documento correto `empresas/{companyId}` do Gestão.
- Confirmar UID administrador nas regras do Sports.
- Fazer deploy da função e executar testes reais antes de produção.

Consulte `INTEGRACAO-PEROWBA-SPORTS.md` para o procedimento detalhado e os testes obrigatórios.
