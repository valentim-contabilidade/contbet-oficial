# ContBet — Especificação de Integração

> **Documento técnico para operadoras de apostas (Lei 14.790/2023)**
> Versão `1.0` · Última atualização: abril/2026

---

## 1. Visão geral

Este documento descreve a especificação técnica para integração entre a **plataforma da operadora de apostas** e o **ContBet** — sistema de gestão contábil-fiscal.

**Modelo de integração:** o ContBet **consome** os dados da operadora via API REST (modelo *outbound* — a operadora **não** acessa a infraestrutura do ContBet).

```
┌──────────────────┐       1× ao dia       ┌──────────────────┐
│     ContBet      │ ───── GET ────────►   │   Operadora      │
│ (escritório      │                       │   (sua casa de   │
│  contábil)       │ ◄──── JSON ─────────  │    apostas)       │
└──────────────────┘                       └──────────────────┘
```

**Resumo do que pedimos:**

1. Vocês **expõem um endpoint REST** seguro (HTTPS) que retorna os totalizadores diários de movimentação operacional;
2. Vocês **nos fornecem uma chave de leitura** (Bearer Token) para autenticação;
3. O ContBet executa a chamada **automaticamente 1× ao dia** (após o fechamento operacional);
4. Os dados populam o módulo de GGR no ContBet, alimentando apurações tributárias (Lei 14.790, PIS/COFINS, ISS) e a DRE.

---

## 2. Identificação do solicitante

| Campo | Valor |
|---|---|
| **Razão social** | _\[preencher antes de enviar\]_ |
| **CNPJ** | _\[preencher\]_ |
| **Nome do produto** | ContBet — Sistema contábil-fiscal para operadoras de apostas |
| **Contato técnico** | _\[seu nome / e-mail / telefone\]_ |
| **Contato administrativo** | _\[idem\]_ |
| **IPs de origem das chamadas** | A definir conforme deploy (informaremos antes da liberação em produção) |

---

## 3. Endpoint a ser exposto pela operadora

### 3.1. Especificação geral

| Item | Valor |
|---|---|
| **Método** | `GET` |
| **Caminho sugerido** | `/api/v1/contbet/totalizadores-diarios` |
| **Conteúdo** | `application/json` |
| **Encoding** | UTF-8 |
| **Protocolo** | HTTPS obrigatório (TLS 1.2+) |
| **Idempotência** | Mesmo `?date=YYYY-MM-DD` deve retornar o mesmo payload |
| **Autenticação** | `Authorization: Bearer <token>` (token gerado pela operadora) |
| **Rate limit aceitável** | 10 chamadas/minuto (faremos no máximo 3-5/dia por marca) |

### 3.2. Parâmetros de query

| Parâmetro | Obrigatório | Tipo | Descrição |
|---|---|---|---|
| `date` | sim | `YYYY-MM-DD` (ISO 8601) | Data do dia operacional consultado |
| `brand_code` | opcional | string | Código da marca (caso a operadora opere múltiplas) |

**Exemplo de chamada:**

```bash
curl -X GET "https://api.suacasa.com.br/api/v1/contbet/totalizadores-diarios?date=2026-04-27&brand_code=SUACASA" \
  -H "Authorization: Bearer SEU_TOKEN_DE_LEITURA"
```

---

## 4. Schema do payload de resposta

### 4.1. Estrutura JSON esperada

```json
{
  "date": "2026-04-27",
  "brand_code": "SUACASA",
  "currency": "BRL",
  "totalizadores": {
    "total_bets":         350000.00,
    "total_prizes":       315000.00,
    "total_deposits":     120000.00,
    "total_withdrawals":   95000.00,
    "total_bonus":          1750.00,
    "bet_count":           18500,
    "prize_count":         16200,
    "deposit_count":         167,
    "withdrawal_count":      133,
    "active_players":        620
  },
  "metadata": {
    "generated_at": "2026-04-28T03:15:00-03:00",
    "source_system": "PLATFORM_v3.4.1"
  }
}
```

### 4.2. Definição dos campos de totalizadores

