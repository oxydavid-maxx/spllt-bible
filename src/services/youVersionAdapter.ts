export interface YouVersionAdapterOptions {
  appKey?: string | null;
  moduleLoader?: () => Promise<unknown>;
  readerModuleLoader?: () => Promise<unknown>;
}

export type YouVersionReaderUiModule = typeof import('@youversion/platform-react-native-expo-ui');

export type YouVersionState =
  | { status: 'CONFIG_REQUIRED'; reason: string }
  | { status: 'NATIVE_MODULE_READY'; module: unknown }
  | { status: 'NATIVE_MODULE_UNAVAILABLE'; reason: string };

export type YouVersionReaderState =
  | { status: 'CONFIG_REQUIRED'; reason: string }
  | { status: 'READER_UI_READY'; module: YouVersionReaderUiModule }
  | { status: 'READER_UI_UNAVAILABLE'; reason: string };

export function createYouVersionAdapter(options: YouVersionAdapterOptions = {}) {
  return {
    async load(): Promise<YouVersionState> {
      if (!options.appKey?.trim()) {
        return { status: 'CONFIG_REQUIRED', reason: 'YouVersion App Key is not configured' };
      }
      try {
        const module = await (options.moduleLoader?.() ?? import('@youversion/platform-react-native-expo-core'));
        return { status: 'NATIVE_MODULE_READY', module };
      } catch {
        return {
          status: 'NATIVE_MODULE_UNAVAILABLE',
          reason: 'Official RN/Expo module could not be loaded in this native runtime',
        };
      }
    },
    async loadReaderUi(): Promise<YouVersionReaderState> {
      if (!options.appKey?.trim()) {
        return { status: 'CONFIG_REQUIRED', reason: 'YouVersion App Key is not configured' };
      }
      try {
        const module = await (options.readerModuleLoader?.() ?? import('@youversion/platform-react-native-expo-ui'));
        return { status: 'READER_UI_READY', module: module as YouVersionReaderUiModule };
      } catch {
        return {
          status: 'READER_UI_UNAVAILABLE',
          reason: 'Official YouVersion RN/Expo reader UI could not be loaded in this native runtime',
        };
      }
    },
  };
}
