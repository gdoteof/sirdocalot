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

USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
