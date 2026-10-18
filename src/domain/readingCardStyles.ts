/** Approved 2026-10-18 mock CSS, scaled from its 640px canvas to A4. No external assets. */
export const READING_CARD_CSS = `
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; }
p { margin: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.paper { width: 210mm; aspect-ratio: 210 / 297; box-sizing: border-box; display: grid; align-content: start;
  font-family: "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif; color: #111;
  background:
    radial-gradient(ellipse 34% 12% at 50% 2%, rgba(255,255,255,.95), rgba(255,255,255,0) 70%),
    radial-gradient(ellipse 30% 8% at 20% 9%, rgba(255,255,255,.7), rgba(255,255,255,0) 70%),
    radial-gradient(ellipse 28% 8% at 82% 12%, rgba(255,255,255,.6), rgba(255,255,255,0) 70%),
    radial-gradient(ellipse 40% 10% at 12% 55%, rgba(255,255,255,.6), rgba(255,255,255,0) 70%),
    radial-gradient(ellipse 36% 9% at 90% 60%, rgba(255,255,255,.55), rgba(255,255,255,0) 70%),
    radial-gradient(ellipse 45% 9% at 50% 99%, rgba(255,255,255,.55), rgba(255,255,255,0) 70%),
    linear-gradient(180deg, #4f86c2 0%, #7fb0de 30%, #a9cbea 55%, #7fb0de 80%, #4f86c2 100%); }
table.month { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; border: 0.65625mm solid #222; box-shadow: 0 0 0 1.3125mm #fff; }
.month th.title { position: relative; font-weight: 800; border-bottom: 0.492188mm solid #222; }
.month th.title em { position: absolute; right: 2.625mm; font-style: normal; font-weight: 700; color: #444; }
.month tr.dow th { background: #d9d9d9; font-weight: 800; border: 0.492188mm solid #222; letter-spacing: .02em; }
.month td.day { border: 0.492188mm solid #222; padding: 0; position: relative; }
.day .n { position: absolute; left: 0; top: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #e3191b; font-weight: 800; border-right: 0.328125mm solid #222; gap: 0.65625mm; }
.day .dv { writing-mode: vertical-rl; font-weight: 800; color: #7a5a00; background: #f6e6b8; border-radius: 0.65625mm; padding: 0.328125mm 0; letter-spacing: 0.328125mm; }
.day .rows { display: grid; grid-template-rows: repeat(3, 1fr); height: 100%; }
.day .r { display: grid; border-bottom: 0.328125mm solid #222; min-height: 0; }
.day .r:last-child { border-bottom: 0; }
.day .r i { border-right: 0.328125mm solid #222; font-style: normal; display: flex; align-items: center; justify-content: center; color: #d6191b; font-weight: 900; line-height: 1; }
.day .r i.box { background: #fffbcc; }
.day .r b { display: flex; align-items: center; justify-content: center; font-weight: 800; white-space: nowrap; overflow: hidden; letter-spacing: -.01em; }
.notes { display: grid; gap: 1.640625mm; padding-left: 8.53125mm; }
.notes p { position: relative; color: #fff; font-weight: 800; text-shadow: 0 0.328125mm 0.65625mm rgba(0,0,0,.35); }
.notes p::before { content: ""; position: absolute; left: -7.21875mm; top: .35em; width: 0; height: 0; border-left: 4.265625mm solid #f7c11e; border-top: 1.96875mm solid transparent; border-bottom: 1.96875mm solid transparent; filter: drop-shadow(-0.984375mm 0 0 #e63323); }
.notes .tick { color: #e3191b; }
.sum { background: #fff; border: 0.65625mm solid #222; box-shadow: 0 0 0 1.3125mm #fff; display: flex; justify-content: space-between; align-items: center; gap: 3.28125mm; padding: 1.96875mm 3.28125mm; }
.sum b { font-size: 4.59375mm; white-space: nowrap; }
.sum span { font-size: 3.9375mm; text-align: right; }
.sum strong { color: #e3191b; font-size: 4.921875mm; }
.sum .ok { display: inline-block; margin-left: 1.96875mm; padding: 0.328125mm 2.625mm; border-radius: 327.796875mm; background: #e7f4ea; color: #1f6b3a; font-weight: 800; font-size: 3.9375mm; }

/* 本月: one month, big cells */
.paper.one { padding: 13.125mm 7.21875mm 8.53125mm; gap: 7.21875mm; }
.one .month th.title { font-size: 4.921875mm; padding: 1.96875mm; }
.one .month th.title em { font-size: 4.265625mm; top: 2.296875mm; }
.one .month tr.dow th { font-size: 3.9375mm; padding: 0.984375mm 0; }
.one .month td.day { height: 35.4375mm; }
.one .day .n { width: 6.234375mm; font-size: 4.921875mm; }
.one .day .dv { font-size: 2.953125mm; }
.one .day .rows { margin-left: 6.234375mm; }
.one .day .r { grid-template-columns: 5.25mm 1fr; }
.one .day .r i { font-size: 5.25mm; }
.one .day .r b { font-size: 3.609375mm; white-space: normal; word-break: break-all; line-height: 1.1; text-align: center; padding: 0 0.328125mm; }
.one .notes p { font-size: 4.921875mm; }
.one .notes .tick { font-size: 5.90625mm; }

/* 本季: three months on one page, small cells, gift check on top */
.paper.quarter { padding: 7.21875mm 5.25mm 5.25mm; gap: 3.28125mm; }
.quarter .month th.title { font-size: 3.773438mm; padding: 0.65625mm; }
.quarter .month th.title em { font-size: 3.28125mm; top: 0.65625mm; }
.quarter .month tr.dow th { font-size: 2.953125mm; padding: 0; }
.quarter .month td.day { height: var(--quarter-day-height, 13.125mm); }
.quarter .day .n { width: 4.59375mm; font-size: 3.28125mm; }
.quarter .day .dv { font-size: 1.96875mm; }
.quarter .day .rows { margin-left: 4.59375mm; }
.quarter .day .r { grid-template-columns: 3.609375mm 1fr; line-height: 1; }
.quarter .day .r i { font-size: 2.953125mm; }
.quarter .day .r b { font-size: 2.789062mm; }
.quarter .notes p { font-size: 3.9375mm; }
.quarter .notes .tick { font-size: 4.59375mm; }


.paper { height: 296.8mm; aspect-ratio: auto; break-inside: avoid; overflow: hidden; }
.sum b { flex-shrink: 0; max-width: 50%; white-space: normal; overflow-wrap: anywhere; }
.month th.title em { max-width: 30%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
