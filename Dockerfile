# Spectra server image — runs `spectra serve` (HTTP API + web UI).
#
#   docker build -t spectra .
#   docker run -p 4096:4096 -v spectra-data:/root/.config/spectra spectra
#
# The mounted volume persists your global config (providers, keys, sessions).

# ---- build stage: install everything and compile ----
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: production deps + compiled output only ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    SPECTRA_HOST=0.0.0.0 \
    SPECTRA_PORT=4096
# git is used by Spectra's git tools; ripgrep speeds up grep/glob.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4096
CMD ["node", "dist/cli.js", "serve"]
