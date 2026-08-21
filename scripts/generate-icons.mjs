#!/usr/bin/env node
// ============================================================================
// One-time PWA icon generator — re-run manually whenever the mascot/icon
// design changes (`node scripts/generate-icons.mjs`); NOT part of the
// build pipeline. @resvg/resvg-js is a devDependency used ONLY by this
// script (a prebuilt-binary Rust rasterizer via napi-rs, no system SVG
// tool like rsvg-convert/imagemagick/inkscape required) — it never ships
// in the app's runtime bundle, keeping the app itself at 3 runtime deps.
//
// One shared glyph-drawing function (buildIconSvg) generates every
// variant, so the mascot can never visually drift between them:
//   - "standard" icons (192/512/apple-touch-icon) reproduce favicon.svg's
//     proportions almost at full bleed, rounded-rect background.
//   - "maskable" (512, for Android's adaptive-icon masking) uses a
//     FULL-BLEED SQUARE background — the OS applies its own mask/rounding,
//     so a pre-rounded background here would look wrong under a circular
//     mask — and insets the glyph further so it stays inside the ~80%
//     "safe zone" every platform guarantees won't be cropped.
// ============================================================================

import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const GRADIENT_FROM = '#7dd3fc';
const GRADIENT_TO = '#c084fc';
const BG = '#05050a'; // matches index.css's --bg-0 token

/**
 * The pyramid+eye mascot, same design as public/favicon.svg (originally
 * authored in a 32-unit box: apex at (16,5), base corners at (28,25)/
 * (4,25), eye centered at (16,18.5) r=4.4, pupil r=1.7). Reproduced here
 * anchored on the EYE's center (matching the original, which isn't
 * geometrically centered in its own box — the eye sits slightly below
 * center), scaled to whatever glyph size `s` is requested.
 */
function buildIconSvg({ size, maskable }) {
  const cornerRadius = maskable ? 0 : size * 0.22; // matches favicon.svg's 7/32 ratio
  const glyphScale = maskable ? 0.6 : 0.82; // maskable needs real margin inside the safe zone
  const cx = size / 2;
  const cy = size / 2;
  const unit = (size * glyphScale) / 32;

  const apexX = cx;
  const apexY = cy - 13.5 * unit;
  const baseRightX = cx + 12 * unit;
  const baseRightY = cy + 6.5 * unit;
  const baseLeftX = cx - 12 * unit;
  const baseLeftY = cy + 6.5 * unit;
  const eyeR = 4.4 * unit;
  const pupilR = 1.7 * unit;
  const strokeW = Math.max(1, 1.6 * unit);
  const eyeStrokeW = strokeW * 0.875; // matches favicon.svg's 1.4/1.6 ratio

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${GRADIENT_FROM}"/>
      <stop offset="100%" stop-color="${GRADIENT_TO}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${cornerRadius}" fill="${BG}"/>
  <path d="M ${apexX} ${apexY} L ${baseRightX} ${baseRightY} L ${baseLeftX} ${baseLeftY} Z" fill="none" stroke="url(#g)" stroke-width="${strokeW}" stroke-linejoin="round"/>
  <circle cx="${cx}" cy="${cy}" r="${eyeR}" fill="none" stroke="url(#g)" stroke-width="${eyeStrokeW}"/>
  <circle cx="${cx}" cy="${cy}" r="${pupilR}" fill="url(#g)"/>
</svg>`;
}

function renderPng(svgString, size, filename) {
  const resvg = new Resvg(svgString, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  writeFileSync(join(outDir, filename), png);
  console.log(`Wrote public/icons/${filename} (${size}x${size})`);
}

renderPng(buildIconSvg({ size: 192, maskable: false }), 192, 'icon-192.png');
renderPng(buildIconSvg({ size: 512, maskable: false }), 512, 'icon-512.png');
renderPng(buildIconSvg({ size: 512, maskable: true }), 512, 'icon-512-maskable.png');
renderPng(buildIconSvg({ size: 180, maskable: false }), 180, 'apple-touch-icon.png');

console.log('Done.');
