# The backend image (issue #95). Build context: the repository root.
#   docker build -f docker/backend.Dockerfile .
# It holds code and the locked dependencies only. No secret is ever copied or built in: every
# secret is a file the compose file mounts at run time (docker/compose.backend.yml).
#
# The sources stay in their repository layout because the backend reads the class format's
# schemas from `schema/class-format/` next to `backend/` (class_schemas.py).
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy

RUN pip install --no-cache-dir uv==0.11.32

WORKDIR /srv/classbeat-player
COPY schema/python schema/python
COPY schema/class-format schema/class-format
COPY backend/pyproject.toml backend/uv.lock backend/
COPY backend/src backend/src
COPY backend/db backend/db
RUN cd backend && uv sync --locked --no-dev

COPY docker/backend-entrypoint.sh docker/purge-loop.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backend-entrypoint.sh /usr/local/bin/purge-loop.sh

ENV PATH="/srv/classbeat-player/backend/.venv/bin:${PATH}"
# A fixed id, so the compose file can say who reads what. Not root.
RUN groupadd --gid 10001 player \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin player
USER 10001:10001
WORKDIR /srv/classbeat-player/backend
EXPOSE 8000
ENTRYPOINT ["backend-entrypoint.sh"]
CMD ["app"]
