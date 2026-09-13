import { NarrationError, type Clip } from "./cloud-player";
export interface HttpResponse {
  status: number;
  json: unknown;
}
export type Transport = (body: object, key: string) => Promise<HttpResponse>;
export const GOOGLE_VOICES = [
  "ja-JP-Chirp3-HD-Achernar",
  "ja-JP-Chirp3-HD-Aoede",
  "ja-JP-Chirp3-HD-Puck",
  "ja-JP-Chirp3-HD-Charon",
] as const;
export async function synthesizeGoogle(
  ssml: string,
  key: string,
  voice: string,
  request: Transport,
): Promise<Blob> {
  if (new TextEncoder().encode(ssml).length > 5000)
    throw new NarrationError("文章が音声APIの入力上限を超えています。");
  if (!(GOOGLE_VOICES as readonly string[]).includes(voice))
    throw new NarrationError("音声の設定を確認してください。");
  let response: HttpResponse;
  try {
    response = await request(
      {
        input: { ssml },
        voice: { languageCode: "ja-JP", name: voice },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1 },
      },
      key,
    );
  } catch {
    throw new NarrationError(
      "接続に失敗しました。ネットワークを確認してください。",
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new NarrationError("APIキー、権限、課金設定を確認してください。");
  if (response.status === 429)
    throw new NarrationError(
      "APIの利用上限に達しました。時間を置いて再試行してください。",
    );
  if (response.status !== 200)
    throw new NarrationError(
      googleFailure(response.status, response.json),
      response.status === 400 && isSentenceTooLong(response.json)
        ? "sentence-too-long"
        : undefined,
    );
  const json = response.json;
  if (
    !json ||
    typeof json !== "object" ||
    !("audioContent" in json) ||
    typeof json.audioContent !== "string" ||
    !json.audioContent
  )
    throw new NarrationError("音声が返りませんでした。");
  try {
    const bytes = Uint8Array.from(atob(json.audioContent), (c) =>
      c.charCodeAt(0),
    );
    return new Blob([bytes], { type: "audio/mpeg" });
  } catch {
    throw new NarrationError("音声データを読み取れませんでした。");
  }
}
export function audioClip(blob: Blob): Clip {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let disposed = false;
  return {
    play: () => audio.play(),
    pause: () => audio.pause(),
    setRate: (rate) => {
      audio.playbackRate = rate;
      audio.preservesPitch = true;
    },
    stop: () => {
      if (disposed) return;
      disposed = true;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    },
    onEnd: (fn) => {
      audio.onended = fn;
    },
    onError: (fn) => {
      audio.onerror = () => fn();
    },
  };
}

/** Classify upstream errors into fixed messages; never return raw API text. */
export function googleFailure(status: number, json: unknown): string {
  let message = "";
  if (json && typeof json === "object" && "error" in json) {
    const error = json.error;
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    )
      message = error.message;
  }
  let reason = "Googleの拒否理由を詳細分類できませんでした。";
  if (/sentenc[es]*.*too long|too long.*sentenc/i.test(message))
    reason = "1文が長すぎるため拒否されました。";
  else if (/api.?key/i.test(message))
    reason = "APIキーの指定が受け付けられませんでした。";
  else if (/ssml/i.test(message))
    reason = "SSMLの形式または音声との組み合わせが拒否されました。";
  else if (/voice.*not.*(found|exist)|invalid.*voice/i.test(message))
    reason = "音声の指定が受け付けられませんでした。";
  else if (/speaking.?rate|pitch|audio.?config/i.test(message))
    reason = "合成速度または音声出力の指定が拒否されました。";
  else if (/input.*(long|limit|size)|bytes|characters.*limit/i.test(message))
    reason = "文章の長さが音声APIの上限を超えています。";
  return reason + "（HTTP " + status + "）";
}

/** Inspect only the expected upstream message; never expose it to the UI. */
export function isSentenceTooLong(json: unknown): boolean {
  if (!json || typeof json !== "object" || !("error" in json)) return false;
  const error = json.error;
  return (
    !!error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    /sentenc[es]*.*too long|too long.*sentenc/i.test(error.message)
  );
}
