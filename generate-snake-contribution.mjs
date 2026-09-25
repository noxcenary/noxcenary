#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.GITHUB_TOKEN;
const LOGIN = process.env.GITHUB_LOGIN || process.env.GITHUB_REPOSITORY_OWNER;
const OUT_DIR = process.env.OUT_DIR || 'dist';
const FRAMES = Number(process.env.FRAMES || 240);

if (!TOKEN || !LOGIN) {
  console.error('Missing GITHUB_TOKEN or GITHUB_LOGIN env vars.');
  process.exit(1);
}

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            contributionCount
            weekday
          }
        }
      }
    }
  }
}`;

async function fetchContributions() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'github-contribution-snake-generator',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const weeks = json.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error('No contribution calendar returned.');

  return weeks.map(w => {
    const col = new Array(7).fill(0);
    for (const d of w.contributionDays) col[d.weekday] = d.contributionCount;
    return col;
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => t * t * (3 - 2 * t);
const fmt = n => Number(n.toFixed(2));

function levelOf(count, max) {
  if (count <= 0) return 0;
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.75) return 4;
  if (ratio > 0.50) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// A continuous serpentine route through the contribution grid.
function buildRoute(grid) {
  const route = [];
  for (let w = 0; w < grid.length; w++) {
    if (w % 2 === 0) {
      for (let d = 0; d < 7; d++) route.push({ w, d });
    } else {
      for (let d = 6; d >= 0; d--) route.push({ w, d });
    }
  }
  return route;
}

function center(MARGIN_X, MARGIN_Y, STEP, CELL, w, d) {
  return [
    MARGIN_X + w * STEP + CELL / 2,
    MARGIN_Y + d * STEP + CELL / 2,
  ];
}

function pointAt(points, progress) {
  if (points.length < 2) return points[0] || [0, 0];

  if (progress < 0) {
    const a = points[0];
    const b = points[1];
    return [
      a[0] + (b[0] - a[0]) * progress,
      a[1] + (b[1] - a[1]) * progress,
    ];
  }

  if (progress >= points.length - 1) {
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    const t = progress - (points.length - 2);
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];
  }

  const i = Math.floor(progress);
  const t = easeInOut(progress - i);
  const a = points[i];
  const b = points[i + 1];
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

function directionAt(points, progress) {
  const a = pointAt(points, progress - 0.12);
  const b = pointAt(points, progress + 0.12);
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
}

function sparkle(x, y, frame, color = '#39d353') {
  const pulse = 0.7 + 0.3 * Math.sin(frame * 0.7);
  return `<g opacity="${fmt(pulse)}">
    <circle cx="${fmt(x)}" cy="${fmt(y)}" r="1.1" fill="#ffffff"/>
    <path d="M ${fmt(x - 4)} ${fmt(y)} H ${fmt(x + 4)} M ${fmt(x)} ${fmt(y - 4)} V ${fmt(y + 4)}" stroke="${color}" stroke-width="0.8" stroke-linecap="round"/>
  </g>`;
}

function snakeHead(x, y, angle, frame) {
  const wag = Math.sin(frame * 0.65) * 0.8;
  return `<g transform="translate(${fmt(x)} ${fmt(y)}) rotate(${fmt(angle)})">
    <rect x="-5.2" y="-4.2" width="10.4" height="8.4" rx="3.6" fill="#39d353"/>
    <circle cx="1.8" cy="-2.2" r="1.2" fill="#0d1117"/>
    <circle cx="1.8" cy="2.2" r="1.2" fill="#0d1117"/>
    <path d="M 5.3 -1.2 Q ${fmt(8 + wag)} -0.2 9.3 -2.3 M 5.3 1.2 Q ${fmt(8 - wag)} 0.2 9.3 2.3" stroke="#39d353" stroke-width="0.9" fill="none" stroke-linecap="round"/>
  </g>`;
}

function snakeBody(points, headProgress, length, frame) {
  let out = '';
  const SEG_SPACING = 0.62; // contribution-grid cell units

  for (let i = length - 1; i >= 1; i--) {
    const p = pointAt(points, headProgress - i * SEG_SPACING);
    const tailRatio = i / Math.max(length - 1, 1);
    const radius = Math.max(1.55, 3.0 - tailRatio * 1.45);
    const wobble = Math.sin(frame * 0.16 - i * 0.42) * 0.55;
    const shade = i % 3 === 0 ? '#2ea043' : '#39d353';
    out += `<circle cx="${fmt(p[0] + wobble)}" cy="${fmt(p[1])}" r="${fmt(radius)}" fill="${shade}"/>`;
  }

  return out;
}

function renderFrame(grid, frameIndex, totalFrames) {
  const CELL = 10;
  const GAP = 3;
  const STEP = CELL + GAP;
  const MARGIN_X = 56;
  const MARGIN_Y = 16;
  const WEEKS = grid.length;
  const DAYS = 7;
  const W = MARGIN_X * 2 + WEEKS * STEP - GAP;
  const H = MARGIN_Y * 2 + DAYS * STEP - GAP;
  const maxCount = Math.max(1, ...grid.flat());

  const route = buildRoute(grid);
  const points = route.map(p => center(MARGIN_X, MARGIN_Y, STEP, CELL, p.w, p.d));

  // Start outside the grid so the initial five-segment snake is clearly visible.
  const startOffset = -5.2;
  const endProgress = points.length - 1;
  const headProgress = startOffset + (frameIndex / (totalFrames - 1)) * (endProgress - startOffset);
  const gridIndex = Math.floor(headProgress);

  const dark = '#0d1117';
  const cellBg = '#161b22';
  const scales = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];

  // Contribution dots are the food. Their radius reflects contribution intensity.
  let cells = '';
  let sparkleLayer = '';
  let eatenCount = 0;

  const eatenBefore = Math.floor(headProgress);
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const [cx, cy] = center(MARGIN_X, MARGIN_Y, STEP, CELL, w, d);
      const level = levelOf(grid[w][d], maxCount);
      const idx = w * 7 + (w % 2 === 0 ? d : 6 - d);

      // Keep the familiar GitHub grid backdrop.
      cells += `<rect x="${fmt(cx - CELL / 2)}" y="${fmt(cy - CELL / 2)}" width="${CELL}" height="${CELL}" rx="2.4" fill="${cellBg}"/>`;

      if (grid[w][d] <= 0 || level <= 0) continue;

      const eaten = idx <= eatenBefore;
      if (!eaten) {
        const r = [0, 2.0, 2.4, 2.8, 3.2][level];
        cells += `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${scales[level]}"/>`;
      }

      if (idx === gridIndex && !eaten && level > 0) {
        sparkleLayer += sparkle(cx, cy, frameIndex);
      }

      if (eaten) eatenCount++;
    }
  }

  const snakeLength = 5 + eatenCount;
  const angle = directionAt(points, headProgress);
  const head = pointAt(points, headProgress);

  const body = snakeBody(points, headProgress, snakeLength, frameIndex);
  const headSvg = snakeHead(head[0], head[1], angle, frameIndex);

  // Tiny dust trail makes the motion easier to read without overpowering the graph.
  const trailP = pointAt(points, headProgress - 0.9);
  const trail = `<circle cx="${fmt(trailP[0])}" cy="${fmt(trailP[1])}" r="1.2" fill="#39d353" opacity="0.28"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="${dark}"/>
  ${cells}
  ${sparkleLayer}
  ${trail}
  ${body}
  ${headSvg}
</svg>`;
}

async function main() {
  const grid = await fetchContributions();
  const frameRoot = path.join(OUT_DIR, 'snake-frames');
  fs.rmSync(frameRoot, { recursive: true, force: true });
  fs.mkdirSync(frameRoot, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (let i = 0; i < FRAMES; i++) {
    const svg = renderFrame(grid, i, FRAMES);
    fs.writeFileSync(
      path.join(frameRoot, `frame-${String(i).padStart(3, '0')}.svg`),
      svg,
    );
  }

  // Static fallbacks for older README references.
  fs.writeFileSync(
    path.join(OUT_DIR, 'github-snake.svg'),
    renderFrame(grid, 0, FRAMES),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'github-snake-dark.svg'),
    renderFrame(grid, 0, FRAMES),
  );

  console.log(`Generated ${FRAMES} snake frames; start length = 5; length grows by 1 per eaten contribution.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