> **Formato monetário:** valores em **reais com 2 casas decimais** (`350000.00` = trezentos e cinquenta mil reais).
> **Inteiros:** quantidades absolutas, sem separadores.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `total_bets` | `number` (R$) | ✅ | Soma de todas as apostas (turnover/handle) recebidas no dia |
| `total_prizes` | `number` (R$) | ✅ | Soma de todos os prêmios pagos aos apostadores no dia |
| `total_deposits` | `number` (R$) | ✅ | Soma de todos os depósitos recebidos dos jogadores no dia |
| `total_withdrawals` | `number` (R$) | ✅ | Soma de todos os saques pagos no dia |
| `total_bonus` | `number` (R$) | ⚠️ recomendado | Total de **gamificação** distribuída no dia (cashback, freebet, depósitos bonificados, pontos resgatados em apostas). Não compõe o GGR para Lei 14.790, mas é despesa de marketing dedutível em IRPJ/CSLL |
| `bet_count` | `integer` | ⚠️ recomendado | Quantidade de apostas individuais no dia |
| `prize_count` | `integer` | ⚠️ recomendado | Quantidade de prêmios individuais pagos no dia |
| `deposit_count` | `integer` | ⚠️ recomendado | Quantidade de operações de depósito no dia |
| `withdrawal_count` | `integer` | ⚠️ recomendado | Quantidade de operações de saque no dia |
| `active_players` | `integer` | ⚠️ recomendado | Jogadores únicos com pelo menos 1 ação (aposta, depósito ou saque) no dia |

### 4.3. Campos calculados pelo ContBet (não enviar)

O ContBet calcula automaticamente a partir dos campos acima:

- `ggr` = `total_bets − total_prizes` (Gross Gaming Revenue)
- `payout_ratio` = `total_prizes / total_bets` (% médio de retorno ao jogador)
- `net_revenue` = `ggr − tributos sobre receita`

---

## 5. Códigos de resposta HTTP

| HTTP | Significado | ContBet vai... |
|---|---|---|
| `200 OK` | Sucesso, payload válido | Processar e popular `GgrDailyRecord` |
| `204 No Content` | Sem dados para a data | Registrar zero-record com flag e seguir |
| `401 Unauthorized` | Token inválido/expirado | Notificar contato técnico, parar tentativas |
| `403 Forbidden` | Token sem permissão para esta marca | Mesmo |
| `404 Not Found` | Marca/data não existe | Logar warning, seguir |
| `429 Too Many Requests` | Rate limit estourado | Backoff exponencial (1min → 5min → 15min) |
| `5xx` | Erro do lado da operadora | Retry 3× com 5min de espaço, depois alertar |

### Resposta de erro padrão sugerida

```json
{
  "error": {
    "code": "INVALID_DATE_RANGE",
    "message": "A data informada está fora do período permitido.",
    "details": { "min_date": "2026-01-01", "max_date": "2026-04-28" }
  }
}
```

---

## 6. Frequência e horário das chamadas

| Item | Configuração |
|---|---|
| **Frequência** | 1× ao dia, podendo ser ajustada para 2-3× em casos específicos |
| **Horário** | **04:00 BRT** (após o fechamento operacional típico das 03:00) |
| **Timezone** | A casa pode operar em UTC ou BRT — informe no metadata. ContBet trata internamente |
| **Dias úteis** | Todos os dias (operação 24/7) |
| **Reprocessamento** | Para datas anteriores (correção de dados), o ContBet pode chamar novamente. O endpoint deve aceitar consultas de até 90 dias retroativos |

---

## 7. Segurança e LGPD

