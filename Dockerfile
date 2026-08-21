# No build step. tsconfig sets `erasableSyntaxOnly`, so every source file is valid
# once its types are stripped, and Node does that itself -- which means the thing
# running in the cluster is the same text that is in the repository.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# Carries the .sql migrations alongside the code that applies them, so a deploy
# can never ship one without the other.
COPY src ./src
# The MCP server handed out at /mcp.js. Served rather than published, so the
# version an agent installs is the version this deployment expects.
COPY client ./client
# The mascot, served by the landing page. Only the web-sized variants: the
# full-resolution source art is repository history, not something to ship.
COPY assets/mascot-light.png assets/mascot-dark.png ./assets/
# The written report behind /bench. The runs it is drawn from stay in the
# repository for anyone checking the arithmetic; the service only serves the page.
COPY bench/report.html ./bench/report.html

USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
