export interface Member {
  id: string;
  displayName: string;
}

export interface MaskedMember {
  id: string;
  label: string;
  isSelf: boolean;
}

function maskedLabel(displayName: string): string {
  const chars = [...displayName.trim()];
  if (chars.length <= 1) return 'O';
  if (chars.length === 2) return `O${chars[1]}O`;
  return `O${chars.slice(1, -1).join('')}O`;
}

export function maskForViewer(viewerId: string, member: Member): MaskedMember {
  const isSelf = viewerId === member.id;
  return {
    id: member.id,
    label: isSelf ? member.displayName : maskedLabel(member.displayName),
    isSelf,
  };
}
