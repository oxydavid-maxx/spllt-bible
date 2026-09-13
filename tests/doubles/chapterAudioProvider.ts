/** Synthetic provider metadata for route/client integration; never contacts the network. */
export async function chapterAudioProvider(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input));
  const versionId = Number(url.searchParams.get('version_id'));
  const reference = url.searchParams.get('reference') ?? '';
  if (['TIT.1', '2TI.4', '1TI.2'].includes(reference)) throw new Error('Synthetic provider outage');
  const data = versionId === 312 ? [] : [{
    id: 1310, version_id: versionId, title: 'Fixture narrator',
    default: true, dramatized: false, timing: [{ usfm: reference + '.1', start: 0 }],
    download_urls: { format_mp3_32k: 'https://media.example.test/observed-fixture.mp3' },
  }];
  return new Response(JSON.stringify({ response: { code: 200, data } }));
}
