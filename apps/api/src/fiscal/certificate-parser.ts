import * as forge from 'node-forge';

/**
 * Parser de certificado digital A1 (.pfx / .p12) usando node-forge.
 *
 * Extrai metadados do certificado: CNPJ, razão social, validade, emissor.
 *
 * Para instalar a dependência:
 *   npm install node-forge
 *   npm install -D @types/node-forge
 */

export interface CertificateInfo {
  cnpj: string;
  holder_name: string;
  serial_number: string;
  issuer: string;
  valid_from: Date;
  valid_to: Date;
  is_expired: boolean;
}

/**
 * Extrai dados de um arquivo .pfx (em base64) usando a senha fornecida.
 * Retorna metadados do certificado.
 *
 * @throws Error se a senha estiver incorreta ou o arquivo for inválido
 */
export function parseCertificate(pfxBase64: string, password: string): CertificateInfo {
  try {
    const pfxBuffer = Buffer.from(pfxBase64, 'base64');
    const pfxAsn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, false, password);

    // Pega o primeiro certificado (geralmente o do titular)
    let cert: forge.pki.Certificate | null = null;
    for (const safeContents of pfx.safeContents) {
      for (const safeBag of safeContents.safeBags) {
        if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
          cert = safeBag.cert;
          break;
        }
      }
      if (cert) break;
    }

    if (!cert) {
      throw new Error('Nenhum certificado encontrado no arquivo PFX.');
    }

    // Extrai CNPJ do subjectAltName ou do CN
    const cnpj = extractCnpjFromCert(cert);
    const holder_name = getCommonName(cert.subject);
    const issuer = getCommonName(cert.issuer);

    return {
      cnpj,
      holder_name,
      serial_number: cert.serialNumber,
      issuer,
      valid_from: cert.validity.notBefore,
      valid_to: cert.validity.notAfter,
      is_expired: cert.validity.notAfter < new Date(),
    };
  } catch (err: any) {
    if (err.message && err.message.includes('Invalid password')) {
      throw new Error('Senha do certificado incorreta.');
    }
    if (err.message && err.message.includes('PKCS#12 MAC')) {
      throw new Error('Arquivo PFX inválido ou senha incorreta.');
    }
    throw new Error(`Erro ao processar certificado: ${err.message ?? 'desconhecido'}`);
  }
}

/**
 * Extrai CNPJ do certificado.
 * Pode estar em diferentes lugares dependendo do emissor:
 *   - subjectAltName (otherName)
 *   - CN (após ":")
 *   - OU
 */
function extractCnpjFromCert(cert: forge.pki.Certificate): string {
  // Tenta extrair do CN (formato: "NOME DA EMPRESA:00000000000000")
  const cn = getCommonName(cert.subject);
  const cnMatch = cn.match(/:(\d{14})/);
  if (cnMatch) return cnMatch[1];

  // Tenta extrair do subjectAltName (extensão 2.5.29.17)
  const altNameExt = cert.getExtension('subjectAltName') as any;
  if (altNameExt && altNameExt.altNames) {
    for (const altName of altNameExt.altNames) {
      // Tipo 0 = otherName (onde fica o CNPJ no padrão ICP-Brasil)
      if (altName.type === 0 && altName.value) {
        const valueStr = String(altName.value);
        const cnpjMatch = valueStr.match(/(\d{14})/);
        if (cnpjMatch) return cnpjMatch[1];
      }
    }
  }

  // Tenta extrair de qualquer atributo do subject
  for (const attr of cert.subject.attributes) {
    const value = String(attr.value || '');
    const m = value.match(/(\d{14})/);
    if (m) return m[1];
  }

  throw new Error('Não foi possível extrair o CNPJ do certificado.');
}

function getCommonName(name: forge.pki.Certificate['subject']): string {
  const cnAttr = name.attributes.find(a => a.shortName === 'CN' || a.name === 'commonName');
  return cnAttr ? String(cnAttr.value) : '';
}
