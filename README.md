# ContBet — Sistema de Contabilidade para Bets

Plataforma multi-tenant para gestão contábil de operadoras de apostas brasileiras.

## Stack

- **Frontend**: Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS
- **Backend**: NestJS 10 + TypeScript + Prisma ORM
- **Banco**: PostgreSQL 15+
- **Autenticação**: JWT + bcrypt
- **Validação**: Zod (frontend) + class-validator (backend)

## Estrutura

```
contbet/
├── apps/
│   ├── web/         # Next.js frontend
│   └── api/         # NestJS backend
├── packages/
│   └── shared/      # Tipos e enums compartilhados
├── docker-compose.yml
└── README.md
```

## Como rodar localmente

### Pré-requisitos
- Node.js 20+
- pnpm 8+ (ou npm)
- Docker + Docker Compose (para o PostgreSQL)

### Passos

```bash
# 1. Subir o PostgreSQL
docker compose up -d

# 2. Backend
cd apps/api
cp .env.example .env
npm install
npx prisma migrate dev
npm run seed
npm run start:dev

# 3. Frontend (em outro terminal)
cd apps/web
cp .env.local.example .env.local
npm install
npm run dev
```

Acesse:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- API Docs (Swagger): http://localhost:3001/docs

### Rodando tudo com Docker (hot-reload)

Para acompanhar alteracoes de codigo em tempo real no browser (inclusive durante edicoes feitas por agentes), rode frontend e backend pelo Compose com volumes montados:

```bash
docker compose up --build
```

O Compose sobe:
- `postgres` na porta `5432`
- `api` (NestJS em watch) na porta `3001`
- `web` (Next.js dev) na porta `3000`

Como os diretorios `apps/web` e `apps/api` ficam montados nos containers, qualquer mudanca de arquivo no host e refletida automaticamente com hot-reload.

### Credenciais iniciais (seed)
- Usuário: `admin`
- Senha: `123456`

## Deploy em produção

### Frontend (Vercel)
```bash
cd apps/web
vercel --prod
```
Configurar `NEXT_PUBLIC_API_URL` apontando para o backend em produção.

### Backend (Railway/Render/Fly.io)
- Build: `npm run build`
- Start: `npm run start:prod`
- Variáveis: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`

### Banco
Recomenda-se PostgreSQL gerenciado: Neon, Supabase, AWS RDS ou Railway.

## Segurança implementada

- Senhas com hash bcrypt (cost 10)
- JWT com expiração configurável
- Guards de autenticação e perfil em todas as rotas
- Rate limiting global + específico em login (5 tentativas / 15min)
- Validação dupla (DTO no backend, Zod no frontend)
- CORS restrito por ambiente
- Helmet para headers de segurança
- Multi-tenancy enforced em queries (Manager/Owner não acessam dados de outras empresas)
- Trilha de auditoria em ações críticas
- Deleção lógica em todas as entidades (`metadeleted`)

## Próximos módulos

- Contratos e honorários
- Apuração de GGR (12% sobre receita líquida)
- IRRF sobre prêmios
- Conciliação financeira
- Relatórios PLD/FT (COAF)
- Calendário fiscal
- Portal do cliente

## Licença

Proprietária — © 2026 ContBet.
