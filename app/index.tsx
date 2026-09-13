import { Redirect } from 'expo-router';
import { initialRoute } from '../src/ui/routes';

export default function InitialRoute() {
  return <Redirect href={initialRoute} />;
}
