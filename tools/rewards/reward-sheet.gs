/**
 * 竹科聖經：獎品與兌換（Google 試算表）→ App 的獎品清單、可兌換積分、我的領取紀錄
 *
 * 一份試算表四個分頁：青少獎品、青少兌換、主堂獎品、主堂兌換。獎品分頁三欄：獎品、分數、上架；兌換分頁五欄：
 * 日期、名字、獎品、分數、照片連結。可兌換積分＝讀經積分減掉兌換分頁每一列的分數；刪掉那一列，分數就回來。
 * 「名單」分頁是名字下拉選單的來源，由 App 自動更新，所以藏起來。兌換分頁第 1 列是說明，第 2 列是欄名。
 * 名字和獎品用下拉選單選；分數照填，不自動帶入，看到什麼就是什麼 (維護者 2026-10-17 核准的 mock)。
 *
 * 放在「團契報名表單」同一個 Apps Script 專案裡（新增一個檔案，貼上本檔），沿用那邊的 identityToken()：
 * 每次送出都附上 Google 簽發的身分權杖，後端確認是管理者的帳號、而且來自同一個專案，才會接受。不放任何金鑰。
 *
 * 第一次：在雲端硬碟「青少處」資料夾建一份空白試算表，名稱「竹科聖經 獎品與兌換」；執行 setupRewardSheet()
 * 並按「允許」。之後有人改試算表就會送出，另外每 15 分鐘也送一次。
 *
 * 「青少讀經統計」「主堂讀經統計」由 App 每次送出後整頁重寫，只有「管理者」那一欄是人填的 (光佑 2026-10-21)：
 * 打勾的人在 App 裡就是管理者，取消就撤銷。重寫時用名字把每個勾放回去 (列會照積分重排)，寫之前再讀一次，
 * 所以剛剛才打的勾也不會被蓋掉，下一次送出就生效。App 後端私人設定的管理者一直打勾，在這裡取消不會撤銷。
 */
const REWARD_ENDPOINT = 'https://api.luminexhealthbiohack.com/api/integrations/reward-sheet';
const REWARD_SHEET_TITLE = '竹科聖經 獎品與兌換';
const REWARD_SHEET_ID_KEY = 'REWARD_SHEET_ID';
const REWARD_MARKS_KEY = 'REWARD_SHEET_MARKS';
const REWARD_SIDES = [
  { key: 'youth', name: '青少', rewards: '青少獎品', redemptions: '青少兌換', roster: 'A' },
  { key: 'main', name: '主堂', rewards: '主堂獎品', redemptions: '主堂兌換', roster: 'B' },
];
const REWARD_ROSTER = '名單';
const REWARD_TAB_HEADERS = ['獎品', '分數', '上架'];
const REDEMPTION_TAB_HEADERS = ['日期', '名字', '獎品', '分數', '照片連結 (可不填)'];
const REDEMPTION_NOTE = '可以換的分數 ＝ 讀經得分 − 這一頁裡這個人每一列的分數。填錯就直接改或刪那一列。';
const READING_STATS_HEADERS = ['名字', '每月讀經天數', '總積分', '可以換的分數', '最後一次讀經', '管理者', '手機', '版本', '最後打開'];
const READING_STATS_NOTE = '這一頁由程式每 15 分鐘自動更新，在這裡改的內容會被蓋掉。只有「管理者」的勾會留著：打勾的人在 App 裡就是管理者，取消就撤銷。';
const READING_STATS_ADMIN = '管理者';
const READING_STATS_OWNER_NOTE = '這位管理者由 App 後端的私人設定指定，在這裡取消不會撤銷。';
const REWARD_REJECTED_COLOR = '#fde7e7';
const REWARD_REJECTION_NOTES = {
  rewards: { name: '請填獎品名稱。', points: '分數要是大於 0 的整數，這個獎品沒有放上 App。', duplicate: '這個獎品名稱重複了，App 只用第一個。' },
  redemptions: {
    name: 'App 找不到這個名字，這一列沒有扣分。請從下拉選單選名字。',
    date: '日期看不懂，這一列沒有扣分。',
    points: '分數要是大於 0 的整數，這一列沒有扣分。',
    reward: '請填獎品，這一列沒有扣分。',
  },
};
// The column a rejected field is noted on.
const REWARD_REJECTION_COLUMN = { rewards: { name: 1, points: 2, duplicate: 1 }, redemptions: { date: 1, name: 2, reward: 3, points: 4 } };

