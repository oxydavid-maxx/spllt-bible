// scripts/ios/count-proxy.ts — CI only. Why not a library: a pass-through with a request log is
// thirty lines of node:http, and changing the production server to log requests for a test is worse.
// usage: tsx scripts/ios/count-proxy.ts <listenPort> <targetPort> <log-file>
import { appendFileSync } from 'node:fs';
import { createServer, request } from 'node:http';

const [listen, target, log] = process.argv.slice(2);
createServer((incoming, outgoing) => {
  appendFileSync(log, `${Date.now()} ${incoming.method} ${incoming.url}\n`);
  const upstream = request({ host: '127.0.0.1', port: Number(target), path: incoming.url, method: incoming.method, headers: incoming.headers }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
  incoming.pipe(upstream);
}).listen(Number(listen), '127.0.0.1');
