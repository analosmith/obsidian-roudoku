import { GOOGLE_VOICES } from "./google";
import { safeRate } from "./player";
export interface Settings {
  provider: "system" | "google";
  speed: number;
  googleVoice: string;
  googleSecretName: string;
}
export const defaults: Settings = {
  provider: "system",
  speed: 1,
  googleVoice: "ja-JP-Chirp3-HD-Aoede",
  googleSecretName: "roudoku-google",
};
export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") return { ...defaults };
  const record = value as Record<string, unknown>;
  return {
    provider: record.provider === "google" ? "google" : "system",
    speed: safeRate(typeof record.speed === "number" ? record.speed : 1),
    googleVoice:
      typeof record.googleVoice === "string" &&
      (GOOGLE_VOICES as readonly string[]).includes(record.googleVoice)
        ? record.googleVoice
        : defaults.googleVoice,
    googleSecretName:
      typeof record.googleSecretName === "string" &&
      /^[a-z0-9-]{0,100}$/.test(record.googleSecretName)
        ? record.googleSecretName
        : defaults.googleSecretName,
  };
}
export interface SecretReader {
  getSecret(name: string): string | null;
}
export function loadGoogleKey(
  store: SecretReader | undefined,
  name: string,
): {
  state: "available" | "missing" | "unavailable" | "error";
  key: string | null;
} {
  if (!store || typeof store.getSecret !== "function")
    return { state: "unavailable", key: null };
  try {
    const key = name ? store.getSecret(name) : null;
    return { state: key ? "available" : "missing", key };
  } catch {
    return { state: "error", key: null };
  }
}
