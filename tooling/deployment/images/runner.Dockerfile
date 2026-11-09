# supply the matching pair of local image IDs or immutable release references
ARG APP_IMAGE
ARG PERSONAL_TOOLS_IMAGE
FROM ${APP_IMAGE} AS app
FROM ${PERSONAL_TOOLS_IMAGE} AS runner
COPY --from=app /app /app
COPY tooling/deployment/bridge/claude-egress.py /opt/guest-tools/claude-egress.py
COPY tooling/deployment/bridge/guest_destinations.py /opt/guest-tools/guest_destinations.py
COPY tooling/deployment/bridge/web-reader.py /opt/guest-tools/web-reader.py
COPY --chmod=0555 tooling/deployment/bridge/bench-web /usr/local/bin/bench-web
WORKDIR /app/intake-server
CMD ["node","--import","tsx","src/agents/shared-vm/guest-main.ts"]

# Explicitly selected only by the offline integration test.
FROM runner AS controlled-provider
COPY --chmod=0555 intake-server/tests/fixtures/session-agent.cjs /opt/fixture/provider.cjs
USER root
RUN { printf '#!/usr/bin/env node\n'; cat /opt/fixture/provider.cjs; } > /opt/fixture/provider && chmod 0555 /opt/fixture/provider
USER node
ENV INTAKE_CLAUDE_EXECUTABLE=/opt/fixture/provider INTAKE_CODEX_EXECUTABLE=/opt/fixture/provider
ENV ANTHROPIC_API_KEY=fixture-only OPENAI_API_KEY=fixture-only

FROM runner AS personal
