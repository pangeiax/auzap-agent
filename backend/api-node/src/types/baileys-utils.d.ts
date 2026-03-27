/**
 * O @whiskeysockets/baileys exporta estes utilitários em runtime via lib/Utils,
 * mas os .d.ts do índice não expõem os membros para o TypeScript.
 * Tipagem mínima só para compilar — o comportamento vem do pacote em runtime.
 */
declare module '@whiskeysockets/baileys/lib/Utils/index.js' {
  export function fetchLatestBaileysVersion(
    options?: Record<string, unknown>
  ): Promise<{ version: [number, number, number]; isLatest?: boolean }>

  // `any`: o Baileys usa tipos internos (AuthenticationCreds, SignalKeyStore) que o subpath não exporta bem;
  // unknown quebraria o assign em makeWASocket({ auth: { creds, keys } }).
  export function makeCacheableSignalKeyStore(
    store: any,
    logger?: any,
    cache?: any
  ): any

  export function useMultiFileAuthState(folder: string): Promise<{
    state: { creds: any; keys: any }
    saveCreds: () => Promise<void>
  }>
}
