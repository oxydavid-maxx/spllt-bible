// scripts/ios/count-proxy.ts — CI only. Why not a library: a pass-through with a request log is
// thirty lines of node:http, and changing the production server to log requests for a test is worse.
// usage: tsx scripts/ios/count-proxy.ts <listenPort> <targetPort> <log-file> [<tls-cert.pem> <tls-key.pem>]
// With a certificate it serves HTTPS, as production does: the reader only takes its content host from an
// https API base (src/ui/youVersionReaderConfig.ts), so over plain HTTP the Bible text never loads.
// Log lines: "<ms> <METHOD> <path>" when a request arrives (R4 counts these), then "<ms> = <status> <path>
// [error body]" when it answers; a 4xx/5xx keeps the first 160 bytes of its body (an error code, never a token).
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTlsServer } from 'node:https';

const [listen, target, log, certFile, keyFile] = process.argv.slice(2);
const forward = (incoming: IncomingMessage, outgoing: ServerResponse) => {
  appendFileSync(log, `${Date.now()} ${incoming.method} ${incoming.url}\n`);
  const upstream = request({ host: '127.0.0.1', port: Number(target), path: incoming.url, method: incoming.method, headers: incoming.headers }, (response) => {
    const status = response.statusCode ?? 502;
    outgoing.writeHead(status, response.headers);
    let head = '';
    response.on('data', (chunk: Buffer) => { if (status >= 400 && head.length < 160) head += chunk.toString('utf8'); });
    response.on('end', () => appendFileSync(log, `${Date.now()} = ${status} ${incoming.url}${status >= 400 ? ` ${head.slice(0, 160)}` : ''}\n`));
    response.pipe(outgoing);
  });
  upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
  incoming.pipe(upstream);
};
const server = certFile && keyFile
  ? createTlsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, forward)
  : createServer(forward);
server.listen(Number(listen), '127.0.0.1');
