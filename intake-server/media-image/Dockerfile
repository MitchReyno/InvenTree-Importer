FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
WORKDIR /app
RUN npm install --global pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY contracts/package.json contracts/package.json
COPY intake-server/package.json intake-server/package.json
COPY frontend/package.json frontend/package.json
COPY tooling/openapi-generator/package.json tooling/openapi-generator/package.json
RUN pnpm --filter @invimport/intake-server... install --frozen-lockfile --prod
COPY contracts/src contracts/src
COPY intake-server/src/media intake-server/src/media
USER 1000:1000
CMD ["node", "--max-old-space-size=256", "--disallow-code-generation-from-strings", "/app/intake-server/src/media/decoder-main.ts"]
