import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { fixtureProfile } from '../ui/fixtureProfile';
import type { CompletionRecord } from '../domain/completion';
import { isWithinCompletionWindow, taipeiDate } from '../domain/gamificationV1';
import { createApiClient } from './apiClient';
import { getAuthSnapshot, isCurrentAuthSession, useAuthSnapshot, type AuthSession } from './authSession';
import { activateCompletionAwardSurface, createCompletionController, subscribeCompletionAwardSurface, type CompletionAwardEvent, type CompletionController, type CompletionControllerDependencies, type CompletionSyncEvent } from './completionController';
import { openQingmuRepository } from '../storage/mobileDatabase';
import type { SyncResult } from '../storage/outbox';
import { useOutboxRecovery } from './useOutboxRecovery';
import { createReminderScheduler } from './reminderScheduler';
import { syncReadingReminderForCompletion } from './reminderCompletion';

export interface UseCompletionControllerOptions {
  planId: string;
  taskDate: string;
  /** Whether this scheduled day is eligible for a new completion. Undo and saved retries remain available. */
  canComplete: boolean;
  onAward?: (event: CompletionAwardEvent) => void;
  onConfirmed?: (event: CompletionSyncEvent) => void;
}

export interface UseCompletionControllerValue {
  record: CompletionRecord;
  pending: boolean;
  syncError: boolean;
  retryable: boolean;
  complete: () => Promise<void>;
  requestUndo: () => void;
}

interface Owner {
  memberId: string | null;
  sessionToken: string | null;
  planId: string;
  taskDate: string;
  authEpoch: number;
}

