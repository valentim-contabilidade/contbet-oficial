/**
 * Parser de arquivos GGR (CSV/XLSX) com formato padrão ContBet.
 *
 * FORMATO PADRÃO (todas as colunas obrigatórias):
 * - data: YYYY-MM-DD ou DD/MM/YYYY
 * - apostas: valor monetário (R$ 1.234,56 ou 1234.56)
 * - premios: valor monetário
 * - depositos: valor monetário
 * - saques: valor monetário
 *
 * Colunas opcionais:
 * - quantidade_apostas
 * - quantidade_premios
 * - quantidade_depositos
 * - quantidade_saques
 * - jogadores_ativos
 *
 * Aceita variações em inglês: bets, prizes, deposits, withdrawals
 * Aceita variações sem acento.
 */

export interface ParsedGgrLine {
  date: Date;
  total_bets: bigint; // centavos
  total_prizes: bigint;
  total_deposits: bigint;
  total_withdrawals: bigint;
  total_bonus?: bigint;
  total_cashback?: bigint;
  bet_count?: number;
  prize_count?: number;
  deposit_count?: number;
  withdrawal_count?: number;
  active_players?: number;
}

export interface ParsedGgrFile {
  format: 'CSV' | 'XLSX';
  lines: ParsedGgrLine[];
  warnings: string[];
}

// =================== Helpers ===================

function normalizeColumnName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .trim()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['data', 'date', 'dia', 'day'],
  total_bets: ['apostas', 'bets', 'stake', 'stakes', 'wager', 'wagers', 'volume_apostas', 'total_apostas'],
  total_prizes: ['premios', 'prizes', 'wins', 'payout', 'payouts', 'volume_premios', 'total_premios'],
  total_deposits: ['depositos', 'deposits', 'volume_depositos', 'total_depositos'],
  total_withdrawals: ['saques', 'withdrawals', 'cashouts', 'volume_saques', 'total_saques'],
  total_bonus: ['bonus', 'gamificacao', 'gamification', 'bonus_total', 'total_bonus', 'freebet', 'freebets', 'freespin', 'volume_bonus'],
  total_cashback: ['cashback', 'total_cashback', 'cash_back'],
  bet_count: ['quantidade_apostas', 'qtd_apostas', 'bets_count', 'num_apostas', 'numero_apostas'],
  prize_count: ['quantidade_premios', 'qtd_premios', 'prizes_count', 'num_premios'],
  deposit_count: ['quantidade_depositos', 'qtd_depositos', 'num_depositos'],
  withdrawal_count: ['quantidade_saques', 'qtd_saques', 'num_saques'],
  active_players: ['jogadores_ativos', 'active_players', 'players', 'usuarios_ativos'],
};

function findColumnIndex(headers: string[], targetField: string): number {
  const aliases = COLUMN_ALIASES[targetField] || [];
  for (let i = 0; i < headers.length; i++) {
    const normalized = normalizeColumnName(headers[i]);
    if (aliases.some(a => normalizeColumnName(a) === normalized)) {
      return i;
    }
  }
  return -1;
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  
  // YYYY-MM-DD
  let m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
  
  // DD/MM/YYYY
  m = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])));
  
  // DD-MM-YYYY
  m = cleaned.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])));
  
  // ISO timestamp
  if (cleaned.match(/^\d{4}-\d{2}-\d{2}T/)) {
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d;
  }
  
  return null;
}

function parseMoney(raw: string | number | undefined | null): bigint {
  if (raw === undefined || raw === null || raw === '') return 0n;
  if (typeof raw === 'number') {
    return BigInt(Math.round(raw * 100));
  }
  // String tratamento
  const cleaned = String(raw)
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '') // remove separador de milhar
    .replace(',', '.'); // troca vírgula decimal por ponto
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0n;
  return BigInt(Math.round(num * 100));
}

function parseInteger(raw: string | number | undefined | null): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number') return Math.round(raw);
  const cleaned = String(raw).replace(/\D/g, '');
  if (!cleaned) return undefined;
  return parseInt(cleaned, 10);
}

// =================== CSV PARSER ===================

function detectDelimiter(line: string): string {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const c of line) {
    if (c === ',') counts[',']++;
    else if (c === ';') counts[';']++;
    else if (c === '\t') counts['\t']++;
  }
  if (counts[';'] >= counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[',']) return '\t';
  return ',';
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result.map(s => s.trim().replace(/^"|"$/g, ''));
}

