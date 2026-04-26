// Helpers e labels do módulo fiscal

export const fiscalProviderLabels: Record<string, string> = {
  PLUGNOTAS: 'PlugNotas',
  FOCUS_NFE: 'Focus NFe',
  NFE_IO: 'NFE.io',
  ARQUIVEI: 'Arquivei',
};

export const fiscalDocumentTypeLabels: Record<string, string> = {
  NFSE: 'NFS-e',
  NFE: 'NF-e',
  NFCE: 'NFC-e',
  CTE: 'CT-e',
};

export const fiscalDirectionLabels: Record<string, string> = {
  INCOMING: 'Entrada',
  OUTGOING: 'Saída',
};

export const fiscalStatusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  AUTHORIZED: 'Autorizada',
  CANCELLED: 'Cancelada',
  REJECTED: 'Rejeitada',
  ERROR: 'Erro',
};

export const fiscalStatusColors: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border border-amber-200',
  AUTHORIZED: 'bg-green-50 text-green-700 border border-green-200',
  CANCELLED: 'bg-stone-100 text-stone-600 border border-stone-300 line-through',
  REJECTED: 'bg-red-50 text-red-700 border border-red-200',
  ERROR: 'bg-red-50 text-red-700 border border-red-200',
};

export const certificateStatusLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  EXPIRED: 'Expirado',
  REVOKED: 'Revogado',
  ERROR: 'Erro',
};

export const certificateStatusColors: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700 border border-green-200',
  EXPIRED: 'bg-red-50 text-red-700 border border-red-200',
  REVOKED: 'bg-stone-100 text-stone-600 border border-stone-300',
  ERROR: 'bg-red-50 text-red-700 border border-red-200',
};

/** Calcula dias até expiração */
export function daysUntilExpiration(validToISO: string): number {
  const validTo = new Date(validToISO);
  const now = new Date();
  const diffMs = validTo.getTime() - now.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/** Lê arquivo como base64 (sem prefixo data:...) */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove "data:...;base64," prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}
