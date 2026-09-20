import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Whether the soft keyboard is up right now.
 *
 * This exists because of one Android detail: a Modal is its own window, and that window does not
 * resize when the keyboard opens. Anything inside it therefore has to move itself out of the way.
 * `KeyboardAvoidingView` does that, but on Android its padding is applied whether or not there is a
 * keyboard, so it has to be switched on only while there is one — which is what this answers.
 */
export function useAndroidKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  return visible;
}
