export function buildGroupLinkFallback(failedUrl: string, openChatUrl: string | null) {
  return {
    copyUrl: failedUrl,
    returnToGroupUrl: openChatUrl && openChatUrl !== failedUrl ? openChatUrl : null,
  } as const;
}
