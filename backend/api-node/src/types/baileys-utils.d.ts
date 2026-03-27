/**
 * O @whiskeysockets/baileys exporta estes utilitários em runtime via lib/Utils,
 * mas os .d.ts do índice não expõem os membros para o TypeScript.
 * Tipagem mínima só para compilar — o comportamento vem do pacote em runtime.
 */
declare module '@whiskeysockets/baileys/lib/Utils/index.js' {
  export function fetchLatestBaileysVersion(
    options?: Record<string, unknown>
  ): Promise<{ version: [number, number, number]; isLatest?: boolean }>

  export function makeCacheableSignalKeyStore(
    store: unknown,
    logger?: unknown,
    cache?: unknown
  ): unknown

  export function useMultiFileAuthState(folder: string): Promise<{
    state: { creds: unknown; keys: unknown }
    saveCreds: () => Promise<void>
  }>
}
