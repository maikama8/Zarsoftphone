const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sizes = [16, 32, 64, 128, 256, 512, 1024];
const iconsetPath = path.join(__dirname, '../build/icon.iconset');
const svgPath = path.join(__dirname, '../public/icon.svg');

// Create iconset directory
if (!fs.existsSync(iconsetPath)) {
  fs.mkdirSync(iconsetPath, { recursive: true });
}

console.log('Generating PNG files from SVG...');

async function generateIcons() {
  for (const size of sizes) {
    // Standard resolution
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsetPath, `icon_${size}x${size}.png`));
    
    console.log(`✓ Generated ${size}x${size}`);
    
    // Retina resolution (2x)
    if (size <= 512) {
      await sharp(svgPath)
        .resize(size * 2, size * 2)
        .png()
        .toFile(path.join(iconsetPath, `icon_${size}x${size}@2x.png`));
      
      console.log(`✓ Generated ${size}x${size}@2x`);
    }
  }
  
  console.log('\nConverting to .icns format...');
  
  // Use macOS iconutil to create .icns
  try {
    execSync(`iconutil -c icns "${iconsetPath}" -o "${path.join(__dirname, '../build/icon.icns')}"`, {
      stdio: 'inherit'
    });
    console.log('✓ Created icon.icns');
    
    // Clean up iconset directory
    fs.rmSync(iconsetPath, { recursive: true });
    console.log('✓ Cleaned up temporary files');
    
    console.log('\n✅ Icon generation complete!');
  } catch (error) {
    console.error('Error creating .icns:', error.message);
    process.exit(1);
  }
}

generateIcons().catch(error => {
  console.error('Error generating icons:', error);
  process.exit(1);
});
