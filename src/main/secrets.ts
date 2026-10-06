import { safeStorage } from 'electron'

/** Encrypt a secret payload with the OS keychain-backed safeStorage. Never log the inputs. */
export function encryptSecret(value: unknown): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 시스템에서 안전한 저장소(safeStorage)를 사용할 수 없습니다.')
  }
  return safeStorage.encryptString(JSON.stringify(value))
}

export function decryptSecret<T>(blob: Buffer | null | undefined): T | null {
  if (!blob) return null
  try {
    return JSON.parse(safeStorage.decryptString(blob)) as T
  } catch {
    return null
  }
}
