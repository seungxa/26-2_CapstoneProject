"""Local follow-up question model. FOLLOWUP_MODEL=local|off (any other value is off; the app warns at startup).

local : a small Korean GGUF model run by llama.cpp (llama-cpp-python) on this server's CPU. Nothing is sent out.
        The model is loaded on the first request (or at startup with FOLLOWUP_PRELOAD) and reused. The file comes
        from the Hugging Face cache; only when it is missing is it downloaded, once (FOLLOWUP_ALLOW_DOWNLOAD).
off   : never loads anything. Callers use their template question.

generate() never raises and never takes longer than FOLLOWUP_TIMEOUT_SEC: waiting for a running generation and
generating share that limit. One generation runs at a time. No work is done for a request that has given up:
a generation is not started with less than MIN_GENERATION_SEC left, also when a slow load ends late. A generation
that passes the limit anyway keeps running (llama.cpp cannot be interrupted); its reply is dropped.
While the model is loading (first download, preload, a retry), only the request that started the load waits for
it; the others get "unavailable" at once instead of holding a server thread for the whole limit.
A failed load is tried again only after LOAD_RETRY_SEC, so requests do not retry a download each time but the
model recovers by itself (e.g. the network was not up at boot). A missing library is not retried.

llama_cpp and huggingface_hub are imported only inside the loader: the app and tests run without them
(backend/requirements-followup.txt installs them).
"""
import importlib.util
import logging
import sys
import threading
import time
from dataclasses import dataclass

from .config import settings
from .followup_text import build_messages, validate_followup

log = logging.getLogger(__name__)

# 1536, not 1024: a 1,200-character answer full of numbers measured 1,084-1,169 prompt tokens with EXAONE
# (each digit is a token); see docs/practice-track/followup-model-check.md
N_CTX = 1536
MAX_TOKENS = 96
# The EXAONE 4.0 model card suggests 0.1 for Korean conversation with the 1.2B model (less code switching)
TEMPERATURE = 0.1
# Do not start a generation with less time left than this: it could not finish and would only hold the model
MIN_GENERATION_SEC = 1.0
# After a failed load (download, cache, model file), the next try waits this long (seconds)
LOAD_RETRY_SEC = 600.0
_POLL_SEC = 0.05  # how often a request waiting for the model checks whether a load has started

_NOT_INSTALLED = ("The local follow-up model is not installed. "
                  "Install backend/requirements-followup.txt, then restart the server.")


@dataclass
class FollowupResult:
    text: str | None  # validated Korean follow-up question, None when the caller should use its template
    fallback_reason: str | None  # "off" | "unavailable" | "timeout" | "error" | a validate_followup reason code
    elapsed_ms: int


def _loader(cfg):
    """Open the configured GGUF model with llama.cpp. Tests replace this function: (settings) -> object with
    create_chat_completion(messages, max_tokens, temperature) -> dict.

    The file is looked up in the cache first and downloaded only when missing (and FOLLOWUP_ALLOW_DOWNLOAD is on);
    the cache-only lookup is the per-call form of HF offline mode. Llama.from_pretrained is not used because it
    lists the repository online on every load, so it would contact Hugging Face at each start and fail offline
    even with the file cached.
    """
    from huggingface_hub import hf_hub_download
    from llama_cpp import Llama

    repo, name, cache = cfg.followup_model_repo, cfg.followup_model_file, cfg.followup_model_dir or None
    try:
        path = hf_hub_download(repo_id=repo, filename=name, cache_dir=cache, local_files_only=True)
    except OSError:  # not in the cache yet (LocalEntryNotFoundError)
        if not cfg.followup_allow_download:
            raise FileNotFoundError(f"{repo}/{name} is not in the cache and FOLLOWUP_ALLOW_DOWNLOAD is false") from None
        log.info("follow-up model: downloading %s/%s (first use only)", repo, name)
        path = hf_hub_download(repo_id=repo, filename=name, cache_dir=cache)
    # n_threads_batch too: llama.cpp would otherwise use every core for reading the prompt
    return Llama(model_path=path, n_ctx=N_CTX, n_threads=cfg.followup_threads,
                 n_threads_batch=cfg.followup_threads, verbose=False)


def _describe(e: Exception) -> str:
    """Why the model is unavailable, safe to show on /health (no paths or raw library messages)."""
    if isinstance(e, ImportError):
        return _NOT_INSTALLED
    if isinstance(e, OSError):
        if not settings.followup_allow_download:
            return ("The follow-up model is not in the local cache and downloading is turned off. "
                    "The server checks the cache again in a few minutes.")
        return ("The follow-up model could not be downloaded. Check the network connection; "
                "the server tries again in a few minutes.")
    # An older llama.cpp fails here too: it cannot read a newer architecture (EXAONE 4 was tested with 0.3.36)
    return ("The follow-up model could not be loaded. Check FOLLOWUP_MODEL_REPO and FOLLOWUP_MODEL_FILE, "
            "or upgrade llama-cpp-python; the server tries again in a few minutes.")


class _Unavailable(Exception):
    """The model cannot be used now: it failed to load (and the retry wait is not over), or another thread is
    loading it. The public reason of a failure is in the runner's error."""


