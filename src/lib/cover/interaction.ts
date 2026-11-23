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