export function parseGgrCSV(content: string): ParsedGgrFile {
  // Pula BOM (UTF-8), linhas vazias e linhas iniciadas por `#` (comentário/instruções)
  const cleaned = content.replace(/^﻿/, '');
  const lines = cleaned
    .split(/\r?\n/)
    .filter(l => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith('#');
    });
  if (lines.length < 2) {
    throw new Error('Arquivo CSV vazio ou sem linhas de dados.');
  }
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter);

  const idxDate = findColumnIndex(headers, 'date');
  const idxBets = findColumnIndex(headers, 'total_bets');
  const idxPrizes = findColumnIndex(headers, 'total_prizes');
  const idxDeposits = findColumnIndex(headers, 'total_deposits');
  const idxWithdrawals = findColumnIndex(headers, 'total_withdrawals');

  if (idxDate < 0) throw new Error('Coluna "data" não encontrada no CSV.');
  if (idxBets < 0) throw new Error('Coluna "apostas" não encontrada no CSV.');
  if (idxPrizes < 0) throw new Error('Coluna "premios" não encontrada no CSV.');
  if (idxDeposits < 0) throw new Error('Coluna "depositos" não encontrada no CSV.');
  if (idxWithdrawals < 0) throw new Error('Coluna "saques" não encontrada no CSV.');

  const idxBetCount = findColumnIndex(headers, 'bet_count');
  const idxPrizeCount = findColumnIndex(headers, 'prize_count');
  const idxDepositCount = findColumnIndex(headers, 'deposit_count');
  const idxWithdrawalCount = findColumnIndex(headers, 'withdrawal_count');
  const idxActivePlayers = findColumnIndex(headers, 'active_players');
  const idxBonus = findColumnIndex(headers, 'total_bonus');
  const idxCashback = findColumnIndex(headers, 'total_cashback');

  const result: ParsedGgrLine[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i], delimiter);
    const date = parseDate(cols[idxDate]);
    if (!date) {
      warnings.push(`Linha ${i + 1}: data inválida "${cols[idxDate]}", ignorada.`);
      continue;
    }
    const total_bets = parseMoney(cols[idxBets]);
    const total_prizes = parseMoney(cols[idxPrizes]);
    const total_deposits = parseMoney(cols[idxDeposits]);
    const total_withdrawals = parseMoney(cols[idxWithdrawals]);

    result.push({
      date,
      total_bets,
      total_prizes,
      total_deposits,
      total_withdrawals,
      total_bonus: idxBonus >= 0 ? parseMoney(cols[idxBonus]) : undefined,
      total_cashback: idxCashback >= 0 ? parseMoney(cols[idxCashback]) : undefined,
      bet_count: idxBetCount >= 0 ? parseInteger(cols[idxBetCount]) : undefined,
      prize_count: idxPrizeCount >= 0 ? parseInteger(cols[idxPrizeCount]) : undefined,
      deposit_count: idxDepositCount >= 0 ? parseInteger(cols[idxDepositCount]) : undefined,
      withdrawal_count: idxWithdrawalCount >= 0 ? parseInteger(cols[idxWithdrawalCount]) : undefined,
      active_players: idxActivePlayers >= 0 ? parseInteger(cols[idxActivePlayers]) : undefined,
    });
  }

  if (result.length === 0) {
    throw new Error('Nenhuma linha de dados válida encontrada no CSV.');
  }

  return { format: 'CSV', lines: result, warnings };
}

// =================== XLSX PARSER ===================

/**
 * Parser de XLSX usando o pacote 'xlsx' (SheetJS).
 * Lê a primeira planilha e converte para o mesmo formato do CSV.
 */
