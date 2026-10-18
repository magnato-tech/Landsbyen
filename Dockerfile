# Landsbyen API for Google Cloud Run. Ingen pakker å installere: Node kjører TypeScript selv.
FROM node:22-slim
WORKDIR /app
COPY package.json openapi.yaml ./
COPY src ./src
COPY web ./web
ENV NODE_ENV=production STORE=firestore AUTH_MODE=google
USER node
CMD ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "src/server.ts"]
