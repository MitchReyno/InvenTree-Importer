FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
WORKDIR /opt/guest-tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates chromium chromium-sandbox curl git poppler-utils python3 python3-pil tini \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
ENV PATH="/opt/guest-tools/node_modules/.bin:${PATH}"
COPY CODEX-LICENSE CODEX-NOTICE /usr/share/doc/codex/
USER node
WORKDIR /home/node
RUN claude --version && codex --version && chromium --version && python3 -c "from PIL import Image"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/bin/bash"]
