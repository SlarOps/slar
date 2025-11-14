# Generate PWA Icons

The PWA requires icons in multiple sizes. Here are options to generate them:

## Option 1: Using Online Tool (Easiest)

1. Visit https://www.pwabuilder.com/imageGenerator
2. Upload your logo/icon (512x512 recommended)
3. Download the generated icon pack
4. Copy all icons to `public/` folder

## Option 2: Using ImageMagick (Local)

If you have ImageMagick installed:

```bash
cd public

# Create a base icon first (512x512)
# Place your base icon as icon-base.png

# Generate all sizes
magick icon-base.png -resize 72x72 icon-72x72.png
magick icon-base.png -resize 96x96 icon-96x96.png
magick icon-base.png -resize 128x128 icon-128x128.png
magick icon-base.png -resize 144x144 icon-144x144.png
magick icon-base.png -resize 152x152 icon-152x152.png
magick icon-base.png -resize 192x192 icon-192x192.png
magick icon-base.png -resize 384x384 icon-384x384.png
magick icon-base.png -resize 512x512 icon-512x512.png
```

## Option 3: Using Node Script

Create a simple icon generator script:

```bash
npm install sharp --save-dev
```

Then run:

```javascript
// generate-icons.js
const sharp = require('sharp');
const fs = require('fs');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputFile = 'public/icon-base.png'; // Your base icon

sizes.forEach(size => {
  sharp(inputFile)
    .resize(size, size)
    .toFile(`public/icon-${size}x${size}.png`)
    .then(() => console.log(`✓ Generated icon-${size}x${size}.png`))
    .catch(err => console.error(`✗ Error generating ${size}x${size}:`, err));
});
```

Run:
```bash
node generate-icons.js
```

## Temporary Solution: Create Simple SVG Icons

For quick testing, create simple SVG icons:

```bash
cd public

# Create a simple blue/purple gradient icon
cat > icon.svg << 'EOF'
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2563eb;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#7c3aed;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="80" fill="url(#grad)"/>
  <text x="256" y="340" font-size="300" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial">S</text>
</svg>
EOF

# Convert SVG to PNG (requires ImageMagick or similar)
# Or use the SVG directly in manifest (some browsers support it)
```

## Required Icons

Make sure you have these files in `public/`:

- icon-72x72.png
- icon-96x96.png
- icon-128x128.png
- icon-144x144.png
- icon-152x152.png (Apple Touch Icon)
- icon-192x192.png (Android)
- icon-384x384.png
- icon-512x512.png (Android splash)

## Screenshots (Optional)

For better app store listing:

- screenshot-mobile.png (540x720 - narrow)
- screenshot-desktop.png (1280x720 - wide)

Take screenshots of:
1. Mobile: AI Agent chat interface
2. Desktop: Full dashboard view

## Verification

After generating icons:

1. Check all files exist:
```bash
ls -la public/icon-*.png
```

2. Verify sizes:
```bash
file public/icon-*.png
```

3. Test manifest:
```bash
curl http://localhost:3000/manifest.json
```
