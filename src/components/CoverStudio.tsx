"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { COVER_FONTS, PAPER_TYPES, coverGeometry, coverProjectSchema, coverWarnings, createCover, type CoverLayer, type CoverProject } from "@/lib/cover/model";
import { readCover, writeCover } from "@/lib/cover/storage";
import { exportCoverPdf, loadCoverImage, renderCover, type ImageCache } from "@/lib/cover/render";
import { RESIZE_HANDLES, coverViewport, extendLayerToSpine, fitCoverScale, handleDirection, resizeCoverLayer, type ResizeHandle } from "@/lib/cover/interaction";

type History = { past: CoverProject[]; present: CoverProject; future: CoverProject[] };
type Gesture = { type: "move" | "resize" | "rotate"; handle?: ResizeHandle; start: { x: number; y: number }; layer: CoverLayer; project: CoverProject; draft: CoverProject; pointerId: number };
const TRIMS = [[6, 9], [8.5, 8.5], [8.5, 11], [8.25, 11], [5, 8]];

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename(title: string) { return title.replace(/[^\p{L}\p{N}_ -]/gu, "").trim() || "book-cover"; }
function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("The image could not be read.")); reader.readAsDataURL(file);
  });
}

export function CoverStudio() {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: createCover(), future: [] }));
  const [draft, setDraft] = useState<CoverProject | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState("Opening your draft…");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [guides, setGuides] = useState(true);
  const [zoom, setZoom] = useState<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 550 });
  const [tool, setTool] = useState<"select" | "pan">("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [clippedText, setClippedText] = useState<string[]>([]);
  const [renderError, setRenderError] = useState("");
  const [imageResizeMode, setImageResizeMode] = useState<"stretch" | "proportional" | "crop">("stretch");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const panGesture = useRef<{ x: number; y: number; left: number; top: number; pointerId: number } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number; screenX: number; screenY: number } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const cache = useRef<ImageCache>(new Map());
  const gesture = useRef<Gesture | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const savedRevision = useRef(0);
  const project = draft ?? history.present;
  const geometry = coverGeometry(project);
  const fitScale = fitCoverScale(geometry.width, geometry.height, viewportSize.width, viewportSize.height);
  const scale = zoom ?? fitScale;
  const view = coverViewport(geometry.width, geometry.height, viewportSize.width, viewportSize.height, scale);
  const selected = project.layers.find((layer) => layer.id === selectedId);
  const warnings = useMemo(() => [...coverWarnings(project), ...clippedText], [project, clippedText]);

  const changeZoom = useCallback((next: number | null, client?: { x: number; y: number }) => {
    const viewport = viewportRef.current, artboard = artboardRef.current;
    if (!viewport || !artboard || gesture.current || panGesture.current) return;
    const nextScale = next === null ? null : Math.max(0.1, Math.min(8, next));
    if (nextScale !== null && Math.abs(nextScale - scale) < 0.00001) return;
    const rect = viewport.getBoundingClientRect(), art = artboard.getBoundingClientRect();
    const screenX = client ? client.x - rect.left - viewport.clientLeft : viewport.clientWidth / 2;
    const screenY = client ? client.y - rect.top - viewport.clientTop : viewport.clientHeight / 2;
    zoomAnchor.current = nextScale === null ? null : {
      x: (rect.left + viewport.clientLeft + screenX - art.left) / scale,
      y: (rect.top + viewport.clientTop + screenY - art.top) / scale, screenX, screenY,
    };
    setZoom(nextScale);
  }, [scale]);

  function focusSpine() {
    zoomAnchor.current = { x: geometry.spineX + geometry.spine / 2, y: geometry.height / 2,
      screenX: viewportSize.width / 2, screenY: viewportSize.height / 2 };
    setZoom(3);
    // Also works if the current zoom is already 300%.
    const layout = coverViewport(geometry.width, geometry.height, viewportSize.width, viewportSize.height, 3);
    if (zoom === 3 && viewportRef.current) {
      viewportRef.current.scrollLeft = layout.left + zoomAnchor.current.x * 3 - zoomAnchor.current.screenX;
      viewportRef.current.scrollTop = layout.top + zoomAnchor.current.y * 3 - zoomAnchor.current.screenY;
      zoomAnchor.current = null;
    }
  }

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element || !ready) return;
    const measure = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);

  useLayoutEffect(() => {
    const element = viewportRef.current, anchor = zoomAnchor.current;
    if (!element) return;
    if (anchor) {
      element.scrollLeft = view.left + anchor.x * scale - anchor.screenX;
      element.scrollTop = view.top + anchor.y * scale - anchor.screenY;
      zoomAnchor.current = null;
    } else if (zoom === null) { element.scrollLeft = 0; element.scrollTop = 0; }
  }, [scale, view.left, view.top, zoom]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || !ready) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      changeZoom(scale * Math.exp(-delta * 0.002), { x: event.clientX, y: event.clientY });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [changeZoom, scale, ready]);

  const commit = useCallback((next: CoverProject | ((current: CoverProject) => CoverProject)) => {
    setHistory((current) => ({ past: [...current.past.slice(-39), current.present],
      present: typeof next === "function" ? next(current.present) : next, future: [] }));
  }, []);
  const undo = useCallback(() => {
    setHistory((h) => h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h);
  }, []);
  const redo = useCallback(() => {
    setHistory((h) => h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h);
  }, []);
  function updateProject(patch: Partial<CoverProject>) { commit((p) => ({ ...p, ...patch })); }
  const updateLayer = useCallback((id: string, patch: Partial<CoverLayer>) => {
    commit((p) => ({ ...p, layers: p.layers.map((layer) => layer.id === id ? { ...layer, ...patch } as CoverLayer : layer) }));
  }, [commit]);
  const removeSelected = useCallback(() => {
    if (!selected || selected.locked) return;
    commit((p) => ({ ...p, layers: p.layers.filter((layer) => layer.id !== selected.id) }));
    setSelectedId(null);
  }, [commit, selected]);
  const duplicate = useCallback(() => {
    if (!selected || project.layers.length >= 200) return;
    const copy = { ...selected, id: crypto.randomUUID(), name: `${selected.name.slice(0, 140)} copy`, x: selected.x + 12, y: selected.y + 12, locked: false };
    commit((p) => ({ ...p, layers: [...p.layers, copy] })); setSelectedId(copy.id);
  }, [selected, project.layers.length, commit]);

  useEffect(() => {
    let cancelled = false;
    readCover().then((saved) => {
      if (!cancelled && saved) setHistory({ past: [], present: saved, future: [] });
    }).catch(() => { if (!cancelled) setNotice("Your saved draft could not be opened. You can import a saved project file."); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const revision = ++savedRevision.current;
    setSaveState("Saving…");
    // Serialize writes so rapid edits never restore an older draft over a newer one.
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => writeCover(history.present));
    saveQueue.current.then(() => { if (revision === savedRevision.current) setSaveState("Saved in this browser"); })
      .catch(() => { if (revision === savedRevision.current) setSaveState("Local save failed — download your project"); });
  }, [history.present, ready]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    renderCover(project, Math.min(4, Math.max(1, scale * window.devicePixelRatio)), cache.current).then(({ canvas, clippedText }) => {
      if (cancelled || !canvasRef.current) { canvas.width = 1; return; }
      const target = canvasRef.current;
      target.width = canvas.width; target.height = canvas.height;
      target.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.width = 1;
      setClippedText(clippedText); setRenderError("");
    }).catch((error: Error) => { if (!cancelled) setRenderError(error.message); });
    return () => { cancelled = true; };
  }, [project, ready, scale]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.code === "Space") { event.preventDefault(); setSpaceHeld(true); return; }
      if (gesture.current || panGesture.current) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicate(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
      else if (event.key === "Escape") setSelectedId(null);
      else if (selected && !selected.locked && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        updateLayer(selected.id, { x: selected.x + (event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0), y: selected.y + (event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0) });
      }
    }
    const releaseSpace = (event: KeyboardEvent) => { if (event.code === "Space") setSpaceHeld(false); };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", releaseSpace); window.removeEventListener("blur", blur); };
  }, [selected, undo, redo, duplicate, removeSelected, updateLayer]);

  function addLayer(type: "text" | "rect" | "ellipse") {
    if (project.layers.length >= 200) { setNotice("This project already has 200 layers."); return; }
    const base = { id: crypto.randomUUID(), x: geometry.front.x + 24, y: 60, width: geometry.front.width - 48, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false };
    const layer: CoverLayer = type === "text"
      ? { ...base, type, name: "Text", text: "Your book title", font: "Georgia", fontSize: 36, bold: true, italic: false, color: "#172d38", align: "center", direction: project.readingDirection, lineHeight: 1.2 }
      : type === "rect" ? { ...base, type, name: "Rectangle", color: "#0f766e", radius: 0 }
        : { ...base, type, name: "Ellipse", width: 120, height: 120, color: "#e7ac65" };
    commit((p) => ({ ...p, layers: [...p.layers, layer] })); setSelectedId(layer.id);
  }

  async function addImages(files: File[]) {
    try {
      if (project.layers.length + files.length > 200) throw new Error("A project can contain up to 200 layers.");
      const layers: CoverLayer[] = [];
      for (const file of files) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Use PNG, JPG or WEBP images.");
        if (file.size > 30 * 1024 * 1024) throw new Error("Each image must be smaller than 30 MB.");
        const dataUrl = await fileDataUrl(file);
        const image = await loadCoverImage(dataUrl, cache.current);
        if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Use an image smaller than 40 megapixels.");
        const left = geometry.front.x === geometry.bleed;
        layers.push({ id: crypto.randomUUID(), name: file.name.slice(0, 150), type: "image", dataUrl,
          pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight, fit: "cover",
          x: left ? 0 : geometry.front.x, y: 0, width: geometry.front.width + geometry.bleed, height: geometry.height,
          rotation: 0, opacity: 1, locked: false, hidden: false });
      }
      if (layers.length) {
        commit((p) => ({ ...p, layers: [...p.layers, ...layers] }));
        setSelectedId(layers[layers.length - 1].id); setNotice("");
      }
    } catch (error) { setNotice((error as Error).message); }
  }

  async function importProject(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Project files must be smaller than 100 MB.");
      const parsed = coverProjectSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("This is not a valid Cover Studio project file.");
      commit(parsed.data); setSelectedId(null); setNotice("Project opened. Your previous design is available with Undo.");
    } catch (error) { setNotice((error as Error).message); }
  }

  async function exportPdf() {
    setExporting(true); setNotice("");
    try {
      const bytes = await exportCoverPdf(history.present, cache.current);
      download(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), `${filename(project.title)}.pdf`);
      setNotice("PDF downloaded: one full cover at 300 DPI. Guides and selection outlines are excluded.");
    } catch (error) { setNotice((error as Error).message); }
    finally { setExporting(false); }
  }

  function pointerPosition(event: PointerEvent) {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  function startGesture(event: PointerEvent, layer: CoverLayer, type: Gesture["type"], handle?: ResizeHandle) {
    if (event.button !== 0 || gesture.current) return;
    event.stopPropagation(); setSelectedId(layer.id);
    if (layer.locked) return;
    event.preventDefault();
    gesture.current = { type, handle, layer, project: history.present, draft: history.present, start: pointerPosition(event), pointerId: event.pointerId };
    svgRef.current?.setPointerCapture(event.pointerId);
  }
  function moveGesture(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const point = pointerPosition(event), layer = current.layer;
    const dx = point.x - current.start.x, dy = point.y - current.start.y;
    let patch: Partial<CoverLayer>;
    if (current.type === "move") patch = { x: Math.max(-5000, Math.min(5000, layer.x + dx)), y: Math.max(-5000, Math.min(5000, layer.y + dy)) };
    else if (current.type === "rotate") {
      const cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2;
      let angle = layer.rotation + (Math.atan2(point.y - cy, point.x - cx) - Math.atan2(current.start.y - cy, current.start.x - cx)) * 180 / Math.PI;
      if (event.shiftKey) angle = Math.round(angle / 15) * 15;
      patch = { rotation: ((angle + 540) % 360) - 180 };
    } else {
      patch = resizeCoverLayer(layer, current.handle ?? "se", dx, dy, event.shiftKey || (layer.type === "image" && imageResizeMode === "proportional"));
      if (layer.type === "image" && !event.shiftKey && imageResizeMode !== "proportional") patch = { ...patch, fit: imageResizeMode === "stretch" ? "stretch" : "cover" };
    }
    current.draft = { ...current.project, layers: current.project.layers.map((l) => l.id === layer.id ? { ...l, ...patch } as CoverLayer : l) };
    setDraft(current.draft);
  }
  function endGesture(event: PointerEvent<SVGSVGElement>, cancel = false) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    gesture.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    setDraft(null);
    if (!cancel && current.draft !== current.project) commit(current.draft);
  }
  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (panGesture.current || gesture.current || !(event.button === 1 || (event.button === 0 && (tool === "pan" || spaceHeld)))) return;
    event.preventDefault(); event.stopPropagation();
    panGesture.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId); setPanning(true);
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    const pan = panGesture.current;
    if (!pan || event.pointerId !== pan.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x);
    event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y);
  }
  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (!panGesture.current || event.pointerId !== panGesture.current.pointerId) return;
    event.stopPropagation(); panGesture.current = null; setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function resizeDimension(axis: "width" | "height", value: number) {
    if (!selected || selected.locked) return;
    let patch: Partial<CoverLayer> = { [axis]: value };
    if (selected.type === "image") {
      if (imageResizeMode === "proportional") {
        const other = axis === "width" ? "height" : "width";
        patch[other] = selected[other] * value / selected[axis];
        if (patch[other]! > 5000 || patch[other]! < 1) return;
      } else patch = { ...patch, fit: imageResizeMode === "stretch" ? "stretch" : "cover" };
    }
    updateLayer(selected.id, patch);
  }
  function extendToSpine(wholeSpine: boolean) {
    if (!selected || selected.type !== "image" || selected.locked || selected.rotation !== 0) return;
    updateLayer(selected.id, { ...extendLayerToSpine(selected, geometry.spineX, geometry.spine, wholeSpine), fit: "stretch" });
  }
  function moveLayer(index: number, direction: number) {
    const next = index + direction;
    if (next < 0 || next >= project.layers.length) return;
    const layers = [...project.layers]; [layers[index], layers[next]] = [layers[next], layers[index]];
    updateProject({ layers });
  }
  function placeOn(target: "front" | "back" | "all") {
    if (!selected || selected.locked) return;
    const area = target === "all" ? { x: 0, y: 0, width: geometry.width, height: geometry.height } : geometry[target];
    if (selected.type === "text") updateLayer(selected.id, { x: area.x + (area.width - selected.width) / 2, y: area.y + (area.height - selected.height) / 2 });
    else updateLayer(selected.id, { rotation: 0, x: target === "all" || area.x === geometry.bleed ? 0 : area.x, y: 0,
      width: area.width + (target === "all" ? 0 : geometry.bleed), height: geometry.height });
  }

  return (
    <main className="cover-studio">
      <header className="cover-header">
        <div className="cover-brand"><Link href="/" aria-label="Back to Picture Book Studio" className="cover-home">▧</Link><div><h1>Cover Studio</h1><p>Design your paperback cover</p></div></div>
        <div className="cover-actions">
          <span className="cover-save" role="status">{saveState}</span>
          <button disabled={!ready} onClick={() => projectInput.current?.click()}>Open project</button>
          <button disabled={!ready} onClick={() => download(new Blob([JSON.stringify(history.present)], { type: "application/json" }), `${filename(project.title)}.cover.json`)}>Save project</button>
          <button className="cover-primary" disabled={!ready || exporting || !!renderError} onClick={exportPdf}>{exporting ? "Exporting…" : "Download PDF · 300 DPI"}</button>
        </div>
      </header>
      <input ref={imageInput} aria-label="Upload cover images" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { void addImages(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <input ref={projectInput} aria-label="Open cover project" type="file" accept=".json" hidden onChange={(event) => { void importProject(event.target.files?.[0]); event.target.value = ""; }} />
      {notice && <div className="cover-notice" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
      {!ready ? <p className="cover-loading">Opening Cover Studio…</p> : <>
        <div className="cover-toolbar" aria-label="Design tools">
          <div><button onClick={() => addLayer("text")}>T · Add text</button><button onClick={() => imageInput.current?.click()}>Add image</button><button onClick={() => addLayer("rect")}>Rectangle</button><button onClick={() => addLayer("ellipse")}>Ellipse</button></div>
          <div><button disabled={!history.past.length || !!draft} onClick={undo}>Undo</button><button disabled={!history.future.length || !!draft} onClick={redo}>Redo</button>
            <label className="cover-inline"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />Print guides</label>
            <button aria-pressed={tool === "select"} onClick={() => setTool("select")}>Select</button>
            <button aria-pressed={tool === "pan"} onClick={() => setTool("pan")} title="Drag to pan. You can also hold Space or use the middle mouse button.">Hand</button>
            <div className="cover-zoom-controls">
              <button aria-label="Zoom out" disabled={scale <= 0.1} onClick={() => changeZoom(scale / 1.25)}>−</button>
              <select aria-label="Canvas zoom" value={zoom === null ? "fit" : String(scale)} onChange={(e) => changeZoom(e.target.value === "fit" ? null : Number(e.target.value))}>
                <option value="fit">Fit · {Math.round(fitScale * 100)}%</option>
                {zoom !== null && ![0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8].includes(zoom) && <option value={scale}>{Math.round(scale * 100)}%</option>}
                {[0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8].map((value) => <option key={value} value={value}>{value * 100}%</option>)}
              </select>
              <button aria-label="Zoom in" disabled={scale >= 8} onClick={() => changeZoom(scale * 1.25)}>+</button>
            </div>
            <button onClick={() => changeZoom(null)}>Fit</button><button onClick={focusSpine}>View spine</button>
          </div>
        </div>
        <div className="cover-workspace">
          <aside className="cover-panel cover-book" aria-label="Book settings">
            <PanelTitle>Book setup</PanelTitle>
            <label>Project name<input value={project.title} maxLength={150} onChange={(e) => updateProject({ title: e.target.value })} /></label>
            <label>Trim size (without bleed)<select value={TRIMS.some(([w,h]) => w===project.trimWidth && h===project.trimHeight) ? `${project.trimWidth}x${project.trimHeight}` : "custom"} onChange={(e) => { if (e.target.value !== "custom") { const [trimWidth, trimHeight] = e.target.value.split("x").map(Number); updateProject({ trimWidth, trimHeight }); } }}>
              {TRIMS.map(([w,h]) => <option key={`${w}x${h}`} value={`${w}x${h}`}>{w} × {h} in</option>)}<option value="custom">Custom</option>
            </select></label>
            <div className="cover-field-grid"><NumberField label="Width (in)" value={project.trimWidth} min={4} max={8.5} step={0.01} onChange={(trimWidth) => updateProject({ trimWidth })} /><NumberField label="Height (in)" value={project.trimHeight} min={6} max={11.69} step={0.01} onChange={(trimHeight) => updateProject({ trimHeight })} /></div>
            <NumberField label="Final page count" value={project.pageCount} min={24} max={828} step={1} onChange={(pageCount) => updateProject({ pageCount })} />
            <label>Ink & paper<select value={project.paper} onChange={(e) => updateProject({ paper: e.target.value as CoverProject["paper"] })}>{Object.entries(PAPER_TYPES).map(([key,paper]) => <option key={key} value={key}>{paper.label}</option>)}</select></label>
            <label>Reading direction<select value={project.readingDirection} onChange={(e) => updateProject({ readingDirection: e.target.value as "ltr" | "rtl" })}><option value="ltr">Left to right · front on right</option><option value="rtl">Right to left · front on left</option></select></label>
            <label className="cover-inline"><input type="checkbox" checked={project.customSpine !== null} onChange={(e) => updateProject({ customSpine: e.target.checked ? geometry.spine / 72 : null })} />Set spine width manually</label>
            {project.customSpine !== null && <NumberField label="Spine width (in)" value={project.customSpine} min={0.01} max={3} step={0.001} onChange={(customSpine) => updateProject({ customSpine })} />}
            <ColorField label="Cover background" value={project.background} onChange={(background) => updateProject({ background })} />
            <div className="cover-measurements"><p>Full cover <strong>{(geometry.width / 72).toFixed(3)} × {(geometry.height / 72).toFixed(3)} in</strong></p><p>Spine <strong>{(geometry.spine / 72).toFixed(3)} in</strong></p><p>Bleed <strong>0.125 in</strong></p></div>
            <p className="cover-hint">Paperback dimensions. Recheck placement after changing book size. Use the final manuscript page count.</p>
            <a className="cover-source" href="https://kdp.amazon.com/cover-calculator" target="_blank" rel="noreferrer">Check with the KDP cover calculator</a>
            <button onClick={() => { commit(createCover()); setSelectedId(null); setNotice("New blank cover. Use Undo to return to the previous design."); }}>New blank cover</button>
          </aside>

          <section className="cover-center" aria-label="Cover design canvas">
            <div className="cover-canvas-header"><span>BACK + SPINE + FRONT</span><span>Wheel to zoom · Space + drag to pan · drag any handle to resize</span></div>
            <div className="cover-image-tools">
              <label>Resize image<select aria-label="Image resize mode" value={imageResizeMode} onChange={(e) => setImageResizeMode(e.target.value as typeof imageResizeMode)}>
                <option value="stretch">Free stretch</option><option value="proportional">Keep proportions</option><option value="crop">Crop frame</option>
              </select></label>
              <div className="cover-button-row"><button disabled={selected?.type !== "image" || selected.locked || selected.rotation !== 0} onClick={() => extendToSpine(false)}>Extend to spine center</button><button disabled={selected?.type !== "image" || selected.locked || selected.rotation !== 0} onClick={() => extendToSpine(true)}>Cover whole spine</button></div>
              <p className="cover-hint">{selected?.type === "image" && selected.rotation !== 0 ? "Set rotation to 0° to use the spine buttons." : "For two cover images, select each and extend to the spine center. Hold Shift while resizing to keep proportions."}</p>
            </div>
            <div ref={viewportRef} className={`cover-canvas-scroll${tool === "pan" || spaceHeld ? " is-pan" : ""}${panning ? " is-panning" : ""}`}
              onPointerDownCapture={startPan} onPointerMoveCapture={movePan} onPointerUpCapture={endPan} onPointerCancelCapture={endPan} onLostPointerCapture={endPan}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDrop={(e) => { e.preventDefault(); void addImages(Array.from(e.dataTransfer.files)); }}>
              <div className="cover-canvas-plane" style={{ width: view.spaceWidth, height: view.spaceHeight }}>
              <div ref={artboardRef} className="cover-artboard" style={{ width: view.artWidth, height: view.artHeight, left: view.left, top: view.top }}>
                <canvas ref={canvasRef} aria-label="Rendered cover artwork" />
                <svg ref={svgRef} className="cover-interaction" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-label="Editable cover layers"
                  onPointerDown={(e) => { if (e.button === 0) setSelectedId(null); }} onPointerMove={moveGesture} onPointerUp={(e) => endGesture(e)} onPointerCancel={(e) => endGesture(e, true)} onLostPointerCapture={(e) => endGesture(e, true)}>
                  <rect width={geometry.width} height={geometry.height} fill="transparent" />
                  {project.layers.filter((l) => !l.hidden).map((layer) => <rect key={layer.id} data-layer-id={layer.id} x={layer.x} y={layer.y} width={layer.width} height={layer.height} fill="transparent"
                    transform={`rotate(${layer.rotation} ${layer.x + layer.width / 2} ${layer.y + layer.height / 2})`} className={layer.locked ? "cover-locked-layer" : "cover-move-layer"}
                    onPointerDown={(e) => startGesture(e, layer, "move")} onDoubleClick={() => { if (layer.type === "text" && !layer.locked) textRef.current?.focus(); }} />)}
                  {guides && <CoverGuides project={project} />}
                  {selected && !selected.hidden && <g transform={`translate(${selected.x + selected.width / 2} ${selected.y + selected.height / 2}) rotate(${selected.rotation}) translate(${-selected.width / 2} ${-selected.height / 2})`}>
                    <rect width={selected.width} height={selected.height} fill="none" stroke="#2563eb" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    {!selected.locked && <>
                      <line x1={selected.width / 2} y1={0} x2={selected.width / 2} y2={-30 / scale} stroke="#2563eb" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                      <g className="cover-rotate-handle" onPointerDown={(e) => startGesture(e, selected, "rotate")}>
                        <circle aria-label="Rotate selected layer" data-handle="rotate" cx={selected.width / 2} cy={-30 / scale} r={12 / scale} fill="transparent" />
                        <circle cx={selected.width / 2} cy={-30 / scale} r={6 / scale} fill="white" stroke="#2563eb" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                      </g>
                      {RESIZE_HANDLES.map((handle) => {
                        const direction = handleDirection(handle), x = (direction.x + 1) * selected.width / 2, y = (direction.y + 1) * selected.height / 2;
                        const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI + selected.rotation;
                        const cursor = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][((Math.round(angle / 45) % 4) + 4) % 4];
                        return <g key={handle} style={{ cursor }} onPointerDown={(e) => startGesture(e, selected, "resize", handle)}>
                          <rect aria-label={`Resize ${handle} edge or corner`} data-handle="resize" data-resize-handle={handle} x={x - 11 / scale} y={y - 11 / scale} width={22 / scale} height={22 / scale} fill="transparent" />
                          <rect x={x - 5 / scale} y={y - 5 / scale} width={10 / scale} height={10 / scale} rx={1.5 / scale} fill="white" stroke="#2563eb" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                        </g>;
                      })}
                    </>}
                  </g>}
                </svg>
                {!project.layers.length && <div className="cover-empty"><strong>Your cover starts here</strong><span>Add text, or drop a cover image onto the canvas.</span><button onClick={() => imageInput.current?.click()}>Choose an image</button></div>}
              </div>
              </div>
            </div>
            <div className="cover-legend"><span><i className="cover-trim-key" />Trim</span><span><i className="cover-safe-key" />Text-safe area</span><span><i className="cover-spine-key" />Spine folds</span><span>Guides are never exported</span></div>
            {renderError && <p className="cover-error" role="alert">{renderError}</p>}
            {warnings.length > 0 && <details className="cover-review" open><summary>{warnings.length} design {warnings.length === 1 ? "note" : "notes"}</summary><ul>{warnings.slice(0, 10).map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
            <p className="cover-export-note">PDF export: one full cover, flattened at 300 DPI in RGB. Text and artwork remain editable in your saved project. <a href="https://kdp.amazon.com/en_US/help/topic/G201953020" target="_blank" rel="noreferrer">KDP cover guidelines</a></p>
          </section>

          <aside className="cover-panel cover-properties" aria-label="Layer properties">
            <PanelTitle>{selected ? "Selected layer" : "Properties"}</PanelTitle>
            {selected ? <>
              <label>Layer name<input value={selected.name} maxLength={150} onChange={(e) => updateLayer(selected.id, { name: e.target.value })} /></label>
              <fieldset disabled={selected.locked} className="cover-properties-fields">
                {selected.type === "text" && <>
                  <label>Text<textarea ref={textRef} aria-label="Layer text" dir={selected.direction} value={selected.text} maxLength={10000} onChange={(e) => updateLayer(selected.id, { text: e.target.value })} /></label>
                  <label>Font<select value={selected.font} onChange={(e) => updateLayer(selected.id, { font: e.target.value as typeof selected.font })}>{COVER_FONTS.map((font) => <option key={font}>{font}</option>)}</select></label>
                  <div className="cover-field-grid"><NumberField label="Size (pt)" value={selected.fontSize} min={7} max={250} onChange={(fontSize) => updateLayer(selected.id, { fontSize })} /><NumberField label="Line spacing" value={selected.lineHeight} min={0.8} max={3} step={0.1} onChange={(lineHeight) => updateLayer(selected.id, { lineHeight })} /></div>
                  <div className="cover-button-row"><button aria-pressed={selected.bold} onClick={() => updateLayer(selected.id, { bold: !selected.bold })}><b>Bold</b></button><button aria-pressed={selected.italic} onClick={() => updateLayer(selected.id, { italic: !selected.italic })}><i>Italic</i></button></div>
                  <div className="cover-field-grid"><label>Alignment<select value={selected.align} onChange={(e) => updateLayer(selected.id, { align: e.target.value as typeof selected.align })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Text direction<select value={selected.direction} onChange={(e) => updateLayer(selected.id, { direction: e.target.value as typeof selected.direction })}><option value="ltr">LTR</option><option value="rtl">RTL / عربي</option></select></label></div>
                </>}
                {selected.type !== "image" && <ColorField label={selected.type === "text" ? "Text color" : "Fill color"} value={selected.color} onChange={(color) => updateLayer(selected.id, { color })} />}
                {selected.type === "image" && <label>Image fit<select value={selected.fit} onChange={(e) => updateLayer(selected.id, { fit: e.target.value as typeof selected.fit })}><option value="cover">Fill & crop</option><option value="contain">Fit entire image</option><option value="stretch">Stretch</option></select></label>}
                <div className="cover-field-grid"><NumberField label="X (in)" value={selected.x / 72} min={-69} max={69} step={0.01} onChange={(x) => updateLayer(selected.id, { x: x * 72 })} /><NumberField label="Y (in)" value={selected.y / 72} min={-69} max={69} step={0.01} onChange={(y) => updateLayer(selected.id, { y: y * 72 })} /><NumberField label="Width (in)" value={selected.width / 72} min={0.02} max={69} step={0.01} onChange={(width) => resizeDimension("width", width * 72)} /><NumberField label="Height (in)" value={selected.height / 72} min={0.02} max={69} step={0.01} onChange={(height) => resizeDimension("height", height * 72)} /><NumberField label="Rotation (°)" value={selected.rotation} min={-180} max={180} onChange={(rotation) => updateLayer(selected.id, { rotation })} /><NumberField label="Opacity (%)" value={selected.opacity * 100} min={0} max={100} onChange={(opacity) => updateLayer(selected.id, { opacity: opacity / 100 })} /></div>
                {selected.type === "rect" && <NumberField label="Corner radius (pt)" value={selected.radius} min={0} max={500} onChange={(radius) => updateLayer(selected.id, { radius })} />}
                <p className="cover-hint">{selected.type === "text" ? "Center this text on:" : "Fill this area:"}</p>
                <div className="cover-button-row"><button onClick={() => placeOn("front")}>Front</button><button onClick={() => placeOn("back")}>Back</button><button onClick={() => placeOn("all")}>Full cover</button></div>
              </fieldset>
              <div className="cover-button-row"><button onClick={duplicate}>Duplicate</button><button onClick={removeSelected} disabled={selected.locked}>Delete</button></div>
            </> : <p className="cover-hint">Select an object on the canvas or in the layers list to edit it.</p>}
            <PanelTitle>Layers · {project.layers.length}</PanelTitle>
            <p className="cover-hint">Top layer appears in front. Select locked or hidden objects here.</p>
            <div className="cover-layers">{[...project.layers].reverse().map((layer, index) => <div key={layer.id} className={`cover-layer ${selectedId === layer.id ? "is-selected" : ""}`}>
              <button className="cover-layer-name" onClick={() => setSelectedId(layer.id)} aria-pressed={selectedId === layer.id}>{layer.type === "text" ? "T" : layer.type === "image" ? "▧" : "◈"} <span>{layer.name}</span></button>
              <div><button aria-label={`${layer.hidden ? "Show" : "Hide"} ${layer.name}`} onClick={() => updateLayer(layer.id, { hidden: !layer.hidden })}>{layer.hidden ? "Show" : "Hide"}</button><button aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`} onClick={() => updateLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? "Unlock" : "Lock"}</button><button aria-label={`Raise ${layer.name}`} disabled={index === 0} onClick={() => moveLayer(project.layers.length - 1 - index, 1)}>Raise</button><button aria-label={`Lower ${layer.name}`} disabled={index === project.layers.length - 1} onClick={() => moveLayer(project.layers.length - 1 - index, -1)}>Lower</button></div>
            </div>)}</div>
          </aside>
        </div>
      </>}
    </main>
  );
}

function PanelTitle({ children }: { children: ReactNode }) { return <h2 className="cover-panel-title">{children}</h2>; }
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<div className="cover-color"><input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} /><span>{value.toUpperCase()}</span></div></label>;
}
function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number }) {
  const [text, setText] = useState(String(Number(value.toFixed(3))));
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setText(String(Number(value.toFixed(3))));
  }
  return <label>{label}<input type="number" value={text} min={min} max={max} step={step} onChange={(e) => {
    const raw = e.target.value; setText(raw);
    const next = Number(raw);
    if (raw !== "" && Number.isFinite(next) && next >= min && next <= max && (step !== 1 || Number.isInteger(next))) onChange(next);
  }} onBlur={() => setText(String(Number(value.toFixed(3))))} /></label>;
}

function CoverGuides({ project }: { project: CoverProject }) {
  const g = coverGeometry(project);
  return <g pointerEvents="none" data-testid="cover-guides" fontFamily="Arial" fontSize={10}>
    <path d={`M0 0H${g.width}V${g.height}H0Z M9 9H${g.width - 9}V${g.height - 9}H9Z`} fill="#fb7185" opacity={0.2} fillRule="evenodd" />
    <rect x={9} y={9} width={g.width - 18} height={g.height - 18} fill="none" stroke="#d97706" vectorEffect="non-scaling-stroke" />
    {[g.spineX, g.spineX + g.spine].map((x) => <line key={x} x1={x} x2={x} y1={0} y2={g.height} stroke="#a855f7" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />)}
    {(["back", "front"] as const).map((side) => <g key={side}>
      <rect x={g[side].x + 9} y={18} width={g[side].width - 18} height={g[side].height - 18} fill="none" stroke="white" strokeWidth={3} vectorEffect="non-scaling-stroke" />
      <rect x={g[side].x + 9} y={18} width={g[side].width - 18} height={g[side].height - 18} fill="none" stroke="#059669" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
      <rect x={g[side].x + 12} y={23} width={side === "front" ? 86 : 80} height={18} rx={3} fill="#ffffff" fillOpacity={0.9} />
      <text x={g[side].x + 18} y={36} fill="#334155">{side === "front" ? "FRONT COVER" : "BACK COVER"}</text>
    </g>)}
    {g.spine > 9 && <rect x={g.spineX + 4.5} y={18} width={g.spine - 9} height={g.height - 36} fill="none" stroke="#a855f7" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
  </g>;
}
