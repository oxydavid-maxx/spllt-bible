// scriptureReference.ts
// App 自有的經文顯示格式化器:把 USFM 識別碼轉成台灣教會慣用的繁體中文簡寫。
//
// 使用者 2026-09-11 的明確要求:顯示面統一用中文簡寫 (詩88、詩89 / 約3:16 / 林前13:4-7 / 太5:1-12)。
//
// 為什麼集中在這一支檔案:
//   USFM、API、資料庫、同步與深連結識別必須保持原值,只有「顯示」才改。各畫面若各自硬寫
//   轉換,遲早會有一處漏掉而在畫面上露出英文書卷碼,或更糟,把轉換後的字串回寫成識別碼而
//   破壞章節對應。所以轉換只有這一個產生處,呼叫端一律傳入原始識別碼、拿到顯示字串,
//   永不反向。
//
// 為什麼不直接用 SDK 的 abbreviation:
//   @youversion/platform-core 的 BibleBookSchema.abbreviation 範例是 "Gen",且書卷標題隨
//   版本語言而來,需要一次 getBooks 網路呼叫。今日讀經卡要能離線立即顯示,而且本輪要求的是
//   台灣教會慣用簡寫,與譯本自帶縮寫不一定相同。因此這份對照表是 App 自有的;官方 Reader
//   內部的本地化仍走它自己的正式設定,這裡不碰 vendor code。

/** USFM 書卷代碼 → 台灣教會慣用繁體中文簡寫。66 卷齊全。 */
export const ZH_TW_BOOK_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  // 舊約 39 卷
  GEN: '創', EXO: '出', LEV: '利', NUM: '民', DEU: '申',
  JOS: '書', JDG: '士', RUT: '得',
  '1SA': '撒上', '2SA': '撒下', '1KI': '王上', '2KI': '王下',
  '1CH': '代上', '2CH': '代下',
  EZR: '拉', NEH: '尼', EST: '斯', JOB: '伯', PSA: '詩',
  PRO: '箴', ECC: '傳', SNG: '歌', ISA: '賽', JER: '耶',
  LAM: '哀', EZK: '結', DAN: '但', HOS: '何', JOL: '珥',
  AMO: '摩', OBA: '俄', JON: '拿', MIC: '彌', NAM: '鴻',
  HAB: '哈', ZEP: '番', HAG: '該', ZEC: '亞', MAL: '瑪',
  // 新約 27 卷
  MAT: '太', MRK: '可', LUK: '路', JHN: '約', ACT: '徒',
  ROM: '羅', '1CO': '林前', '2CO': '林後', GAL: '加', EPH: '弗',
  PHP: '腓', COL: '西', '1TH': '帖前', '2TH': '帖後',
  '1TI': '提前', '2TI': '提後', TIT: '多', PHM: '門', HEB: '來',
  JAS: '雅', '1PE': '彼前', '2PE': '彼後',
  '1JN': '約一', '2JN': '約二', '3JN': '約三',
  JUD: '猶', REV: '啟',
});

/** 單一書卷的中文簡寫;不認識就回 undefined,絕不臆造書卷名。 */
export function bookAbbreviationZhTw(bookUsfm: string): string | undefined {
  if (!bookUsfm) return undefined;
  return ZH_TW_BOOK_ABBREVIATIONS[bookUsfm.toUpperCase()];
}

/**
 * 把一個 USFM 參照轉成顯示字串。
 *   PSA.88      → 詩88
 *   JHN.3.16    → 約3:16
 *   1CO.13.4-7  → 林前13:4-7
 *   PSA         → 詩
 * 不認識的書卷原樣回傳 —— 寧可顯示原始識別碼讓人看得出哪裡沒對照到,
 * 也不要編一個看起來合理但錯誤的書卷名。輸入永不被修改。
 */
export function formatReferenceZhTw(reference: string): string {
  if (!reference || !reference.trim()) return reference;
  const parts = reference.split('.');
  const abbrev = bookAbbreviationZhTw(parts[0]);
  if (!abbrev) return reference;
  if (parts.length === 1) return abbrev;
  const chapter = parts[1];
  if (parts.length === 2) return `${abbrev}${chapter}`;
  // 第三段可能是單節或範圍 (4-7),原樣保留,只換分隔符為冒號
  const verses = parts.slice(2).join('.');
  return `${abbrev}${chapter}:${verses}`;
}

/** 多個參照的顯示字串,用全角頓號連接,與今日讀經卡一致。 */
export function formatReferenceListZhTw(references: readonly string[]): string {
  if (!references || references.length === 0) return '';
  return references.map(formatReferenceZhTw).join('、');
}
