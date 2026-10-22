# Build the shared browser interface.
FROM node:24-alpine AS web
WORKDIR /build/web
RUN npm install --global pnpm@11.10.0
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# Build the streaming API as a static binary.
FROM golang:1.27.3-alpine AS server
WORKDIR /build/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /household-server ./cmd/household \
    && mkdir /data && chown 65532:65532 /data

# Linux host networking keeps the strict loopback listener behind Tailscale Serve.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=server /household-server /app/household-server
COPY --from=web /build/web/dist/ /app/web/
COPY --from=server --chown=65532:65532 /data/ /data/
ENV HOUSEHOLD_ADDR=127.0.0.1:8787 \
    HOUSEHOLD_DATA_DIR=/data \
    HOUSEHOLD_WEB_DIR=/app/web \
    HOUSEHOLD_DEV=0
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/app/household-server"]
