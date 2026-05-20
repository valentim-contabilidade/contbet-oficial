import { PrismaClient, Profile, Status } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { syncDefaultAccountingRules } from '../src/accounting/default-rules';

const prisma = new PrismaClient();

// Top 30 bancos brasileiros (códigos COMPE oficiais)
const BANKS_SEED = [
  { code: '001', name: 'Banco do Brasil S.A.' },
  { code: '033', name: 'Banco Santander (Brasil) S.A.' },
  { code: '041', name: 'Banco do Estado do Rio Grande do Sul S.A. (Banrisul)' },
  { code: '070', name: 'BRB - Banco de Brasília S.A.' },
  { code: '077', name: 'Banco Inter S.A.' },
  { code: '085', name: 'Cooperativa Central de Crédito - Ailos' },
  { code: '104', name: 'Caixa Econômica Federal' },
  { code: '197', name: 'Stone Pagamentos S.A.' },
  { code: '208', name: 'Banco BTG Pactual S.A.' },
  { code: '212', name: 'Banco Original S.A.' },
  { code: '237', name: 'Banco Bradesco S.A.' },
  { code: '260', name: 'Nu Pagamentos S.A. (Nubank)' },
  { code: '290', name: 'PagSeguro Internet S.A.' },
  { code: '323', name: 'Mercado Pago' },
  { code: '335', name: 'Banco Digio S.A.' },
  { code: '336', name: 'Banco C6 S.A.' },
  { code: '341', name: 'Itaú Unibanco S.A.' },
  { code: '342', name: 'Creditas Sociedade de Crédito Direto S.A.' },
  { code: '348', name: 'Banco XP S.A.' },
  { code: '380', name: 'PicPay Servicos S.A.' },
  { code: '389', name: 'Banco Mercantil do Brasil S.A.' },
  { code: '422', name: 'Banco Safra S.A.' },
  { code: '623', name: 'Banco Pan S.A.' },
  { code: '633', name: 'Banco Rendimento S.A.' },
  { code: '637', name: 'Banco Sofisa S.A.' },
  { code: '655', name: 'Banco Votorantim S.A.' },
  { code: '707', name: 'Banco Daycoval S.A.' },
  { code: '745', name: 'Banco Citibank S.A.' },
  { code: '748', name: 'Banco Cooperativo Sicredi S.A.' },
  { code: '756', name: 'Banco Cooperativo do Brasil S.A. (Bancoob/Sicoob)' },
];

async function seedBanks() {
  console.log('🏦 Seeding banks...');
  let added = 0;
  for (const b of BANKS_SEED) {
    const exists = await prisma.bank.findUnique({ where: { code: b.code } });
    if (!exists) {
      await prisma.bank.create({ data: b });
      added++;
    }
  }
  console.log(`✅ ${added} novos bancos cadastrados (total no catálogo: ${BANKS_SEED.length})`);
}

async function seedAdmin() {
  const adminUsername = 'admin';
  const adminPassword = '123456';

  const existing = await prisma.user.findUnique({ where: { username: adminUsername } });
  if (existing) {
    console.log('⚠️  Admin user already exists, skipping admin seed.');
    return;
  }

  const password_hash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.create({
    data: {
      name: 'Administrador',
      username: adminUsername,
      email: 'admin@contbet.com.br',
      password_hash,
      profile: Profile.ADMIN,
      status: Status.ACTIVE,
    },
  });

  console.log('✅ Admin user created:', admin.username);
  console.log(`   Login: ${adminUsername} / ${adminPassword}`);
}

async function main() {
  console.log('🌱 Seeding ContBet database...');
  await seedAdmin();
  await seedBanks();
  const rulesRes = await syncDefaultAccountingRules(prisma);
  console.log(`📒 Accounting rules: ${rulesRes.created} criadas (catálogo: ${rulesRes.total_default}).`);
  console.log('✨ Seed concluído.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
