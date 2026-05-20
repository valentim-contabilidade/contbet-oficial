// Labels e helpers para Naturezas Contábeis
import type { DreSection, NatureType } from './nature-types';

export const natureTypeLabels: Record<NatureType, string> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
};

export const dreSectionLabels: Record<DreSection, string> = {
  RECEITA_OPERACIONAL: 'Receita Operacional',
  RECEITA_FINANCEIRA: 'Receita Financeira',
  DEDUCAO_RECEITA: 'Deduções da Receita',
  CUSTO_OPERACIONAL: 'Custo Operacional',
  DESPESA_OPERACIONAL: 'Despesa Operacional',
  DESPESA_NAO_OPERACIONAL: 'Despesa Não Operacional',
  DESPESA_FINANCEIRA: 'Despesa Financeira',
  IMPOSTO_LUCRO: 'Imposto sobre Lucro',
};

export const dreSectionShortLabels: Record<DreSection, string> = {
  RECEITA_OPERACIONAL: 'Rec. Op.',
  RECEITA_FINANCEIRA: 'Rec. Fin.',
  DEDUCAO_RECEITA: 'Dedução',
  CUSTO_OPERACIONAL: 'Custo',
  DESPESA_OPERACIONAL: 'Desp. Op.',
  DESPESA_NAO_OPERACIONAL: 'Desp. NÃO Op.',
  DESPESA_FINANCEIRA: 'Desp. Fin.',
  IMPOSTO_LUCRO: 'IRPJ/CSLL',
};

export const dreSectionColors: Record<DreSection, string> = {
  RECEITA_OPERACIONAL: 'bg-green-50 text-green-800 border border-green-200',
  RECEITA_FINANCEIRA: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  DEDUCAO_RECEITA: 'bg-amber-50 text-amber-800 border border-amber-200',
  CUSTO_OPERACIONAL: 'bg-orange-50 text-orange-800 border border-orange-200',
  DESPESA_OPERACIONAL: 'bg-red-50 text-red-800 border border-red-200',
  DESPESA_NAO_OPERACIONAL: 'bg-rose-50 text-rose-800 border border-rose-200',
  DESPESA_FINANCEIRA: 'bg-purple-50 text-purple-800 border border-purple-200',
  IMPOSTO_LUCRO: 'bg-stone-100 text-stone-800 border border-stone-300',
};

/** Ordem das seções na DRE (para ordenar visualmente) */
export const dreSectionOrder: Record<DreSection, number> = {
  RECEITA_OPERACIONAL: 1,
  DEDUCAO_RECEITA: 2,
  CUSTO_OPERACIONAL: 3,
  DESPESA_OPERACIONAL: 4,
  DESPESA_NAO_OPERACIONAL: 5,
  RECEITA_FINANCEIRA: 6,
  DESPESA_FINANCEIRA: 7,
  IMPOSTO_LUCRO: 8,
};

/** Seções válidas para Receitas */
export const RECEITA_SECTIONS: DreSection[] = ['RECEITA_OPERACIONAL', 'RECEITA_FINANCEIRA'];

/** Seções válidas para Despesas */
export const DESPESA_SECTIONS: DreSection[] = [
  'DEDUCAO_RECEITA',
  'CUSTO_OPERACIONAL',
  'DESPESA_OPERACIONAL',
  'DESPESA_NAO_OPERACIONAL',
  'DESPESA_FINANCEIRA',
  'IMPOSTO_LUCRO',
];

/**
 * Catálogo padrão de nomes de naturezas sugeridos por seção da DRE.
 * Usado no formulário "Nova natureza" para evitar nomes livres/duplicados.
 * Espelha (e expande levemente) as 16 naturezas padrão do backend.
 */
export const SUGGESTED_NATURE_NAMES: Record<DreSection, { name: string; accounting_code?: string; description?: string }[]> = {
  RECEITA_OPERACIONAL: [
    { name: 'GGR (Receita de Apostas)', accounting_code: '3.1.01' },
    { name: 'Receita de Serviços', accounting_code: '3.1.02' },
    { name: 'Outras Receitas Operacionais', accounting_code: '3.1.03' },
  ],
  RECEITA_FINANCEIRA: [
    { name: 'Receita Financeira', accounting_code: '3.2.01' },
    { name: 'Rendimentos de Aplicações', accounting_code: '3.2.02' },
    { name: 'Variação Cambial Ativa', accounting_code: '3.2.03' },
  ],
  DEDUCAO_RECEITA: [
    { name: 'Tributos sobre Receita - Lei 14.790', accounting_code: '3.1.91' },
    { name: 'PIS / COFINS sobre Receita', accounting_code: '3.1.92' },
    { name: 'ISS sobre Serviços', accounting_code: '3.1.93' },
  ],
  CUSTO_OPERACIONAL: [
    { name: 'Prêmios Pagos a Apostadores', accounting_code: '4.1.01' },
    { name: 'Custos com Plataforma', accounting_code: '4.1.02' },
    { name: 'Custos com Provedores de Jogos', accounting_code: '4.1.03' },
  ],
  DESPESA_OPERACIONAL: [
    { name: 'Despesas com Pessoal', accounting_code: '4.2.01' },
    { name: 'Despesas Administrativas', accounting_code: '4.2.02' },
    { name: 'Despesas Comerciais e Marketing', accounting_code: '4.2.03' },
    { name: 'Despesas Tecnológicas', accounting_code: '4.2.04' },
    { name: 'Despesas Tributárias Operacionais', accounting_code: '4.2.05' },
  ],
  DESPESA_NAO_OPERACIONAL: [
    { name: 'Despesas Não Operacionais', accounting_code: '4.3.01' },
  ],
  DESPESA_FINANCEIRA: [
    { name: 'Despesas Financeiras', accounting_code: '4.4.01' },
    { name: 'Variação Cambial Passiva', accounting_code: '4.4.02' },
  ],
  IMPOSTO_LUCRO: [
    { name: 'IRPJ + CSLL', accounting_code: '4.9.01' },
  ],
};
