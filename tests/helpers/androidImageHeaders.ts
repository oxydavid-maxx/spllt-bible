/**
 * The request headers React Native 0.85's Android Image hands the native view for a `source`
 * (node_modules/react-native/Libraries/Image/Image.android.js lines 202-208 and 246-247): only an array source
 * passes its first entry's `headers` on; a single `{ uri, headers }` object takes the else branch, where the headers
 * are dropped. The native ReactImageView.setSource reads only uri, size and cache from each source, so nothing else
 * sends them. tests/ui/imageSourceHeaders.test.ts checks that this copy still matches React Native's source.
 */
export function androidForwardedHeaders(source: unknown): Record<string, string> | undefined {
  if (!Array.isArray(source)) return undefined;
  const first = source[0] as { headers?: Record<string, string> } | undefined;
  return first?.headers;
}
