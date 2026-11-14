import { expect, test } from "@playwright/test";
import { transcriptionNotice } from "../../../src/features/practice-track/sttText";
import type { SttStatus } from "../../../src/features/practice-track/types";

const stt = (over: Partial<SttStatus>): SttStatus => ({ provider: "local", available: true, model: "base", state: "ready", error: null, ...over });

test("no notice while transcription works or the model has not loaded yet", () => {
  for (const state of ["ready", "not_loaded", "loading", null] as const) expect(transcriptionNotice(stt({ state }))).toBeNull();
});

test("transcription off or unavailable suggests typing the answer", () => {
  for (const s of [stt({ provider: "off", available: false, model: null, state: null }), stt({ available: false, state: null })]) {
    const notice = transcriptionNotice(s);
    expect(notice).toMatch(/^Transcription is off\./);
    expect(notice).toContain("Type");
  }
});

test("a failing transcription model gets its own sentence without the server's reason", () => {
  const notice = transcriptionNotice(stt({ state: "error", error: "Install faster-whisper on the backend." }));
  expect(notice).toMatch(/^Transcription isn't working right now\./);
  expect(notice).toContain("Type");
  expect(notice).not.toMatch(/whisper|backend|model/i);
});

test("notices are plain English sentences", () => {
  for (const s of [stt({ provider: "off", available: false }), stt({ state: "error", error: "x" })]) {
    expect(transcriptionNotice(s)).not.toMatch(/[가-힣]/);
  }
});
