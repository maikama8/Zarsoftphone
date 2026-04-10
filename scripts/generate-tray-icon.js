const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '../public/icon.svg');
const buildPath = path.join(__dirname, '../build');

// Create build directory if it doesn't exist
if (!fs.existsSync(buildPath)) {
  fs.mkdirSync(buildPath, { recursive: true });
}

console.log('Generating tray icons...');

async function generateTrayIcons() {
  // macOS tray icon (16x16 and 32x32 for retina)
  await sharp(svgPath)
    .resize(16, 16)
    .png()
    .toFile(path.join(buildPath, 'trayIcon.png'));
  console.log('✓ Generated trayIcon.png (16x16)');
  
  await sharp(svgPath)
    .resize(32, 32)
    .png()
    .toFile(path.join(buildPath, 'trayIcon@2x.png'));
  console.log('✓ Generated trayIcon@2x.png (32x32)');
  
  // Windows tray icon
  await sharp(svgPath)
    .resize(16, 16)
    .png()
    .toFile(path.join(buildPath, 'trayIcon-win.png'));
  console.log('✓ Generated trayIcon-win.png (16x16)');
  
  await sharp(svgPath)
    .resize(32, 32)
    .png()
    .toFile(path.join(buildPath, 'trayIcon-win@2x.png'));
  console.log('✓ Generated trayIcon-win@2x.png (32x32)');
  
  console.log('\n✅ Tray icon generation complete!');
}

generateTrayIcons().catch(error => {
  console.error('Error generating tray icons:', error);
  process.exit(1);
});
