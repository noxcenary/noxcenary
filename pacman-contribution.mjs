#!/usr/bin/env node
/**
 * Generates an animated GitHub contribution graph where Pac-Man travels
 * through the contribution grid and eats contribution squares, while
 * four ghosts chase him using frame-based x/y velocity vectors.
 *
 * The ghost chase logic is inspired by the angle + velocity-vector approach
 * described by 101 Computing's "Pacman Ghost Algorithm" article.
 *
 * Usage:
 *   GITHUB_TOKEN=xxxx GITHUB_LOGIN=yourname node generate-frog-snake-pacman.mjs
 *
 * Outputs:
 *   dist/github-snake.svg
 *   dist/github-snake-dark.svg
 */

import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.GITHUB_TOKEN;
const LOGIN = process.env.GITHUB_LOGIN || process.env.GITHUB_REPOSITORY_OWNER;
const OUT_DIR = process.env.OUT_DIR || "dist";

if (!TOKEN || !LOGIN) {
  console.error("Missing GITHUB_TOKEN or GITHUB_LOGIN env vars.");
  process.exit(1);
}

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
            weekday
          }
        }
      }
    }
  }
}`;

async function fetchContributions() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  return weeks.map((w) => {
    const col = new Array(7).fill(0);
    w.contributionDays.forEach((d) => {
      col[d.weekday] = d.contributionCount;
    });
    return col;
  });
}

function levelOf(count, max) {
  if (count <= 0) return 0;
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// A boustrophedon / snake path keeps Pac-Man moving between adjacent cells
// instead of teleporting around the contribution calendar.
function buildPacmanPath(grid) {
  const path = [];
  for (let w = 0; w < grid.length; w++) {
    const down = w % 2 === 0;
    for (let i = 0; i < 7; i++) {
      const d = down ? i : 6 - i;
      path.push({ w, d, count: grid[w][d] });
    }
  }
  return path;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pacmanSVG() {
  return `
    <circle cx="0" cy="0" r="6" fill="#ffd83d"/>
    <g class="fs-mouth">
      <polygon points="0,0 6.5,-3.15 6.5,-1.55" fill="#0d1117"/>
      <polygon points="0,0 6.5,3.15 6.5,1.55" fill="#0d1117"/>
    </g>
    <circle cx="-1.15" cy="-3" r="0.9" fill="#0d1117"/>
  `;
}

function ghostSVG(color) {
  return `
    <path d="M -5.4 5 L -5.4 -1.5 C -5.4 -5  -2.8 -6.5 0 -6.5 C 2.8 -6.5 5.4 -5 5.4 -1.5 L 5.4 5
             L 3.3 3.1 L 1.1 5 L -1.1 3.1 L -3.3 5 L -5.4 3.1 Z" fill="${color}"/>
    <path d="M -4.1 -5.1 L -3.15 -8 L -1.35 -5.9 Z" fill="${color}"/>
    <path d="M 4.1 -5.1 L 3.15 -8 L 1.35 -5.9 Z" fill="${color}"/>
    <circle cx="-1.8" cy="-2" r="1.05" fill="#ffffff"/>
    <circle cx="1.8" cy="-2" r="1.05" fill="#ffffff"/>
    <circle cx="-1.45" cy="-1.9" r="0.52" fill="#0d1117"/>
    <circle cx="2.15" cy="-1.9" r="0.52" fill="#0d1117"/>
  `;
}

function interpolate(a, b, t) {
  return a + (b - a) * t;
}

function makePacmanSamples(route, cellCenter, sampleCount, duration) {
  const samples = [];
  const segments = Math.max(1, route.length - 1);

  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    const scaled = t * segments;
    const index = Math.min(segments - 1, Math.floor(scaled));
    const local = Math.min(1, scaled - index);
    const current = route[index];
    const next = route[Math.min(route.length - 1, index + 1)];
    const [x1, y1] = cellCenter(current.w, current.d);
    const [x2, y2] = cellCenter(next.w, next.d);
    const x = interpolate(x1, x2, local);
    const y = interpolate(y1, y2, local);
    const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
    samples.push({ x, y, angle, time: t * duration });
  }

  return samples;
}

/**
 * Frame-based chase simulation:
 * angle = atan2(targetY - y, targetX - x)
 * vx = cos(angle) * speed
 * vy = sin(angle) * speed
 *
 * This follows the vector-chasing structure described in the supplied
 * Pac-Man reference rather than giving each ghost a pre-baked route.
 */
function simulateGhost(pacmanSamples, start, speed, duration) {
  const frames = [];
  const sampleCount = pacmanSamples.length;
  let x = start.x;
  let y = start.y;

  for (let i = 0; i < sampleCount; i++) {
    const target = pacmanSamples[i];
    const prevTarget = pacmanSamples[Math.max(0, i - 1)];
    const dt = i === 0 ? duration / (sampleCount - 1) : (target.time - prevTarget.time);

    const dx = target.x - x;
    const dy = target.y - y;
    const distance = Math.hypot(dx, dy);

    if (distance > 0.001) {
      const angle = Math.atan2(dy, dx);
      const vx = Math.cos(angle) * speed * dt;
      const vy = Math.sin(angle) * speed * dt;
      const step = Math.min(distance, Math.hypot(vx, vy));
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
    }

    frames.push({ x, y });
  }

  return frames;
}

function renderSVG(grid, theme) {
  const CELL = 11;
  const GAP = 3;
  const STEP = CELL + GAP;
  const MARGIN = 14;
  const WEEKS = grid.length;
  const DAYS = 7;
  const W = MARGIN * 2 + WEEKS * STEP - GAP;
  const H = MARGIN * 2 + DAYS * STEP - GAP;

  const DURATION = 34;
  const SAMPLE_COUNT = 300;
  const emptyColor = theme === "dark" ? "#161b22" : "#ebedf0";
  const scale =
    theme === "dark"
      ? ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]
      : ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];

  const ghostColors =
    theme === "dark"
      ? ["#ff4b4b", "#ff9fca", "#28d7fe", "#ffb847"]
      : ["#d62828", "#e65d92", "#1197b5", "#e28a17"];

  const maxCount = Math.max(1, ...grid.flat());
  const route = buildPacmanPath(grid);
  const totalCells = route.length;
  const cellCenter = (w, d) => [
    MARGIN + w * STEP + CELL / 2,
    MARGIN + d * STEP + CELL / 2,
  ];

  const pacmanSamples = makePacmanSamples(route, cellCenter, SAMPLE_COUNT, DURATION);

  // ----- Contribution squares: Pac-Man eats them when he arrives. -----
  let dots = "";
  let dotAnims = "";
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const [cx, cy] = cellCenter(w, d);
      const level = levelOf(grid[w][d], maxCount);
      const id = `d${w}-${d}`;
      const fill = scale[level];
      const cellIndex = route.findIndex((p) => p.w === w && p.d === d);
      const eatTime = (cellIndex / Math.max(1, totalCells - 1)) * DURATION;
      const pctBefore = Math.max(0, ((eatTime - 0.08) / DURATION) * 100).toFixed(3);
      const pctStart = Math.min(100, (eatTime / DURATION) * 100).toFixed(3);
      const pctEnd = Math.min(100, ((eatTime + 0.22) / DURATION) * 100).toFixed(3);

      dots += `<rect x="${cx - CELL / 2}" y="${cy - CELL / 2}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}" class="${level > 0 ? id : ""}"/>`;

      if (level > 0) {
        dotAnims += `
          @keyframes ${id} {
            0%, ${pctBefore}% { opacity: 1; transform: scale(1); }
            ${pctStart}% { opacity: 1; transform: scale(1); }
            ${pctEnd}% { opacity: 0.12; transform: scale(0.15); }
            100% { opacity: 0.12; transform: scale(0.15); }
          }
          .${id} {
            animation: ${id} ${DURATION}s ease-in-out infinite;
            transform-box: fill-box;
            transform-origin: center;
          }
        `;
      }
    }
  }

  // ----- Pac-Man motion: smooth linear motion between adjacent cells. -----
  const pacmanFrames = pacmanSamples.map((p, i) => {
    const pct = ((i / (pacmanSamples.length - 1)) * 100).toFixed(3);
    return `${pct}% { transform: translate(${p.x}px, ${p.y}px) rotate(${p.angle}deg); }`;
  });

  // ----- Ghosts: true target-chasing vector motion toward Pac-Man. -----
  const starts = [
    { x: MARGIN + STEP * 2, y: MARGIN + STEP * 2 },
    { x: MARGIN + STEP * (WEEKS - 3), y: MARGIN + STEP * 2 },
    { x: MARGIN + STEP * 2, y: MARGIN + STEP * (DAYS - 2) },
    { x: MARGIN + STEP * (WEEKS - 3), y: MARGIN + STEP * (DAYS - 2) },
  ];

  const speeds = [
    STEP * 6.5,
    STEP * 6.0,
    STEP * 5.6,
    STEP * 5.2,
  ];

  let ghostKeyframes = "";
  let ghostRules = "";
  let ghosts = "";

  for (let i = 0; i < 4; i++) {
    const frames = simulateGhost(pacmanSamples, starts[i], speeds[i], DURATION);
    const animName = `ghostChase${i}`;
    const delay = -((DURATION / 4) * i + i * 1.15);
    const keyframes = frames.map((p, j) => {
      const pct = ((j / (frames.length - 1)) * 100).toFixed(3);
      return `${pct}% { transform: translate(${p.x}px, ${p.y}px); }`;
    }).join("\n");

    ghostKeyframes += `@keyframes ${animName} { ${keyframes} }\n`;
    ghostRules += `.fs-ghost-${i} { animation: ${animName} ${DURATION}s linear ${delay.toFixed(2)}s infinite; }\n`;

    ghosts += `<g class="fs-ghost fs-ghost-${i}" transform="translate(${frames[0].x}, ${frames[0].y})">${ghostSVG(ghostColors[i])}</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <style>
    @keyframes movePacman { ${pacmanFrames.join("\n")} }
    ${ghostKeyframes}
    ${dotAnims}

    .fs-pacman {
      animation: movePacman ${DURATION}s linear infinite;
      transform-box: fill-box;
      transform-origin: center;
    }

    .fs-mouth {
      transform-box: fill-box;
      transform-origin: 0 0;
      animation: fsMouth 0.42s ease-in-out infinite alternate;
    }

    @keyframes fsMouth {
      from { transform: scaleY(0.22); }
      to   { transform: scaleY(1); }
    }

    ${ghostRules}

    .fs-ghost {
      will-change: transform;
    }

    rect { shape-rendering: geometricPrecision; }
  </style>

  <rect width="100%" height="100%" fill="transparent"/>
  ${dots}
  ${ghosts}
  <g class="fs-pacman" transform="translate(${pacmanSamples[0].x}, ${pacmanSamples[0].y}) rotate(${pacmanSamples[0].angle})">
    ${pacmanSVG()}
  </g>
</svg>`;
}

async function main() {
  const grid = await fetchContributions();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "github-snake.svg"), renderSVG(grid, "light"));
  fs.writeFileSync(path.join(OUT_DIR, "github-snake-dark.svg"), renderSVG(grid, "dark"));
  console.log(`Wrote ${OUT_DIR}/github-snake.svg and ${OUT_DIR}/github-snake-dark.svg`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
