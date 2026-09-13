export interface LineGroupLink {
  rpgUrl: string | null;
  callUrl?: string | null;
  callProvider?: 'meet' | 'zoom';
}

export interface LineLinksConfig {
  communityUrl: string | null;
  groups: Record<string, LineGroupLink>;
}

export interface FixedMember {
  id: string;
  groupId: string;
  displayName?: string;
}

function validExternalUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === 'https:';
}

export function createLineLinks(config: LineLinksConfig) {
  if (config.communityUrl && !validExternalUrl(config.communityUrl)) throw new Error('community URL must use HTTPS');
  for (const link of Object.values(config.groups)) {
    if (link.rpgUrl && !validExternalUrl(link.rpgUrl)) throw new Error('RPG URL must use HTTPS');
    if (link.callUrl && !validExternalUrl(link.callUrl)) throw new Error('call URL must use HTTPS');
  }
  return {
    forMember(member: FixedMember) {
      const group = config.groups[member.groupId];
      if (!group) throw new Error('fixed RPG group link is not configured');
      return {
        communityUrl: config.communityUrl,
        rpgUrl: group.rpgUrl,
        ...(group.callUrl ? { callUrl: group.callUrl } : {}),
        ...(group.callProvider ? { callProvider: group.callProvider } : {}),
      };
    },
  };
}
