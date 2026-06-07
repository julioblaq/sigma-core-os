FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY apps/worker ./apps/worker
COPY agents ./agents
COPY core ./core
COPY integrations ./integrations

ENV NODE_ENV=production
ENV SIGMA_CONTROL_STORE=postgres
ENV TASK_QUEUE_MODE=redis
ENV TASK_QUEUE_NAME=sigma:tasks
ENV SIGMA_SANDBOX_PATH=/tmp/sigma-sandbox

RUN mkdir -p /tmp/sigma-sandbox && chown -R node:node /app /tmp/sigma-sandbox

USER node

CMD ["npm", "run", "start:worker"]
