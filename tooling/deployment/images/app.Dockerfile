FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS workspace
WORKDIR /app
RUN npm install --global pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY contracts/package.json contracts/package.json
COPY intake-server/package.json intake-server/package.json
COPY media-decoder/package.json media-decoder/package.json
COPY frontend/package.json frontend/package.json
COPY tooling/openapi-generator/package.json tooling/openapi-generator/package.json

FROM workspace AS ui
RUN pnpm --filter @invimport/frontend... install --frozen-lockfile
COPY contracts/src contracts/src
COPY contracts/generated contracts/generated
COPY frontend frontend
RUN pnpm --filter @invimport/frontend build

FROM workspace AS dependencies
RUN pnpm --filter @invimport/intake-server... install --prod --frozen-lockfile

FROM ghcr.io/astral-sh/uv:0.9.18@sha256:5713fa8217f92b80223bc83aac7db36ec80a84437dbc0d04bbc659cae030d8c9 AS uv
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS python-dependencies
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
COPY backend/src src
RUN uv sync --frozen --no-dev --no-editable --python /usr/local/bin/python3

FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS app
WORKDIR /app
COPY --from=workspace /usr/local/bin/node /usr/local/bin/node
COPY --from=dependencies /app /app
COPY --from=ui /app/frontend/dist frontend/dist
COPY --from=python-dependencies /app/backend/.venv backend/.venv
COPY backend/config backend/config
COPY contracts/src contracts/src
COPY contracts/generated contracts/generated
COPY intake-server/src intake-server/src
COPY media-decoder/src media-decoder/src
COPY intake-server/migrations intake-server/migrations
ENV PATH="/app/backend/.venv/bin:${PATH}"
COPY LICENSE LICENSE
RUN install -d -o 1000 -g 1000 -m 0700 /var/lib/intake/agent /var/lib/intake/apply /var/lib/intake/blobs
USER 1000:1000
WORKDIR /app/intake-server
CMD ["node", "--import", "tsx", "src/main.ts"]
