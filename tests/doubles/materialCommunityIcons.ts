/**
 * Stand-in for @expo/vector-icons/MaterialCommunityIcons in the node test environment.
 *
 * The real icon set loads its font through expo-font, which imports expo-asset, which requires
 * react-native's own Flow source at import time: every component test that rendered the reader or the
 * audio controls failed to load ("Unexpected token 'typeof'") before a single assertion ran. The double
 * renders a host element carrying the icon name, so a test can still see which glyph was chosen.
 */
import { createElement } from 'react';

export default function MaterialCommunityIcons(props: { name: string; [key: string]: unknown }) {
  return createElement('MaterialCommunityIcons', props);
}
