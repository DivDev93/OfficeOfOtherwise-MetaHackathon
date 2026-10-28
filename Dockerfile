FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DEMO_REPLAY_ONLY=true \
    DEMO_3D_ENABLED=false

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/out && chown node:node /app/out

USER node
EXPOSE 8080

CMD ["node", "server/index.js"]
