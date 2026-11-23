import { coverGeometry, layerBounds, type CoverLayer, type CoverProject } from "./model";
import type { SnapTargets } from "./interaction";

export function selectionBounds(layers: CoverLayer[]) {
  const boxes = layers.map(layerBounds);
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
}
export function selectionForLayer(project: CoverProject, layer: CoverLayer) {
  return project.layers.filter(l => l.id === layer.id || (!!layer.groupId && l.groupId === layer.groupId)).map(l => l.id);
}
export function coverSnapTargets(project: CoverProject, excluded: string[]): SnapTargets {
  const g = coverGeometry(project);
  const x = [0, 9, 18, g.width - 18, g.width - 9, g.width, g.spineX, g.spineX + g.spine / 2, g.spineX + g.spine];
  const y = [0, 9, 18, g.height / 2, g.height - 18, g.height - 9, g.height];
  for (const panel of [g.front, g.back]) x.push(panel.x + 9, panel.x + panel.width / 2, panel.x + panel.width - 9);
  for (const layer of project.layers.filter(l => !l.hidden && !excluded.includes(l.id))) {
    const b = layerBounds(layer); x.push(b.x, b.x + b.width / 2, b.x + b.width); y.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  return { x, y };
}
export function cropImageDrag(layer: Extract<CoverLayer, { type: "image" }>, dx: number, dy: number) {
  const angle = layer.rotation * Math.PI / 180;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const fit = Math.max(layer.width / layer.pixelWidth, layer.height / layer.pixelHeight) * (layer.cropZoom ?? 1);
  const extraX = (layer.pixelWidth * fit - layer.width) / 2, extraY = (layer.pixelHeight * fit - layer.height) / 2;
  return { cropX: extraX > 0.0001 ? Math.max(-1, Math.min(1, (layer.cropX ?? 0) + localX / extraX)) : 0,
    cropY: extraY > 0.0001 ? Math.max(-1, Math.min(1, (layer.cropY ?? 0) + localY / extraY)) : 0 };
}
