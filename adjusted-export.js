const sharp = require('sharp');
const adjustments = require('./image-adjustments');

async function adjustedExport(image, settings) {
  if (!adjustments.isActive(settings)) return image;
  const { data, info } = await image.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  adjustments.apply(data, info.width, info.height, info.channels, settings);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
}

module.exports = { adjustedExport };
