import type { CoverLayer } from "./model";

export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = typeof RESIZE_HANDLES[number];

export function handleDirection(handle: ResizeHandle) {
  return { x: handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
    y: handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0 };
}

// Keep the opposite edge/corner fixed, including on rotated objects. A side
// handle affects only its axis unless proportional resizing is requested.
export function resizeCoverLayer(layer: CoverLayer, handle: ResizeHandle, dx: number, dy: number, proportional: boolean) {
  const direction = handleDirection(handle);
  const angle = layer.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
  const rawWidth = layer.width + direction.x * localX, rawHeight = layer.height + direction.y * localY;
  let width = direction.x ? Math.max(8, Math.min(5000, rawWidth)) : layer.width;
  let height = direction.y ? Math.max(8, Math.min(5000, rawHeight)) : layer.height;
  if (proportional) {
    const useWidth = direction.x && (!direction.y || Math.abs(localX / layer.width) >= Math.abs(localY / layer.height));
    const scale = Math.max(Math.max(8 / layer.width, 8 / layer.height), Math.min(
      Math.min(5000 / layer.width, 5000 / layer.height), useWidth ? rawWidth / layer.width : rawHeight / layer.height,
    ));
    width = layer.width * scale; height = layer.height * scale;
  }
  const cx = direction.x * (width - layer.width) / 2, cy = direction.y * (height - layer.height) / 2;
  return { width, height,
    x: layer.x + (layer.width - width) / 2 + cx * cos - cy * sin,
    y: layer.y + (layer.height - height) / 2 + cx * sin + cy * cos };
}

export function extendLayerToSpine(layer: CoverLayer, spineX: number, spineWidth: number, wholeSpine: boolean) {
  const center = spineX + spineWidth / 2;
  const onLeft = layer.x + layer.width / 2 < center;
  const target = wholeSpine ? (onLeft ? spineX + spineWidth : spineX) : center;
  const x = onLeft ? layer.x : Math.min(layer.x, target);
  const right = onLeft ? Math.max(layer.x + layer.width, target) : layer.x + layer.width;
  return { x, width: right - x };
}

export const VIEWPORT_PADDING = 72;
export function fitCoverScale(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return Math.max(0.05, Math.min((viewportWidth - VIEWPORT_PADDING * 2) / width, (viewportHeight - VIEWPORT_PADDING * 2) / height));
}
export function coverViewport(width: number, height: number, viewportWidth: number, viewportHeight: number, scale: number) {
  const artWidth = width * scale, artHeight = height * scale;
  const spaceWidth = Math.max(viewportWidth, artWidth + VIEWPORT_PADDING * 2);
  const spaceHeight = Math.max(viewportHeight, artHeight + VIEWPORT_PADDING * 2);
  return { artWidth, artHeight, spaceWidth, spaceHeight, left: (spaceWidth - artWidth) / 2, top: (spaceHeight - artHeight) / 2 };
}

export type Bounds = { x: number; y: number; width: number; height: number };
export type SnapTargets = { x: number[]; y: number[] };
export function closestSnap(values: number[], targets: number[], tolerance: number) {
  let best: { delta: number; guide: number } | null = null;
  for (const value of values) for (const target of targets) {
    const delta = target - value;
    if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, guide: target };
  }
  return best;
}
export function snapMove(bounds: Bounds, targets: SnapTargets, tolerance: number) {
  const x = closestSnap([bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width], targets.x, tolerance);
  const y = closestSnap([bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height], targets.y, tolerance);
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides: { x: x?.guide, y: y?.guide } };
}
export function snapResize(bounds: Bounds, handle: ResizeHandle, targets: SnapTargets, tolerance: number) {
  const d = handleDirection(handle);
  const x = d.x ? closestSnap([bounds.x + (d.x > 0 ? bounds.width : 0)], targets.x, tolerance) : null;
  const y = d.y ? closestSnap([bounds.y + (d.y > 0 ? bounds.height : 0)], targets.y, tolerance) : null;
  const validX = x && bounds.width + d.x * x.delta >= 8 && bounds.width + d.x * x.delta <= 5000 ? x : null;
  const validY = y && bounds.height + d.y * y.delta >= 8 && bounds.height + d.y * y.delta <= 5000 ? y : null;
  return { bounds: { x: bounds.x + (d.x < 0 ? validX?.delta ?? 0 : 0), y: bounds.y + (d.y < 0 ? validY?.delta ?? 0 : 0),
    width: bounds.width + d.x * (validX?.delta ?? 0), height: bounds.height + d.y * (validY?.delta ?? 0) },
    guides: { x: validX?.guide, y: validY?.guide } };
}
