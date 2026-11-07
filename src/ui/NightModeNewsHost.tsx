import { useEffect, useRef, useState } from 'react';
import { NightModeNews } from './NightModeNews';
import { useNightMode } from './nightModeContext';
import { requestNightModePage, useReaderFreeForNews } from './nightModeNewsSlot';
import { useUpdatePromptShowing } from './updatePromptPresence';

/** How long the reader must stay on screen, panel-free, before the card first appears: it settles after its start. */
export const NEWS_SETTLE_MS = 2500;

/**
 * The 新功能 card at the root (光佑 2026-11-04): it first appears once the reader has stayed on screen with no panel open
 * (and 有新版本 not showing) for a moment, and from then on stays until one of its buttons is pressed, whatever the
 * reader does under it. 改設定 opens the reader's 夜間模式 page after the card has gone (two dialogs at once can lose
 * the second on iOS).
 */
export function NightModeNewsHost() {
  const { newsDue, dismissNews } = useNightMode();
  const readerFree = useReaderFreeForNews();
  const updatePromptShowing = useUpdatePromptShowing();
  const [shown, setShown] = useState(false);
  const ready = newsDue && readerFree && !updatePromptShowing;
  useEffect(() => {
    if (!ready || shown) return undefined;
    // Restarts whenever the reader leaves or remounts while it starts (readerFree goes false in between).
    const timer = setTimeout(() => setShown(true), NEWS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, shown]);
  const pageAfter = useRef(false);
  const openPage = () => {
    if (!pageAfter.current) return;
    pageAfter.current = false;
    requestNightModePage();
  };
  // Mounted only once it has appeared, so a screen that never gets the card never builds its dialog.
  if (!shown) return null;
  return <NightModeNews visible={newsDue} onDone={dismissNews} onChange={() => {
    pageAfter.current = true;
    dismissNews();
    setTimeout(openPage, 450);
  }} onClosed={openPage} />;
}
