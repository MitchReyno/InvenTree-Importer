ARG APP_IMAGE
FROM docker:28.5.2-cli@sha256:625d9431a9f54c5a2bc90f24f0e1c3d55b1349fd857dd85035f98c2c9acbdd4d AS cli
FROM ${APP_IMAGE}
USER root
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
RUN install -d -m 0700 -o 1000 -g 1000 /run/decoder
USER 1000:1000
ENTRYPOINT ["flock","--no-fork","--nonblock","/run/decoder/owner.lock","node","--import","tsx","src/media/dispatcher-main.ts"]
