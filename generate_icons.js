
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function createIcon(size, fileName) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#6366f1'; // var(--primary)
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.2);
    ctx.fill();

    // Text "E"
    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.floor(size * 0.6)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('E', size / 2, size / 2);

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(__dirname, fileName), buffer);
    console.log(`Icon ${fileName} created.`);
}

createIcon(192, 'icon-192.png');
createIcon(512, 'icon-512.png');
createIcon(180, 'apple-touch-icon.png');
