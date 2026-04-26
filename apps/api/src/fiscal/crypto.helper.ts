import * as crypto from 'crypto';

/**
 * Helper para criptografia/descriptografia AES-256-GCM.
 *
 * Usado para proteger certificados digitais A1 (.pfx) e suas senhas
 * armazenados no banco de dados.
 *
 * IMPORTANTE: a chave de criptografia (FISCAL_ENCRYPTION_KEY) deve estar
 * no .env e ser PROTEGIDA. Se ela vazar, todos os certificados podem ser
 * descriptografados. Em produção, considere usar AWS KMS, HashiCorp Vault,
 * ou similar para gerenciamento de chaves.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits para GCM
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const envKey = process.env.FISCAL_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error(
      'FISCAL_ENCRYPTION_KEY não está definida no .env. ' +
      'Gere uma com: openssl rand -hex 32'
    );
  }
  // Aceita hex (64 chars) ou base64 (44 chars) ou qualquer string >= 32 bytes
  if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }
  // Deriva chave de 32 bytes via SHA-256 a partir da string
  return crypto.createHash('sha256').update(envKey).digest();
}

/**
 * Criptografa string e retorna como base64 (IV + tag + ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Concatena: IV (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Descriptografa string base64 (IV + tag + ciphertext)
 */
export function decrypt(encryptedBase64: string): string {
  const key = getKey();
  const data = Buffer.from(encryptedBase64, 'base64');
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Dado criptografado inválido (tamanho insuficiente).');
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Criptografa um buffer binário (para PFX) e retorna como base64
 */
export function encryptBinary(data: Buffer): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Descriptografa base64 e retorna buffer binário
 */
export function decryptBinary(encryptedBase64: string): Buffer {
  const key = getKey();
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