export function parseGgrXLSX(buffer: Buffer): ParsedGgrFile {
  // Import dinâmico para evitar penalty quando não usar
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Planilha XLSX não tem nenhuma aba.');
  const sheet = workbook.Sheets[sheetName];
  // Converte para array de objetos com headers como chaves
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (rows.length === 0) {
    throw new Error('Planilha XLSX vazia.');
  }

  const headers = Object.keys(rows[0]);
  const idxDate = findColumnIndex(headers, 'date');
  const idxBets = findColumnIndex(headers, 'total_bets');
  const idxPrizes = findColumnIndex(headers, 'total_prizes');
  const idxDeposits = findColumnIndex(headers, 'total_deposits');
  const idxWithdrawals = findColumnIndex(headers, 'total_withdrawals');

  if (idxDate < 0) throw new Error('Coluna "data" não encontrada na planilha.');
  if (idxBets < 0) throw new Error('Coluna "apostas" não encontrada na planilha.');
  if (idxPrizes < 0) throw new Error('Coluna "premios" não encontrada na planilha.');
  if (idxDeposits < 0) throw new Error('Coluna "depositos" não encontrada na planilha.');
  if (idxWithdrawals < 0) throw new Error('Coluna "saques" não encontrada na planilha.');

  const dateKey = headers[idxDate];
  const betsKey = headers[idxBets];
  const prizesKey = headers[idxPrizes];
  const depKey = headers[idxDeposits];
  const wdKey = headers[idxWithdrawals];

  const idxBetCount = findColumnIndex(headers, 'bet_count');
  const idxPrizeCount = findColumnIndex(headers, 'prize_count');
  const idxDepositCount = findColumnIndex(headers, 'deposit_count');
  const idxWithdrawalCount = findColumnIndex(headers, 'withdrawal_count');
  const idxActivePlayers = findColumnIndex(headers, 'active_players');
  const idxBonus = findColumnIndex(headers, 'total_bonus');
  const idxCashback = findColumnIndex(headers, 'total_cashback');

  const result: ParsedGgrLine[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawDate = row[dateKey];
    let date: Date | null = null;
    if (rawDate instanceof Date) date = rawDate;
    else date = parseDate(String(rawDate));
    if (!date) {
      warnings.push(`Linha ${i + 2}: data inválida "${rawDate}", ignorada.`);
      continue;
    }

    result.push({
      date,
      total_bets: parseMoney(row[betsKey]),
      total_prizes: parseMoney(row[prizesKey]),
      total_deposits: parseMoney(row[depKey]),
      total_withdrawals: parseMoney(row[wdKey]),
      total_bonus: idxBonus >= 0 ? parseMoney(row[headers[idxBonus]]) : undefined,
      total_cashback: idxCashback >= 0 ? parseMoney(row[headers[idxCashback]]) : undefined,
      bet_count: idxBetCount >= 0 ? parseInteger(row[headers[idxBetCount]]) : undefined,
      prize_count: idxPrizeCount >= 0 ? parseInteger(row[headers[idxPrizeCount]]) : undefined,
      deposit_count: idxDepositCount >= 0 ? parseInteger(row[headers[idxDepositCount]]) : undefined,
      withdrawal_count: idxWithdrawalCount >= 0 ? parseInteger(row[headers[idxWithdrawalCount]]) : undefined,
      active_players: idxActivePlayers >= 0 ? parseInteger(row[headers[idxActivePlayers]]) : undefined,
    });
  }

  if (result.length === 0) {
    throw new Error('Nenhuma linha de dados válida encontrada na planilha.');
  }

  return { format: 'XLSX', lines: result, warnings };
}

/**
 * Detecta o formato e roteia para o parser correto.
 */
export function parseGgrFile(filename: string, content: Buffer | string): ParsedGgrFile {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    if (typeof content === 'string') {
      throw new Error('Arquivo XLSX deve ser enviado como buffer (binário).');
    }
    return parseGgrXLSX(content);
  }
  // CSV
  const text = typeof content === 'string' ? content : content.toString('utf-8');
  return parseGgrCSV(text);
}

/**
 * Gera um template CSV padrão para download.
 *
 * Espelha o template XLSX (mesmas colunas e mesmo número de linhas) para
 * que o cliente possa escolher o formato sem perder informação. Linhas
 * comentadas no topo com `#` são ignoradas pelo parser e servem de
 * instrução rápida (Excel/Sheets/LibreOffice respeitam o `#` na primeira
 * coluna como dado de texto, então abre normal).
 *
 * @param days quantidade de dias pré-preenchidos (default 31)
 */
export function generateGgrTemplateCSV(opts: { days?: number } = {}): string {
  const days = opts.days ?? 31;
  const today = new Date();

  const lines: string[] = [
    '# MODELO GGR — ContBet',
    '# Preencha os valores em REAIS (ex: 1234,56 ou 1234.56). Não altere os nomes das colunas.',
    '# Colunas obrigatórias: data, apostas, premios, depositos, saques.',
    '# Colunas opcionais: bonus, quantidade_apostas, quantidade_premios, quantidade_depositos, quantidade_saques, jogadores_ativos.',
    '# GGR = apostas - premios (calculado automaticamente).',
    '',
    'data;apostas;premios;depositos;saques;bonus;quantidade_apostas;quantidade_premios;quantidade_depositos;quantidade_saques;jogadores_ativos',
  ];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    lines.push(`${dateStr};0,00;0,00;0,00;0,00;0,00;0;0;0;0;0`);
  }
  return lines.join('\n');
}

