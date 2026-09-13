import { createHttpServer } from '../server/http';

async function main(): Promise<void> {
  const { server } = createHttpServer({ fixtureToken: 'smoke-token' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not expose a TCP port');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/content-capabilities`, {
    headers: {
      authorization: 'Bearer smoke-token',
      'x-qingmu-member-id': 'fixture:self',
    },
  });
  const body = await response.json() as { status?: string };
  server.close();
  if (response.status !== 200 || body.status !== 'C_PENDING_ACCESS') {
    throw new Error(`unexpected capability response: ${response.status} ${JSON.stringify(body)}`);
  }
  console.log(JSON.stringify({ status: response.status, contentMode: body.status, bind: '127.0.0.1' }));
}

void main();
