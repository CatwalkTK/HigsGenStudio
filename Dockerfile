FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates git \
    && npm install -g @anthropic-ai/claude-code \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN mkdir -p /app/projects /app/state /home/node/.claude \
    && chown -R node:node /app /home/node

COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/higsgen-entrypoint

USER node
ENV PORT=4649
EXPOSE 4649

ENTRYPOINT ["higsgen-entrypoint"]
CMD ["node", "ui/server.mjs"]
