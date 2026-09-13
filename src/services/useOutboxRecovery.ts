import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  createOutboxRecoveryController,
  type OutboxRecoveryClient,
  type OutboxRecoveryRepository,
  type OutboxRecoverySession,
} from './outboxRecovery';

export interface UseOutboxRecoveryOptions {
  memberId: string | null;
  sessionToken: string | null;
  planId: string;
  taskDate: string;
  getRepository: () => OutboxRecoveryRepository | null;
  getClient: () => OutboxRecoveryClient | null;
  getSession: () => OutboxRecoverySession | null;
  isCurrentAuthSession: (session: OutboxRecoverySession | null) => boolean;
  onRecovered: () => void;
}

/**
 * Wires the pure outboxRecovery controller to AppState. Flushes once whenever the app becomes
 * 'active' and, while the visible-date record stays PENDING_SAVE, keeps retrying with bounded
 * backoff — all through the same repository.flush used by the existing focus/client-creation
 * paths, so the queued command and its operationId never change. Recreated (and the previous
 * controller stopped) whenever memberId/session/date change, so a member/session switch cancels
 * any in-flight backoff for the previous identity.
 */
export function useOutboxRecovery(options: UseOutboxRecoveryOptions): void {
  const getRepositoryRef = useRef(options.getRepository);
  getRepositoryRef.current = options.getRepository;
  const getClientRef = useRef(options.getClient);
  getClientRef.current = options.getClient;
  const getSessionRef = useRef(options.getSession);
  getSessionRef.current = options.getSession;
  const isCurrentAuthSessionRef = useRef(options.isCurrentAuthSession);
  isCurrentAuthSessionRef.current = options.isCurrentAuthSession;
  const onRecoveredRef = useRef(options.onRecovered);
  onRecoveredRef.current = options.onRecovered;

  const { memberId, sessionToken, planId, taskDate } = options;

  useEffect(() => {
    if (!memberId) return undefined;
    const controller = createOutboxRecoveryController({
      getRepository: () => getRepositoryRef.current(),
      getClient: () => getClientRef.current(),
      getSession: () => getSessionRef.current(),
      isCurrentAuthSession: (session) => isCurrentAuthSessionRef.current(session),
      getTarget: () => ({ memberId, planId, taskDate }),
      onRecovered: () => onRecoveredRef.current(),
    });

    if (AppState.currentState === 'active') controller.kick();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') controller.kick();
      else controller.pause();
    });

    return () => {
      controller.stop();
      subscription.remove();
    };
    // memberId/sessionToken/planId/taskDate identify the recovery target + auth guard; a change to
    // any of them must stop the previous controller (cancelling its pending retries) before a new
    // one (if any) starts.
  }, [memberId, sessionToken, planId, taskDate]);
}
