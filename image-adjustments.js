(function (root) {
  const controls = [
    { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
    { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.1 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
    { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
    { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
    { key: 'sharpness', label: 'Sharpness', min: 0, max: 100, step: 1 }
  ];

  function normalize(value = {}) {
    const input = value && typeof value === 'object' ? value : {};
    const result = { enabled: input.enabled !== false, expanded: input.expanded === true };
    for (const control of controls) {
      const number = Number(input[control.key]);
      result[control.key] = Number.isFinite(number)
        ? Math.max(control.min, Math.min(control.max, Math.round(number / control.step) * control.step)) : 0;
    }
    return result;
  }

  function isActive(value) {
    const settings = normalize(value);
    return settings.enabled && controls.some(({ key }) => settings[key] !== 0);
  }

  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

  // Shared by canvas previews/downloads and desktop exports. Work in-place;
  // sharpening retains only three source rows, even for high-DPI crops.
  function apply(data, width, height, channels, value) {
    const settings = normalize(value);
    if (!isActive(settings)) return data;
    if (![3, 4].includes(channels) || data.length !== width * height * channels) {
      throw new Error('Image adjustments need RGB or RGBA pixels.');
    }
    const exposure = 2 ** settings.exposure;
    const contrast = 2 ** (settings.contrast / 100);
    const brightness = settings.brightness / 100 * 0.25;
    const saturation = 1 + settings.saturation / 100;
    const tone = new Float64Array(256);
    for (let index = 0; index < 256; index += 1) {
      const srgb = index / 255;
      const linear = (srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4) * exposure;
      const exposed = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
      tone[index] = Math.max(0, Math.min(1, (exposed - 0.5) * contrast + 0.5 + brightness));
    }
    for (let index = 0; index < data.length; index += channels) {
      const r = tone[data[index]], g = tone[data[index + 1]], b = tone[data[index + 2]];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const shift = 0.35 * (settings.shadows / 100 * (1 - luminance) ** 2
        + settings.highlights / 100 * luminance ** 2);
      data[index] = clamp((luminance + (r - luminance) * saturation + shift) * 255);
      data[index + 1] = clamp((luminance + (g - luminance) * saturation + shift) * 255);
      data[index + 2] = clamp((luminance + (b - luminance) * saturation + shift) * 255);
    }
    if (settings.sharpness > 0) {
      const stride = width * channels;
      let current = Uint8Array.from(data.subarray(0, stride));
      let previous = current;
      const amount = settings.sharpness / 100;
      for (let y = 0; y < height; y += 1) {
        const next = y + 1 < height ? Uint8Array.from(data.subarray((y + 1) * stride, (y + 2) * stride)) : current;
        for (let x = 0; x < width; x += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            const index = x * channels + channel;
            const neighbours = previous[index] + next[index]
              + current[Math.max(0, x - 1) * channels + channel]
              + current[Math.min(width - 1, x + 1) * channels + channel];
            data[y * stride + index] = clamp(current[index] + amount * (current[index] - neighbours / 4));
          }
        }
        previous = current;
        current = next;
      }
    }
    return data;
  }

  const api = { controls, normalize, isActive, apply };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScanboxAdjustments = api;
})(typeof globalThis === 'object' ? globalThis : this);
