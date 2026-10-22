# Household sharing app

The user approved building the proposal in `household-share-architecture.md`.

## Scope and constraints

- Build a private shared household feed for text and files, with Mac, Linux, Android installed clients and browser fallback.
- File target: 20 GB. Uploads and downloads must stream with bounded memory and resumable state; native queues survive closing the interface.
- Every household user sees the same feed initially.
- No developer accounts or app-store dependency. macOS local ad-hoc signing and Android local APK/ADB installation are supported paths.
- Security boundary: Tailscale Serve HTTPS to a loopback backend; support an explicit configured app token for local development/pairing. Never silently expose public service.
- Do not claim native/device validation or successful 20 GB transfers without actual evidence. Document unavailable toolchains and unperformed checks honestly.
- No deployment or system-wide software installation is authorized by this file. Project dependency installation is part of the build; obtain approval before installing absent language toolchains or OS SDK/system packages.

## Collaboration

- This is a shared checkout. Each assigned agent owns its named directory. Avoid modifying another owner's files without explicit coordination.
- Root owns integration docs, root build/configuration, API contract, and deployment packaging.
- Server owner writes `server/`.
- Interface owner writes `web/`.
- Native owner writes `clients/` and `integrations/`.
- Quality reviewer reads all source and reports defects; fixes require coordination with the owner.
- Use Ponderosa managed Agents and tracked Requests. Report exact files, validation actually run, limitations, and remaining work in canonical results.

## Implementation

- The user requested Ponytail for coding and review. Read the repository-local `.agents/skills/ponytail/SKILL.md`; its pinned source and MIT notice are beside it. Reuse existing components, platform features and dependencies before adding code. Make the smallest complete change while preserving every requested behavior, validation, recovery path and accessibility requirement. Existing ownership and runtime instructions continue to apply.

- Read `docs/api-contract.md` before implementing clients or server.
- Use explicit upload states. Never expose incomplete file bytes as ready content.
- Plain text content must remain inert; copy full stored text and show success only after the write succeeds.
- Keep large bodies out of feed JSON, live events, and in-memory whole-file buffers.
- Validate offsets, lengths, item access, disk budget, and user filenames independently.
- Favor a working, narrowly scoped application over placeholder features or unverified claims.
