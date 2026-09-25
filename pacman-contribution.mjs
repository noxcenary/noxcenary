#!/usr/bin/env node
/**
 * Animated Pac-Man contribution graph for GitHub READMEs.
 *
 * Important: GitHub sanitizes CSS @keyframes in SVG images rendered in READMEs.
 * This generator therefore uses native SVG SMIL (<animate>, <animateMotion>,
 * <animateTransform>) instead of CSS animation.
 *
 * Inputs:
 *   GITHUB_TOKEN - token with access to the user's contribution graph
 *   GITHUB_LOGIN - GitHub username
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
      "User-Agent": "pacman-contribution-generator",
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
    for (const d of w.contributionDays) col[d.weekday] = d.contributionCount;
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

// Horizontal snake through week columns: down one column, up the next.
function buildPacmanPath(grid) {
  const out = [];
  for (let w = 0; w < grid.length; w++) {
    if (w % 2 === 0) {
      for (let d = 0; d < 7; d++) out.push({ w, d });
    } else {
      for (let d = 6; d >= 0; d--) out.push({ w, d });
    }
  }
  return out;
}

function fmt(n) {
  return Number(n.toFixed(2));
}

function pathFromPoints(points) {
  if (!points.length) return "M 0 0";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p[0])} ${fmt(p[1])}`)
    .join(" ");
}

function cellCenter(MARGIN, STEP, CELL, w, d) {
  return [MARGIN + w * STEP + CELL / 2, MARGIN + d * STEP + CELL / 2];
}

function pointsForRoute(route, center) {
  return route.map((p) => center(p.w, p.d));
}

function simulateGhost(pacmanPoints, start, speed, duration) {
  const out = [];
  let x = start[0];
  let y = start[1];
  const dt = duration / Math.max(1, pacmanPoints.length - 1);

  for (const target of pacmanPoints) {
    const dx = target[0] - x;
    const dy = target[1] - y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) {
      const step = Math.min(dist, speed * dt);
      x += (dx / dist) * step;
      y += (dy / dist) * step;
    }
    out.push([x, y]);
  }
  return out;
}

function pacmanSVG() {
  return `
    <circle cx="0" cy="0" r="6.2" fill="#ffd83d"/>
    <g>
      <polygon points="0,0 6.8,-3.2 6.8,-1.4" fill="#0d1117">
        <animateTransform attributeName="transform" type="rotate"
          values="0 0 0; -15 0 0; 0 0 0; -15 0 0; 0 0 0"
          dur="0.34s" repeatCount="indefinite"/>
      </polygon>
      <polygon points="0,0 6.8,3.2 6.8,1.4" fill="#0d1117">
        <animateTransform attributeName="transform" type="rotate"
          values="0 0 0; 15 0 0; 0 0 0; 15 0 0; 0 0 0"
          dur="0.34s" repeatCount="indefinite"/>
      </polygon>
    </g>
    <circle cx="-1.3" cy="-3.1" r="0.9" fill="#0d1117"/>
  `;
}

function ghostSVG(color) {
  return `
    <path d="M-5.5,5 V-1.2 C-5.5,-4.9 -3.1,-6.5 0,-6.5 C3.1,-6.5 5.5,-4.9 5.5,-1.2 V5
      L3.3,3.1 L1.1,5 L-1.1,3.1 L-3.3,5 L-5.5,3.1 Z" fill="${color}"/>
    <circle cx="-1.8" cy="-2" r="1.1" fill="#fff"/>
    <circle cx="1.8" cy="-2" r="1.1" fill="#fff"/>
    <circle cx="-1.55" cy="-1.85" r="0.5" fill="#0d1117"/>
    <circle cx="2.05" cy="-1.85" r="0.5" fill="#0d1117"/>
  `;
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

  // Long enough to feel smooth, short enough to remain obviously alive.
  const DURATION = 28;
  const empty = theme === "dark" ? "#161b22" : "#ebedf0";
  const scale = theme === "dark"
    ? ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]
    : ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];

  const ghostColors = theme === "dark"
    ? ["#ff4b4b", "#ff9fca", "#28d7fe", "#ffb847"]
    : ["#d62828", "#e65d92", "#1197b5", "#e28a17"];

  const maxCount = Math.max(1, ...grid.flat());
  const route = buildPacmanPath(grid);
  const center = (w, d) => cellCenter(MARGIN, STEP, CELL, w, d);
  const pacmanPoints = pointsForRoute(route, center);
  const pacmanPath = pathFromPoints(pacmanPoints);

  let cells = "";
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const [cx, cy] = center(w, d);
      const level = levelOf(grid[w][d], maxCount);
      const cellIndex = route.findIndex((p) => p.w === w && p.d === d);
      const progress = cellIndex / Math.max(1, route.length - 1);
      const eatStart = Math.max(0.001, progress * 100);
      const eatEnd = Math.min(100, eatStart + 1.4);
      const startKey = (eatStart / 100).toFixed(5);
      const endKey = (eatEnd / 100).toFixed(5);

      cells += `
        <g transform="translate(${fmt(cx)} ${fmt(cy)})">
          <rect x="${-CELL / 2}" y="${-CELL / 2}" width="${CELL}" height="${CELL}" rx="2.5" fill="${scale[level]}">
            <animate attributeName="opacity"
              values="1;1;0.12;0.12;1"
              keyTimes="0;${startKey};${endKey};0.99999;1"
              dur="${DURATION}s" repeatCount="indefinite"/>
          </rect>
          ${level > 0 ? `
          <circle cx="0" cy="0" r="${Math.max(1.5, 2.0 + level * 0.2)}" fill="${theme === "dark" ? "#ffffff" : "#216e39"}" opacity="0">
            <animate attributeName="opacity" values="0;0;0.9;0" keyTimes="0;${startKey};${endKey};${Math.min(1, (eatEnd / 100) + 0.025).toFixed(5)}" dur="${DURATION}s" repeatCount="indefinite"/>
          </circle>` : ""}
        </g>`;
    }
  }

  // Pac-Man is intentionally larger and bright so the effect is obvious.
  const pacmanStart = pacmanPoints[0];
  const ghostsStart = [
    [MARGIN + STEP * 2, MARGIN + STEP * 2],
    [MARGIN + STEP * (WEEKS - 3), MARGIN + STEP * 2],
    [MARGIN + STEP * 2, MARGIN + STEP * (DAYS - 2)],
    [MARGIN + STEP * (WEEKS - 3), MARGIN + STEP * (DAYS - 2)],
  ];
  const speeds = [STEP * 8.2, STEP * 7.4, STEP * 6.6, STEP * 5.8];

  let ghosts = "";
  for (let i = 0; i < ghostsStart.length; i++) {
    const ghostPoints = simulateGhost(pacmanPoints, ghostsStart[i], speeds[i], DURATION);
    const ghostPath = pathFromPoints(ghostPoints);
    ghosts += `
      <g transform="translate(${fmt(ghostsStart[i][0])} ${fmt(ghostsStart[i][1])})" opacity="0.95">
        ${ghostSVG(ghostColors[i])}
        <animateMotion path="${ghostPath}" dur="${DURATION}s" repeatCount="indefinite" calcMode="linear"/>
      </g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="${empty}"/>
  ${cells}

  <!-- Ghosts chase the same moving route with different speeds. -->
  ${ghosts}

  <!-- Pac-Man uses SMIL animateMotion so GitHub can render the animation. -->
  <g transform="translate(${fmt(pacmanStart[0])} ${fmt(pacmanStart[1])})">
    ${pacmanSVG()}
    <animateMotion path="${pacmanPath}" dur="${DURATION}s" repeatCount="indefinite" calcMode="linear" rotate="auto"/>
    <animate attributeName="opacity"
      values="1;1;1;0;0;1"
      keyTimes="0;0.94;0.967;0.985;0.995;1"
      dur="${DURATION}s" repeatCount="indefinite"/>
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
