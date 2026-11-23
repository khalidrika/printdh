import { coverGeometry, type CoverProject, type TextLayer } from "./model";

export type ImageCache = Map<string, Promise<HTMLImageElement>>;
export function loadCoverImage(src: string, cache: ImageCache) {
  let pending = cache.get(src);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("An image could not be loaded. Replace it before exporting."));
      image.src = src;
    });
    cache.set(src, pending);
  }
  return pending;
}

export function textLines(context: CanvasRenderingContext2D, layer: TextLayer) {
  const lines: string[] = [];
  for (const paragraph of layer.text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > layer.width) { lines.push(line); line = ""; }
      // Split long unbroken words as well as ordinary whitespace-separated text.
      for (const character of (line ? ` ${word}` : word)) {
        if (line && context.measureText(line + character).width > layer.width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderCover(project: CoverProject, scale: number, cache: ImageCache) {
  const g = coverGeometry(project);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(g.width * scale);
  canvas.height = Math.ceil(g.height * scale);
  if (canvas.width * canvas.height > 45_000_000) throw new Error("This cover is too large to render. Reduce the trim size.");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not create the cover canvas.");
  context.scale(canvas.width / g.width, canvas.height / g.height);
  context.fillStyle = project.background;
  context.fillRect(0, 0, g.width, g.height);
  const visible = project.layers.filter((layer) => !layer.hidden);
  await Promise.all(visible.filter((l) => l.type === "image").map((l) => loadCoverImage(l.dataUrl, cache)));
  const clippedText: string[] = [];
  for (const layer of visible) {
    context.save();
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    context.rotate(layer.rotation * Math.PI / 180);
    context.translate(-layer.width / 2, -layer.height / 2);
    context.globalAlpha = layer.opacity;
    if (layer.type === "image") {
      const image = await loadCoverImage(layer.dataUrl, cache);
      const sx = layer.width / image.naturalWidth, sy = layer.height / image.naturalHeight;
      const fit = layer.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
      const zoom = layer.fit === "cover" ? layer.cropZoom ?? 1 : 1;
      const width = layer.fit === "stretch" ? layer.width : image.naturalWidth * fit * zoom;
      const height = layer.fit === "stretch" ? layer.height : image.naturalHeight * fit * zoom;
      context.beginPath(); context.rect(0, 0, layer.width, layer.height); context.clip();
      const offsetX = layer.fit === "cover" ? (layer.cropX ?? 0) * Math.max(0, width - layer.width) / 2 : 0;
      const offsetY = layer.fit === "cover" ? (layer.cropY ?? 0) * Math.max(0, height - layer.height) / 2 : 0;
      context.drawImage(image, (layer.width - width) / 2 + offsetX, (layer.height - height) / 2 + offsetY, width, height);
    } else if (layer.type === "text") {
      context.font = `${layer.italic ? "italic" : "normal"} ${layer.bold ? "bold" : "normal"} ${layer.fontSize}px "${layer.font}"`;
      context.fillStyle = layer.color;
      context.textAlign = layer.align;
      context.direction = layer.direction;
      context.textBaseline = "alphabetic";
      const lines = textLines(context, layer);
      const lineHeight = layer.fontSize * layer.lineHeight;
      if ((lines.length - 1) * lineHeight + layer.fontSize * 1.2 > layer.height) clippedText.push(`${layer.name}: enlarge its height to show all text.`);
      context.beginPath(); context.rect(0, 0, layer.width, layer.height); context.clip();
      const x = layer.align === "center" ? layer.width / 2 : layer.align === "right" ? layer.width : 0;
      lines.forEach((line, i) => context.fillText(line, x, layer.fontSize + i * lineHeight));
    } else {
      context.fillStyle = layer.color;
      context.beginPath();
      if (layer.type === "ellipse") context.ellipse(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
      else context.roundRect(0, 0, layer.width, layer.height, Math.min(layer.radius, layer.width / 2, layer.height / 2));
      context.fill();
    }
    context.restore();
  }
  return { canvas, clippedText };
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image export failed.")), "image/png"));
}

export async function exportCoverPdf(project: CoverProject, cache: ImageCache) {
  const { canvas, clippedText } = await renderCover(project, 300 / 72, cache);
  if (clippedText.length) throw new Error(clippedText.join(" "));
  const png = await canvasBlob(canvas);
  canvas.width = 1; canvas.height = 1;
  const [{ PDFDocument }, { savePdfWithGenericMetadata }] = await Promise.all([import("pdf-lib"), import("../pdf-metadata")]);
  const pdf = await PDFDocument.create();
  const g = coverGeometry(project);
  const image = await pdf.embedPng(await png.arrayBuffer());
  pdf.addPage([g.width, g.height]).drawImage(image, { x: 0, y: 0, width: g.width, height: g.height });
  return savePdfWithGenericMetadata(pdf);
}
