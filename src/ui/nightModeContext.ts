import { createContext, useContext } from 'react';
import type { NightModeChoice } from '../services/nightMode';

/**
 * What screens need from 夜間模式 (src/ui/NightModeProvider.tsx owns it): the choice, a way to change it, and whether
 * the 新功能 card is due. No native module here, so any screen and its tests can import it; without the provider
 * (component tests) the choice reads 晚上自動 and the card is never due.
 */
export interface NightModeBinding {
  choice: NightModeChoice;
  setChoice: (choice: NightModeChoice) => void;
  /** The 新功能 card is due on this phone. */
  newsDue: boolean;
  dismissNews: () => void;
}

const FALLBACK: NightModeBinding = { choice: 'auto', setChoice: () => undefined, newsDue: false, dismissNews: () => undefined };
export const NightModeContext = createContext<NightModeBinding>(FALLBACK);

export function useNightMode(): NightModeBinding {
  return useContext(NightModeContext);
}
