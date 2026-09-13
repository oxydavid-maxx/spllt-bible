import type { AuthSession } from './authSession';

export interface AuthScopeTicket {
  generation: number;
  session: AuthSession;
}

export function createAuthScopeAuthority(isSessionCurrent: (session: AuthSession) => boolean) {
  let generation = 0;
  return {
    begin(session: AuthSession): AuthScopeTicket {
      generation += 1;
      return { generation, session };
    },
    invalidate(): void {
      generation += 1;
    },
    invalidateIfCurrent(ticket: AuthScopeTicket): void {
      if (ticket.generation === generation) generation += 1;
    },
    isCurrent(ticket: AuthScopeTicket): boolean {
      return ticket.generation === generation && isSessionCurrent(ticket.session);
    },
  };
}

export type AuthScopeAuthority = ReturnType<typeof createAuthScopeAuthority>;
