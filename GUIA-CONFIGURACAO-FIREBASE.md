# Guia de configuração — Perowba Gestão com Firebase

Este pacote mantém o sistema funcionando em modo local enquanto `enabled` estiver como `false`. Depois da configuração, altere para `true` para usar Authentication, Firestore, Storage e Cloud Functions.

## O que esta versão acrescenta

- Login real com Firebase Authentication.
- Recuperação de senha por e-mail.
- Dados separados por empresa em `empresas/{companyId}/...`.
- Produtos, clientes, fornecedores, caixa, financeiro e auditoria no Firestore.
- Imagens de produtos no Cloud Storage.
- Venda concluída em Cloud Function com transação de estoque.
- Compra recebida em Cloud Function com entrada de estoque e conta a pagar.
- Ajuste de estoque em Cloud Function.
- Criação e ativação de usuários em Cloud Function, sem senha no Firestore.
- Regras do Firestore e Storage.
- Estrutura de App Check.
- Estrutura de Hosting, emuladores e backups.

## 1. Pré-requisitos

Instale:

- Node.js 22.
- Visual Studio Code.
- Firebase CLI.

No terminal:

```bash
npm install -g firebase-tools
firebase login
```

Cloud Functions e Cloud Storage exigem o plano Blaze. Configure também um alerta de orçamento no Google Cloud Billing.

## 2. Crie o projeto Firebase

Para desenvolver com segurança, crie primeiro um projeto chamado, por exemplo:

```text
perowba-gestao-dev
```

Quando estiver testado, crie outro projeto para produção:

```text
perowba-gestao-prod
```

Não use dados reais no projeto de desenvolvimento.

## 3. Registre o aplicativo Web

No Firebase Console:

1. Abra **Configurações do projeto**.
2. Em **Seus aplicativos**, escolha o ícone Web `</>`.
3. Registre o aplicativo.
4. Copie o objeto `firebaseConfig`.
5. Abra `scripts/firebase-config.js`.
6. Substitua os valores de exemplo.
7. Troque:

```js
enabled: false
```

por:

```js
enabled: true
```

Não coloque credenciais de conta de serviço no código do navegador.

## 4. Ative o Authentication

No Firebase Console:

1. Acesse **Authentication**.
2. Clique em **Começar**.
3. Abra **Método de login**.
4. Ative **E-mail/senha**.
5. Em **Configurações > Domínios autorizados**, confirme o domínio do Firebase Hosting e os demais domínios usados pelo sistema.

## 5. Crie o banco Firestore

1. Acesse **Firestore Database**.
2. Clique em **Criar banco de dados**.
3. Escolha o modo de produção.
4. Escolha cuidadosamente a região. Para operação no Brasil, prefira uma região compatível próxima, como São Paulo, quando disponível para o projeto.

A localização do banco não deve ser escolhida sem planejamento, pois afeta latência, custo e outros recursos.

## 6. Crie a primeira empresa e o primeiro administrador

### 6.1 Crie o usuário no Authentication

Em **Authentication > Usuários**:

1. Clique em **Adicionar usuário**.
2. Use seu e-mail real ou `admin@perowba.com` para testes.
3. Crie uma senha forte.
4. Copie o **UID** gerado.

### 6.2 Crie a empresa no Firestore

Crie a coleção:

```text
empresas
```

Crie um documento com ID:

```text
perowba-sports
```

Adicione os campos:

| Campo | Tipo | Valor inicial |
|---|---|---|
| `companyName` | string | `Perowba Sports` |
| `cnpj` | string | deixe vazio durante o teste |
| `phone` | string | telefone da empresa |
| `city` | string | `João Pessoa - PB` |
| `allowNegativeStock` | boolean | `false` |
| `currency` | string | `BRL` |

### 6.3 Crie o perfil do administrador

Crie a coleção:

```text
usuarios
```

O ID do documento deve ser exatamente o **UID copiado do Authentication**.

Adicione:

| Campo | Tipo | Valor |
|---|---|---|
| `name` | string | seu nome |
| `email` | string | o mesmo e-mail do Authentication |
| `role` | string | `admin` |
| `active` | boolean | `true` |
| `companyId` | string | `perowba-sports` |

Depois disso, o administrador poderá criar os outros usuários dentro do próprio sistema.

## 7. Ative o Cloud Storage

1. Acesse **Storage**.
2. Clique em **Começar**.
3. Crie o bucket padrão.
4. Confirme que o `storageBucket` em `firebase-config.js` é exatamente o informado pelo Firebase.

As regras deste projeto aceitam somente imagens de produtos com até 5 MB, enviadas por administrador ou gerente da mesma empresa.

## 8. Associe a pasta ao projeto Firebase

Abra o terminal dentro de `perowba-gestao-profissional`:

```bash
firebase use --add
```

Selecione o projeto de desenvolvimento e escolha um alias como:

