# LocalSend reference for Zing

The user requested interface inspiration and suitable source reuse from
[LocalSend](https://localsend.org/) and its
[repository](https://github.com/localsend/localsend). The inspected reference is
commit `6e37efd5fe750299758b6778d2b150b31af3b95d` (2026-10-21).

The compact device picker, editable display name separate from identity,
content-selection summary, transfer feedback and explicit Open/Quit distinction
are useful patterns for Zing. Reference paths include:

- `app/lib/pages/tabs/send_tab.dart` and `send_tab_vm.dart`;
- `app/lib/widget/list_tile/device_list_tile.dart`;
- `packages/localsend_isolates/lib/model/device.dart`;
- `packages/localsend_isolates/lib/util/transfer_notification.dart` and
  `foreground_service.dart`;
- `app/lib/widget/watcher/tray_watcher.dart`.

Zing retains its server-backed shared feed, offline receiving, tus resume,
streamed file bytes and awaited exact clipboard writes. The reference's LAN
discovery, per-device listeners, peer transport, automatic saving and Flutter
dependencies are not needed for those requirements. Its active-transfer
foreground notification is not evidence of incoming alerts after Android
process exit or force-stop.

No LocalSend code or assets have been copied at this review stage. The pinned
root [license](https://github.com/localsend/localsend/blob/6e37efd5fe750299758b6778d2b150b31af3b95d/LICENSE)
is Apache-2.0, copyright 2022–2026 Tien Do Nam. If source is later copied or
adapted, include the license, retain applicable notices, identify changed files,
and record the exact upstream paths/revision in third-party notices. No tracked
upstream NOTICE file was found in this revision. Separate dependency/package
licenses require their own check; this review does not clear LocalSend branding
or all transitive dependencies.

This is a source/design assessment, not LocalSend or Zing device testing.
