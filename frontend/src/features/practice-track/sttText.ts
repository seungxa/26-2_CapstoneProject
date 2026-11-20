import type { SttStatus } from "./types";

/** One line for the interview runner, shown next to the record button only when transcription can't run.
 *  It writes its own sentence instead of the server's reason, which can name internal parts. null while transcription works */
export function transcriptionNotice(stt: SttStatus): string | null {
  if (!stt.available) return "Transcription is off. Recordings are saved without text, so choose Type to write your answer.";
  if (stt.state === "error") return "Transcription isn't working right now. Choose Type to write your answer, or retry later.";
  return null;
}
