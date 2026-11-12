"""Structured logging: one JSON object per line, passed through the redaction rules."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any, cast

from player_backend.log_redaction import redact

# Extra fields a log call may attach (`logger.info("...", extra={"fields": {...}})`). Only these
# keys are written; anything else in `fields` is dropped, so a header or a body cannot slip in.
ALLOWED_FIELDS = frozenset({"method", "path", "status", "duration_ms", "event"})


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        fields: object = getattr(record, "fields", None)
        if isinstance(fields, dict):
            for key, value in cast("dict[object, object]", fields).items():
                if isinstance(key, str) and key in ALLOWED_FIELDS:
                    entry[key] = redact(value) if isinstance(value, str) else value
        if record.exc_info and record.exc_info[0] is not None:
            # The exception type only: a message or a traceback can quote a value.
            entry["exception"] = record.exc_info[0].__name__
        return json.dumps(entry, separators=(",", ":"), default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Uvicorn's access log writes the query string; ours writes the path only.
    logging.getLogger("uvicorn.access").disabled = True
