// KOSMOS 포스터 HTML 생성기
// 실행: NODE_PATH=<node_modules> node poster/build_html.js  → poster/poster.html
// 캔버스는 A0 세로(841×1189mm)를 1px = 1pt 로 잡은 2384×3370px 이다.
// html_to_pptx.js 가 같은 좌표를 그대로 pt → inch(÷72)로 옮긴다.
// 숫자 출처: research/summary_20261123.md,
//   research/design_v2_20261112/analysis/out_final_k100/REPORT.md,
//   experiments/20261123-reasoning-high-full/README.md (out/trend.csv)

const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const lu = require("react-icons/lu");

const C = {
  ink: "#13343B",      // 주 색: 먹청(짙은 청록)
  ink2: "#1E4A52",
  paper: "#EEF2F1",    // 배경
  card: "#FFFFFF",
  human: "#E2553A",    // 사람 = 주홍
  humanSoft: "#FBE3DC",
  exaone: "#1F8A80",   // 모델 = 차가운 계열
  deepseek: "#3F6C9E",
  haiku: "#7D6BB0",
  base: "#B9C4C6",     // 기준선(균등분포)
  text: "#17262A",
  muted: "#5A6B70",
  line: "#D5DEDD",
  gold: "#F2B544",
};

const icon = (name, size, color) => {
  const Comp = lu[name];
  if (!Comp) throw new Error("no icon " + name);
  return renderToStaticMarkup(
    React.createElement(Comp, { size, color, strokeWidth: 2 })
  );
};

// ---------- 차트(SVG) : pptx 네이티브 차트와 같은 데이터·같은 모양 ----------
const fmt = (v, d) => v.toFixed(d);

function hbarSVG(ch) {
  const { w, h, labels, values, colors, max, dec } = ch;
  const labW = ch.labelW || 250, valW = 120;
  const n = labels.length;
  const rowH = h / n;
  const barH = rowH * 0.62;
  const plotW = w - labW - valW;
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  labels.forEach((lab, i) => {
    const y = i * rowH + (rowH - barH) / 2;
    const bw = (values[i] / max) * plotW;
    s += `<text x="${labW - 18}" y="${y + barH / 2}" text-anchor="end" dominant-baseline="central" font-size="${ch.fs || 26}" font-weight="600" fill="${C.text}">${lab}</text>`;
    s += `<rect x="${labW}" y="${y}" width="${bw}" height="${barH}" rx="6" fill="${colors[i]}"/>`;
    s += `<text x="${labW + bw + 14}" y="${y + barH / 2}" dominant-baseline="central" font-size="${ch.fs || 26}" font-weight="800" fill="${C.text}">${fmt(values[i], dec)}</text>`;
  });
  s += `<line x1="${labW}" y1="0" x2="${labW}" y2="${h}" stroke="${C.muted}" stroke-width="2"/>`;
  return s + "</svg>";
}

function lineSVG(ch) {
  const { w, h, labels, values, color, min, max, dec } = ch;
  const padL = 40, padR = 40, padT = 52, padB = 50;
  const pw = w - padL - padR, ph = h - padT - padB;
  const X = (i) => padL + (pw * i) / (labels.length - 1);
  const Y = (v) => padT + ph * (1 - (v - min) / (max - min));
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  s += `<line x1="${padL - 20}" y1="${padT + ph}" x2="${w - padR + 20}" y2="${padT + ph}" stroke="${C.line}" stroke-width="2"/>`;
  s += `<polyline points="${values.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>`;
  values.forEach((v, i) => {
    s += `<circle cx="${X(i)}" cy="${Y(v)}" r="10" fill="${color}"/>`;
    s += `<text x="${X(i)}" y="${Y(v) - 24}" text-anchor="middle" font-size="24" font-weight="800" fill="${C.text}">${fmt(v, dec)}</text>`;
    s += `<text x="${X(i)}" y="${h - 12}" text-anchor="middle" font-size="22" font-weight="600" fill="${C.muted}">${labels[i]}</text>`;
  });
  return s + "</svg>";
}

