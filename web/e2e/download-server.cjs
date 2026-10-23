// Chromium download navigations bypass Playwright's page/context route mocks.
// Serve the small attachment through real HTTP and Vite's same-origin proxy.
const http = require('node:http')
const body = Buffer.from('downloaded fixture bytes')
const text = Buffer.from('  From the kitchen\n\t🦊 café\n\n  ')
const server = http.createServer((request,response) => {
  if (request.url === '/health') { response.writeHead(200); response.end('ok'); return }
  const format = /^\/api\/items\/text-one\/download\?format=(txt|md)$/.exec(request.url)?.[1]
  if (request.url !== '/api/items/file-one/download' && !format) { response.writeHead(404); response.end(); return }
  if (!request.headers.cookie?.split(';').some(value => value.trim() === 'household=fixture')) {
    response.writeHead(401); response.end('Connect first'); return
  }
  response.writeHead(200, {
    'Content-Type':'application/octet-stream',
    'Content-Disposition':format ? `attachment; filename="Kitchen note.${format}"` : 'attachment; filename="weekend.zip"',
    'Content-Length':String((format ? text : body).length),
    'Cache-Control':'no-store',
  })
  response.end(format ? text : body)
})
server.listen(Number(process.env.HOUSEHOLD_DOWNLOAD_TEST_PORT || '18174'),'127.0.0.1')
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,() => server.close(() => process.exit(0)))
