/**
 * 竹科聖經：團契報名表單 → App 公告頁「已報名人數、哪些朋友報名」
 *
 * 在光佑的 Google 帳號裡執行（script.google.com 新增專案，貼上本檔與 appsscript.json）。每 15 分鐘把
 * 最近 120 天內修改過、標題含「報名」的表單回覆送到 App 後端。只讀「姓名」與「日期」兩題；
 * LINE ID、年級／年齡等其他題目不讀也不送。後端只保存對得上 App 成員的人與總人數。
 *
 * 不放任何金鑰：每次送出都附上 Google 簽發的身分權杖（ScriptApp.getIdentityToken）。後端驗證簽章，
 * 確認權杖屬於管理者的 Google 帳號、而且來自這個專案（aud），才會接受。
 * 第一次：執行 showIdentity() 並按「允許」，把記錄裡的 aud 設進後端（QINGMU_FORM_SYNC_AUDIENCE）；
 * 再執行 install()，之後自動每 15 分鐘同步。
 */
const ENDPOINT = 'https://api.luminexhealthbiohack.com/api/integrations/form-registrations';

function install() {
  ScriptApp.getProjectTriggers().forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncRegistrations').timeBased().everyMinutes(15).create();
  syncRegistrations();
}

/** 印出本專案的 aud，以及帳號 ID 雜湊的前 16 碼（讓後端核對管理者，不印出帳號 ID 本身）。 */
function showIdentity() {
  const claims = identityClaims();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, claims.sub, Utilities.Charset.UTF_8);
  const hex = digest.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('');
  console.log(`aud=${claims.aud} sub16=${hex.slice(0, 16)}`);
}

function identityToken() {
  const token = ScriptApp.getIdentityToken();
  if (!token) throw new Error('拿不到身分權杖：appsscript.json 的 oauthScopes 要有 "openid"');
  return token;
}

function identityClaims() {
  const part = identityToken().split('.')[1];
  const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString());
}

/**
 * 表格題（青崇報名表的「參加日期」：每列是一個日期，欄是用餐／不用餐）的日期在列標題，
 * 那一列有作答就算報名那天；其他題型的答案本身就是日期。
 */
function chosenDates(item, answer) {
  const type = item.getType();
  if (type === FormApp.ItemType.GRID || type === FormApp.ItemType.CHECKBOX_GRID) {
    const rows = type === FormApp.ItemType.GRID ? item.asGridItem().getRows() : item.asCheckboxGridItem().getRows();
    return rows.filter((row, index) => (Array.isArray(answer[index]) ? answer[index].length > 0 : Boolean(answer[index])));
  }
  return (Array.isArray(answer) ? answer : [answer]).filter(Boolean);
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
      const chosen = chosenDates(dateItem, dates.getResponse());
      if (chosen.length === 0) continue;
      responses.push({
        name: String(name.getResponse()).slice(0, 80),
        dates: chosen.map((label) => String(label).slice(0, 200)),
      });
    }
  }
  const result = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${identityToken()}` },
    payload: JSON.stringify({ responses }),
  });
  console.log(result.getResponseCode(), result.getContentText().slice(0, 300));
}