function chart(ch) {
  const svg = ch.type === "bar" ? hbarSVG(ch) : lineSVG(ch);
  const data = JSON.stringify(ch).replace(/'/g, "&#39;");
  return `<div class="pp-chart" data-chart='${data}' style="width:${ch.w}px;height:${ch.h}px">${svg}</div>`;
}

// ---------- 포레스트 플롯 : 도형(div)으로 그려 pptx에서도 도형으로 옮긴다 ----------
function forest() {
  const rows = [
    ["페르소나 문장", "당신 → 이 사람", [0.0073, -0.012, 0.0275], [-0.0048, -0.0218, 0.0107]],
    ["문항 호칭", "귀하 → 이 사람", [0.0061, -0.0095, 0.0228], [0.0036, -0.0082, 0.0156]],
    ["지시문", "+ '이 사람이 고를'", [0.0005, -0.0067, 0.0081], [-0.015, -0.0281, -0.0028]],
    ["주체 높임 제거", "-시- 빼기", [-0.01, -0.0227, 0.0029], [-0.0101, -0.0175, -0.0021]],
  ];
  const W = 660, labW = 220, plotW = W - labW - 20, rowH = 92, top = 60;
  const lo = -0.032, hi = 0.032;
  const X = (v) => labW + ((v - lo) / (hi - lo)) * plotW;
  const H = top + rows.length * rowH + 64;
  let s = `<div class="forest" style="position:relative;width:${W}px;height:${H}px">`;
  // 0선, 눈금
  s += `<div class="pp-box" style="position:absolute;left:${X(0) - 1.5}px;top:${top - 16}px;width:3px;height:${rows.length * rowH + 16}px;background:${C.muted}"></div>`;
  [-0.02, -0.01, 0.01, 0.02].forEach((t) => {
    s += `<div class="pp-box" style="position:absolute;left:${X(t) - 1}px;top:${top - 10}px;width:2px;height:${rows.length * rowH + 10}px;background:${C.line}"></div>`;
  });
  [-0.02, 0, 0.02].forEach((t) => {
    s += `<div class="pp-text" style="position:absolute;left:${X(t) - 60}px;width:120px;top:${top + rows.length * rowH + 8}px;font-size:21px;color:${C.muted};text-align:center;font-weight:600">${t === 0 ? "0" : (t > 0 ? "+" : "−") + Math.abs(t).toFixed(2)}</div>`;
  });
  // 범례
  s += `<div class="pp-box" style="position:absolute;left:${labW}px;top:8px;width:22px;height:22px;border-radius:50%;background:${C.white || "#fff"};border:5px solid ${C.deepseek}"></div>`;
  s += `<div class="pp-text" style="position:absolute;left:${labW + 34}px;top:2px;width:200px;font-size:23px;font-weight:700;color:${C.text}">추론 끔</div>`;
  s += `<div class="pp-box" style="position:absolute;left:${labW + 170}px;top:8px;width:32px;height:32px;border-radius:50%;background:${C.human}"></div>`;
  s += `<div class="pp-text" style="position:absolute;left:${labW + 214}px;top:2px;width:200px;font-size:23px;font-weight:700;color:${C.text}">추론 low</div>`;
  rows.forEach((r, i) => {
    const y0 = top + i * rowH;
    s += `<div class="pp-text" style="position:absolute;left:0;top:${y0 + 10}px;width:${labW - 14}px;font-size:24px;font-weight:800;color:${C.text}">${r[0]}</div>`;
    s += `<div class="pp-text" style="position:absolute;left:0;top:${y0 + 46}px;width:${labW - 20}px;font-size:20px;font-weight:500;color:${C.muted}">${r[1]}</div>`;
    [[r[2], C.deepseek, 26, true], [r[3], C.human, 62, false]].forEach(([d, col, dy, hollow]) => {
      const [m, a, b] = d;
      s += `<div class="pp-box" style="position:absolute;left:${X(a)}px;top:${y0 + dy - 2.5}px;width:${X(b) - X(a)}px;height:5px;border-radius:3px;background:${col}"></div>`;
      const r0 = 16;
      s += hollow
        ? `<div class="pp-box" style="position:absolute;left:${X(m) - r0}px;top:${y0 + dy - r0}px;width:${2 * r0 - 10}px;height:${2 * r0 - 10}px;border-radius:50%;background:#FFFFFF;border:5px solid ${col}"></div>`
        : `<div class="pp-box" style="position:absolute;left:${X(m) - r0}px;top:${y0 + dy - r0}px;width:${2 * r0}px;height:${2 * r0}px;border-radius:50%;background:${col}"></div>`;
    });
  });
  s += `<div class="pp-text" style="position:absolute;left:${labW}px;top:${H - 22}px;width:${plotW / 2}px;font-size:19px;color:${C.exaone};font-weight:700">← 사람에 가까워짐</div>`;
  s += `<div class="pp-text" style="position:absolute;left:${labW + plotW / 2}px;top:${H - 22}px;width:${plotW / 2}px;font-size:19px;color:${C.muted};font-weight:700;text-align:right">멀어짐 →</div>`;
  return s + "</div>";
}

// ---------- 조각 ----------
const sec = (num, title, sub) => `
  <div class="sec-head">
    <div class="pp-box num">${""}</div>
    <div class="pp-text numtxt">${num}</div>
    <div class="pp-text sec-title">${title}</div>
  </div>${sub ? `<div class="pp-text sec-sub">${sub}</div>` : ""}`;

const bullet = (html, color) => `
  <div class="bl"><div class="pp-box dot" style="background:${color || C.human}"></div><div class="pp-text bltxt">${html}</div></div>`;

const iconCircle = (name, bg, fg, size = 68, isz = 38) => `
  <div class="pp-box icc" style="width:${size}px;height:${size}px;background:${bg}"><div class="pp-img" style="width:${isz}px;height:${isz}px">${icon(name, isz, fg)}</div></div>`;

const hl = (t) => `<b class="hl">${t}</b>`;

// ---------- 본문 ----------
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>KOSMOS 포스터</title>
<meta name="viewport" content="width=2384">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
:root{--ink:${C.ink};--paper:${C.paper};--human:${C.human};--text:${C.text};--muted:${C.muted}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:${C.paper}}
body{width:2384px;height:3370px;font-family:"Pretendard","Pretendard Variable",sans-serif;color:${C.text};word-break:keep-all;overflow-wrap:break-word;position:relative;overflow:hidden}
.pp-img svg{display:block}
/* 헤더 */
#header{position:absolute;left:0;top:0;width:2384px;height:600px;background:${C.ink}}
.eyebrow{position:absolute;left:96px;top:78px;width:1460px;font-size:30px;font-weight:700;color:${C.gold};letter-spacing:0}
.title{position:absolute;left:96px;top:122px;width:1480px;font-size:104px;line-height:1.16;font-weight:900;color:#fff}
.subtitle{position:absolute;left:96px;top:388px;width:1440px;font-size:36px;line-height:1.4;font-weight:500;color:#CFE0DE}
.authors{position:absolute;left:96px;top:512px;width:1420px;font-size:30px;font-weight:600;color:#fff}
.authors span{color:${C.gold}}
/* 헤더 오른쪽 개념도 */
#concept{position:absolute;left:1600px;top:80px;width:690px;height:440px;background:${C.ink2};border-radius:28px}
/* 핵심 숫자 */
#stats{position:absolute;left:90px;top:640px;width:2204px;height:220px;display:flex;gap:36px}
.stat{position:relative;flex:1;background:#fff;border-radius:24px;box-shadow:0 6px 18px rgba(19,52,59,.10)}
.stat .big{position:absolute;left:36px;top:26px;width:470px;font-size:76px;line-height:1.1;font-weight:900;color:${C.ink}}
.stat .big .h{color:${C.human}}
.stat .cap{position:absolute;left:36px;top:124px;width:460px;font-size:25px;line-height:1.36;font-weight:500;color:${C.muted}}
/* 단 */
.col{position:absolute;top:900px;width:1072px}
#colL{left:90px} #colR{left:1222px}
.card{position:relative;background:#fff;border-radius:24px;box-shadow:0 6px 18px rgba(19,52,59,.10);padding:34px 40px 32px;margin-bottom:30px}
.sec-head{position:relative;height:64px;margin-bottom:16px}
.num{position:absolute;left:0;top:0;width:64px;height:64px;border-radius:50%;background:${C.ink}}
.numtxt{position:absolute;left:0;top:12px;width:64px;text-align:center;font-size:32px;line-height:1.2;font-weight:900;color:#fff}
.sec-title{position:absolute;left:86px;top:6px;width:880px;font-size:44px;line-height:1.2;font-weight:800;color:${C.ink}}
.sec-sub{font-size:23px;line-height:1.4;color:${C.muted};font-weight:500;margin:-4px 0 14px 86px}
.body{font-size:27px;line-height:1.5;font-weight:500;color:${C.text}}
.hl{color:${C.human};font-weight:800}
.ink{color:${C.ink};font-weight:800}
.bl{position:relative;padding-left:36px;margin-top:14px}
.dot{position:absolute;left:4px;top:15px;width:14px;height:14px;border-radius:50%}
.bltxt{font-size:28px;line-height:1.5;font-weight:500}
.icc{display:flex;align-items:center;justify-content:center;border-radius:50%;flex:none}
.ctitle{font-size:28px;line-height:1.35;font-weight:800;color:${C.ink};margin:6px 0 6px}
.note{font-size:20px;line-height:1.4;color:${C.muted};font-weight:500;margin-top:10px}
.take{position:relative;background:${C.humanSoft};border-radius:18px;padding:18px 24px;margin-top:16px}
.take .t{font-size:25px;line-height:1.45;font-weight:600;color:${C.text}}
/* 질문 */
.qrow{display:flex;gap:18px;align-items:flex-start;margin-top:12px}
.qk{font-size:28px;font-weight:900;color:${C.human};width:60px;flex:none;line-height:1.45}
.qt{font-size:27px;line-height:1.45;font-weight:700;color:${C.text};flex:1}
/* 방법 흐름 */
.flow{display:flex;gap:14px;margin-top:6px}
.step{position:relative;flex:1;background:${C.paper};border-radius:20px;padding:20px 18px 18px;height:316px}
.step .stn{font-size:20px;font-weight:800;color:${C.human};margin-top:12px}
.step .stt{font-size:25px;line-height:1.3;font-weight:800;color:${C.ink};margin-top:4px}
.step .std{font-size:20px;line-height:1.38;color:${C.muted};font-weight:500;margin-top:8px}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.chip{background:${C.ink};border-radius:30px;padding:8px 20px}
.chip .ct{font-size:21px;font-weight:600;color:#fff;line-height:1.3;white-space:nowrap}
.charth{font-size:25px;line-height:1.35;font-weight:800;color:${C.ink};margin:14px 0 10px}
.charth .u{font-size:20px;font-weight:500;color:${C.muted}}
/* 추론 미니 차트 */
.minis{display:flex;gap:20px}
.mini{flex:1;background:${C.paper};border-radius:18px;padding:16px 14px 4px}
.mini .mh{font-size:24px;line-height:1.3;font-weight:800;color:${C.ink};text-align:center}
.mini .ms{font-size:20px;line-height:1.3;font-weight:600;color:${C.muted};text-align:center;margin-top:2px}
/* 말투 결과 옆 숫자 */
.split{display:flex;gap:26px;align-items:center;margin-top:10px}
.bigbox{position:relative;width:250px;flex:none;background:${C.ink};border-radius:20px;padding:20px 22px;height:190px}
.bigbox .bn{font-size:58px;font-weight:900;color:${C.gold};line-height:1.1}
.bigbox .bc{font-size:19px;line-height:1.38;color:#E4EEEC;font-weight:500;margin-top:6px}
/* 하단 */
#bottom{position:absolute;left:90px;top:2826px;width:2204px;height:412px;display:flex;gap:40px}
#concl{position:relative;width:760px;background:${C.ink};border-radius:24px;padding:34px 38px}
#concl .sec-title{color:#fff}
#concl .num{background:${C.human}}
.cl{display:flex;gap:16px;margin-top:12px}
.cln{font-size:27px;font-weight:900;color:${C.gold};width:40px;flex:none;line-height:1.4}
.clt{font-size:25px;line-height:1.4;color:#fff;font-weight:500}
.clt b{font-weight:800;color:#fff}
#insight{position:relative;flex:1;background:#fff;border-radius:24px;box-shadow:0 6px 18px rgba(19,52,59,.10);padding:34px 38px}
.igrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px 20px}
.ins{position:relative;display:flex;gap:16px;align-items:flex-start;background:${C.paper};border-radius:18px;padding:16px 18px;height:132px}
.ins .it{font-size:24px;line-height:1.3;font-weight:800;color:${C.ink}}
.ins .id{font-size:19px;line-height:1.38;color:${C.muted};font-weight:500;margin-top:6px}
#footer{position:absolute;left:90px;top:3262px;width:2204px;height:80px}
.ft{font-size:19px;line-height:1.45;color:${C.muted};font-weight:500}
.ft b{color:${C.ink};font-weight:800}
</style></head>
<body>
<div class="pp-box" id="header"></div>
<div class="pp-text eyebrow">2026 캡스톤 디자인 · 팀 KOSMOS · 한국형 실리콘 샘플링 검증</div>
<div class="pp-text title">LLM은 한국인처럼<br>답할 수 있을까?</div>
<div class="pp-text subtitle">KGSS 2023 246문항으로 본 LLM 여론 재현: 한 보기로 쏠리고, 집단 차이를 부풀리며, 말투에 흔들린다</div>
<div class="pp-text authors">[이름 · 소속 기입] &nbsp;<span>|</span>&nbsp; github.com/Great-Grace/KOSMOS</div>

${(() => {
  // 개념도: 같은 5점 척도 문항에 대한 사람과 LLM 응답 분포의 전형적인 모양 (실제 데이터 아님)
  const L = 1600, T = 70;
  const hum = [0.13, 0.24, 0.3, 0.21, 0.12], llm = [0.02, 0.05, 0.86, 0.05, 0.02];
  let s = `<div class="pp-box" id="concept"></div>`;
  s += `<div class="pp-text" style="position:absolute;left:${L + 40}px;top:${T + 30}px;width:620px;font-size:24px;font-weight:700;color:${C.gold}">같은 질문, 다른 분포 <span style="color:#9FBDB9;font-weight:500">(개념도)</span></div>`;
  const panel = (x, vals, col, name, sub) => {
    let o = "";
    const baseY = T + 330, maxH = 210, bw = 40, gap = 12;
    vals.forEach((v, i) => {
      const h = Math.max(6, v / 0.86 * maxH);
      o += `<div class="pp-box" style="position:absolute;left:${x + i * (bw + gap)}px;top:${baseY - h}px;width:${bw}px;height:${h}px;border-radius:6px 6px 0 0;background:${col}"></div>`;
    });
    o += `<div class="pp-box" style="position:absolute;left:${x - 6}px;top:${baseY}px;width:${5 * bw + 4 * gap + 12}px;height:3px;background:#6E9894"></div>`;
    o += `<div class="pp-text" style="position:absolute;left:${x - 6}px;top:${baseY + 14}px;width:300px;font-size:27px;font-weight:800;color:#fff">${name}</div>`;
    o += `<div class="pp-text" style="position:absolute;left:${x - 6}px;top:${baseY + 50}px;width:300px;font-size:20px;font-weight:500;color:#9FBDB9">${sub}</div>`;
    return o;
  };
  s += panel(L + 52, hum, C.human, "사람", "의견이 고르게 갈린다");
  s += panel(L + 372, llm, "#7FD1C7", "LLM", "한 보기로 몰린다");
  return s;
})()}

<div id="stats">
  <div class="pp-box stat"><div class="pp-text big">0.22–0.28</div><div class="pp-text cap">보정한 뒤에도 남는 사람 분포와의 거리<br>(TVD, 성별×연령 10셀, 3모델)</div></div>
  <div class="pp-box stat"><div class="pp-text big">0.81–0.93</div><div class="pp-text cap">가장 많이 고른 보기의 평균 비율<br>모델 3종 · <b style="color:${C.human}">사람은 0.52</b></div></div>
  <div class="pp-box stat"><div class="pp-text big">1.7–3.3<span style="font-size:56px">배</span></div><div class="pp-text cap">성별×연령 페르소나를 줄 때 응답이<br>움직이는 폭, 사람 대비</div></div>
  <div class="pp-box stat"><div class="pp-text big"><span class="h">0</span> <span style="font-size:56px;color:${C.muted}">/ 9</span></div><div class="pp-text cap">인칭·화계 효과 검정 중 사람 분포에<br>유의하게 가까워진 것 (Holm 보정)</div></div>
</div>

<!-- 왼쪽 단 -->
<div class="col" id="colL">
  <div class="pp-box card">
    ${sec("01", "왜, 무엇을 물었나")}
    <div class="pp-text body"><b class="ink">실리콘 샘플링</b>은 LLM에 인구집단 페르소나를 주고 설문에 답하게 해 여론을 추정하는 방법이다. 싸고 빠르지만, 한국어·한국 사회에서도 믿을 수 있는지는 검증이 드물다.</div>
    <div class="qrow"><div class="pp-text qk">Q1</div><div class="pp-text qt">LLM의 응답 분포는 실제 한국인 분포에 얼마나 가까운가?</div></div>
    <div class="qrow"><div class="pp-text qk">Q2</div><div class="pp-text qt">성별·연령 집단 사이의 차이를 제대로 재현하는가?</div></div>
    <div class="qrow"><div class="pp-text qk">Q3</div><div class="pp-text qt">추론 강도나 말투(인칭·화계)를 바꾸면 더 가까워지는가?</div></div>
  </div>

  <div class="pp-box card">
    ${sec("02", "어떻게 쟀나")}
    <div class="flow">
      <div class="pp-box step">${iconCircle("LuDatabase", C.ink, "#fff")}<div class="pp-text stn">STEP 1</div><div class="pp-text stt">KGSS 2023<br>246문항</div><div class="pp-text std">실제 한국인 응답 분포(FINALWT 가중)를 정답으로</div></div>
      <div class="pp-box step">${iconCircle("LuUsers", C.ink, "#fff")}<div class="pp-text stn">STEP 2</div><div class="pp-text stt">LLM 3종 ×<br>페르소나 3단계</div><div class="pp-text std">페르소나 없음 · 한국 성인 · 성별×연령 10셀</div></div>
      <div class="pp-box step">${iconCircle("LuRepeat", C.ink, "#fff")}<div class="pp-text stn">STEP 3</div><div class="pp-text stt">프롬프트당<br>50–100회</div><div class="pp-text std">같은 질문을 반복해 고른 보기의 비율로 분포를 만든다</div></div>
      <div class="pp-box step">${iconCircle("LuScale", C.human, "#fff")}<div class="pp-text stn">STEP 4</div><div class="pp-text stt">보정 후<br>거리 측정</div><div class="pp-text std">p ∝ (count+1)<sup>β</sup>로 쏠림을 편 뒤 TVD로 비교</div></div>
    </div>
    <div class="chips">
      <div class="pp-box chip"><div class="pp-text ct">K-EXAONE 2.5 · DeepSeek V4.1 Flash · Claude Haiku 5.5</div></div>
      <div class="pp-box chip"><div class="pp-text ct">calibration 148 · validation 49 · test 49문항</div></div>
      <div class="pp-box chip"><div class="pp-text ct">사전등록 · Holm 보정 · 부트스트랩 2,000회</div></div>
    </div>
    <div class="pp-text note"><b style="color:${C.ink}">TVD</b>: 두 분포가 다른 정도. 0이면 같고 1이면 완전히 다르다. β는 calibration 문항에서만 정하고 validation·test에서 잰다.</div>
  </div>

  <div class="pp-box card">
    ${sec("03", "가깝지 않고, 한쪽으로 쏠린다")}
    <div class="pp-text charth">보정 후 사람 분포와의 거리 <span class="u">TVD · 성별×연령 10셀 · 낮을수록 가까움</span></div>
    ${chart({ type: "bar", w: 984, h: 200, labelW: 250, labels: ["K-EXAONE 2.5", "DeepSeek V4.1", "Haiku 5.5", "균등분포(기준)"], values: [0.222, 0.257, 0.284, 0.372], colors: [C.exaone, C.deepseek, C.haiku, C.base], max: 0.42, dec: 3 })}
    <div class="pp-text charth">가장 많이 고른 보기의 평균 비율 <span class="u">한국 성인 페르소나</span></div>
    ${chart({ type: "bar", w: 984, h: 200, labelW: 250, labels: ["사람(KGSS)", "K-EXAONE 2.5", "DeepSeek V4.1", "Haiku 5.5"], values: [0.52, 0.81, 0.82, 0.93], colors: [C.human, C.exaone, C.deepseek, C.haiku], max: 1.08, dec: 2 })}
    <div class="pp-box take"><div class="pp-text t">한국어 특화 <b class="ink">K-EXAONE</b>이 두 모델보다 유의하게 가깝다(차이 −0.035, −0.062). 그래도 세 모델 모두 한 보기로 몰린다. 최빈 보기가 90%를 넘는 문항이 모델은 <b class="hl">49–76%</b>, 사람은 <b class="hl">2%</b>다.</div></div>
    <div class="pp-text note">k=100, β 고정 후 test 49문항을 한 번 열어 잰 값</div>
  </div>
</div>

<!-- 오른쪽 단 -->
<div class="col" id="colR">
  <div class="pp-box card">
    ${sec("04", "집단 차이를 부풀린다")}
    <div class="pp-text charth">'한국 성인' → 성별×연령 셀로 바꿀 때 응답이 움직이는 폭 <span class="u">셀 이동 TVD</span></div>
    ${chart({ type: "bar", w: 984, h: 200, labelW: 250, labels: ["사람(KGSS)", "K-EXAONE 2.5", "DeepSeek V4.1", "Haiku 5.5"], values: [0.075, 0.124, 0.209, 0.246], colors: [C.human, C.exaone, C.deepseek, C.haiku], max: 0.29, dec: 3 })}
    <div class="pp-box take"><div class="pp-text t"><b class="ink">방향은 맞히지만 크기를 키운다.</b> DeepSeek Eco에서 셀 간 분산은 사람의 <b class="hl">3.4배</b>(표준편차로 약 1.8배)인데, 셀 편차의 방향이 사람과 맞는 정도(정렬)는 0.48이다.</div></div>
  </div>

  <div class="pp-box card">
    ${sec("05", "추론을 켜면 더 과장한다")}
    <div class="pp-text sec-sub">DeepSeek V4.1 Flash Eco · 188문항 · k=50 · 추론 끔 → low → medium → high</div>
    <div class="minis">
      <div class="pp-box mini"><div class="pp-text mh">셀 간 분산비</div><div class="pp-text ms">모델 / 사람 · 과장</div>${chart({ type: "line", w: 300, h: 196, labels: ["끔", "low", "med", "high"], values: [3.38, 4.51, 5.16, 5.07], color: C.human, min: 2.4, max: 6.5, dec: 2 })}</div>
      <div class="pp-box mini"><div class="pp-text mh">셀 편차 정렬</div><div class="pp-text ms">사람과 같은 방향</div>${chart({ type: "line", w: 300, h: 196, labels: ["끔", "low", "med", "high"], values: [0.479, 0.548, 0.581, 0.585], color: C.exaone, min: 0.42, max: 0.67, dec: 3 })}</div>
      <div class="pp-box mini"><div class="pp-text mh">보정 후 TVD</div><div class="pp-text ms">사람과의 거리</div>${chart({ type: "line", w: 300, h: 196, labels: ["끔", "low", "med", "high"], values: [0.284, 0.278, 0.277, 0.277], color: C.ink, min: 0.2, max: 0.36, dec: 3 })}</div>
    </div>
    <div class="pp-box take"><div class="pp-text t">추론은 페르소나를 <b class="ink">더 강하게 연기</b>하게 만든다. 맞는 방향과 과장이 함께 커져 거리는 그대로다. low → high 분산비 +0.56(Holm p 0.042), 정렬 +0.037(p 0.008), 증가는 medium에서 멈춘다.</div></div>
  </div>

  <div class="pp-box card">
    ${sec("06", "말투를 바꾸면 흔들리기만 한다")}
    <div class="pp-text sec-sub">인칭 요소별 보정 후 TVD 변화 · 한국 성인 · validation 49문항 · 95% 구간</div>
    <div class="split" style="align-items:flex-start;gap:24px;margin-top:4px">
      ${forest()}
      <div style="width:316px;flex:none">
        <div class="pp-box bigbox" style="width:316px"><div class="pp-text bn">6–32%</div><div class="pp-text bc">거리는 그대로인데 1등 보기가 바뀐 문항 (조건별, 추론 끔)</div></div>
        <div class="pp-text body" style="font-size:22px;line-height:1.45;margin-top:16px">인칭·화계 9개 검정은 <b class="hl">모두 유의하지 않다.</b> 요소를 쪼개도 끔·low 공통으로 거리를 줄이는 요소는 없다. low의 주체 높임(p 0.044)은 글자까지 같은 문장에서도 같은 크기 차이가 나 효과로 보지 않는다.</div>
      </div>
    </div>
  </div>
</div>

<!-- 하단 -->
<div id="bottom">
  <div class="pp-box" id="concl">
    ${sec("07", "결론")}
    <div class="cl"><div class="pp-text cln">1</div><div class="pp-text clt"><b>LLM 응답은 한국인 여론 분포를 대신할 수 없다.</b> 보정해도 거리가 크고 응답이 좁다.</div></div>
    <div class="cl"><div class="pp-text cln">2</div><div class="pp-text clt"><b>집단 차이는 과장된다.</b> 그대로 쓰면 실제보다 갈라진 사회로 보인다.</div></div>
    <div class="cl"><div class="pp-text cln">3</div><div class="pp-text clt"><b>추론과 말투는 재현도를 높이는 손잡이가 아니다.</b></div></div>
    <div class="cl"><div class="pp-text cln">4</div><div class="pp-text clt"><b>차이를 만든 것은 모델이다.</b> 한국어 특화 모델만 유의하게 가까웠다.</div></div>
  </div>
  <div id="insight" class="pp-box">
    ${sec("08", "무엇을 배웠나")}
    <div class="igrid">
      <div class="pp-box ins">${iconCircle("LuTarget", C.humanSoft, C.human, 72, 40)}<div><div class="pp-text it">방향은 맞고 크기는 틀리다</div><div class="pp-text id">위험은 무작위 오차가 아니라 고정관념이 증폭되는 체계적 오차다</div></div></div>
      <div class="pp-box ins">${iconCircle("LuBrain", C.humanSoft, C.human, 72, 40)}<div><div class="pp-text it">더 생각해도 더 사람 같지 않다</div><div class="pp-text id">추론은 정확도가 아니라 페르소나 연기를 키운다</div></div></div>
      <div class="pp-box ins">${iconCircle("LuLanguages", C.humanSoft, C.human, 72, 40)}<div><div class="pp-text it">말투는 손잡이가 아니라 잡음원</div><div class="pp-text id">한국어 실리콘 샘플링은 프롬프트 문구를 고정하고 보고해야 한다</div></div></div>
      <div class="pp-box ins">${iconCircle("LuBot", C.humanSoft, C.human, 72, 40)}<div><div class="pp-text it">기법보다 모델</div><div class="pp-text id">학습 데이터가 더 중요할 수 있다. 다만 모델이 셋뿐이라 단정은 못 한다</div></div></div>
      <div class="pp-box ins">${iconCircle("LuShieldCheck", C.humanSoft, C.human, 72, 40)}<div><div class="pp-text it">검증이 결론을 바꾼다</div><div class="pp-text id">'이 사람 문체가 낫다'와 '추론 효과 멈춤'은 엄격한 검정에서 뒤집혔다</div></div></div>
      <div class="pp-box ins">${iconCircle("LuSearch", C.humanSoft, C.human, 72, 40)}<div><div class="pp-text it">남은 질문: 왜 흔들리나</div><div class="pp-text id">평가 의식 · 사회적 바람직성 · 격식(해요체·해체)은 향후 연구로</div></div></div>
    </div>
  </div>
</div>

<div id="footer">
  <div class="pp-text ft"><b>한계</b> 분산비·정렬은 DeepSeek에서만 측정했다. 3모델 비교는 test 49문항을 한 번 열어 쓴 결과이고, 이후 실험은 validation 49문항 기준이라 검정력이 제한된다. 주체 높임 결과는 해석을 미룬다.</div>
  <div class="pp-text ft" style="margin-top:6px"><b>자료</b> 한국종합사회조사(KGSS) 2023 · Argyle et al. (2023), Out of One, Many: Using Language Models to Simulate Human Samples, <i>Political Analysis</i> · 모든 숫자는 레포의 실험 결과 파일(out/)에서 옮겼다.</div>
</div>
</body></html>`;

fs.writeFileSync(path.join(__dirname, "poster.html"), html);
console.log("wrote poster.html", html.length);
