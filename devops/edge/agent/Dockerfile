FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY edge-agent.mjs ./edge-agent.mjs
USER node
EXPOSE 8080
CMD ["node", "edge-agent.mjs"]