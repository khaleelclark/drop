#!/usr/bin/env bash
# Runs only synthetic WKWebView diagnostics. Never builds/replaces frontend assets.
set -euo pipefail
if [[ $# != 3 || ( "$3" != baseline && "$3" != tabindex && "$3" != fixed ) ]]; then
  echo 'Usage: test-delete-webview.sh DIST_DIR NEW_OUTPUT_DIR baseline|tabindex|fixed (parent must exist)' >&2
  exit 2
fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Requires macOS with an active GUI session, existing Xcode/Command Line Tools and Node.js. No installation is performed.' >&2
  exit 2
fi
command -v node >/dev/null
command -v xcrun >/dev/null
scripts_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
dist_dir="$(cd -- "$1" && pwd -P)"
[[ -f "$dist_dir/index.html" ]]
output_parent="$(cd -- "$(dirname -- "$2")" && pwd -P)"
output_name="$(basename -- "$2")"
[[ "$output_name" != . && "$output_name" != .. ]] || { echo 'Choose a fresh OUTPUT_DIR' >&2; exit 2; }
output_dir="$output_parent/$output_name"
# Validate before creating anything beside the (possibly frozen) frontend assets.
case "$output_dir/" in "$dist_dir/"*) echo 'OUTPUT_DIR must be outside DIST_DIR' >&2; exit 2;; esac
[[ ! -e "$output_dir" && ! -L "$output_dir" ]] || { echo 'Choose a fresh OUTPUT_DIR' >&2; exit 2; }
mkdir -- "$output_dir"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/zing-delete-webview.XXXXXX")"
server_pid=''
cleanup() { if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi; rm -rf -- "$work_dir"; }
trap cleanup EXIT
{
  sw_vers
  xcrun --show-sdk-path
  xcrun --show-sdk-version
  xcrun swiftc --version
  node --version
} > "$output_dir/environment.txt"
# Loopback-only, read-only static host. CSP blocks all remote connections/workers.
node - "$dist_dir" "$work_dir/port" "$output_dir/assets.json" <<'NODE' > "$output_dir/static-server.log" 2>&1 &
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto')
const root=fs.realpathSync(process.argv[2]),portFile=process.argv[3],manifestFile=process.argv[4]
const manifest=[]
function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Symlink in frontend tree');if(entry.isDirectory())scan(full);else if(entry.isFile())manifest.push({path:path.relative(root,full),bytes:fs.statSync(full).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')})}}
scan(root);manifest.sort((a,b)=>a.path.localeCompare(b.path));fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n')
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; worker-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'")
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return}
  let file
  try{const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);file=fs.realpathSync(path.resolve(root,'.'+(name==='/'?'/index.html':name)));if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw Error('Outside root')}catch{res.writeHead(404).end();return}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Content-Length',fs.statSync(file).size)
  res.writeHead(200);if(req.method==='HEAD')res.end();else{const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res)}
})
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(portFile,String(server.address().port)))
NODE
server_pid=$!
for _ in {1..100}; do
  [[ ! -f "$work_dir/port" ]] || break
  kill -0 "$server_pid" 2>/dev/null || { cat "$output_dir/static-server.log" >&2; exit 1; }
  sleep 0.05
done
[[ -s "$work_dir/port" ]] || { echo 'Loopback server did not start' >&2; exit 1; }
xcrun swiftc -swift-version 5 -framework AppKit -framework WebKit "$scripts_dir/test-delete-webview.swift" -o "$work_dir/test-delete-webview"
"$work_dir/test-delete-webview" "http://127.0.0.1:$(cat "$work_dir/port")" "$3" "$output_dir" "$scripts_dir/delete-webview-fixture.js" > "$output_dir/runner.log" 2>&1
