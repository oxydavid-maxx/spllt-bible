import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fetchBibleContent = vi.fn(async () => ({ status: 200, body: '{}', contentType: 'application/json' }));
vi.mock('@youversion/platform-react-native-expo-core', () => ({ useYouVersion: () => ({ fetchBibleContent }) }));

import { BibleContentPreloadHost } from '../../src/ui/BibleContentPreloadHost';

afterEach(() => { fetchBibleContent.mockClear(); });

describe('BibleContentPreloadHost', () => {
  it('starts only when the owner declares home and preferences ready, and restarts on generation changes', async () => {
    let view!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      view = TestRenderer.create(React.createElement(BibleContentPreloadHost, {
        enabled: false, versionId: 46, references: ['1TI.1'], generationKey: '2026-09-14:46',
      }));
    });
    expect(fetchBibleContent).not.toHaveBeenCalled();
    await act(async () => {
      view.update(React.createElement(BibleContentPreloadHost, {
        enabled: true, versionId: 46, references: ['1TI.1', '1TI.2'], activeReferenceIndex: 1, generationKey: '2026-09-14:46',
      }));
    });
    expect(fetchBibleContent).toHaveBeenCalledWith({ path: '/v1/bibles/46/passages/1TI.2?format=html&include_headings=true&include_notes=true' });
    await act(async () => {
      view.update(React.createElement(BibleContentPreloadHost, {
        enabled: true, versionId: 40, references: ['PSA.90'], generationKey: '2026-09-15:40',
      }));
    });
    expect(fetchBibleContent).toHaveBeenLastCalledWith({ path: '/v1/bibles/40/passages/PSA.90?format=html&include_headings=true&include_notes=true' });
    await act(async () => view.unmount());
  });
});
