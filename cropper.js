function closeMask(mask, width, height, radius = 4) {
  const horizontal = new Uint8Array(mask.length);
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let found = 0;
      const start = Math.max(0, x - radius);
      const end = Math.min(width - 1, x + radius);
      for (let sx = start; sx <= end; sx += 1) if (mask[row + sx]) { found = 1; break; }
      horizontal[row + x] = found;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let found = 0;
      const start = Math.max(0, y - radius);
      const end = Math.min(height - 1, y + radius);
      for (let sy = start; sy <= end; sy += 1) if (horizontal[sy * width + x]) { found = 1; break; }
      dilated[y * width + x] = found;
    }
  }
  const erodedHorizontal = new Uint8Array(mask.length);
  const closed = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let filled = 1;
      const start = Math.max(0, x - radius);
      const end = Math.min(width - 1, x + radius);
      for (let sx = start; sx <= end; sx += 1) if (!dilated[row + sx]) { filled = 0; break; }
      erodedHorizontal[row + x] = filled;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let filled = 1;
      const start = Math.max(0, y - radius);
      const end = Math.min(height - 1, y + radius);
      for (let sy = start; sy <= end; sy += 1) if (!erodedHorizontal[sy * width + x]) { filled = 0; break; }
      closed[y * width + x] = filled;
    }
  }
  return closed;
}

function mergeNearby(regions, gap = 16) {
  const boxes = regions.map((box) => ({ ...box }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
        const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
        if (dx <= gap && dy <= gap) {
          const left = Math.min(a.x, b.x);
          const top = Math.min(a.y, b.y);
          const right = Math.max(a.x + a.width, b.x + b.width);
          const bottom = Math.max(a.y + a.height, b.y + b.height);
          boxes[i] = { x: left, y: top, width: right - left, height: bottom - top };
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return boxes;
}

function findPhotoRegions(gray, width, height, threshold = 242, padding = 0.025) {
  const mask = new Uint8Array(width * height);
  const safeThreshold = Math.max(150, Math.min(254, Number(threshold) || 242));
  for (let i = 0; i < mask.length; i += 1) mask[i] = gray[i] < safeThreshold ? 1 : 0;
  const closed = closeMask(mask, width, height, Math.max(2, Math.round(width / 300)));
  const seen = new Uint8Array(closed.length);
  const stack = new Int32Array(closed.length);
  const boxes = [];
  const minArea = Math.max(800, Math.floor(width * height * 0.00022));
  for (let start = 0; start < closed.length; start += 1) {
    if (!closed[start] || seen[start]) continue;
    let stackLength = 1;
    stack[0] = start;
    seen[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (stackLength) {
      const index = stack[--stackLength];
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let n = 0; n < 4; n += 1) {
        const next = neighbors[n];
        if (next < 0 || next >= closed.length || seen[next] || !closed[next]) continue;
        if ((n === 0 && x === 0) || (n === 1 && x === width - 1)) continue;
        seen[next] = 1;
        stack[stackLength++] = next;
      }
    }
    if (area >= minArea && maxX - minX >= 35 && maxY - minY >= 35) {
      boxes.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
    }
  }
  const merged = mergeNearby(boxes, Math.max(10, Math.round(width / 90)));
  return merged.map((box) => {
    const padX = Math.round(box.width * Math.max(0, Math.min(0.1, padding)));
    const padY = Math.round(box.height * Math.max(0, Math.min(0.1, padding)));
    const left = Math.max(0, box.x - padX);
    const top = Math.max(0, box.y - padY);
    const right = Math.min(width, box.x + box.width + padX);
    const bottom = Math.min(height, box.y + box.height + padY);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }).filter((box) => box.width < width * 0.98 || box.height < height * 0.98)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

module.exports = { findPhotoRegions };
