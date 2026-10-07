# Scanbox Photo Studio

![Scanbox Photo Studio](https://raw.githubusercontent.com/Invertee/Scanbox/main/box.png)

A Windows desktop app for scanning several prints from an A4 flatbed, separating the photos, reviewing the crop boxes, and exporting individual JPEGs with EXIF dates and GPS coordinates.

## What it does

- Scans A4 colour pages at various DPIs through a WIA or TWAIN scanner driver.
- Detects photo regions on the page and displays numbered crop boxes for review.
- Select a crop and drag its left handle to move it or its right handle to rotate it.
- Lets you exclude crops, remove them, or drag a box on the scan to add a manual crop, move and rotate as required
- Imports existing JPEG, PNG, TIFF, BMP, or WebP images for crop practice without connecting a scanner.
- Applies a selected photo date and an OpenStreetMap-picked location to selected crops.
- Saves high-quality JPEGs with EXIF date, GPS, and resolution tags.

## Windows scanner setup

The app uses [NAPS2](https://www.naps2.com/download) to access Windows WIA and TWAIN scanner drivers. Install NAPS2 on the same PC as the scanner. The app looks for `NAPS2.Console.exe` in the standard Program Files folder, then lists scanners found through WIA and TWAIN. If a scanner does not appear under one driver, switch the driver selector and refresh the list.

The scan controls use the A4 glass source and the selected DPI. Put prints face down on the glass with some blank space between them for better automatic separation.

## Run from source

Install a current Node.js LTS release, then from this folder run:

```powershell
npm install
npm start
```

## Build a Windows installer

On Windows, open PowerShell in the project folder (the folder containing `package.json`). Install the project dependencies, then build the installer:

```powershell
npm install
npm run dist
```

The interactive NSIS installer is created in `dist/` with a name like `Scanbox-Photo-Studio-Setup-1.0.0.exe`; the version comes from `package.json`. Run that `.exe` to install the app. The installer offers an install location and creates Start Menu and desktop shortcuts.

NAPS2 is installed separately and is not bundled in this installer. Install it on each PC that will use a scanner; importing existing images does not require it.

## Notes

- Images are read, cropped, and written on the local PC. EXIF dates are stored at midnight because the selector records a date without a time.
- The map fetches visible map tiles from OpenStreetMap and shows the required contributor attribution. Map use requires an internet connection.
- A scanner and NAPS2 are not required for the import-image workflow.
