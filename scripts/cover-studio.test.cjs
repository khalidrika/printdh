/* eslint-disable @typescript-eslint/no-require-imports -- Node's standalone CommonJS test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

// Load the pure TypeScript helpers without adding a separate test-runner dependency.
function loadTs(filename) {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (name) => name.startsWith(".") ? loadTs(path.resolve(path.dirname(filename), `${name}.ts`)) : require(name);
  new Function("require", "module", "exports", source)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}
const model = loadTs(path.resolve(__dirname, "../src/lib/cover/model.ts"));
const { textLines } = loadTs(path.resolve(__dirname, "../src/lib/cover/render.ts"));
const { RESIZE_HANDLES, handleDirection, resizeCoverLayer, extendLayerToSpine, fitCoverScale, coverViewport } = loadTs(path.resolve(__dirname, "../src/lib/cover/interaction.ts"));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const text = {
  id: "text", name: "Title", type: "text", text: "hello world\n\nABCDEFGHI", font: "Arial", fontSize: 10,
  bold: false, italic: false, color: "#ffffff", align: "left", direction: "ltr", lineHeight: 1.2,
  x: 100, y: 100, width: 50, height: 120, rotation: 0, opacity: 1, locked: false, hidden: false,
};

test("paperback dimensions include two panels, the paper-specific spine and outer bleed", () => {
  const project = model.createCover();
  const g = model.coverGeometry(project);
  close(g.width, 12.52024 * 72);
  close(g.height, 9.25 * 72);
  close(g.spine, 0.27024 * 72);
  close(g.front.x, 9 + 432 + g.spine);
  close(model.coverGeometry({ ...project, paper: "cream" }).spine, 120 * 0.0025 * 72);
  close(model.coverGeometry({ ...project, paper: "premium" }).spine, 120 * 0.002347 * 72);
  close(model.coverGeometry({ ...project, paper: "standard" }).spine, g.spine);
  close(model.coverGeometry({ ...project, customSpine: 0.4 }).width, 12.65 * 72);
  assert.deepEqual(model.coverGeometry({ ...project, readingDirection: "rtl" }).front, g.back);
});

test("project imports reject invalid geometry, duplicate IDs and remote image references", () => {
  const project = model.createCover();
  assert.equal(model.coverProjectSchema.safeParse({ ...project, pageCount: -1 }).success, false);
  assert.equal(model.coverProjectSchema.safeParse({ ...project, layers: [text, text] }).success, false);
  assert.equal(model.coverProjectSchema.safeParse({ ...project, trimWidth: Infinity }).success, false);
  assert.equal(model.coverProjectSchema.safeParse({ ...project, layers: [{ ...text, type: "image", dataUrl: "https://example.com/image.png", pixelWidth: 200, pixelHeight: 200, fit: "cover" }] }).success, false);
  assert.ok(model.coverProjectSchema.safeParse(JSON.parse(JSON.stringify({ ...project, layers: [text] }))).success);
});

test("rotation and physical image scale are reflected in design notes", () => {
  const b = model.layerBounds({ ...text, width: 100, height: 20, rotation: 90 });
  close(b.width, 20); close(b.height, 100); close(b.x, 140); close(b.y, 60);
  const image = { ...text, type: "image", pixelWidth: 300, pixelHeight: 600, width: 144, height: 144, fit: "cover" };
  const warnings = model.coverWarnings({ ...model.createCover(), layers: [image, { ...text, id: "outside", x: -2000 }] });
  assert.ok(warnings.some((w) => w.includes("150 DPI")));
  assert.ok(warnings.some((w) => w.includes("outside the cover")));
});

test("text layout preserves paragraphs and wraps unbroken words", () => {
  const context = { measureText: (s) => ({ width: [...s].length * 10 }) };
  assert.deepEqual(textLines(context, text), ["hello", "world", "", "ABCDE", "FGHI"]);
  assert.deepEqual(textLines(context, { ...text, text: "" }), [""]);
  assert.equal(textLines(context, { ...text, text: "مرحبا بكم", width: 100 }).join(" "), "مرحبا بكم");
});

function point(layer, x, y) {
  const angle = layer.rotation * Math.PI / 180;
  return { x: layer.x + layer.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: layer.y + layer.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) };
}
test("all eight handles keep the opposite anchor fixed, including rotated layers", () => {
  for (const rotation of [0, 35, 90, -135]) for (const handle of RESIZE_HANDLES) {
    const layer = { ...text, width: 200, height: 100, rotation };
    const d = handleDirection(handle), angle = rotation * Math.PI / 180;
    const next = { ...layer, ...resizeCoverLayer(layer, handle, 30 * Math.cos(angle) - 20 * Math.sin(angle), 30 * Math.sin(angle) + 20 * Math.cos(angle), false) };
    close(next.width, 200 + d.x * 30); close(next.height, 100 + d.y * 20);
    const before = point(layer, -d.x * layer.width / 2, -d.y * layer.height / 2);
    const after = point(next, -d.x * next.width / 2, -d.y * next.height / 2);
    close(before.x, after.x); close(before.y, after.y);
  }
});
test("proportional side resizing keeps aspect ratio and clamps extreme drags", () => {
  const layer = { ...text, width: 200, height: 100 };
  const enlarged = resizeCoverLayer(layer, "e", 50, 300, true);
  close(enlarged.width, 250); close(enlarged.height, 125); close(enlarged.x, layer.x);
  const reduced = resizeCoverLayer(layer, "se", -50, -25, true);
  close(reduced.width, 150); close(reduced.height, 75);
  for (const dx of [-10000, 10000]) {
    const result = resizeCoverLayer(layer, "w", dx, 0, true);
    close(result.width / result.height, 2);
    assert.ok(result.width <= 5000 && result.height >= 8);
  }
});
test("two cover images meet at spine center while outer edges and heights stay fixed", () => {
  for (const readingDirection of ["ltr", "rtl"]) {
    const g = model.coverGeometry({ ...model.createCover(), readingDirection });
    const left = { ...text, x: 0, y: 0, width: g.spineX, height: g.height };
    const right = { ...text, x: g.spineX + g.spine, y: 0, width: g.width - g.spineX - g.spine, height: g.height };
    const a = { ...left, ...extendLayerToSpine(left, g.spineX, g.spine, false) };
    const b = { ...right, ...extendLayerToSpine(right, g.spineX, g.spine, false) };
    close(a.x, 0); close(a.x + a.width, b.x); close(b.x + b.width, g.width);
    close(a.height, g.height); close(b.height, g.height);
    close(extendLayerToSpine(left, g.spineX, g.spine, true).width, g.spineX + g.spine);
    close(extendLayerToSpine(right, g.spineX, g.spine, true).x, g.spineX);
    assert.deepEqual(extendLayerToSpine(a, g.spineX, g.spine, false), { x: a.x, width: a.width });
    const full = { ...left, width: g.width };
    assert.deepEqual(extendLayerToSpine(full, g.spineX, g.spine, false), { x: 0, width: g.width });
  }
});
test("Fit reserves room for edge handles and zoomed covers remain fully scrollable", () => {
  for (const [vw, vh] of [[1200, 650], [355, 550]]) {
    const scale = fitCoverScale(1260, 630, vw, vh);
    const fit = coverViewport(1260, 630, vw, vh, scale);
    close(fit.spaceWidth, vw); close(fit.spaceHeight, vh);
    assert.ok(fit.left >= 72 - 1e-7 && fit.top >= 72 - 1e-7);
    const zoom = coverViewport(1260, 630, vw, vh, 3);
    assert.ok(zoom.spaceWidth >= zoom.artWidth + 144 && zoom.spaceHeight >= zoom.artHeight + 144);
    close(zoom.left, 72); close(zoom.top, 72);
  }
});
