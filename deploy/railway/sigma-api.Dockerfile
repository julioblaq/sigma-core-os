FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY apps/api ./apps/api
COPY agents ./agents
COPY core ./core
COPY integrations ./integrations
COPY deploy/railway/sigma-api-entrypoint.sh /usr/local/bin/sigma-api-entrypoint.sh

RUN mkdir -p /data/sandbox && \
    chown -R node:node /data /app && \
    chmod +x /usr/local/bin/sigma-api-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/sigma.db
ENV SIGMA_SANDBOX_PATH=/data/sandbox

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["sigma-api-entrypoint.sh"]
CMD ["npm", "run", "start:api"]
