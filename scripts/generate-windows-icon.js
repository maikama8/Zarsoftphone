const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '../public/icon.svg');
const buildPath = path.join(__dirname, '../build');
const tempPath = path.join(buildPath, 'temp');

// Create directories
if (!fs.existsSync(buildPath)) {
  fs.mkdirSync(buildPath, { recursive: true });
}
if (!fs.existsSync(tempPath)) {
  fs.mkdirSync(tempPath, { recursive: true });
}

console.log('Generating Windows icon (.ico)...');

async function generateWindowsIcon() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngFiles = [];
  
  // Generate PNG files at different sizes
  for (const size of sizes) {
    const pngPath = path.join(tempPath, `icon_${size}.png`);
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(pngPath);
    
    pngFiles.push(pngPath);
    console.log(`✓ Generated ${size}x${size}`);
  }
  
  // Convert to .ico
  console.log('\nConverting to .ico format...');
  
  // Read PNG buffers
  const pngBuffers = await Promise.all(
    pngFiles.map(file => fs.promises.readFile(file))
  );
  
  const icoBuffer = await toIco(pngBuffers);
  fs.writeFileSync(path.join(buildPath, 'icon.ico'), icoBuffer);
  console.log('✓ Created icon.ico');
  
  // Clean up temp files
  fs.rmSync(tempPath, { recursive: true });
  console.log('✓ Cleaned up temporary files');
  
  console.log('\n✅ Windows icon generation complete!');
}

generateWindowsIcon().catch(error => {
  console.error('Error generating Windows icon:', error);
  process.exit(1);
});
