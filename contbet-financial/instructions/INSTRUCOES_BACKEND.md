# ContBet — Aplicação do Módulo Financeiro (Backend)

Este pacote contém os arquivos do **backend** do Módulo Financeiro.
A Parte 2 (frontend) virá na próxima resposta.

## Antes de começar

1. Abra um terminal no Cursor.
2. Pare o backend se estiver rodando (`Ctrl+C` na aba dele).

## Passo 1 — Substituir/criar os arquivos

Os arquivos abaixo devem ser **substituídos ou criados** no seu projeto, mantendo a estrutura de pastas:

### Arquivos a SUBSTITUIR (já existem no seu projeto):

- `apps/api/prisma/schema.prisma` ← substituir pelo novo
- `apps/api/src/app.module.ts` ← substituir pelo novo

### Arquivos NOVOS (criar):

- `apps/api/src/financial/tenant.helper.ts`
- `apps/api/src/financial/money.helper.ts`
- `apps/api/src/financial/chart-of-accounts/chart-of-accounts.module.ts`
- `apps/api/src/financial/financial-categories/financial-categories.module.ts`
- `apps/api/src/financial/bank-accounts/bank-accounts.module.ts`
- `apps/api/src/financial/accounts-payable/accounts-payable.module.ts`
- `apps/api/src/financial/accounts-receivable/accounts-receivable.module.ts`
- `apps/api/src/financial/transactions/transactions.module.ts`

Basta **descompactar o zip dentro da raiz do projeto `contbet/`** que tudo vai para o lugar certo.

## Passo 2 — Aplicar a migration do banco

No terminal, dentro de `apps/api`:

```bash
cd apps/api
npx prisma generate
npx prisma migrate dev --name add_financial_module
```

Quando o Prisma perguntar, dê **Enter** ou digite `y` para confirmar.

Você vai ver mensagens como:
```
✔ Generated Prisma Client
The following migration(s) have been created and applied:
  └─ XXXXXXXXXXXXXX_add_financial_module/
        └─ migration.sql
```

## Passo 3 — Subir o backend

```bash
npm run start:dev
```

Aguarde aparecer:
```
🚀 ContBet API rodando em http://localhost:3001
📖 Swagger em http://localhost:3001/docs
```

Acesse `http://localhost:3001/docs` no navegador. Você verá os novos grupos de endpoints:

- `financial/chart-of-accounts` — Plano de Contas
- `financial/categories` — Categorias Financeiras
- `financial/bank-accounts` — Contas Bancárias
- `financial/accounts-payable` — Contas a Pagar
- `financial/accounts-receivable` — Contas a Receber
- `financial/transactions` — Lançamentos
- `financial/reports` — Dashboard e Fluxo de Caixa

## Próximo passo

Aguarde a **Parte 2** (frontend) para ter acesso visual a tudo isso.
Depois te entrego em zip também.

## Em caso de erro

- Erro de **TypeScript** ao subir o backend: rode `npm install` na pasta `apps/api` (caso falte alguma dependência).
- Erro de **Prisma**: certifique-se de que o PostgreSQL está rodando (`docker compose ps` na raiz).
- Erro de **autenticação**: o admin já existe do seed anterior, não precisa rodar `npm run seed` de novo.

Os dados já cadastrados (empresas, usuários, marcas) **não serão afetados** — a migration só **adiciona** tabelas novas.