/** 第一次執行：整理分頁和下拉選單、把 App 裡原本的獎品抄進「青少獎品」、裝好自動送出。可以重複執行。 */
function setupRewardSheet() {
  const files = DriveApp.searchFiles(`title = '${REWARD_SHEET_TITLE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
  const found = [];
  while (files.hasNext()) found.push(files.next());
  if (found.length !== 1) throw new Error(`雲端硬碟裡要剛好有一份「${REWARD_SHEET_TITLE}」，現在有 ${found.length} 份`);
  const book = SpreadsheetApp.openById(found[0].getId());
  PropertiesService.getScriptProperties().setProperty(REWARD_SHEET_ID_KEY, book.getId());

  const roster = book.getSheetByName(REWARD_ROSTER) || book.insertSheet(REWARD_ROSTER);
  roster.getRange(1, 1, 1, 2).setValues([['青少', '主堂']]).setFontWeight('bold');
  for (const side of REWARD_SIDES) {
    const rewards = rewardTab(book, side.rewards, REWARD_TAB_HEADERS);
    rewards.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false).setHelpText('分數要大於 0').build());
    rewards.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    const redemptions = rewardTab(book, side.redemptions, REDEMPTION_TAB_HEADERS, REDEMPTION_NOTE);
    redemptions.getRange('A3:A').setNumberFormat('yyyy-mm-dd')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('日期，例如 2026-10-12').build());
    redemptions.getRange('B3:B').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInRange(roster.getRange(`${side.roster}2:${side.roster}`), true).setAllowInvalid(false).setHelpText('從清單選名字').build());
    redemptions.getRange('C3:C').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInRange(rewards.getRange('A2:A'), true).setAllowInvalid(true).build());
    redemptions.getRange('D3:D').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false).setHelpText('分數要大於 0').build());
  }
  // A new spreadsheet comes with one empty tab; it has no job here.
  for (const sheet of book.getSheets()) {
    const known = sheet.getName() === REWARD_ROSTER || REWARD_SIDES.some((side) => sheet.getName() === side.rewards || sheet.getName() === side.redemptions);
    if (!known && sheet.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(sheet);
  }
  roster.hideSheet();

  // Ask first, change nothing: the prizes set up in the app go into 青少獎品 only if it is still empty.
  const first = postRewardSheet({});
  writeRewardRoster(book, first.labels);
  const youthRewards = book.getSheetByName(REWARD_SIDES[0].rewards);
  const hasYouthRewards = youthRewards.getRange('A2:A').getValues().some((row) => rewardCellText(row[0]) !== '');
  if (!hasYouthRewards && first.legacyRewards.length) {
    youthRewards.getRange(2, 1, first.legacyRewards.length, 3).setValues(first.legacyRewards.map((reward) => [reward.name, reward.points, true]));
  }

  ScriptApp.getProjectTriggers()
    .filter((trigger) => ['syncRewardSheet', 'onRewardSheetEdit', 'onRewardSheetChange'].includes(trigger.getHandlerFunction()))
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('onRewardSheetEdit').forSpreadsheet(book).onEdit().create();
  ScriptApp.newTrigger('onRewardSheetChange').forSpreadsheet(book).onChange().create();
  ScriptApp.newTrigger('syncRewardSheet').timeBased().everyMinutes(15).create();
  syncRewardSheet();
}

/** A tab's headers, with an optional note line above them. */
function rewardTab(book, name, headers, note) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  const headerRow = note ? 2 : 1;
  if (note) sheet.getRange(1, 1, 1, headers.length).merge().setValue(note).setBackground('#fffbe6').setWrap(true);
  sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(headerRow);
  return sheet;
}

/** 有人改了一格就送出。不自動帶入任何值：表上看到什麼就是什麼。 */
function onRewardSheetEdit() {
  syncRewardSheet();
}

/** 刪掉一列不算「編輯」，要另外接住；一般編輯已經由 onRewardSheetEdit 送過。 */
function onRewardSheetChange(e) {
  if (e && e.changeType === 'EDIT') return;
  syncRewardSheet();
}

function syncRewardSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const id = PropertiesService.getScriptProperties().getProperty(REWARD_SHEET_ID_KEY);
    if (!id) throw new Error('還沒執行 setupRewardSheet()');
    const book = SpreadsheetApp.openById(id);
    const push = {};
    for (const side of REWARD_SIDES) push[side.key] = { rewards: readRewardRows(book.getSheetByName(side.rewards)), redemptions: readRedemptionRows(book.getSheetByName(side.redemptions)) };
    // 還沒有「管理者」欄的分頁 (舊版面) 不送，後端就不改任何管理者。
    const admins = readRewardAdminMarks(book);
    if (admins) push.admins = admins;
    const result = postRewardSheet(push);
    writeRewardRoster(book, result.labels);
    markRewardRejections(book, result.rejected);
    writeRewardReadingStats(book, result.readingStats);
  } finally {
    lock.releaseLock();
  }
}

function rewardDataRows(sheet, width, firstRow) {
  const last = sheet.getLastRow();
  if (last < firstRow) return [];
  return sheet.getRange(firstRow, 1, last - firstRow + 1, width).getValues()
    .map((cells, index) => ({ row: index + firstRow, cells }))
    .filter((item) => item.cells.some((cell) => cell !== '' && cell !== false));
}

const rewardCellText = (value) => String(value === null || value === undefined ? '' : value).trim().slice(0, 100);
const rewardCellPoints = (value) => (typeof value === 'number' ? value : rewardCellText(value));

function readRewardRows(sheet) {
  return rewardDataRows(sheet, 3, 2).map(({ row, cells }) => ({ row, name: rewardCellText(cells[0]), points: rewardCellPoints(cells[1]), listed: cells[2] === true }));
}

function readRedemptionRows(sheet) {
  return rewardDataRows(sheet, 4, 3).map(({ row, cells }) => ({
    row,
    date: cells[0] instanceof Date ? Utilities.formatDate(cells[0], 'Asia/Taipei', 'yyyy-MM-dd') : rewardCellText(cells[0]),
    name: rewardCellText(cells[1]),
    reward: rewardCellText(cells[2]),
    points: rewardCellPoints(cells[3]),
  }));
}

function postRewardSheet(push) {
  const response = UrlFetchApp.fetch(REWARD_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${identityToken()}` },
    payload: JSON.stringify(push),
  });
  if (response.getResponseCode() !== 200) throw new Error(`App 後端沒有收下：${response.getResponseCode()} ${response.getContentText().slice(0, 200)}`);
  return JSON.parse(response.getContentText());
}

