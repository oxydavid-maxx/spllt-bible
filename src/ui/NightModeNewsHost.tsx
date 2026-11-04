import { useEffect, useRef, useState } from 'react';
import { NightModeNews } from './NightModeNews';
import { useNightMode } from './nightModeContext';
import { requestNightModePage, useReaderFreeForNews } from './nightModeNewsSlot';
import { useUpdatePromptShowing } from './updatePromptPresence';

/**
 * The 新功能 card at the root (光佑 2026-11-04): it first appears once the reader is on screen with no panel open and
 * 有新版本 is not showing, and from then on stays until one of its buttons is pressed, whatever the reader does under it.
 * 改設定 opens the reader's 夜間模式 page after the card has gone (two dialogs at once can lose the second on iOS).
 */
export function NightModeNewsHost() {
  const { newsDue, dismissNews } = useNightMode();
  const readerFree = useReaderFreeForNews();
  const updatePromptShowing = useUpdatePromptShowing();
  const [shown, setShown] = useState(false);
  useEffect(() => { if (newsDue && readerFree && !updatePromptShowing) setShown(true); }, [newsDue, readerFree, updatePromptShowing]);
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
