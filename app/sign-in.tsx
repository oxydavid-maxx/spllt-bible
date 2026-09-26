import { runtimeConfig } from '../src/config/runtime';
import { SignInScreen } from '../src/ui/SignInScreen';

export default function SignInRoute() {
  return <SignInScreen baseUrl={runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl} />;
}