const rewardStatsTab = (side) => `${side.name}讀經統計`;

/**
 * 兩頁「讀經統計」上每個名字和它的「管理者」勾。兩頁都還沒有這一欄 (舊版面、還沒建) 時回 null：不送，後端不改。
 * 欄位用第 2 列的欄名找，不靠固定位置。
 */
function readRewardAdminMarks(book) {
  let marks = null;
  for (const side of REWARD_SIDES) {
    const sheet = book.getSheetByName(rewardStatsTab(side));
    if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) continue;
    const width = sheet.getLastColumn();
    const headers = sheet.getRange(2, 1, 1, width).getValues()[0].map(rewardCellText);
    const nameColumn = headers.indexOf(READING_STATS_HEADERS[0]);
    const adminColumn = headers.indexOf(READING_STATS_ADMIN);
    if (nameColumn < 0 || adminColumn < 0) continue;
    marks = marks || [];
    if (sheet.getLastRow() < 3) continue;
    for (const cells of sheet.getRange(3, 1, sheet.getLastRow() - 2, width).getValues()) {
      const name = rewardCellText(cells[nameColumn]);
      if (name) marks.push({ name, admin: cells[adminColumn] === true });
    }
  }
  return marks;
}

/**
 * 舊後端沒有統計就跳過；有資料時整頁重寫，避免會員停用或轉堂後殘留舊列。「管理者」欄是人填的：寫之前再讀一次
 * 兩頁的勾，用名字放回去 (送出之後才打的勾也留著)；表上還沒有的人用後端的答案；私人設定的管理者一直打勾。
 */