function blankRecord(memberId: string, planId: string, taskDate: string): CompletionRecord {
  return { memberId, planId, taskDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
}

function sameOwner(left: Owner | null, right: Owner): boolean {
  return Boolean(left && left.memberId === right.memberId && left.sessionToken === right.sessionToken
    && left.planId === right.planId && left.taskDate === right.taskDate && left.authEpoch === right.authEpoch);
}

export function useCompletionController(options: UseCompletionControllerOptions): UseCompletionControllerValue {
  const auth = useAuthSnapshot();
  const fixtureMode = process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true';
  const memberId = auth.session?.memberId ?? (fixtureMode ? fixtureProfile.memberId : null);
  const sessionToken = auth.session?.sessionToken ?? (fixtureMode ? process.env.EXPO_PUBLIC_QINGMU_DEV_TOKEN?.trim() || null : null);
  const ownerRef = useRef<Owner | null>(null);
  const nextOwner: Owner = { memberId, sessionToken, planId: options.planId, taskDate: options.taskDate, authEpoch: auth.epoch };
  if (!sameOwner(ownerRef.current, nextOwner)) ownerRef.current = nextOwner;
  const owner = ownerRef.current!;
  const identity = { memberId: memberId ?? 'signed-out', planId: options.planId, taskDate: options.taskDate };

  const repositoryRef = useRef<ReturnType<typeof openQingmuRepository> | null>(null);
  const clientRef = useRef<ReturnType<typeof createApiClient> | null>(null);
  const [record, setRecord] = useState<CompletionRecord>(() => {
    if (!memberId) return blankRecord('signed-out', options.planId, options.taskDate);
    try {
      const repository = openQingmuRepository();
      repositoryRef.current = repository;
      return repository.get({ memberId, planId: options.planId, taskDate: options.taskDate })
        ?? blankRecord(memberId, options.planId, options.taskDate);
    } catch {
      return blankRecord(memberId, options.planId, options.taskDate);
    }
  });
  const [syncError, setSyncError] = useState(false);
  const [reminderScheduler] = useState(() => createReminderScheduler());
  const focusedRef = useRef(false);
  const awardCallbackRef = useRef(options.onAward);
  awardCallbackRef.current = options.onAward;
  const confirmedCallbackRef = useRef(options.onConfirmed);
  confirmedCallbackRef.current = options.onConfirmed;
  const awardSubscriptionRef = useRef<(() => void) | null>(null);
  const controllerRef = useRef<CompletionController | null>(null);

  const isSessionCurrent = useCallback(() => {
    if (!owner.memberId || !owner.sessionToken) return false;
    const current = getAuthSnapshot();
    if (current.epoch !== owner.authEpoch) return false;
    if (owner.memberId === fixtureProfile.memberId && fixtureMode && !auth.session) {
      return process.env.EXPO_PUBLIC_QINGMU_DEV_TOKEN?.trim() === owner.sessionToken;
    }
    const session: AuthSession = { memberId: owner.memberId, sessionToken: owner.sessionToken };
    return isCurrentAuthSession(session);
  }, [owner, fixtureMode, auth.session]);
  const isCurrent = useCallback(() => ownerRef.current === owner && isSessionCurrent(), [owner, isSessionCurrent]);

  const getRepository = () => {
    if (repositoryRef.current) return repositoryRef.current;
    if (!memberId) return null;
    try {
      repositoryRef.current = openQingmuRepository();
      return repositoryRef.current;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const repository = getRepository();
    clientRef.current = memberId && sessionToken
      ? createApiClient({
        baseUrl: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL?.trim() || 'http://127.0.0.1:8787',
        token: sessionToken,
        memberId,
      })
      : null;
    const current = repository?.get(identity);
    setRecord(current ?? blankRecord(identity.memberId, identity.planId, identity.taskDate));
    setSyncError(false);
    // The identity includes auth epoch so a same-member sign-out/sign-in cannot reuse a prior callback.
  }, [memberId, sessionToken, auth.epoch, options.planId, options.taskDate]);

  const dependenciesRef = useRef<CompletionControllerDependencies | null>(null);
  dependenciesRef.current = {
    identity,
    authEpoch: owner.authEpoch,
    canComplete: () => options.canComplete && isWithinCompletionWindow(owner.taskDate, taipeiDate()),
    isCurrent,
    isSessionCurrent,
    isVisible: () => focusedRef.current && AppState.currentState === 'active' && isCurrent(),
    hasPendingCompletion: () => getRepository()?.hasPendingCompletion(identity) ?? false,
    getRecord: () => getRepository()?.get(identity),
    saveCompletion: (command) => {
      const repository = getRepository();
      if (!repository) throw new Error('completion repository unavailable');
      return repository.saveCompletion(command);
    },
    flush: async (): Promise<SyncResult[]> => {
      const repository = getRepository();
      const client = clientRef.current;
      if (!repository || !client || !memberId) return [];
      return repository.flush((command) => client.saveCompletion(command), memberId);
    },
    onRecord: setRecord,
    onSyncError: setSyncError,
    onCommandSaved: (command) => syncReadingReminderForCompletion({
      memberId: command.memberId,
      planId: command.planId,
      taskDate: command.taskDate,
      status: command.desiredStatus,
      scheduler: reminderScheduler,
      store: SecureStore,
    }),
    confirmUndo: (message, onConfirm) => Alert.alert('撤銷完成', message, [
      { text: '取消', style: 'cancel' },
      { text: '撤銷', style: 'destructive', onPress: onConfirm },
    ]),
    generateOperationId: randomUUID,
  };
  if (!controllerRef.current) controllerRef.current = createCompletionController(() => dependenciesRef.current!);
  const controller = controllerRef.current;

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    const subscription = subscribeCompletionAwardSurface(
      identity,
      owner.authEpoch,
      () => focusedRef.current && AppState.currentState === 'active' && isCurrent(),
      (event) => {
        if (isCurrent()) awardCallbackRef.current?.(event);
      },
      (event) => {
        if (isCurrent()) confirmedCallbackRef.current?.(event);
      },
    );
    awardSubscriptionRef.current = subscription;
    const repository = getRepository();
    const current = repository?.get(identity);
    if (isCurrent() && current) setRecord(current);
    if (repository && memberId && clientRef.current) {
      void repository.flush((command) => clientRef.current!.saveCompletion(command), memberId).then((results) => {
        controller.observeFlushResults(results);
        if (!isCurrent()) return;
        const recovered = repository.get(identity);
        if (recovered) {
          setRecord(recovered);
          setSyncError(results.some((result) => !result.ok && !result.conflict) || recovered.syncStatus === 'SAVE_FAILED');
        }
      }).catch(() => { if (isCurrent()) setSyncError(true); });
    }
    return () => {
      focusedRef.current = false;
      subscription();
      if (awardSubscriptionRef.current === subscription) awardSubscriptionRef.current = null;
    };
  }, [memberId, options.planId, options.taskDate, owner, isCurrent, controller]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focusedRef.current && isCurrent()) {
        activateCompletionAwardSurface(identity, owner.authEpoch);
      }
    });
    return () => subscription.remove();
  }, [identity.memberId, identity.planId, identity.taskDate, owner.authEpoch, isCurrent]);

  const recoverySession: AuthSession | null = auth.session ?? (
    fixtureMode && sessionToken && memberId ? { memberId, sessionToken } : null
  );
  useOutboxRecovery({
    memberId,
    sessionToken,
    planId: options.planId,
    taskDate: options.taskDate,
    getRepository: () => repositoryRef.current,
    getClient: () => clientRef.current,
    getSession: () => recoverySession,
    isCurrentAuthSession: (session) => Boolean(session && session.memberId === owner.memberId && session.sessionToken === owner.sessionToken && isCurrent()),
    onRecovered: (results) => {
      controller.observeFlushResults(results);
      if (!isCurrent()) return;
      const recovered = getRepository()?.get(identity);
      if (!recovered) return;
      setRecord(recovered);
      setSyncError(results.some((result) => !result.ok && !result.conflict) || recovered.syncStatus === 'SAVE_FAILED');
    },
  });

  const matchingRecord = record.memberId === identity.memberId && record.planId === identity.planId && record.taskDate === identity.taskDate
    ? record
    : blankRecord(identity.memberId, identity.planId, identity.taskDate);
  const retryable = matchingRecord.syncStatus === 'SAVE_FAILED' && (getRepository()?.hasPendingCompletion(identity) ?? false);
  return {
    record: matchingRecord,
    pending: matchingRecord.syncStatus === 'PENDING_SAVE',
    syncError: record.memberId === identity.memberId && record.planId === identity.planId && record.taskDate === identity.taskDate && syncError,
    retryable,
    complete: () => controller.complete(),
    requestUndo: () => controller.requestUndo(),
  };
}