```text
dev
```

Para produção, posteriormente:

```bash
firebase use --add
```

Escolha outro projeto e o alias:

```text
prod
```

## 9. Instale as dependências das Cloud Functions

```bash
cd functions
npm install
cd ..
```

## 10. Teste localmente com os emuladores

```bash
firebase emulators:start
```

Abra o endereço do Hosting Emulator exibido no terminal, normalmente:

```text
http://127.0.0.1:5000
```

Observação: o projeto ainda usa os serviços Firebase configurados no navegador. Para um ambiente de emulador totalmente isolado, a próxima melhoria é conectar explicitamente os SDKs aos emuladores no arquivo `firebase-service.js`.

## 11. Publique regras, funções e site

Primeira publicação:

```bash
firebase deploy --only firestore:rules,storage,functions,hosting
```

Também é possível publicar separadamente:

```bash
firebase deploy --only firestore:rules
firebase deploy --only storage
firebase deploy --only functions
firebase deploy --only hosting
```

Depois da publicação, abra a URL exibida pelo Firebase Hosting e teste o login.

## 12. Configure o App Check

Faça isso depois que login, banco, funções e Storage estiverem funcionando.

1. Crie uma chave de site do reCAPTCHA Enterprise para o domínio de produção.
2. No Firebase Console, abra **App Check**.
3. Registre o aplicativo Web usando o reCAPTCHA Enterprise.
4. Coloque a chave pública em:

```js
appCheckSiteKey: "SUA_CHAVE_DE_SITE"
```

5. Teste sem enforcement para confirmar que as requisições recebem tokens válidos.
6. No arquivo `functions/index.js`, altere:

```js
const ENFORCE_APP_CHECK = false;
```

para:

```js
const ENFORCE_APP_CHECK = true;
```

7. Publique novamente as funções:

```bash
firebase deploy --only functions
```

8. Depois, ative gradualmente o enforcement do App Check para Firestore, Storage e Authentication, acompanhando as métricas para não bloquear usuários legítimos.

Nunca publique um token de depuração do App Check no GitHub.

## 13. Configure backups automáticos

No Google Cloud Console:

1. Abra **Firestore > Databases**.
2. Localize o banco `(default)`.
3. Abra **Scheduled backups** ou **Disaster recovery**.
4. Configure um backup diário.
5. Defina uma retenção adequada, por exemplo 14 ou 30 dias.
6. Mantenha também um backup semanal com retenção maior, se disponível para sua estratégia.
7. Teste uma restauração em um banco ou projeto de teste antes de considerar o processo concluído.

O backup não substitui regras de segurança, auditoria nem exportações operacionais.

## 14. Testes mínimos antes de usar dados reais

Teste com pelo menos dois navegadores ou usuários:

- Administrador consegue entrar.
- Vendedor não acessa usuários, auditoria e configurações.
- Estoquista acessa compras e estoque, mas não financeiro.
- Financeiro não altera produtos e estoque.
- Venda reduz o estoque uma única vez.
- Duas vendas simultâneas não deixam o estoque incorreto.
- Venda sem estoque é recusada.
- Compra aumenta o estoque e cria despesa.
- Ajuste negativo exige motivo e não deixa estoque negativo.
- Usuário desativado não consegue entrar.
- Imagem acima de 5 MB é recusada.
- Usuário de uma empresa não lê dados de outra empresa.
- Relatórios apresentam os mesmos totais das vendas.
- Backup pode ser restaurado em ambiente de teste.

## 15. O que ainda deve ser desenvolvido antes de chamar de versão final

Esta entrega conclui a fundação Firebase, mas um sistema comercial completo ainda precisa destas etapas:

1. Cancelamento, troca e devolução por Cloud Functions.
2. Inventário com aprovação do gerente.
3. Recebimentos parciais de compras.
4. Pagamentos divididos no PDV.
5. Paginação e consultas por período no Firestore, sem carregar todo o histórico.
6. Atualizações em tempo real com listeners.
7. Testes automatizados das regras com Emulator Suite.
8. Verificação de e-mail e política de senha.
9. Registro de login/logout e tentativas negadas no backend.
10. Módulo fiscal NF-e/NFC-e com provedor especializado e contador.
11. Gateway de pagamentos, sem armazenar dados completos de cartão.
12. Política de privacidade, termos, retenção de dados e processo LGPD.
13. Monitoramento, alertas de custo e resposta a incidentes.

## 16. Ordem recomendada a partir daqui

1. Configurar este pacote no projeto de desenvolvimento.
2. Testar autenticação e separação por empresa.
3. Testar venda, compra e movimentação simultâneas.
4. Implementar cancelamento, devolução e inventário.
5. Adicionar paginação e testes automatizados.
6. Criar projeto de produção separado.
7. Ativar App Check e backups.
8. Somente depois inserir dados reais e integrar emissão fiscal.
