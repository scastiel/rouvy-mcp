# Build from the repo root: docker build -f probe/Dockerfile -t rouvy-mcp-probe .
# The container just stays up; run the probe inside it (fly ssh console / docker exec), as often as needed.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY test/fixtures ./test/fixtures
COPY probe/package.json probe/*.ts probe/*.mjs ./probe/
RUN cd probe && npm install --no-audit --no-fund && npx tsx make-inputs.ts
WORKDIR /app/probe
CMD ["sleep", "infinity"]
