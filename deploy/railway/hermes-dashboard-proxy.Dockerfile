FROM node:20-alpine

WORKDIR /app

COPY deploy/railway/hermes-dashboard-proxy.mjs ./server.mjs

ENV PORT=3000
ENV HERMES_DASHBOARD_UPSTREAM=http://hermes-agent.railway.internal:9119

CMD ["node", "server.mjs"]
