// Helpers e labels do módulo tributário

export const taxRegimeLabels: Record<string, string> = {
  LUCRO_REAL: 'Lucro Real',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  SIMPLES_NACIONAL: 'Simples Nacional',
};

export const pisCofinsRegimeLabels: Record<string, string> = {
  CUMULATIVO: 'Cumulativo',
  NAO_CUMULATIVO: 'Não-Cumulativo',
};

export const apurationPeriodLabels: Record<string, string> = {
  TRIMESTRAL: 'Trimestral',
  ANUAL_ESTIMATIVA: 'Anual (estimativa mensal)',
};

export const irpjStatusLabels: Record<string, string> = {
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  PAID: 'Paga',
};

export const irpjStatusColors: Record<string, string> = {
  OPEN: 'bg-blue-50 text-blue-700 border border-blue-200',
  CLOSED: 'bg-amber-50 text-amber-800 border border-amber-200',
  PAID: 'bg-green-50 text-green-700 border border-green-200',
};

export const lalurTypeLabels: Record<string, string> = {
  ADDITION: 'Adição',
  EXCLUSION: 'Exclusão',
};

export function formatPeriod(p: { period_type: string; year: number; quarter: number | null; month: number | null }): string {
  if (p.period_type === 'TRIMESTRAL' && p.quarter) {
    return `${p.quarter}T/${p.year}`;
  }
  if (p.month) {
    return `${String(p.month).padStart(2, '0')}/${p.year}`;
  }
  return `${p.year}`;
}

export function quarterLabel(q: number): string {
  const labels = ['1º Trimestre (Jan-Mar)', '2º Trimestre (Abr-Jun)', '3º Trimestre (Jul-Set)', '4º Trimestre (Out-Dez)'];
  return labels[q - 1] || `${q}º Trimestre`;
}
