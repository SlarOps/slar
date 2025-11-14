const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputFile = path.join(__dirname, 'public/icon.svg');
const outputDir = path.join(__dirname, 'public');

async function generateIcons() {
  console.log('🎨 Generating PWA icons...\n');

  // Check if input file exists
  if (!fs.existsSync(inputFile)) {
    console.error('❌ Error: icon.svg not found in public/ directory');
    process.exit(1);
  }

  // Generate all sizes
  const promises = sizes.map(size => {
    const outputFile = path.join(outputDir, `icon-${size}x${size}.png`);

    return sharp(inputFile)
      .resize(size, size)
      .png({ quality: 100 })
      .toFile(outputFile)
      .then(() => {
        console.log(`✓ Generated icon-${size}x${size}.png`);
      })
      .catch(err => {
        console.error(`✗ Error generating ${size}x${size}:`, err.message);
      });
  });

  await Promise.all(promises);

  console.log('\n✅ All icons generated successfully!');
  console.log('\n📋 Verification:');
  console.log('Run: ls -lh public/icon-*.png');
}

generateIcons();
