import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Play compares the Data safety form with the privacy policy; the form is filled from docs/play/app-content.md.
// What expo-updates really sends (EAS-Client-ID on every check, Expo-Fatal-Error after a failed launch:
// node_modules/expo-updates/android/.../loader/FileDownloader.kt) has to appear in both.
const safetyTable = (markdown: string) => markdown.slice(markdown.indexOf('## 資料安全表單'));
const row = (table: string, type: string) => table.split(/\r?\n/).find((line) => line.startsWith(`| ${type}`)) ?? '';

describe('Play Data safety matches the privacy policy for EAS Update', () => {
  const policy = readFileSync('docs/play/privacy-policy.md', 'utf8');
  const table = safetyTable(readFileSync('docs/play/app-content.md', 'utf8'));
  it('the privacy policy still discloses both items this check is about', () => {
    expect(policy).toContain('安裝識別碼');
    expect(policy).toContain('啟動錯誤紀錄');
  });
  it('declares the install identifier under device or other IDs as required, for app functionality', () => {
    const ids = row(table, '裝置或其他 ID');
    expect(ids).toContain('安裝識別碼');
    expect(ids.split('|')[5]).toContain('必要');
  });
  // 光佑 2026-10-21: the app now tells its own server its version, build, running update, a random installation
  // id and the day it was opened (src/services/clientInfo.ts, server/clientInstalls.ts).
  it('declares the version log in both, and its deletion with the account', () => {
    expect(policy).toContain('App 版本紀錄');
    expect(policy).toMatch(/刪除[^。]*App 版本紀錄/);
    expect(row(table, '應用程式資訊和效能 → 其他應用程式效能資料')).toContain('App 版本');
    expect(row(table, '應用程式活動 → 應用程式互動')).toContain('最後打開');
    expect(row(table, '裝置或其他 ID')).toContain('記錄版本');
  });
  it('declares the startup error log as crash logs', () => {
    const crash = row(table, '應用程式資訊和效能 → 當機記錄');
    expect(crash).toContain('expo-updates');
    expect(crash.split('|')[2].trim()).toBe('是');
  });
});