### 7.1. Transporte
- **TLS 1.2+** obrigatório
- Certificado válido (Let's Encrypt aceito)
- Rejeitar HTTP puro

### 7.2. Autenticação
- **Bearer Token** com no mínimo 32 bytes de entropia (recomendado: UUID v4 ou base64 de 32 bytes)
- O ContBet **armazena o token criptografado** (AES-256) em repouso
- Token de leitura apenas, **sem permissão para escrita ou alteração**

### 7.3. Rotação
- A operadora pode rotacionar o token a qualquer momento mediante aviso de 7 dias
- Suportamos rolagem com sobreposição (token antigo + novo válidos por até 24h)

### 7.4. LGPD
- Os totalizadores são **dados agregados**, sem identificação de jogadores individuais (não há CPF, nome, ou ID de usuário)
- O ContBet trata os dados sob a base legal de **execução de obrigação contratual** (art. 7º, V da LGPD), exclusivamente para fins de apuração contábil-fiscal
- Retenção: 10 anos (mínimo legal — Lei 14.790 art. 12)
- Acesso: somente equipe técnica do ContBet com auditoria de logs (NestJS `AuditLog`)

### 7.5. Dados sensíveis
- ❌ **Não enviar:** CPF, nome, endereço, IP, dados de cartão, qualquer informação individualizada de jogador
- ✅ **Enviar apenas:** os totalizadores listados na Seção 4.2

---

## 8. Ambientes e cronograma

### 8.1. Sequência sugerida

| Etapa | Quem faz | Duração | Resultado |
|---|---|---|---|
| **1. Análise técnica** | Operadora | 3-7 dias | Aprovação interna do escopo |
| **2. Implementação do endpoint** | Operadora | 5-15 dias | Endpoint disponível em sandbox |
| **3. Geração do token de leitura** | Operadora | 1 dia | Token + URL enviados ao ContBet |
| **4. Configuração no ContBet** | ContBet | 1 dia | Cadastro do `DataSource` |
| **5. Testes em sandbox** | Ambos | 3-5 dias | Conferência de payload, retry, edge cases |
| **6. Go-live em produção** | Ambos | 1 dia | Cron diário ativo |

### 8.2. Ambientes do ContBet

| Ambiente | Disponibilidade | Uso |
|---|---|---|
| **Sandbox** | _\[a definir conforme deploy\]_ | Testes técnicos |
| **Produção** | _\[a definir\]_ | Operação |

> **Nota:** o ContBet pode iniciar a integração técnica antes mesmo do deploy em produção, usando ambiente de homologação com URL pública temporária. Detalhes serão alinhados na etapa de implementação.

---

## 9. Exemplo de payload completo (response real)

```json
{
  "date": "2026-04-27",
  "brand_code": "BETREAL",
  "currency": "BRL",
  "totalizadores": {
    "total_bets": 11666666.67,
    "total_prizes": 10500000.00,
    "total_deposits": 4000000.00,
    "total_withdrawals": 3166666.67,
    "total_bonus": 58333.33,
    "bet_count": 5000,
    "prize_count": 2000,
    "deposit_count": 167,
    "withdrawal_count": 133,
    "active_players": 600
  },
  "metadata": {
    "generated_at": "2026-04-28T03:15:00-03:00",
    "source_system": "PLATFORM_v3.4.1",
    "data_completeness": "FULL"
  }
}
```

Cálculos derivados que o ContBet faz a partir desse payload:

| Indicador | Cálculo | Resultado |
|---|---|---|
| **GGR** (Lei 14.790) | `total_bets − total_prizes` | R$ 1.166.666,67 |
| **Payout** | `total_prizes / total_bets` | 90,0% |
| **Net Revenue** | `ggr − (12% Lei 14.790) − PIS/COFINS − ISS` | (auto) |
| **CAC indireto** | `total_bonus` (não impacta GGR) | R$ 58.333,33 |

---

## 10. Suporte e contato

Para dúvidas técnicas durante a implementação:

- **E-mail técnico:** _\[seu e-mail\]_
- **Slack/Teams:** _\[a definir\]_
- **Documentação OpenAPI/Swagger:** _\[link\]_ (será enviado após deploy de homologação)

Para questões contratuais e LGPD:

- **E-mail jurídico:** _\[seu e-mail\]_
- **DPO ContBet:** _\[se aplicável\]_

---

## 11. Checklist de implementação (uso interno da operadora)

- [ ] Endpoint criado em sandbox conforme Seção 3
- [ ] Schema do JSON conforme Seção 4
- [ ] HTTPS com certificado válido
- [ ] Bearer Token gerado (32+ bytes de entropia)
- [ ] Rate limit configurado (10 req/min é suficiente)
- [ ] Logs de acesso à API por token (auditoria)
- [ ] Rotina de geração diária dos totalizadores às ~03:00
- [ ] Período retroativo de 90 dias coberto
- [ ] Validações: rejeitar `date` futura, aceitar `date` ≤ hoje
- [ ] Comportamento testado: 200 com dados, 204 sem dados, 401 token inválido, 404 marca inexistente
- [ ] Token enviado ao ContBet por canal seguro (não por e-mail simples)
- [ ] URL do endpoint informada
- [ ] IPs do ContBet whitelistados (opcional — informaremos antes do go-live)

---

> **Documento mantido por:** ContBet — equipe de integrações
> **Versão atual:** 1.0
> **Próxima revisão prevista:** após primeira integração concluída
