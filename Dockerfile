# Spectra — containerized HTTP API + web UI (`spectra serve`).
#
#   docker build -t spectra .
#   docker run --rm -p 4096:4096 -e SPECTRA_HOST=0.0.0.0 \
#     -e OPENAI_API_KEY=... -v "$PWD":/work -w /work spectra
#
# Mount your project at /work so the agent operates on it. The default free
# model works with no key; add provider keys via -e as needed.

# ---- build stage: compile TypeScript to dist/ ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: prod deps + compiled output only ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# ripgrep powers fast grep/glob (optional but recommended).
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep git \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Bind to all interfaces inside the container; publish with -p on the host.
ENV SPECTRA_HOST=0.0.0.0
ENV SPECTRA_PORT=4096
EXPOSE 4096

# Run against a mounted working directory (default /work).
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["serve"]
