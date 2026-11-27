import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { primitive, setString, openURL } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
  setString: vi.fn(async () => true),
  openURL: vi.fn(async () => true),
}));
vi.mock('react-native', () => ({
  Pressable: primitive('Pressable'),
  Text: primitive('Text'),
  View: primitive('View'),
  Linking: { openURL },
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-clipboard', () => ({ setStringAsync: setString }));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { PLACES, PlacePin, placeCopyText } from '../../src/ui/PlacePin';

function render(side: 'main' | 'youth') {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(React.createElement(PlacePin, { place: PLACES[side] })); });
  return {
    text: () => JSON.stringify(tree.toJSON()),
    byLabel: (label: string) => tree.root.findAll((node) => node.props?.accessibilityLabel === label)[0],
  };
}

describe('the address pinned on top of 公告 (作答頁 Q13347)', () => {
  it('starts closed: one line with the place name only', () => {
    const pin = render('youth');
    expect(pin.text()).toContain('青年館');
    expect(pin.text()).not.toContain('龍山西路');
    expect(pin.byLabel('開青年館地圖')).toBeUndefined();
  });

  it('opens to the full address, a copy button and a map button', async () => {
    const pin = render('youth');
    act(() => { pin.byLabel('青年館地址，展開').props.onPress(); });
    expect(pin.text()).toContain('新竹市東區龍山西路107號2樓');
    await act(async () => { await pin.byLabel('複製青年館地址和地圖連結').props.onPress(); });
    expect(setString).toHaveBeenCalledWith('竹科靈糧堂 青年館\n新竹市東區龍山西路107號2樓\nhttps://maps.app.goo.gl/k9NFs6UmogC2sGqj9');
    expect(pin.text()).toContain('已複製');
    act(() => { pin.byLabel('開青年館地圖').props.onPress(); });
    expect(openURL).toHaveBeenCalledWith('https://maps.app.goo.gl/k9NFs6UmogC2sGqj9');
  });

  it('gives 主堂 the church itself', () => {
    expect(placeCopyText(PLACES.main)).toBe('竹科靈糧堂\n新竹市東區慈雲路65號\nhttps://maps.google.com/?cid=2334640645045630095');
  });

  it('keeps the maintainer\'s own 青年館 map link (青崇 SOP: never swap the pin)', () => {
    expect(PLACES.youth.mapUrl).toBe('https://maps.app.goo.gl/k9NFs6UmogC2sGqj9');
  });

  it('every address names its city and district', () => {
    for (const place of Object.values(PLACES)) expect(place.address).toMatch(/^新竹市東區/);
  });

  it('is on both sides of 公告, above everything else on the page', () => {
    const screen = readFileSync(join(__dirname, '../../app/(tabs)/announcements.tsx'), 'utf8');
    const pin = screen.indexOf('<PlacePin key={`${side}:${visits}`} place={PLACES[side]} />');
    expect(pin).toBeGreaterThan(screen.indexOf('accessibilityRole="tablist"'));
    expect(pin).toBeLessThan(screen.indexOf('<UpdateCard'));
    expect(pin).toBeLessThan(screen.indexOf("{side === 'main'"));
  });

  it('closes again every time 公告 comes back into view', () => {
    const screen = readFileSync(join(__dirname, '../../app/(tabs)/announcements.tsx'), 'utf8');
    expect(screen).toContain('useFocusEffect(useCallback(() => { setVisits((count) => count + 1); }, []));');
  });

  it('says to copy instead when the phone cannot open the map', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    const pin = render('main');
    act(() => { pin.byLabel('竹科靈糧堂地址，展開').props.onPress(); });
    await act(async () => { await pin.byLabel('開竹科靈糧堂地圖').props.onPress(); });
    expect(pin.text()).toContain('打不開地圖');
  });
});
