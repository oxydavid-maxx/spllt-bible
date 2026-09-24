import { useCallback, useEffect, useRef, useState } from 'react';
import { openQingmuJournalStore } from '../storage/mobileDatabase';
import type { JournalRecord, JournalSyncStatus } from '../storage/journalStore';

/**
 * Owns one day's journal entry: load, debounce, save, and the guards that stop text being lost.
 *
 * Call this INSIDE the panel that renders the text box, never in the reader screen above it. The
 * typing state lives wherever this hook is called, and the reader must not re-render on every
 * keystroke — a chapter is a WebView, and repainting it while someone writes is the difference
 * between a box that feels instant and one that stutters.
 *
 * Two guards are carried over from the reading card, because losing a day's writing is the one
 * failure this feature cannot survive:
 *
 *   - An ownership check, so a slow load that resolves after the member switched day or account is
 *     discarded instead of pasted over what they have since typed.
 *   - A visible-entry re-derivation, so a mismatched key renders blank rather than showing
 *     yesterday's text under today's heading for a frame.
 */

const SAVE_DEBOUNCE_MS = 2_000;

export interface JournalEntryView {
  ready: boolean;
  body: string;
  syncStatus: JournalSyncStatus;
  /** Another device wrote this day. The local text is kept and nothing is overwritten silently. */
  conflict: boolean;
  setBody: (next: string) => void;
  /** Append a verse the member copied out of the reader, on its own line. */
  appendQuote: (quote: string) => void;
  /** Persist immediately: closing the panel, changing day, or the app going to the background. */
  flushNow: () => void;
  /** Send the local text even though the server moved on, after the member says so. */
  resolveConflict: () => void;
}

export interface JournalEntryOptions {
  memberId: string | null;
  planId: string;
  taskDate: string;
  newOperationId: () => string;
  /** Injectable for tests; defaults to the shared device store. */
  openStore?: typeof openQingmuJournalStore;
  /**
   * Optional copy into a folder the member picked. Best effort by definition: the entry is already
   * in the local store and on its way to the server before this runs, so a folder that has gone
   * away must never cost somebody their writing.
   */
  mirror?: (taskDate: string, body: string) => void;
}

const blank = (memberId: string, planId: string, taskDate: string): JournalRecord => ({
  memberId, planId, taskDate, body: '', revision: 0, syncStatus: 'CONFIRMED', updatedAt: '',
});

export function useJournalEntry(options: JournalEntryOptions): JournalEntryView {
  const { memberId, planId, taskDate } = options;
  // Callers pass these as inline lambdas, which is the natural way to write the call site. Holding
  // them in a ref keeps them out of every dependency array: a fresh function identity on each render
  // would otherwise re-run the load effect, which sets state, which renders again, forever.
  const latest = useRef({ newOperationId: options.newOperationId, openStore: options.openStore ?? openQingmuJournalStore, mirror: options.mirror });
  latest.current = { newOperationId: options.newOperationId, openStore: options.openStore ?? openQingmuJournalStore, mirror: options.mirror };

  const ownerRef = useRef({ memberId, taskDate });
  if (ownerRef.current.memberId !== memberId || ownerRef.current.taskDate !== taskDate) {
    ownerRef.current = { memberId, taskDate };
  }
  const owner = ownerRef.current;
  const owns = () => ownerRef.current === owner;

  const [record, setRecord] = useState<JournalRecord | null>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const persistedDraftRef = useRef<{ owner: typeof owner; body: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((force = false) => {
    if (!memberId) return;
    const body = draftRef.current;
    if (!force && persistedDraftRef.current?.owner === owner && persistedDraftRef.current.body === body) return;
    const saved = latest.current.openStore().save({
      memberId, planId, taskDate, body, operationId: latest.current.newOperationId(), expectedRevision: 0,
    });
    persistedDraftRef.current = { owner, body };
    if (owns()) setRecord(saved);
    // After the local store has it, never before: the mirror is a copy of something already safe.
    try { latest.current.mirror?.(taskDate, body); } catch { /* a copy failing is not a save failing */ }
  }, [memberId, planId, taskDate, owner]);

  const cancelPending = () => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  // Load whenever the day or the member changes, and write out whatever was typed for the day we
  // are leaving. The cleanup runs before the next load, so the flush always belongs to the old day.
  useEffect(() => {
    if (!memberId) { setRecord(null); setDraft(''); draftRef.current = ''; persistedDraftRef.current = { owner, body: '' }; return undefined; }
    const store = latest.current.openStore();
    const stored = store.get({ memberId, taskDate }) ?? blank(memberId, planId, taskDate);
    setRecord(stored);
    setDraft(stored.body);
    draftRef.current = stored.body;
    persistedDraftRef.current = { owner, body: stored.body };
    return () => {
      cancelPending();
      // Leaving with unsaved keystrokes is exactly how a debounce loses a day's writing.
      const lastSaved = persistedDraftRef.current?.owner === owner ? persistedDraftRef.current.body : stored.body;
      if (draftRef.current !== lastSaved) {
        const body = draftRef.current;
        store.save({ memberId, planId, taskDate, body, operationId: latest.current.newOperationId(), expectedRevision: 0 });
        persistedDraftRef.current = { owner, body };
        try { latest.current.mirror?.(taskDate, body); } catch { /* see above */ }
      }
    };
  }, [memberId, planId, taskDate]);

  const setBody = useCallback((next: string) => {
    draftRef.current = next;
    setDraft(next);
    cancelPending();
    timerRef.current = setTimeout(() => { timerRef.current = null; persist(); }, SAVE_DEBOUNCE_MS);
  }, [persist]);

  const appendQuote = useCallback((quote: string) => {
    const separator = draftRef.current.length > 0 && !draftRef.current.endsWith('\n') ? '\n' : '';
    setBody(`${draftRef.current}${separator}${quote}\n`);
  }, [setBody]);

  const flushNow = useCallback(() => { cancelPending(); persist(); }, [persist]);
  const resolveConflict = useCallback(() => { cancelPending(); persist(true); }, [persist]);

  // A record whose key does not match the current selection is stale by definition: render blank.
  const visible = record && memberId && record.memberId === memberId && record.taskDate === taskDate
    ? record
    : null;

  return {
    ready: visible !== null,
    body: draft,
    syncStatus: visible?.syncStatus ?? 'CONFIRMED',
    conflict: visible?.syncStatus === 'SAVE_FAILED',
    setBody,
    appendQuote,
    flushNow,
    resolveConflict,
  };
}
