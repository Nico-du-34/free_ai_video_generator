ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

# ffmpeg : conversion des images et assemblage de la vidéo
RUN apk add --no-cache ffmpeg tini

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
