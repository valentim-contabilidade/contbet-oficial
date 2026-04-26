import { TaxRegime, PisCofinsRegime } from '@prisma/client';

/**
 * Defaults canônicos para PIS/COFINS conforme o regime tributário da empresa.
 *
 * - Lucro Real ⇒ PIS/COFINS Não-Cumulativo (1,65% + 7,60%), com créditos sobre despesas elegíveis.
 * - Lucro Presumido ⇒ PIS/COFINS Cumulativo (0,65% + 3,00%), sem créditos.
 * - Simples Nacional ⇒ pagos via DAS unificado; alíquotas separadas não se aplicam.
 *
 * Use ao mudar o regime da empresa (em Company.tax_regime ou em CompanyTaxConfig.tax_regime)
 * para manter as alíquotas em sintonia com a legislação.
 */
export interface PisCofinsDefaults {
  pis_cofins_regime: PisCofinsRegime;
  pis_rate: number;
  cofins_rate: number;
}

export function pisCofinsDefaultsForRegime(regime: TaxRegime): PisCofinsDefaults | null {
  switch (regime) {
    case TaxRegime.LUCRO_REAL:
      return { pis_cofins_regime: PisCofinsRegime.NAO_CUMULATIVO, pis_rate: 1.65, cofins_rate: 7.6 };
    case TaxRegime.LUCRO_PRESUMIDO:
      return { pis_cofins_regime: PisCofinsRegime.CUMULATIVO, pis_rate: 0.65, cofins_rate: 3.0 };
    case TaxRegime.SIMPLES_NACIONAL:
      return null;
    default:
      return null;
  }
}
