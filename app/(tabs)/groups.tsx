import { Redirect } from 'expo-router';

/** Compatibility target for old group/deep links. The group/RPG surface was retired in v1. */
export default function RetiredGroupsRoute() {
  return <Redirect href="/(tabs)/today" />;
}
