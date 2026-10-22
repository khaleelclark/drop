# Linux hosting

This guide describes the intended deployment; no service is deployed automatically. Read actual validation results before choosing a build.

## Files and configuration

The server needs its binary, built web assets, and a writable persistent data directory. Use `.env.example` for environment names. Keep `HOUSEHOLD_TOKEN` private; it authorizes access to the shared household feed. Installed clients pair with the server URL and this token; browsers exchange it for a session cookie.

Bind the host server to `127.0.0.1:8787`. Set `HOUSEHOLD_PUBLIC_URL` to the exact HTTPS origin that Tailscale Serve will expose, for example `https://your-host.your-tailnet.ts.net`. The value is an origin, not a URL with a path. Restrict tailnet access to the intended household users/devices.

After starting the server, run on the Linux host:

```sh
tailscale serve --bg http://127.0.0.1:8787
```

Tailscale Serve supplies HTTPS and limits the service to the tailnet. Keep public Funnel exposure disabled. Tailscale must also be connected on client devices. The host must remain awake and online for uploads and downloads. [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)

## Optional container packaging

`Dockerfile` builds the interface and static server. The Linux `compose.yaml` uses host networking so the server can keep its strict loopback listener while Tailscale Serve on the host reaches it. It uses a persistent named volume and requires the production token and origin in `.env`. This container recipe targets the Linux hosting box; it does not rely on Docker Desktop host-network support.

```sh
docker compose build
docker compose up -d
```

The runtime image uses numeric non-root user 65532 and initializes `/data` ownership for a fresh Docker named volume. A pre-existing volume or bind mount must be writable by that user. See `docs/validation.md` for the actual container checks performed; a source Dockerfile alone is not validation evidence.

## Optional Linux desktop build container

The desktop GUI requires GTK/WebKit development dependencies. `Dockerfile.desktop` keeps those build dependencies in an isolated image rather than installing them on the host. Once the shared frontend and desktop source checks pass, build/export a Linux Debian package and capture helper with:

```sh
docker build --file Dockerfile.desktop --output type=local,dest=.tools/desktop-build .
```

The generated package still needs installation and GUI/lifetime testing on the target Linux desktop. It is not the Linux server container. See `docs/validation.md` for which builds actually passed.

## Storage and recovery

Choose a filesystem with ample free space for concurrent 20 GB uploads. The application should reserve budget for incomplete uploads and keep a free-space floor. Back up metadata and content consistently together; stopping the service or using a filesystem snapshot avoids a mismatched database/blob backup.

Treat this as a transfer inbox unless you also establish a backup policy. Configure retention deliberately. Keep the local Android signing key available for updates, outside the shared server data volume and source repository.

## Required operational checks

- Confirm anonymous API access fails and the intended household clients can connect.
- Confirm the server port is not exposed on public/LAN interfaces.
- Exercise interrupted upload/download and restart recovery with byte-integrity checks.
- Validate actual large files on the host and native clients; a small fixture does not prove the 20 GB target.
- Verify disk-budget exhaustion produces recoverable errors without presenting corrupt content as ready.
- Verify the UI and clients can recover when Tailscale connectivity is lost.