/**
 * Gera um modelo .xlsx pronto para envio ao cliente.
 *
 * - Aba "Lançamentos" com cabeçalhos e linhas pré-populadas com a data
 *   (`days` últimos dias contando até hoje, default 31 = um mês comercial).
 * - Aba "Instruções" explicando cada coluna, formatos aceitos e exemplos.
 * - Largura de coluna ajustada e cabeçalho destacado.
 *
 * @param days quantidade de dias pré-preenchidos (default 31)
 * @param brandName opcional — usado no nome do arquivo e cabeçalho da aba
 */
export function generateGgrTemplateXLSX(opts: { days?: number; brandName?: string } = {}): { buffer: Buffer; filename: string } {
  const XLSX = require('xlsx');
  const days = opts.days ?? 31;
  const today = new Date();

  // -------- Aba 1: Lançamentos --------
  const headers = [
    'data',
    'apostas',
    'premios',
    'depositos',
    'saques',
    'bonus',
    'quantidade_apostas',
    'quantidade_premios',
    'quantidade_depositos',
    'quantidade_saques',
    'jogadores_ativos',
  ];

  const rows: any[] = [headers];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
    rows.push([dateStr, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }

  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  // Larguras de coluna
  ws1['!cols'] = [
    { wch: 12 }, // data
    { wch: 14 }, // apostas
    { wch: 14 }, // premios
    { wch: 14 }, // depositos
    { wch: 14 }, // saques
    { wch: 14 }, // bonus
    { wch: 18 }, // qtd apostas
    { wch: 18 }, // qtd premios
    { wch: 20 }, // qtd depositos
    { wch: 18 }, // qtd saques
    { wch: 18 }, // jogadores_ativos
  ];
  // Congela a primeira linha (cabeçalho) para facilitar o scroll
  ws1['!freeze'] = { xSplit: 0, ySplit: 1 };
  // Marca colunas obrigatórias com cor no cabeçalho (negrito via prefixo só não dá; o xlsx free não suporta estilos sem o sheetjs-pro)
  // Logo o destaque vai mesmo só na aba Instruções.

  // -------- Aba 2: Instruções --------
  const instr: any[][] = [
    ['MODELO DE IMPORTAÇÃO GGR — ContBet'],
    [opts.brandName ? `Marca: ${opts.brandName}` : ''],
    [''],
    ['INSTRUÇÕES DE PREENCHIMENTO'],
    [''],
    ['1) Preencha todas as linhas com os valores diários da sua operação.'],
    ['2) Não altere os nomes das colunas — o sistema procura por essas chaves.'],
    ['3) Pode adicionar mais linhas (uma por dia) ou remover dias que não operou.'],
    ['4) Datas: aceita formatos AAAA-MM-DD (preferido) ou DD/MM/AAAA.'],
    ['5) Valores monetários: pode usar 1234,56 ou 1234.56 — sem prefixo R$ é melhor.'],
    ['6) Valores em REAIS (não em centavos). O sistema converte automaticamente.'],
    [''],
    ['COLUNAS — significado e obrigatoriedade'],
    [''],
    ['Coluna', 'Obrigatória', 'Descrição'],
    ['data', 'SIM', 'Data do registro (AAAA-MM-DD ou DD/MM/AAAA)'],
    ['apostas', 'SIM', 'Volume total apostado no dia (R$). Soma das stakes recebidas.'],
    ['premios', 'SIM', 'Total pago em prêmios no dia (R$).'],
    ['depositos', 'SIM', 'Total depositado pelos apostadores (R$).'],
    ['saques', 'SIM', 'Total sacado pelos apostadores (R$).'],
    ['bonus', 'NÃO', 'Bônus, cashback e freebets distribuídos (R$). Despesa de marketing.'],
    ['quantidade_apostas', 'NÃO', 'Número de apostas (count, sem casa decimal).'],
    ['quantidade_premios', 'NÃO', 'Número de prêmios pagos.'],
    ['quantidade_depositos', 'NÃO', 'Número de operações de depósito.'],
    ['quantidade_saques', 'NÃO', 'Número de operações de saque.'],
    ['jogadores_ativos', 'NÃO', 'Jogadores únicos que apostaram no dia.'],
    [''],
    ['CÁLCULO DO GGR'],
    ['GGR = apostas - premios'],
    ['(O sistema calcula automaticamente.)'],
    [''],
    ['DÚVIDAS'],
    ['Em caso de dúvidas, entre em contato com seu contador ou suporte ContBet.'],
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(instr);
  ws2['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 80 }];

  // Junta as abas no workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Lançamentos');
  XLSX.utils.book_append_sheet(wb, ws2, 'Instruções');

  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const safeName = (opts.brandName ?? 'modelo').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
  const stamp = new Date().toISOString().split('T')[0];
  return { buffer, filename: `ggr-${safeName}-${stamp}.xlsx` };
}
