/**
 * Helpers de período e cálculos para relatórios.
 */

export type PeriodType = 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface PeriodRange {
  start: Date;
  end: Date;
  label: string;
  previous_start: Date;
  previous_end: Date;
  previous_label: string;
}

/**
 * Resolve o período baseado no tipo + ano/mês/trimestre.
 * Retorna o intervalo do período + o anterior comparável.
 */
export function resolvePeriod(input: {
  period_type: PeriodType;
  year: number;
  month?: number;
  quarter?: number;
  start_date?: string;
  end_date?: string;
}): PeriodRange {
  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  if (input.period_type === 'monthly') {
    const m = input.month ?? new Date().getMonth() + 1;
    const start = new Date(Date.UTC(input.year, m - 1, 1));
    const end = new Date(Date.UTC(input.year, m, 1));
    const prev_start = new Date(Date.UTC(input.year, m - 2, 1));
    const prev_end = start;
    return {
      start, end,
      label: `${monthNames[m - 1]}/${input.year}`,
      previous_start: prev_start,
      previous_end: prev_end,
      previous_label: `${monthNames[(m - 2 + 12) % 12]}/${m === 1 ? input.year - 1 : input.year}`,
    };
  }

  if (input.period_type === 'quarterly') {
    const q = input.quarter ?? Math.floor(new Date().getMonth() / 3) + 1;
    const startMonth = (q - 1) * 3;
    const start = new Date(Date.UTC(input.year, startMonth, 1));
    const end = new Date(Date.UTC(input.year, startMonth + 3, 1));
    const prev_q_year = q === 1 ? input.year - 1 : input.year;
    const prev_q = q === 1 ? 4 : q - 1;
    const prev_start = new Date(Date.UTC(prev_q_year, (prev_q - 1) * 3, 1));
    const prev_end = new Date(Date.UTC(prev_q_year, (prev_q - 1) * 3 + 3, 1));
    return {
      start, end,
      label: `${q}T/${input.year}`,
      previous_start: prev_start,
      previous_end: prev_end,
      previous_label: `${prev_q}T/${prev_q_year}`,
    };
  }

  if (input.period_type === 'yearly') {
    const start = new Date(Date.UTC(input.year, 0, 1));
    const end = new Date(Date.UTC(input.year + 1, 0, 1));
    const prev_start = new Date(Date.UTC(input.year - 1, 0, 1));
    const prev_end = new Date(Date.UTC(input.year, 0, 1));
    return {
      start, end,
      label: String(input.year),
      previous_start: prev_start,
      previous_end: prev_end,
      previous_label: String(input.year - 1),
    };
  }

  // Custom
  if (!input.start_date || !input.end_date) {
    throw new Error('start_date e end_date obrigatórios para custom.');
  }
  const start = new Date(input.start_date);
  const end = new Date(input.end_date);
  const diffMs = end.getTime() - start.getTime();
  const prev_end = new Date(start);
  const prev_start = new Date(start.getTime() - diffMs);
  return {
    start, end,
    label: `${formatDateShort(start)} a ${formatDateShort(end)}`,
    previous_start: prev_start,
    previous_end: prev_end,
    previous_label: `${formatDateShort(prev_start)} a ${formatDateShort(prev_end)}`,
  };
}

function formatDateShort(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Calcula variação percentual entre dois valores.
 * Retorna null se o valor anterior for zero (divisão por zero).
 */
export function percentageChange(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  const diff = Number(current - previous);
  const prev = Number(previous);
  return (diff / prev) * 100;
}

/** Converte BigInt em number sem perda significativa (para divisões/percentuais) */
export function toNumber(v: bigint): number {
  return Number(v);
}

/** Calcula percentual com 2 casas */
export function percentage(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  return (Number(numerator) / Number(denominator)) * 100;
}
