/**
 * Tabela de alíquotas de ISS por município brasileiro para serviços de
 * exploração de apostas (LC 116/2003 — itens 12.13 jogos eletrônicos / 17.06).
 *
 * Fonte: lista compilada a partir das leis municipais vigentes em 2026.
 * Cobertura: principais capitais + municípios com hub de apostas.
 *
 * Quando o município não estiver na tabela, retornamos a alíquota máxima
 * legal de 5% (LC 116 art. 8-A) com `confidence: 'fallback'` para que o
 * usuário saiba que precisa confirmar manualmente.
 *
 * IMPORTANTE: o ISS é devido no município de estabelecimento do prestador
 * (regra geral), com exceções na lista do art. 3º da LC 116. Para casas de
 * apostas digitais (item 17.06 / 12.13), aplica-se a regra geral do
 * estabelecimento prestador.
 */

export type IssCityKey = string; // formato "UF|cidade-normalizada"

export interface IssRateSuggestion {
  city: string;
  state: string;
  rate: number;
  service_code: string;
  confidence: 'official' | 'common' | 'fallback';
  note?: string;
}

/**
 * Normaliza nome do município para comparação (lowercase, sem acentos).
 */
export function normalizeCityName(city: string): string {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ISS_RATES_TABLE: Record<IssCityKey, IssRateSuggestion> = {
  // === SP — São Paulo ===
  'SP|sao-paulo':       { city: 'São Paulo',       state: 'SP', rate: 5.0,  service_code: '12.13', confidence: 'official', note: 'Lei 13.701/03 — alíquota máxima' },
  'SP|campinas':        { city: 'Campinas',        state: 'SP', rate: 5.0,  service_code: '12.13', confidence: 'common'   },
  'SP|sao-caetano':     { city: 'São Caetano do Sul', state: 'SP', rate: 2.0, service_code: '12.13', confidence: 'official', note: 'Lei municipal 5.388/16 — ISS reduzido' },
  'SP|barueri':         { city: 'Barueri',         state: 'SP', rate: 2.0,  service_code: '12.13', confidence: 'official', note: 'Programa de incentivo fiscal — ISS reduzido' },
  'SP|santana-de-parnaiba': { city: 'Santana de Parnaíba', state: 'SP', rate: 2.0, service_code: '12.13', confidence: 'official' },

  // === RJ ===
  'RJ|rio-de-janeiro':  { city: 'Rio de Janeiro',  state: 'RJ', rate: 5.0,  service_code: '12.13', confidence: 'official' },
  'RJ|niteroi':         { city: 'Niterói',         state: 'RJ', rate: 5.0,  service_code: '12.13', confidence: 'common'   },

  // === MG ===
  'MG|belo-horizonte':  { city: 'Belo Horizonte',  state: 'MG', rate: 5.0,  service_code: '12.13', confidence: 'official', note: 'Lei 8.725/03' },
  'MG|nova-lima':       { city: 'Nova Lima',       state: 'MG', rate: 2.0,  service_code: '12.13', confidence: 'official', note: 'ISS reduzido para tecnologia' },

  // === PR ===
  'PR|curitiba':        { city: 'Curitiba',        state: 'PR', rate: 5.0,  service_code: '12.13', confidence: 'official' },
  'PR|sao-jose-pinhais': { city: 'São José dos Pinhais', state: 'PR', rate: 5.0, service_code: '12.13', confidence: 'common' },
  'PR|maringa':         { city: 'Maringá',         state: 'PR', rate: 3.0,  service_code: '12.13', confidence: 'common'   },

  // === SC ===
  'SC|florianopolis':   { city: 'Florianópolis',   state: 'SC', rate: 2.5,  service_code: '12.13', confidence: 'official', note: 'Lei municipal — alíquota intermediária' },
  'SC|joinville':       { city: 'Joinville',       state: 'SC', rate: 5.0,  service_code: '12.13', confidence: 'common'   },
  'SC|chapeco':         { city: 'Chapecó',         state: 'SC', rate: 3.0,  service_code: '12.13', confidence: 'common'   },

  // === RS ===
  'RS|porto-alegre':    { city: 'Porto Alegre',    state: 'RS', rate: 5.0,  service_code: '12.13', confidence: 'official' },
  'RS|caxias-do-sul':   { city: 'Caxias do Sul',   state: 'RS', rate: 5.0,  service_code: '12.13', confidence: 'common'   },

  // === DF ===
  'DF|brasilia':        { city: 'Brasília',        state: 'DF', rate: 5.0,  service_code: '12.13', confidence: 'official' },

  // === BA ===
  'BA|salvador':        { city: 'Salvador',        state: 'BA', rate: 5.0,  service_code: '12.13', confidence: 'official' },

  // === PE ===
  'PE|recife':          { city: 'Recife',          state: 'PE', rate: 5.0,  service_code: '12.13', confidence: 'official' },

  // === CE ===
  'CE|fortaleza':       { city: 'Fortaleza',       state: 'CE', rate: 5.0,  service_code: '12.13', confidence: 'official' },

  // === GO ===
  'GO|goiania':         { city: 'Goiânia',         state: 'GO', rate: 5.0,  service_code: '12.13', confidence: 'official' },

  // === ES ===
  'ES|vitoria':         { city: 'Vitória',         state: 'ES', rate: 5.0,  service_code: '12.13', confidence: 'official' },
  'ES|vila-velha':      { city: 'Vila Velha',      state: 'ES', rate: 5.0,  service_code: '12.13', confidence: 'common'   },

  // === MT / MS ===
  'MT|cuiaba':          { city: 'Cuiabá',          state: 'MT', rate: 5.0,  service_code: '12.13', confidence: 'common'   },
  'MS|campo-grande':    { city: 'Campo Grande',    state: 'MS', rate: 5.0,  service_code: '12.13', confidence: 'common'   },
};

/**
 * Retorna a alíquota de ISS sugerida para (cidade, UF). Se não encontrar,
 * retorna fallback com alíquota máxima de 5%.
 */
export function suggestIssRate(city: string, state: string): IssRateSuggestion {
  const key: IssCityKey = `${state.toUpperCase()}|${normalizeCityName(city)}`;
  const found = ISS_RATES_TABLE[key];
  if (found) return found;
  return {
    city, state: state.toUpperCase(), rate: 5.0, service_code: '17.06',
    confidence: 'fallback',
    note: 'Município não cadastrado na base — usando alíquota máxima legal de 5% (LC 116 art. 8-A). Confirme manualmente com a prefeitura.',
  };
}
