// Chromium download navigations bypass Playwright's page/context route mocks.
// Serve the small attachment through real HTTP and Vite's same-origin proxy.
const http = require('node:http')
const body = Buffer.from('downloaded fixture bytes')
const server = http.createServer((request,response) => {
  if (request.url === '/health') { response.writeHead(200); response.end('ok'); return }
  if (request.url !== '/api/items/file-one/download') { response.writeHead(404); response.end(); return }
  if (!request.headers.cookie?.split(';').some(value => value.trim() === 'household=fixture')) {
    response.writeHead(401); response.end('Connect first'); return
  }
  response.writeHead(200, {
    'Content-Type':'application/octet-stream',
    'Content-Disposition':'attachment; filename="weekend.zip"',
    'Content-Length':String(body.length),
    'Cache-Control':'no-store',
  })
  response.end(body)
})
server.listen(Number(process.env.HOUSEHOLD_DOWNLOAD_TEST_PORT || '18174'),'127.0.0.1')
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,() => server.close(() => process.exit(0)))
