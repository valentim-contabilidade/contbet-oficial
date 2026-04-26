/**
 * Parser de extratos bancários: OFX e CSV.
 *
 * OFX (Open Financial Exchange) é o padrão dos bancos brasileiros para
 * exportação de extratos. É um formato XML-like com tags simples.
 *
 * CSV é o fallback genérico (pode ter qualquer estrutura, fazemos detecção).
 */

export interface ParsedStatementLine {
  date: Date;
  amount: bigint; // sempre positivo, em centavos
  type: 'CREDIT' | 'DEBIT';
  description: string;
  fit_id?: string;
  reference?: string;
}

export interface ParsedStatement {
  start_date: Date;
  end_date: Date;
  initial_balance?: bigint;
  final_balance?: bigint;
  lines: ParsedStatementLine[];
}

// =================== OFX PARSER ===================

function extractTag(content: string, tag: string): string | null {
  // OFX usa tanto <TAG>valor quanto <TAG>valor</TAG>
  const re = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function extractAllBlocks(content: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
  const result: string[] = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    result.push(m[1]);
  }
  return result;
}

function parseOFXDate(raw: string): Date {
  // Formatos comuns: 20260115, 20260115120000, 20260115120000[-3:BRT]
  const cleaned = raw.replace(/\[.*?\]/, '').trim();
  if (cleaned.length >= 8) {
    const y = parseInt(cleaned.substring(0, 4), 10);
    const m = parseInt(cleaned.substring(4, 6), 10) - 1;
    const d = parseInt(cleaned.substring(6, 8), 10);
    if (cleaned.length >= 14) {
      const hh = parseInt(cleaned.substring(8, 10), 10);
      const mm = parseInt(cleaned.substring(10, 12), 10);
      const ss = parseInt(cleaned.substring(12, 14), 10);
      return new Date(Date.UTC(y, m, d, hh, mm, ss));
    }
    return new Date(Date.UTC(y, m, d));
  }
  return new Date(cleaned);
}

function parseOFXAmount(raw: string): { amount: bigint; type: 'CREDIT' | 'DEBIT' } {
  const num = parseFloat(raw.replace(',', '.'));
  const type = num >= 0 ? 'CREDIT' : 'DEBIT';
  const amount = BigInt(Math.round(Math.abs(num) * 100));
  return { amount, type };
}

export function parseOFX(content: string): ParsedStatement {
  // Remove cabeçalho HTTP-like se houver
  const ofxStart = content.indexOf('<OFX>');
  const body = ofxStart >= 0 ? content.substring(ofxStart) : content;

  // Datas do período
  const dtstart = extractTag(body, 'DTSTART');
  const dtend = extractTag(body, 'DTEND');
  const start_date = dtstart ? parseOFXDate(dtstart) : new Date();
  const end_date = dtend ? parseOFXDate(dtend) : new Date();

  // Saldos
  const ledgerBlock = extractAllBlocks(body, 'LEDGERBAL')[0];
  const initialBlock = extractAllBlocks(body, 'AVAILBAL')[0];
  let final_balance: bigint | undefined;
  let initial_balance: bigint | undefined;
  if (ledgerBlock) {
    const balAmt = extractTag(ledgerBlock, 'BALAMT');
    if (balAmt) final_balance = parseOFXAmount(balAmt).amount;
  }
  if (initialBlock) {
    const balAmt = extractTag(initialBlock, 'BALAMT');
    if (balAmt) initial_balance = parseOFXAmount(balAmt).amount;
  }

  // Transações
  const stmtTrns = extractAllBlocks(body, 'STMTTRN');
  const lines: ParsedStatementLine[] = [];
  for (const trn of stmtTrns) {
    const dtposted = extractTag(trn, 'DTPOSTED');
    const trnamt = extractTag(trn, 'TRNAMT');
    const memo = extractTag(trn, 'MEMO') || extractTag(trn, 'NAME') || 'Sem descrição';
    const fitid = extractTag(trn, 'FITID');
    const checknum = extractTag(trn, 'CHECKNUM');

    if (!dtposted || !trnamt) continue;
    const { amount, type } = parseOFXAmount(trnamt);
    lines.push({
      date: parseOFXDate(dtposted),
      amount,
      type,
      description: memo,
      fit_id: fitid || undefined,
      reference: checknum || undefined,
    });
  }

  return { start_date, end_date, initial_balance, final_balance, lines };
}

// =================== CSV PARSER ===================

function detectDelimiter(line: string): string {
  if (line.includes(';')) return ';';
  if (line.includes('\t')) return '\t';
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

function parseCSVDate(raw: string): Date | null {
  // DD/MM/YYYY ou YYYY-MM-DD
  const cleaned = raw.trim();
  let m = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])));
  m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
  m = cleaned.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])));
  return null;
}

function parseCSVAmount(raw: string): { amount: bigint; type: 'CREDIT' | 'DEBIT' } | null {
  const cleaned = raw.replace(/[R$\s.]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  const type = num >= 0 ? 'CREDIT' : 'DEBIT';
  const amount = BigInt(Math.round(Math.abs(num) * 100));
  return { amount, type };
}

export function parseCSV(content: string): ParsedStatement {
  const allLines = content.split(/\r?\n/).filter(l => l.trim());
  if (allLines.length === 0) {
    return { start_date: new Date(), end_date: new Date(), lines: [] };
  }

  const delimiter = detectDelimiter(allLines[0]);
  const headerLine = allLines[0];
  const headerCols = parseCSVLine(headerLine, delimiter).map(h => h.toLowerCase());

  // Detecta colunas
  const dateIdx = headerCols.findIndex(h => h.match(/data|date/));
  const descIdx = headerCols.findIndex(h => h.match(/descri|hist|memo|description/));
  const amountIdx = headerCols.findIndex(h => h.match(/valor|amount|montante/));
  const docIdx = headerCols.findIndex(h => h.match(/documento|doc|nsu|tid/));

  if (dateIdx < 0 || amountIdx < 0) {
    throw new Error('CSV não tem cabeçalhos reconhecíveis (precisa de "data" e "valor"). Tente OFX para mais robustez.');
  }

  const lines: ParsedStatementLine[] = [];
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (let i = 1; i < allLines.length; i++) {
    const cols = parseCSVLine(allLines[i], delimiter);
    if (cols.length < 2) continue;

    const date = parseCSVDate(cols[dateIdx] || '');
    const amountResult = parseCSVAmount(cols[amountIdx] || '');
    if (!date || !amountResult) continue;

    const desc = (descIdx >= 0 ? cols[descIdx] : '') || 'Sem descrição';
    const ref = docIdx >= 0 ? cols[docIdx] : undefined;

    lines.push({
      date,
      amount: amountResult.amount,
      type: amountResult.type,
      description: desc,
      reference: ref,
    });

    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  }

  return {
    start_date: minDate || new Date(),
    end_date: maxDate || new Date(),
    lines,
  };
}

export function parseStatement(filename: string, content: string): { format: string; parsed: ParsedStatement } {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.ofx') || content.includes('<OFX>')) {
    return { format: 'OFX', parsed: parseOFX(content) };
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return { format: 'CSV', parsed: parseCSV(content) };
  }
  // tenta auto-detectar
  if (content.includes('<OFX>') || content.includes('<STMTTRN>')) {
    return { format: 'OFX', parsed: parseOFX(content) };
  }
  return { format: 'CSV', parsed: parseCSV(content) };
}