class _Runner:
    """The loaded model, its state, and the one-at-a-time slot. Tests start each case with a fresh runner."""

    def __init__(self, installed: bool | None = None):
        self.model = None
        self.state = "idle"  # idle | loading | ready | error
        self.error: str | None = None
        self._failed_at = 0.0  # time.monotonic() of the last failed load
        self._retry = True  # False after ImportError: installing the library needs a restart anyway
        self._installed = installed
        self._load_lock = threading.Lock()
        # Two generations on a laptop CPU slow each other down: run one, let the next wait within its time limit
        self.slot = threading.Semaphore(1)

    def installed(self) -> bool:
        if self._installed is None:
            self._installed = "llama_cpp" in sys.modules or importlib.util.find_spec("llama_cpp") is not None
        return self._installed

    def load(self, wait: bool = True):
        """The model, loaded once even when requests arrive together. Raises _Unavailable after a failed load
        until LOAD_RETRY_SEC has passed. With wait=False (requests) it also raises when another thread is loading,
        instead of waiting for a load that can take minutes."""
        if self.model is not None:
            return self.model
        if not self._load_lock.acquire(blocking=wait):
            raise _Unavailable("loading")
        try:
            if self.model is not None:
                return self.model
            if self.state == "error" and not (self._retry and time.monotonic() - self._failed_at >= LOAD_RETRY_SEC):
                raise _Unavailable(self.error)
            if self.state == "error":
                log.info("follow-up model: trying to load again after a failure")
            self.state = "loading"  # the last error stays visible until this try ends
            started = time.monotonic()
            try:
                model = _loader(settings)
            except Exception as e:
                log.warning("follow-up model: cannot load %s/%s: %r",
                            settings.followup_model_repo, settings.followup_model_file, e)
                self.state, self.error = "error", _describe(e)
                self._failed_at, self._retry = time.monotonic(), not isinstance(e, ImportError)
                raise _Unavailable(self.error) from e
            self.model, self.state, self.error = model, "ready", None
            log.info("follow-up model: loaded %s/%s (%d threads) in %.1fs", settings.followup_model_repo,
                     settings.followup_model_file, settings.followup_threads, time.monotonic() - started)
            return model
        finally:
            self._load_lock.release()


_runner = _Runner()


def _local() -> bool:
    return settings.followup_model == "local"


def _take_slot(runner: _Runner, deadline: float) -> str | None:
    """Wait for the model until the deadline: None once this request holds it, else the fallback reason.
    A load in progress ends the wait at once ("unavailable"): the request that started it is the one that waits."""
    while runner.state != "loading":
        remaining = deadline - time.monotonic()
        if runner.slot.acquire(timeout=max(0.0, min(remaining, _POLL_SEC))):
            return None
        if remaining <= _POLL_SEC:
            return "timeout"
    return "unavailable"


def status() -> dict:
    """For /health. Never loads the model."""
    if not _local():
        return {"mode": "off", "available": False, "model": None, "state": "idle", "error": None}
    r = _runner
    available, error = r.state != "error", r.error
    if r.state == "idle" and not r.installed():
        available, error = False, _NOT_INSTALLED
    return {"mode": "local", "available": available, "state": r.state, "error": error,
            "model": f"{settings.followup_model_repo}/{settings.followup_model_file}"}


def generate(question: str, transcript: str, focus: str) -> FollowupResult:
    """One follow-up question from the local model, or text=None with the reason to use the template instead."""
    started = time.monotonic()

    def result(text: str | None, reason: str | None) -> FollowupResult:
        return FollowupResult(text, reason, int((time.monotonic() - started) * 1000))

    if not _local():
        return result(None, "off")
    runner = _runner  # this request keeps the runner it started with
    limit = settings.followup_timeout_sec
    deadline = started + limit
    waited = _take_slot(runner, deadline)
    if waited == "unavailable":
        log.info("follow-up model: still loading, using the template")
        return result(None, waited)
    if waited == "timeout":
        log.info("follow-up model: still busy after %.0fs, using the template", limit)
        return result(None, waited)
    if deadline - time.monotonic() < MIN_GENERATION_SEC:
        runner.slot.release()
        log.info("follow-up model: too little time left after waiting, using the template")
        return result(None, "timeout")
    out: dict = {}

    def work():  # owns the slot from here and frees it when it ends, even after the limit
        try:
            model = runner.load(wait=False)
            if deadline - time.monotonic() < MIN_GENERATION_SEC:  # the load ended (too) late: nobody waits now
                log.info("follow-up model: loaded after the request's limit, not generating")
                out["result"] = (None, "timeout")
                return
            reply = model.create_chat_completion(messages=build_messages(question, transcript, focus),
                                                 max_tokens=MAX_TOKENS, temperature=TEMPERATURE)
            out["result"] = validate_followup(reply["choices"][0]["message"]["content"], question, transcript)
            if time.monotonic() > deadline:
                log.info("follow-up model: a generation ended %.1fs after its limit; its reply was dropped",
                         time.monotonic() - deadline)
        except _Unavailable:
            out["result"] = (None, "unavailable")
        except Exception as e:
            log.warning("follow-up model: generation failed: %r", e)
            out["result"] = (None, "error")
        finally:
            runner.slot.release()

    worker = threading.Thread(target=work, name="followup-generate", daemon=True)
    try:
        worker.start()
    except RuntimeError as e:  # cannot start a thread: the worker will never free the slot
        runner.slot.release()
        log.warning("follow-up model: cannot start a worker: %r", e)
        return result(None, "error")
    worker.join(timeout=max(0.0, deadline - time.monotonic()))
    if worker.is_alive():
        log.warning("follow-up model: no reply within %.0fs, using the template", limit)
        return result(None, "timeout")
    return result(*out.get("result", (None, "error")))


def preload() -> None:
    """Load the model before the first request (FOLLOWUP_PRELOAD). Failures are logged and shown by status()."""
    if not _local():
        return
    try:
        _runner.load()
    except Exception:
        pass  # load() logged it and status() reports it
