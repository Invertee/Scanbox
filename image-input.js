const path = require('node:path');
const sharp = require('sharp');

function openImage(imagePath) {
  // High-DPI scanner TIFFs can have a single decoded strip larger than
  // libtiff's 50 MiB allocation cap. Keep the separate image pixel limit.
  const isTiff = ['.tif', '.tiff'].includes(path.extname(imagePath).toLowerCase());
  return sharp(imagePath, { limitInputPixels: 160_000_000, unlimited: isTiff });
}

module.exports = { openImage };
