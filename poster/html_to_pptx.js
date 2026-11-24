// poster.html → kosmos_poster.pptx
// HTML 요소의 실제 위치(px = pt)를 읽어 같은 자리에 pptx 도형·텍스트·차트를 놓는다.
//   .pp-box   → 사각형/둥근 사각형/원 (배경색·테두리·그림자)
//   .pp-text  → 텍스트 상자 (굵기·색·크기·줄 간격을 글자 단위 run으로 옮김)
//   .pp-img   → 아이콘 SVG를 투명 PNG로 캡처해 그림으로
//   .pp-chart → data-chart JSON으로 PowerPoint 네이티브 차트
// 실행: NODE_PATH=<node_modules>:$(npm root -g) node poster/html_to_pptx.js

const path = require("path");
const { chromium } = require("playwright");
const pptxgen = require("pptxgenjs");

const PX = 1 / 72; // 1px = 1pt = 1/72 inch
const FONT = "Pretendard";

const hex = (rgb) => {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return null;
  const [r, g, b, a] = m.map(Number);
  if (a === 0) return null;
  return [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
};

const face = (w) =>
  w >= 850 ? { fontFace: "Pretendard Black", bold: false }
  : w >= 750 ? { fontFace: "Pretendard ExtraBold", bold: false }
  : w >= 650 ? { fontFace: FONT, bold: true }
  : w >= 550 ? { fontFace: "Pretendard SemiBold", bold: false }
  : w >= 450 ? { fontFace: "Pretendard Medium", bold: false }
  : { fontFace: FONT, bold: false };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2384, height: 3370 } });
  await page.goto("file://" + path.join(__dirname, "poster.html"));
  await page.evaluate(() => document.fonts.ready);

  const items = await page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll(".pp-box, .pp-text, .pp-img, .pp-chart");
    els.forEach((el, idx) => {
      el.setAttribute("data-ppid", idx);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const base = { id: idx, x: r.left, y: r.top, w: r.width, h: r.height };
      if (el.classList.contains("pp-chart")) {
        out.push({ ...base, kind: "chart", data: JSON.parse(el.dataset.chart) });
      } else if (el.classList.contains("pp-img")) {
        out.push({ ...base, kind: "img" });
      } else if (el.classList.contains("pp-box")) {
        out.push({
          ...base, kind: "box",
          bg: cs.backgroundColor,
          radius: parseFloat(cs.borderTopLeftRadius) || 0,
          radiusB: parseFloat(cs.borderBottomLeftRadius) || 0,
          bw: parseFloat(cs.borderTopWidth) || 0,
          bc: cs.borderTopColor,
          shadow: cs.boxShadow && cs.boxShadow !== "none",
        });
      }
      if (el.classList.contains("pp-text")) {
        // 글자 단위 run 수집
        const runs = [];
        const walk = (node) => {
          node.childNodes.forEach((n) => {
            if (n.nodeType === 3) {
              const t = n.textContent.replace(/[ \t\n\r]+/g, " ");
              if (!t) return;
              const ps = getComputedStyle(n.parentElement);
              runs.push({
                text: t, color: ps.color, weight: +ps.fontWeight, size: parseFloat(ps.fontSize),
                italic: ps.fontStyle === "italic", sup: n.parentElement.tagName === "SUP",
              });
            } else if (n.nodeType === 1) {
              if (n.tagName === "BR") runs.push({ br: true });
              else walk(n);
            }
          });
        };
        walk(el);
        // 줄 처음·끝 공백 정리
        if (runs.length && runs[0].text) runs[0].text = runs[0].text.replace(/^ +/, "");
        const last = runs[runs.length - 1];
        if (last && last.text) last.text = last.text.replace(/ +$/, "");
        out.push({
          ...base, kind: "text", runs,
          size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2,
          align: cs.textAlign === "center" ? "center" : cs.textAlign === "right" ? "right" : "left",
          padL: parseFloat(cs.paddingLeft) || 0, padT: parseFloat(cs.paddingTop) || 0,
          nowrap: cs.whiteSpace === "nowrap",
        });
      }
    });
    return out;
  });

  // 아이콘을 4배 해상도, 투명 배경으로 캡처
  const page4 = await browser.newPage({ viewport: { width: 2384, height: 3370 }, deviceScaleFactor: 4 });
  await page4.goto("file://" + path.join(__dirname, "poster.html"));
  await page4.evaluate(() => document.fonts.ready);
  await page4.evaluate(() => document.querySelectorAll(".pp-box, .pp-text, .pp-img, .pp-chart").forEach((el, i) => el.setAttribute("data-ppid", i)));
  for (const it of items.filter((i) => i.kind === "img")) {
    // 아이콘 뒤 원 배경이 같이 찍히지 않도록 부모 배경을 잠시 투명하게
    await page4.evaluate((id) => {
      const el = document.querySelector(`[data-ppid="${id}"]`);
      let p = el.parentElement;
      while (p) { p.dataset.bgKeep = p.style.background; p.style.background = "transparent"; p.style.boxShadow = "none"; p = p.parentElement; }
      document.body.style.background = "transparent"; document.documentElement.style.background = "transparent";
    }, it.id);
    const buf = await page4.locator(`[data-ppid="${it.id}"]`).screenshot({ omitBackground: true });
    it.png = buf.toString("base64");
    await page4.reload();
    await page4.evaluate(() => document.fonts.ready);
    await page4.evaluate(() => document.querySelectorAll(".pp-box, .pp-text, .pp-img, .pp-chart").forEach((el, i) => el.setAttribute("data-ppid", i)));
  }
  await browser.close();

  const bodyBg = "EEF2F1";
  const pres = new pptxgen();
  pres.defineLayout({ name: "A0_PORTRAIT", width: 2384 * PX, height: 3370 * PX });
  pres.layout = "A0_PORTRAIT";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
  pres.title = "LLM은 한국인처럼 답할 수 있을까? — KOSMOS";
  pres.author = "팀 KOSMOS";
  const slide = pres.addSlide();
  slide.background = { color: bodyBg };

  let n = 0;
  for (const it of items) {
    n++;
    const X = it.x * PX, Y = it.y * PX, W = it.w * PX, H = it.h * PX;
    if (it.kind === "box") {
      const fill = hex(it.bg);
      const line = it.bw > 0 ? hex(it.bc) : null;
      if (!fill && !line) continue;
      // 정사각형에 반지름이 절반 이상일 때만 원, 나머지는 둥근 사각형(알약 모양 포함)
      const isCircle = Math.abs(it.w - it.h) < 2 && it.radius >= Math.min(it.w, it.h) / 2 - 1;
      const opts = {
        x: X, y: Y, w: W, h: H, objectName: `box-${n}`,
        fill: fill ? { color: fill } : { type: "none" },
        line: line ? { color: line, width: it.bw * 0.95 } : { type: "none" },
      };
      if (line) { // 테두리는 상자 안쪽에 그려지도록 반만큼 줄인다
        const d = (it.bw / 2) * PX;
        Object.assign(opts, { x: X + d, y: Y + d, w: W - 2 * d, h: H - 2 * d });
      }
      if (it.shadow) opts.shadow = { type: "outer", color: "13343B", opacity: 0.12, blur: 12, offset: 4, angle: 90 };
      let shape = pres.ShapeType.rect;
      if (isCircle) shape = pres.ShapeType.ellipse;
      else if (it.radius > 0 && it.radiusB > 0) { shape = pres.ShapeType.roundRect; opts.rectRadius = Math.min(it.radius, it.w / 2, it.h / 2) * PX; }
      slide.addShape(shape, opts);
    } else if (it.kind === "img") {
      slide.addImage({ data: "image/png;base64," + it.png, x: X, y: Y, w: W, h: H, altText: "아이콘" });
    } else if (it.kind === "text") {
      if (!it.runs.length) continue;
      const runs = it.runs.map((r, i) => {
        if (r.br) return { text: "", options: { breakLine: true } };
        const f = face(r.weight);
        return {
          text: r.text,
          options: {
            fontFace: f.fontFace, bold: f.bold, color: hex(r.color) || "17262A",
            fontSize: r.size, italic: r.italic, superscript: r.sup || undefined, lang: "ko-KR",
          },
        };
      });
      // <br>로 끝나는 빈 run 정리: breakLine은 앞 run에 붙인다
      const merged = [];
      runs.forEach((r) => {
        if (r.options.breakLine && r.text === "") { if (merged.length) merged[merged.length - 1].options.breakLine = true; }
        else merged.push(r);
      });
      // 글자 폭이 렌더러마다 조금씩 달라 줄바꿈이 밀리지 않게 여유를 둔다
      const slack = Math.max(6, it.w * 0.03);
      let x = it.x + it.padL, w = it.w - it.padL + slack;
      if (it.align === "center") { x = it.x - slack / 2; w = it.w + slack; }
      if (it.align === "right") { x = it.x - slack; w = it.w + slack; }
      const lines = Math.max(1, Math.round((it.h - it.padT) / it.lh));
      slide.addText(merged, {
        x: x * PX, y: (it.y + it.padT) * PX, w: w * PX, h: Math.max(it.h - it.padT, it.lh * lines) * PX,
        margin: 0, valign: "top", align: it.align, isTextBox: true, fit: "none", wrap: !it.nowrap,
        lineSpacingMultiple: +(it.lh / (it.size * 1.2)).toFixed(3),
        objectName: `text-${n}`,
      });
    } else if (it.kind === "chart") {
      const d = it.data;
      const lab = { color: "17262A" };
      if (d.type === "bar") {
        slide.addChart(pres.ChartType.bar, [{ name: "값", labels: d.labels, values: d.values }], {
          x: X, y: Y, w: W, h: H, objectName: `chart-${n}`,
          barDir: "bar", barGapWidthPct: 55,
          chartColors: d.colors.map((c) => c.replace("#", "")),
          catAxisOrientation: "maxMin",
          valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: d.max,
          valGridLine: { style: "none" }, catGridLine: { style: "none" },
          catAxisLabelFontSize: d.fs || 26, catAxisLabelFontFace: "Pretendard SemiBold", catAxisLabelColor: lab.color,
          catAxisLineShow: true, catAxisLineColor: "5A6B70", catAxisLineSize: 1.5,
          showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: d.fs || 26,
          dataLabelFontFace: "Pretendard ExtraBold", dataLabelColor: lab.color,
          dataLabelFormatCode: d.dec === 3 ? "0.000" : "0.00",
          showLegend: false, showTitle: false,
          plotArea: { fill: { color: "FFFFFF", transparency: 100 } },
        });
      } else {
        slide.addChart(pres.ChartType.line, [{ name: "값", labels: d.labels, values: d.values }], {
          x: X, y: Y, w: W, h: H, objectName: `chart-${n}`,
          chartColors: [d.color.replace("#", "")], lineSize: 4.5,
          lineDataSymbol: "circle", lineDataSymbolSize: 14,
          valAxisHidden: true, valAxisMinVal: d.min, valAxisMaxVal: d.max,
          valGridLine: { style: "none" }, catGridLine: { style: "none" },
          catAxisLabelFontSize: 22, catAxisLabelFontFace: "Pretendard SemiBold", catAxisLabelColor: "5A6B70",
          catAxisLineShow: true, catAxisLineColor: "D5DEDD",
          showValue: true, dataLabelPosition: "t", dataLabelFontSize: 23,
          dataLabelFontFace: "Pretendard ExtraBold", dataLabelColor: lab.color,
          dataLabelFormatCode: d.dec === 3 ? "0.000" : "0.00",
          showLegend: false, showTitle: false,
          plotArea: { fill: { color: "FFFFFF", transparency: 100 } },
        });
      }
    }
  }

  const outFile = path.join(__dirname, "kosmos_poster.pptx");
  await pres.writeFile({ fileName: outFile });
  require("child_process").execFileSync("python3", [path.join(__dirname, "fix_pptx.py"), outFile], { stdio: "inherit" });
  console.log("wrote", outFile, items.length, "items");
})();
