/**
 * Helpers de formatação para o módulo financeiro
 */

export function formatBRL(cents: string | number | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return 'R$ 0,00';
  const value = Number(cents) / 100;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function centsToReais(cents: string | number | null | undefined): number {
  if (cents === null || cents === undefined || cents === '') return 0;
  return Number(cents) / 100;
}

export function reaisToCents(reais: number | string): number {
  const n = typeof reais === 'string' ? parseFloat(reais) : reais;
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function formatCurrencyInput(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  const cents = parseInt(digits, 10);
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseCurrencyInput(formatted: string | number | null | undefined): number {
  if (formatted === null || formatted === undefined) return 0;
  const digits = String(formatted).replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

// Aliases usados pelos formulários de Contas a Pagar/Receber:
// representam valores em centavos como string já formatada (ex.: "1.234,56").
export const formatBRLInput = formatCurrencyInput;
export const parseInputToCents = parseCurrencyInput;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toISOString().split('T')[0];
}

export function todayInput(): string {
  return new Date().toISOString().split('T')[0];
}

export function daysUntil(iso: string): number {
  const target = new Date(iso);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Formata CPF/CNPJ */
export function formatDocument(doc: string | null | undefined): string {
  if (!doc) return '—';
  const cleaned = doc.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (cleaned.length === 14) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc;
}

/** Formata telefone */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  if (cleaned.length === 10) {
    return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }
  return phone;
}

// =================== LABELS ===================

export const accountTypeLabels: Record<string, string> = {
  ASSET: 'Ativo',
  LIABILITY: 'Passivo',
  EQUITY: 'Patrimônio Líquido',
  REVENUE: 'Receita',
  EXPENSE: 'Despesa',
};

export const bankAccountTypeLabels: Record<string, string> = {
  CHECKING: 'Conta Corrente',
  SAVINGS: 'Poupança',
  PAYMENT: 'Conta de Pagamento',
  PSP_GATEWAY: 'Gateway / PSP',
  CASH: 'Caixa',
};

export const paymentStatusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
  PARTIAL: 'Parcial',
};

export const paymentStatusColors: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border border-amber-200',
  PAID: 'bg-green-50 text-green-700 border border-green-200',
  OVERDUE: 'bg-red-50 text-red-700 border border-red-200',
  CANCELLED: 'bg-stone-100 text-stone-500 border border-stone-200',
  PARTIAL: 'bg-blue-50 text-blue-700 border border-blue-200',
};

export const transactionTypeLabels: Record<string, string> = {
  INCOME: 'Entrada',
  EXPENSE: 'Saída',
  TRANSFER: 'Transferência',
};

export const categoryTypeLabels: Record<string, string> = {
  INCOME: 'Receita',
  EXPENSE: 'Despesa',
};

export const personTypeLabels: Record<string, string> = {
  INDIVIDUAL: 'Pessoa Física',
  COMPANY: 'Pessoa Jurídica',
};

export const statementStatusLabels: Record<string, string> = {
  PROCESSING: 'Processando',
  RECONCILED: 'Conciliado',
  PARTIAL: 'Parcialmente conciliado',
  UNRECONCILED: 'Pendente conciliação',
};

export const statementStatusColors: Record<string, string> = {
  PROCESSING: 'bg-stone-100 text-stone-600 border border-stone-200',
  RECONCILED: 'bg-green-50 text-green-700 border border-green-200',
  PARTIAL: 'bg-amber-50 text-amber-800 border border-amber-200',
  UNRECONCILED: 'bg-red-50 text-red-700 border border-red-200',
};

export const lineStatusLabels: Record<string, string> = {
  UNMATCHED: 'Pendente',
  MATCHED: 'Conciliado',
  IGNORED: 'Ignorado',
  CREATED: 'Criado',
};

export const lineStatusColors: Record<string, string> = {
  UNMATCHED: 'bg-amber-50 text-amber-800 border border-amber-200',
  MATCHED: 'bg-green-50 text-green-700 border border-green-200',
  IGNORED: 'bg-stone-100 text-stone-500 border border-stone-200',
  CREATED: 'bg-blue-50 text-blue-700 border border-blue-200',
};

export const monthNames = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

/** Constrói descrição dos tipos do contato (Cliente/Fornecedor/Funcionário/Sócio) */
export function buildContactBadges(contact: { is_customer: boolean; is_supplier: boolean; is_employee: boolean; is_partner: boolean }): string[] {
  const badges: string[] = [];
  if (contact.is_customer) badges.push('Cliente');
  if (contact.is_supplier) badges.push('Fornecedor');
  if (contact.is_employee) badges.push('Funcionário');
  if (contact.is_partner) badges.push('Sócio');
  return badges;
}
