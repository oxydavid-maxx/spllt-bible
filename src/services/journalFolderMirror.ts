import type { ReaderPreferencesStorage } from './readerPreferences';
import { buildMirrorFile, decideMirrorWrite, mirrorFileName } from '../domain/journalMirror';

/**
 * Writes a copy of each journal entry into a folder the member picked.
 *
 * Off until someone turns it on, and invisible until then. For most people the journal simply lives
 * in the app; for someone who already keeps their thinking in a folder that syncs — a vault, a
 * notes app, anything backed by plain files — this drops the entry straight in as Markdown.
 *
 * It is a mirror and behaves like one. Writing never blocks or fails a journal save: the server has
 * already taken the entry, so a folder that has gone missing, been revoked, or filled up is an
 * inconvenience to report later, not a reason to lose what somebody just typed.
 *
 * Android hands out folder access one grant at a time and remembers it, so the picker appears once.
 * The granted address is stored per member, because two people sharing a phone should not share a
 * journal folder.
 */

export type MirrorWriteOutcome =
  | { ok: true; wrote: boolean }
  | { ok: false; reason: 'NO_FOLDER' | 'FOREIGN_FILE' | 'WRITE_FAILED' };

export interface JournalFolderMirror {
  folderUri(memberId: string | null): string | null;
  load(memberId: string | null): Promise<void>;
  /** Opens the system folder picker. Returns the chosen folder, or null if they backed out. */
  choose(memberId: string | null): Promise<string | null>;
  forget(memberId: string | null): Promise<void>;
  write(memberId: string | null, taskDate: string, body: string): Promise<MirrorWriteOutcome>;
}

function storageKey(memberId: string): string {
  const encoded = Array.from(memberId, (character) => character.codePointAt(0)!.toString(16)).join('_');
  return `qingmu.journal.folder.v1.m-${encoded || 'empty'}`;
}

/**
 * Loaded on demand from the LEGACY entry point, which is where this lives in SDK 56.
 *
 * `expo-file-system` now exports a new file API from its main entry, and folder access granted by
 * the user is not part of it — that is only under `expo-file-system/legacy`. Importing the main
 * entry gets a module with no StorageAccessFramework, and since choosing a folder fails softly by
 * design, the symptom is a picker that never opens and a message saying nothing was chosen.
 */
async function storageAccess() {
  const legacy = await import('expo-file-system/legacy');
  const saf = (legacy as unknown as { StorageAccessFramework?: Record<string, Function> }).StorageAccessFramework;
  if (!saf) throw new Error('STORAGE_ACCESS_UNAVAILABLE');
  return { saf, fileSystem: legacy as unknown as Record<string, Function> };
}

export function createJournalFolderMirror(storage: ReaderPreferencesStorage): JournalFolderMirror {
  const folders = new Map<string, string | null>();

  return {
    folderUri: (memberId) => (memberId ? folders.get(memberId) ?? null : null),

    async load(memberId) {
      if (!memberId || folders.has(memberId)) return;
      try { folders.set(memberId, await storage.getItem(storageKey(memberId))); }
      catch { folders.set(memberId, null); }
    },

    async choose(memberId) {
      if (!memberId) return null;
      try {
        const { saf } = await storageAccess();
        const permission = await saf.requestDirectoryPermissionsAsync!(null) as { granted: boolean; directoryUri: string };
        if (!permission?.granted) return null; // the member backed out of the picker
        folders.set(memberId, permission.directoryUri);
        await storage.setItem(storageKey(memberId), permission.directoryUri);
        return permission.directoryUri;
      } catch (error) {
        // Distinguishable in logcat: a missing API and a cancelled picker look identical otherwise.
        console.warn('[journal-mirror] folder picker failed', error);
        return null;
      }
    },

    async forget(memberId) {
      if (!memberId) return;
      folders.set(memberId, null);
      try { await storage.setItem(storageKey(memberId), ''); } catch { /* the in-memory value already stopped it */ }
    },

    async write(memberId, taskDate, body) {
      const folder = memberId ? folders.get(memberId) ?? null : null;
      if (!folder) return { ok: false, reason: 'NO_FOLDER' };
      try {
        const { saf, fileSystem } = await storageAccess();
        const wanted = mirrorFileName(taskDate);
        const existingUris = await saf.readDirectoryAsync!(folder) as string[];
        const match = existingUris.find((uri) => decodeURIComponent(uri).endsWith(`/${wanted}`));

        let existingContents: string | null = null;
        if (match) {
          try { existingContents = await fileSystem.readAsStringAsync!(match) as string; }
          catch { existingContents = ''; } // unreadable counts as somebody else's; never clobber it
        }

        const decision = decideMirrorWrite(existingContents);
        if (decision.action === 'skip') return { ok: false, reason: 'FOREIGN_FILE' };

        const file = buildMirrorFile(taskDate, body);
        const target = match ?? (await saf.createFileAsync!(folder, taskDate, 'text/markdown') as string);
        await fileSystem.writeAsStringAsync!(target, file.contents);
        return { ok: true, wrote: true };
      } catch {
        // A revoked grant, a removed SD card, a full disk. The entry is already safe on the server.
        return { ok: false, reason: 'WRITE_FAILED' };
      }
    },
  };
}
