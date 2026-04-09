#!/usr/bin/env node

/**
 * Icon Generation Script for Zarsip
 * 
 * This script provides instructions for generating app icons.
 * For actual conversion, you'll need external tools like ImageMagick or online converters.
 */

const fs = require('fs');
const path = require('path');

console.log('\n🎨 Zarsip Icon Generator\n');
console.log('═'.repeat(50));

const iconPath = path.join(__dirname, '../build/icon.svg');

if (!fs.existsSync(iconPath)) {
  console.error('❌ Error: icon.svg not found in build/ directory');
  process.exit(1);
}

console.log('✅ Found icon.svg');
console.log('\n📋 To generate PNG and platform-specific icons:\n');

console.log('Option 1: Using ImageMagick (Recommended)');
console.log('─'.repeat(50));
console.log('Install: brew install imagemagick');
console.log('\nGenerate PNGs:');
console.log('  cd build');
console.log('  convert -background none icon.svg -resize 1024x1024 icon.png');
console.log('  convert -background none icon.svg -resize 512x512 icon-512.png');
console.log('  convert -background none icon.svg -resize 256x256 icon-256.png');
console.log('  convert -background none icon.svg -resize 128x128 icon-128.png');
console.log('  convert -background none icon.svg -resize 64x64 icon-64.png');
console.log('  convert -background none icon.svg -resize 32x32 icon-32.png');
console.log('  convert -background none icon.svg -resize 16x16 icon-16.png');

console.log('\n\nOption 2: Using macOS iconutil');
console.log('─'.repeat(50));
console.log('  mkdir icon.iconset');
console.log('  # Use sips to convert SVG to PNG at different sizes');
console.log('  # Then: iconutil -c icns icon.iconset');

console.log('\n\nOption 3: Online Converter');
console.log('─'.repeat(50));
console.log('  1. Visit: https://cloudconvert.com/svg-to-png');
console.log('  2. Upload: build/icon.svg');
console.log('  3. Set size: 1024x1024');
console.log('  4. Download PNG');
console.log('\n  For .icns: https://cloudconvert.com/png-to-icns');
console.log('  For .ico: https://cloudconvert.com/png-to-ico');

console.log('\n\n📦 Electron Builder Configuration');
console.log('─'.repeat(50));
console.log('Add to package.json:');
console.log(`
{
  "build": {
    "mac": {
      "icon": "build/icon.icns"
    },
    "win": {
      "icon": "build/icon.ico"
    },
    "linux": {
      "icon": "build/icon.png"
    }
  }
}
`);

console.log('\n✨ Icon design ready! Follow the steps above to generate platform icons.\n');
