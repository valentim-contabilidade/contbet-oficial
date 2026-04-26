/**
 * Converte recursivamente todos os campos BigInt em string para serialização JSON.
 * O frontend recebe strings e converte para number (sabendo que está em centavos).
 */
export function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object' && obj.constructor === Object) {
    const result: any = {};
    for (const key in obj) {
      result[key] = serializeBigInt(obj[key]);
    }
    return result;
  }
  if (obj instanceof Date) return obj.toISOString();
  // Para objetos Prisma (que não são plain objects)
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      result[key] = serializeBigInt(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * Converte centavos (BigInt) para reais formatados (BRL).
 * Uso: para logs/debug. No frontend tem formatação própria.
 */
export function centsToBRL(cents: bigint | number | string): string {
  const value = typeof cents === 'bigint' ? Number(cents) : Number(cents);
  return (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Converte valor em reais (number) para centavos (BigInt).
 */
export function brlToCents(brl: number): bigint {
  return BigInt(Math.round(brl * 100));
}
