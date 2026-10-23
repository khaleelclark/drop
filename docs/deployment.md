# Linux hosting

This guide describes the intended deployment; no service is deployed automatically. Read actual validation results before choosing a build.

## Files and configuration

The server needs its binary, built web assets, and a writable persistent data directory. Use `.env.example` for environment names.

For URL-only household access, explicitly set `HOUSEHOLD_AUTH_MODE=tailscale`.
The browser opens through Serve without a token prompt; installed clients save
the private HTTPS origin once and leave the token empty. The backend requires
Serve's user identity on each request from its trusted loopback proxy. Keep
Tailscale grants/ACLs and device sharing restricted to intended household users.
Serve removes incoming identity headers and supplies its own; other processes
on the host remain inside the trusted-local-host boundary. Tagged client devices
do not receive user identity headers and need the optional token fallback.
[Tailscale identity-header guidance](https://tailscale.com/docs/features/tailscale-serve#identity-headers)

The default `HOUSEHOLD_AUTH_MODE=token` retains explicit token login. Set a strong
private `HOUSEHOLD_TOKEN`; installed clients save it privately and browsers
exchange it for a session cookie. A nonempty token may also be retained as an
advanced/legacy fallback in Tailscale mode. Never enable anonymous development
mode to avoid sign-in on a deployed server. Disconnecting Zing does not sign
the device out of Tailscale or revoke its tailnet access.

Bind the host server to `127.0.0.1:8787`. Set `HOUSEHOLD_PUBLIC_URL` to the exact HTTPS origin that Tailscale Serve will expose, for example `https://your-host.your-tailnet.ts.net`. The value is an origin, not a URL with a path. Restrict tailnet access to the intended household users/devices.

After starting the server, run on the Linux host:

```sh
tailscale serve --bg http://127.0.0.1:8787
```

Tailscale Serve supplies HTTPS and limits the service to the tailnet. Keep public Funnel exposure disabled. Tailscale must also be connected on client devices. The host must remain awake and online for uploads and downloads. [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)

## Optional container packaging

`Dockerfile` builds the interface and static server. The Linux `compose.yaml` uses host networking so the server can keep its strict loopback listener while Tailscale Serve on the host reaches it. It uses a persistent named volume and requires the exact HTTPS origin plus the selected authentication mode in `.env`; token mode also requires a token. The server rejects invalid or incomplete configuration. This container recipe targets the Linux hosting box; it does not rely on Docker Desktop host-network support.

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

The Zing editing release upgrades existing schema 1 or 2 databases to schema 3
at startup. Stop every process using that data directory, then back up the whole
directory (SQLite database and any WAL/SHM files together with blobs), the old
binary and its private configuration before the first new start. Keep ownership
and permissions intact. Schema 3 stores immutable content pointers and original
upload lengths; an older binary cannot read it. Rollback requires stopping the
new server and restoring the matching old binary **and** its consistent data
backup. Restoring that backup discards shares and edits made after it was taken.
Do not run old and new servers against the same directory.

Treat this as a transfer inbox unless you also establish a backup policy. Configure retention deliberately. Keep the local Android signing key available for updates, outside the shared server data volume and source repository.

## Required operational checks

- Confirm requests without a valid Serve identity or configured credential fail,
  and the intended household clients can connect. Mock identity-header tests
  alone do not prove a real Serve connection.
- Confirm the server port is not exposed on public/LAN interfaces.
- Exercise interrupted upload/download and restart recovery with byte-integrity checks.
- Validate actual large files on the host and native clients; a small fixture does not prove the 20 GB target.
- Verify disk-budget exhaustion produces recoverable errors without presenting corrupt content as ready.
- Verify the UI and clients can recover when Tailscale connectivity is lost.
