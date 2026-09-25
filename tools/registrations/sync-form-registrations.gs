/**
 * 竹科聖經：團契報名表單 → App 公告頁「已報名人數、哪些朋友報名」
 *
 * 在光佑的 Google 帳號裡執行（script.google.com 新增專案，貼上本檔）。每 15 分鐘把最近
 * 120 天內修改過、標題含「報名」的表單回覆送到 App 後端。只讀「姓名」與「日期」兩題；
 * LINE ID、年級／年齡等其他題目不讀也不送。後端只保存對得上 App 成員的人與總人數。
 *
 * KEY 由後端的 session secret 衍生（server/eventRegistrations.ts deriveFormRegistrationKey），
 * 不寫進 git；本機 .handoff/registrations-20260925/ 有填好 KEY 的版本可直接貼上。
 * 第一次執行 install() 並按「允許」，之後自動每 15 分鐘同步。
 */
const ENDPOINT = 'https://api.luminexhealthbiohack.com/api/integrations/form-registrations';
const KEY = 'PASTE_KEY_HERE';

function install() {
  ScriptApp.getProjectTriggers().forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncRegistrations').timeBased().everyMinutes(15).create();
  syncRegistrations();
}

function syncRegistrations() {
  const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  const files = DriveApp.searchFiles(
    `mimeType = 'application/vnd.google-apps.form' and title contains '報名' and modifiedDate > '${since}' and trashed = false`);
  const responses = [];
  while (files.hasNext()) {
    const form = FormApp.openById(files.next().getId());
    const items = form.getItems();
    const nameItem = items.find((item) => /姓名/.test(item.getTitle()));
    const dateItem = items.find((item) => /日期/.test(item.getTitle()));
    if (!nameItem || !dateItem) continue;
    for (const response of form.getResponses()) {
      const name = response.getResponseForItem(nameItem);
      const dates = response.getResponseForItem(dateItem);
      if (!name || !dates) continue;
      const value = dates.getResponse();
      responses.push({
        name: String(name.getResponse()).slice(0, 80),
        dates: (Array.isArray(value) ? value : [value]).map((label) => String(label).slice(0, 200)),
      });
    }
  }
  const result = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-qingmu-registration-key': KEY },
    payload: JSON.stringify({ responses }),
  });
  console.log(result.getResponseCode(), result.getContentText().slice(0, 300));
}
