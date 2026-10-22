// Installed before the shared frontend loads. Native Kotlin owns all transfer bytes/lifetime.
window.__HOUSEHOLD_NATIVE__ = Object.freeze({platform:'android', invoke(command, args = {}) {
  return window.__TAURI_INTERNALS__.invoke('plugin:household|dispatch', {command, argsJson:JSON.stringify(args)});
}});
