import io
import logging
import sys
import threading
import time


DEFAULT_MAX_BUFFER = 5000
_MAX_TAIL_RESPONSE = 5000


class _LogCaptureState:
    def __init__(self):
        self.lock = threading.RLock()
        self.started = False
        self.next_id = 1
        self.entries = []
        self.max_buffer = DEFAULT_MAX_BUFFER
        self.infinite = False
        self.logging_handler = None
        self.stdout_wrapper = None
        self.stderr_wrapper = None

    def add_entry(self, text, source="log"):
        message = str(text or "")
        if not message:
            return None
        with self.lock:
            entry = {
                "id": self.next_id,
                "ts": time.time(),
                "source": str(source or "log"),
                "text": message,
            }
            self.next_id += 1
            self.entries.append(entry)
            self._trim_locked()
            return entry["id"]

    def _trim_locked(self):
        if self.infinite:
            return
        limit = self.max_buffer if isinstance(self.max_buffer, int) else DEFAULT_MAX_BUFFER
        limit = max(1, limit)
        extra = len(self.entries) - limit
        if extra > 0:
            del self.entries[:extra]

    def clear(self):
        with self.lock:
            self.entries.clear()

    def get_config(self):
        with self.lock:
            return {
                "max_buffer": None if self.infinite else self.max_buffer,
                "infinite": bool(self.infinite),
            }

    def set_config(self, *, max_buffer=None, infinite=None):
        with self.lock:
            if infinite is not None:
                self.infinite = bool(infinite)
            if max_buffer is not None:
                self.max_buffer = max(1, int(max_buffer))
            self._trim_locked()
            return self.get_config()

    def get_logs(self, after_id=None, limit=None):
        with self.lock:
            entries = self.entries
            total = len(entries)
            earliest_id = entries[0]["id"] if entries else None
            latest_id = entries[-1]["id"] if entries else 0
            reset = False

            if isinstance(after_id, int) and after_id > 0:
                if earliest_id is not None and after_id < earliest_id - 1:
                    reset = True
                    items = list(entries)
                else:
                    items = [entry for entry in entries if entry["id"] > after_id]
            else:
                items = list(entries)

            if (reset or not (isinstance(after_id, int) and after_id > 0)) and isinstance(limit, int) and limit > 0:
                items = items[-min(limit, _MAX_TAIL_RESPONSE):]

            return {
                "items": items,
                "reset": reset,
                "earliest_id": earliest_id,
                "latest_id": latest_id,
                "total": total,
            }

    def get_recent_entries(self, limit):
        safe_limit = max(1, int(limit))
        with self.lock:
            return list(self.entries[-safe_limit:])


_STATE = _LogCaptureState()


class _TeeCaptureStream(io.TextIOBase):
    def __init__(self, original, source):
        self._original = original
        self._source = source
        self._buffer = ""
        self._lock = threading.RLock()

    def write(self, data):
        if data is None:
            return 0
        text = data if isinstance(data, str) else str(data)
        written = self._original.write(text)
        self._capture(text)
        return len(text) if written is None else written

    def flush(self):
        try:
            self._original.flush()
        except Exception:
            pass

    def writable(self):
        return True

    def isatty(self):
        try:
            return self._original.isatty()
        except Exception:
            return False

    @property
    def encoding(self):
        return getattr(self._original, "encoding", None)

    @property
    def errors(self):
        return getattr(self._original, "errors", None)

    def fileno(self):
        return self._original.fileno()

    def _capture(self, text):
        if not text:
            return
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        with self._lock:
            self._buffer += normalized
            while "\n" in self._buffer:
                line, self._buffer = self._buffer.split("\n", 1)
                if line:
                    _STATE.add_entry(line, self._source)

    def __getattr__(self, name):
        return getattr(self._original, name)


class _BufferLoggingHandler(logging.Handler):
    def emit(self, record):
        try:
            message = self.format(record)
        except Exception:
            try:
                message = record.getMessage()
            except Exception:
                message = "<logging emit error>"
        if message:
            _STATE.add_entry(message, "logging")


def ensure_log_capture_started():
    with _STATE.lock:
        if _STATE.started:
            return

        if not isinstance(sys.stdout, _TeeCaptureStream):
            _STATE.stdout_wrapper = _TeeCaptureStream(sys.stdout, "stdout")
            sys.stdout = _STATE.stdout_wrapper
        else:
            _STATE.stdout_wrapper = sys.stdout

        if not isinstance(sys.stderr, _TeeCaptureStream):
            _STATE.stderr_wrapper = _TeeCaptureStream(sys.stderr, "stderr")
            sys.stderr = _STATE.stderr_wrapper
        else:
            _STATE.stderr_wrapper = sys.stderr

        root_logger = logging.getLogger()
        handler = _BufferLoggingHandler()
        handler.setLevel(logging.NOTSET)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        handler._cozygen_log_capture = True

        already_present = any(getattr(existing, "_cozygen_log_capture", False) for existing in root_logger.handlers)
        if not already_present:
            root_logger.addHandler(handler)
            _STATE.logging_handler = handler

        _STATE.started = True
        _STATE.add_entry("CozyGen log capture started", "cozygen")


def append_log_line(text, source="cozygen"):
    ensure_log_capture_started()
    return _STATE.add_entry(text, source)


def clear_log_buffer():
    ensure_log_capture_started()
    _STATE.clear()


def get_log_buffer_config():
    ensure_log_capture_started()
    return _STATE.get_config()


def set_log_buffer_config(*, max_buffer=None, infinite=None):
    ensure_log_capture_started()
    return _STATE.set_config(max_buffer=max_buffer, infinite=infinite)


def get_log_entries(*, after_id=None, limit=None):
    ensure_log_capture_started()
    safe_after = None
    if after_id is not None:
        safe_after = int(after_id)
    safe_limit = None
    if limit is not None:
        safe_limit = max(1, int(limit))
    payload = _STATE.get_logs(after_id=safe_after, limit=safe_limit)
    payload["config"] = _STATE.get_config()
    return payload


def format_log_entries(entries):
    lines = []
    for entry in entries or []:
        ts = time.strftime("%H:%M:%S", time.localtime(entry.get("ts", 0)))
        source = entry.get("source", "log")
        text = entry.get("text", "")
        lines.append(f"[{ts}] [{source}] {text}")
    return "\n".join(lines)


def capture_log_snapshot_text(max_lines):
    ensure_log_capture_started()
    safe_limit = max(1, int(max_lines))
    append_log_line(f"CozyGen log capture snapshot requested (max={safe_limit})", "cozygen")
    entries = _STATE.get_recent_entries(safe_limit)
    return format_log_entries(entries)