function writeRewardReadingStats(book, stats) {
  if (!stats) return;
  const checks = new Map((readRewardAdminMarks(book) || []).map((mark) => [mark.name, mark.admin]));
  const adminColumn = READING_STATS_HEADERS.indexOf(READING_STATS_ADMIN) + 1;
  for (const side of REWARD_SIDES) {
    const rows = stats[side.key];
    if (!Array.isArray(rows)) continue;
    const name = rewardStatsTab(side);
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    sheet.clearContents();
    if (sheet.getMaxRows() < rows.length + 2) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 2 - sheet.getMaxRows());
    // No empty checkbox or old note is left on a row that no longer has a person.
    if (sheet.getMaxRows() > 2) sheet.getRange(3, 1, sheet.getMaxRows() - 2, READING_STATS_HEADERS.length).removeCheckboxes().clearNote();
    sheet.getRange(1, 1, 1, READING_STATS_HEADERS.length).breakApart();
    rewardTab(book, name, READING_STATS_HEADERS, READING_STATS_NOTE);
    if (!rows.length) continue;
    // Keep labels, the compact monthly text, YYYYMMDD (weekday) and the version as literal text.
    sheet.getRange(3, 1, rows.length, 2).setNumberFormat('@');
    sheet.getRange(3, 5, rows.length, 1).setNumberFormat('@');
    sheet.getRange(3, adminColumn + 1, rows.length, 3).setNumberFormat('@');
    sheet.getRange(3, adminColumn, rows.length, 1).insertCheckboxes();
    // newLabel: 後端剛把這個名字給了新的人 (例如刪除帳號的人空出來的名字)，表上同名的勾是前一個人的，不沿用。
    const admin = (row) => (row.adminFromSettings === true ? true : checks.has(row.name) && row.newLabel !== true ? checks.get(row.name) : row.admin === true);
    sheet.getRange(3, 1, rows.length, READING_STATS_HEADERS.length).setValues(rows.map((row) => [
      row.name, row.monthlyReadingDays, row.earnedTotal, row.redeemableBalance, row.lastReadingDate,
      admin(row), row.phone || '', row.version || '', row.lastOpened || '',
    ]));
    rows.forEach((row, index) => { if (row.adminFromSettings === true) sheet.getRange(3 + index, adminColumn).setNote(READING_STATS_OWNER_NOTE); });
  }
}

function writeRewardRoster(book, labels) {
  const roster = book.getSheetByName(REWARD_ROSTER);
  const height = Math.max(labels.youth.length, labels.main.length, 1);
  roster.getRange(2, 1, Math.max(roster.getMaxRows() - 1, 1), 2).clearContent();
  if (roster.getMaxRows() < height + 1) roster.insertRowsAfter(roster.getMaxRows(), height + 1 - roster.getMaxRows());
  roster.getRange(2, 1, height, 2).setValues(Array.from({ length: height }, (_, index) => [labels.youth[index] || '', labels.main[index] || '']));
}

/**
 * 沒算進 App 的格子塗淡紅色、加上說明；改好之後下一次送出就會清掉。只清自己上次標的格子，同工自己的顏色和備註不動。
 */
function markRewardRejections(book, rejected) {
  const properties = PropertiesService.getScriptProperties();
  for (const mark of JSON.parse(properties.getProperty(REWARD_MARKS_KEY) || '[]')) {
    const sheet = book.getSheetByName(mark.sheet);
    if (sheet) sheet.getRange(mark.a1).setBackground(null).clearNote();
  }
  const marks = [];
  for (const item of rejected) {
    const side = REWARD_SIDES.find((entry) => entry.key === item.side);
    const sheet = side && book.getSheetByName(item.tab === 'rewards' ? side.rewards : side.redemptions);
    const column = REWARD_REJECTION_COLUMN[item.tab] && REWARD_REJECTION_COLUMN[item.tab][item.field];
    if (!sheet || !column) continue;
    const cell = sheet.getRange(item.row, column);
    cell.setBackground(REWARD_REJECTED_COLOR).setNote(REWARD_REJECTION_NOTES[item.tab][item.field]);
    marks.push({ sheet: sheet.getName(), a1: cell.getA1Notation() });
  }
  properties.setProperty(REWARD_MARKS_KEY, JSON.stringify(marks));
}
