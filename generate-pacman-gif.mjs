#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.GITHUB_TOKEN;
const LOGIN = process.env.GITHUB_LOGIN || process.env.GITHUB_REPOSITORY_OWNER;
const OUT_DIR = process.env.OUT_DIR || 'dist';
const FRAMES = Number(process.env.FRAMES || 120);

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
      'User-Agent': 'pacman-contribution-gif-generator',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  return json.data.user.contributionsCollection.contributionCalendar.weeks.map(w => {
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
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function buildRoute(grid) {
  const route = [];
  for (let w = 0; w < grid.length; w++) {
    if (w % 2 === 0) for (let d = 0; d < 7; d++) route.push({ w, d });
    else for (let d = 6; d >= 0; d--) route.push({ w, d });
  }
  return route;
}

function center(MARGIN, STEP, CELL, w, d) {
  return [MARGIN + w * STEP + CELL / 2, MARGIN + d * STEP + CELL / 2];
}

function smoothRoutePoint(points, progress) {
  // Clamp to the route and interpolate between adjacent cells.
  progress = clamp(progress, 0, points.length - 1);
  const i = Math.floor(progress);
  const t = easeInOut(progress - i);
  const a = points[i];
  const b = points[Math.min(i + 1, points.length - 1)];
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

function routeDirection(points, progress) {
  const p0 = smoothRoutePoint(points, Math.max(0, progress - 0.25));
  const p1 = smoothRoutePoint(points, Math.min(points.length - 1, progress + 0.25));
  const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
  return { angle, dx: p1[0] - p0[0], dy: p1[1] - p0[1] };
}

function pacmanSvg(angle, mouthOpen, theme) {
  const body = '#ffd84a';
  const mouth = theme === 'dark' ? '#0d1117' : '#ffffff';
  const eye = '#171717';
  const top = mouthOpen ? 38 : 4;
  const bottom = mouthOpen ? 38 : -4;
  return `
    <g transform="rotate(${fmt(angle)})">
      <path d="M0 0 L8 ${-top / 3} A8 8 0 1 1 8 ${top / 3} Z" fill="${body}"/>
      <path d="M0 0 L8 -${bottom / 3} A8 8 0 1 0 8 ${bottom / 3} Z" fill="${body}" opacity="0"/>
      ${mouthOpen ? `<path d="M0 0 L9 -4 A10 10 0 0 1 9 4 Z" fill="${mouth}"/>` : ''}
      <circle cx="-1.8" cy="-3.8" r="1" fill="${eye}"/>
    </g>`;
}

function ghostSvg(color, theme) {
  const pupil = theme === 'dark' ? '#0d1117' : '#222';
  return `
    <path d="M-6 6V-1C-6-5-3.5-7 0-7S6-5 6-1V6L3.6 4.1 1.2 6-1.2 4.1-3.6 6-6 3.9Z" fill="${color}"/>
    <circle cx="-2" cy="-2" r="1.6" fill="#fff"/>
    <circle cx="2" cy="-2" r="1.6" fill="#fff"/>
    <circle cx="-1.5" cy="-1.8" r="0.7" fill="${pupil}"/>
    <circle cx="2.5" cy="-1.8" r="0.7" fill="${pupil}"/>`;
}

function renderFrame(grid, theme, frameIndex, totalFrames) {
  const CELL = 10;
  const GAP = 3;
  const STEP = CELL + GAP;
  const MARGIN = 14;
  const WEEKS = grid.length;
  const DAYS = 7;
  const W = MARGIN * 2 + WEEKS * STEP - GAP;
  const H = MARGIN * 2 + DAYS * STEP - GAP;
  const maxCount = Math.max(1, ...grid.flat());
  const route = buildRoute(grid);
  const points = route.map(p => center(MARGIN, STEP, CELL, p.w, p.d));
  const progress = (frameIndex / (totalFrames - 1)) * (points.length - 1);
  const p = smoothRoutePoint(points, progress);
  const dir = routeDirection(points, progress);

  const dark = theme === 'dark';
  const bg = dark ? '#0d1117' : '#ffffff';
  const scale = dark
    ? ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
    : ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
  const ghosts = dark
    ? ['#ff4d4d', '#ff9ecf', '#2edbff', '#ffb84d']
    : ['#d62828', '#e65f96', '#1098b7', '#e09118'];

  let cells = '';
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const [cx, cy] = center(MARGIN, STEP, CELL, w, d);
      const level = levelOf(grid[w][d], maxCount);
      const idx = w * 7 + (w % 2 === 0 ? d : 6 - d);
      const eaten = idx < Math.floor(progress);
      const isCurrent = idx === Math.floor(progress);
      let opacity = eaten ? 0.13 : 1;
      if (isCurrent) opacity = 0.25;
      cells += `<rect x="${fmt(cx - CELL / 2)}" y="${fmt(cy - CELL / 2)}" width="${CELL}" height="${CELL}" rx="2.4" fill="${scale[level]}" opacity="${opacity}"/>`;
      if (isCurrent && level > 0) {
        cells += `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="2.1" fill="${dark ? '#ffffff' : '#216e39'}" opacity="0.9"/>`;
      }
    }
  }

  let ghostLayer = '';
  // Ghosts use different lags and small lateral offsets, creating a readable chase.
  const lags = [26, 44, 62, 78];
  for (let i = 0; i < 4; i++) {
    const gp = smoothRoutePoint(points, Math.max(0, progress - lags[i]));
    const wave = Math.sin(frameIndex / 5 + i) * 1.5;
    const gx = gp[0] + (i % 2 === 0 ? -wave : wave);
    const gy = gp[1] + Math.cos(frameIndex / 6 + i) * 1.2;
    ghostLayer += `<g transform="translate(${fmt(gx)} ${fmt(gy)})">${ghostSvg(ghosts[i], theme)}</g>`;
  }

  const mouthOpen = Math.floor(frameIndex / 2) % 2 === 0;
  const pacman = `<g transform="translate(${fmt(p[0])} ${fmt(p[1])})">${pacmanSvg(dir.angle, mouthOpen, theme)}</g>`;

  // A subtle eating sparkle appears right at the current contribution.
  const sparkle = `<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="${fmt(2.5 + Math.sin(frameIndex * 0.6))}" fill="#ffd84a" opacity="0.22"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="${bg}"/>
  ${cells}
  ${sparkle}
  ${ghostLayer}
  ${pacman}
</svg>`;
}

async function main() {
  const grid = await fetchContributions();
  const frameRoot = path.join(OUT_DIR, 'pacman-frames');
  fs.rmSync(frameRoot, { recursive: true, force: true });
  fs.mkdirSync(frameRoot, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (let i = 0; i < FRAMES; i++) {
    fs.writeFileSync(path.join(frameRoot, `frame-${String(i).padStart(3, '0')}.svg`), renderFrame(grid, 'dark', i, FRAMES));
  }
  // Keep a static light SVG as a harmless fallback/preview.
  fs.writeFileSync(path.join(OUT_DIR, 'github-snake.svg'), renderFrame(grid, 'light', 0, FRAMES));
  // Dark first frame as well.
  fs.writeFileSync(path.join(OUT_DIR, 'github-snake-dark.svg'), renderFrame(grid, 'dark', 0, FRAMES));

  console.log(`Generated ${FRAMES} SVG frames in ${frameRoot}`);
}

main().catch(err => { console.error(err); process.exit(1); });
