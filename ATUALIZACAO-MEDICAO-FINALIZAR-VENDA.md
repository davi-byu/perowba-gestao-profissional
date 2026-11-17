# Atualização de diagnóstico da finalização de vendas

Esta atualização adiciona somente registros de tempo à Cloud Function `finalizarVenda`.

## O que será medido

- `profileReadMs`: tempo para consultar o perfil do usuário.
- `transactionMs`: duração total de `runTransaction`, incluindo tentativas e commit.
- `transactionCallbackMs`: tempo gasto dentro do callback da transação.
- `transactionCommitAndRetryMs`: diferença entre a duração total e o callback (indicador aproximado do tempo de commit/repetições e espera do SDK).
- `transactionAttempts`: quantas vezes o Firestore executou o callback por causa de repetição da transação.
- `itemCount` e `groupedProductCount`: quantidade de itens recebidos e produtos distintos.
- `totalFunctionMs`: tempo total dentro da função, incluindo perfil, validações e transação.

Os registros não incluem nome, e-mail, UID, dados do cliente, valores ou conteúdo dos produtos.

## Publicar somente a função

No terminal, na pasta raiz do projeto:

```bash
firebase deploy --only functions:finalizarVenda --project perowba-finance
```

## Consultar os registros

Depois de concluir uma venda de teste:

```bash
firebase functions:log --only finalizarVenda --project perowba-finance
```

Procure por:

```text
[Perowba][finalizarVenda][timing]
```

Copie a linha JSON completa e envie para análise. Faça pelo menos uma venda simples de teste e confira se venda, estoque, financeiro e movimentação foram registrados corretamente.

## Segurança e escopo

Esta atualização não altera regras de autorização, validações, cálculo, gravação, estoque, financeiro, auditoria, modelo de dados ou interface. Não é uma otimização de velocidade; é instrumentação para localizar o gargalo com dados reais. A publicação deve ser feita primeiro em ambiente de teste, se disponível.
