"""Exercise the real upload/retry/STT adapter with a fake local provider (conftest fake_stt).

These tests validate our integration, not a speech model's recognition accuracy.
"""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from app import stt


def session_answer(client, keep_audio=False):
    headers = {"X-User-Id": f"speech-{uuid.uuid4()}"}
    # 녹음 업로드·전사 다시 시도에는 녹음 동의가 필요하다. keep_audio=False면 전사에 성공한 원본은 바로 지운다
    consent = client.put("/practice/settings", headers=headers, json={"consent": True, "keep_audio": keep_audio})
    assert consent.status_code == 200, consent.text
    session = client.post("/practice/sessions", headers=headers, json={"mode": "free", "count": 1}).json()
    return headers, session["answers"][0]["id"]


def test_korean_transcript_goes_through_the_multipart_upload(client, fake_stt):
    text = "안녕하세요. 백엔드 개발자로 지원했습니다."
    fake_stt.reply = f"  {text}  "
    h, aid = session_answer(client)
    r = client.post(f"/practice/answers/{aid}/audio", headers=h,
                    files={"file": ("answer.webm", b"simulated-audio", "audio/webm;codecs=opus")})
    assert r.status_code == 200, r.text
    assert r.json()["stt_status"] == "done" and r.json()["transcript"] == text
    audio, name, content_type = fake_stt.calls[0]
    assert name.endswith(".webm") and audio == b"simulated-audio" and content_type == "audio/webm"


@pytest.mark.parametrize("reply", [
    "", "   ",
    stt.STTError("no_speech", "말소리를 인식하지 못했어요"),
    stt.STTError("invalid_audio", "녹음 파일을 읽지 못했어요"),
    stt.STTError("provider_error", "음성 인식 중 오류가 났어요. 다시 시도해 주세요"),
])
def test_empty_or_invalid_transcription_keeps_audio_and_offers_retry(client, fake_stt, reply):
    fake_stt.reply = reply
    h, aid = session_answer(client)
    r = client.post(f"/practice/answers/{aid}/audio", headers=h,
                    files={"file": ("answer.webm", b"simulated-audio", "audio/webm")})
    assert r.status_code == 200, r.text
    assert r.json()["stt_status"] == "failed"
    assert r.json()["transcript"] is None
    assert client.get(f"/practice/answers/{aid}/audio", headers=h).content == b"simulated-audio"


def test_mp4_retry_preserves_format_and_recognizes_the_stored_recording(client, fake_stt):
    fake_stt.reply = stt.STTError("busy", "다른 녹음을 전사하느라 바빠요. 잠시 뒤 다시 시도해 주세요")
    h, aid = session_answer(client, keep_audio=True)  # 다시 전사한 뒤에도 저장된 원본 형식을 확인하려고 보관
    first = client.post(f"/practice/answers/{aid}/audio", headers=h,
                        files={"file": ("answer.m4a", b"simulated-mp4", "audio/mp4")})
    assert first.json()["stt_status"] == "failed"
    fake_stt.reply = "저는 캐시를 직접 설계했습니다."
    retried = client.post(f"/practice/answers/{aid}/transcribe", headers=h)
    assert retried.status_code == 200 and retried.json()["stt_status"] == "done"
    assert retried.json()["transcript"] == "저는 캐시를 직접 설계했습니다."
    assert retried.json()["audio_path"] == first.json()["audio_path"]
    assert fake_stt.calls[-1][0] == b"simulated-mp4" and fake_stt.calls[-1][2] == "audio/mp4"
    assert client.get(f"/practice/answers/{aid}/audio", headers=h).headers["content-type"] == "audio/mp4"


def test_failed_retry_keeps_the_users_corrected_transcript(client, fake_stt):
    fake_stt.reply = "첫 인식 결과"
    h, aid = session_answer(client, keep_audio=True)  # 첫 전사가 성공해도 다시 시도할 원본을 남기려고 보관
    client.post(f"/practice/answers/{aid}/audio", headers=h,
                files={"file": ("answer.webm", b"simulated-audio", "audio/webm")})
    client.patch(f"/practice/answers/{aid}", headers=h, json={"transcript": "사용자가 고친 정확한 답변"})
    fake_stt.reply = ""
    retry = client.post(f"/practice/answers/{aid}/transcribe", headers=h)
    assert retry.status_code == 200 and retry.json()["stt_status"] == "failed"
    assert retry.json()["transcript"] == "사용자가 고친 정확한 답변"


def test_unsupported_recording_type_is_rejected_before_saving(client, fake_stt):
    h, aid = session_answer(client)
    r = client.post(f"/practice/answers/{aid}/audio", headers=h,
                    files={"file": ("answer.txt", b"not-audio", "text/plain")})
    assert r.status_code == 415
    assert client.get(f"/practice/answers/{aid}/audio", headers=h).status_code == 404
    assert fake_stt.calls == []


def test_slow_transcription_does_not_block_unrelated_api_requests(client, fake_stt, monkeypatch):
    entered, resume = Event(), Event()
    fake_stt.reply = "인식 결과"
    transcribe = fake_stt.transcribe

    def slow(audio, filename, content_type):
        entered.set()
        assert resume.wait(5)
        return transcribe(audio, filename, content_type)

    monkeypatch.setattr(fake_stt, "transcribe", slow)
    h, aid = session_answer(client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        upload = pool.submit(client.post, f"/practice/answers/{aid}/audio", headers=h,
                             files={"file": ("answer.webm", b"simulated-audio", "audio/webm")})
        assert entered.wait(5)
        try:
            health = pool.submit(client.get, "/health")
            assert health.result(timeout=1).status_code == 200
        finally:
            resume.set()
        assert upload.result(timeout=5).json()["transcript"] == "인식 결과"
