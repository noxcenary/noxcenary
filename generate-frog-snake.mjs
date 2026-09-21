#!/usr/bin/env node
/**
 * Generates an animated SVG contribution graph where a frog eats the
 * contribution dots (tongue-grab animation, turns greener as it eats)
 * while ghost-colored cats chase it along the same path.
 *
 * Usage:
 *   GITHUB_TOKEN=xxxx GITHUB_LOGIN=yourname node generate-frog-snake.mjs
 *
 * Requires a token with access to the GraphQL `contributionsCollection`
 * field for the target user. The default `secrets.GITHUB_TOKEN` in
 * Actions usually has enough scope to read a *public* contribution graph
 * for the repo owner; if it doesn't, create a classic PAT with `read:user`
 * and store it as a repo secret (e.g. SNAKE_TOKEN) instead.
 *
 * Outputs:
 *   dist/frog-snake.svg
 *   dist/frog-snake-dark.svg
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
  // grid[week][day] = count
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

function buildPath(grid) {
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

function frogFill(t, theme) {
  const from = theme === "dark" ? [120, 140, 70] : [214, 222, 140];
  const to = theme === "dark" ? [70, 220, 120] : [42, 168, 74];
  const c = from.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function frogSVG() {
  return `
    <ellipse cx="0" cy="1" rx="5.6" ry="4.6" fill="currentColor" stroke="#1b4d2b" stroke-width="0.6"/>
    <circle cx="-2.6" cy="-3.2" r="1.7" fill="currentColor" stroke="#1b4d2b" stroke-width="0.5"/>
    <circle cx="2.6" cy="-3.2" r="1.7" fill="currentColor" stroke="#1b4d2b" stroke-width="0.5"/>
    <circle cx="-2.6" cy="-3.2" r="0.85" fill="#0d1117"/>
    <circle cx="2.6" cy="-3.2" r="0.85" fill="#0d1117"/>
    <line class="fs-tongue" x1="0" y1="1.5" x2="9" y2="1.5" stroke="#ff5c7a" stroke-width="1.4" stroke-linecap="round"/>
  `;
}

function catGhostSVG(color) {
  return `
    <g opacity="0.82">
      <path d="M -5.5 5 L -5.5 -1.5 C -5.5 -5 -2.8 -6.8 0 -6.8 C 2.8 -6.8 5.5 -5 5.5 -1.5 L 5.5 5
               L 3.5 3.2 L 1.3 5 L -1.3 3.2 L -3.5 5 L -5.5 3.2 Z"
            fill="${color}"/>
      <path d="M -4.2 -5.4 L -3.2 -8.4 L -1.4 -6 Z" fill="${color}"/>
      <path d="M 4.2 -5.4 L 3.2 -8.4 L 1.4 -6 Z" fill="${color}"/>
      <circle cx="-1.8" cy="-2" r="1" fill="#0d1117"/>
      <circle cx="1.8" cy="-2" r="1" fill="#0d1117"/>
    </g>
  `;
}

function renderSVG(grid, theme) {
  const CELL = 11, GAP = 3, STEP = CELL + GAP, MARGIN = 14;
  const WEEKS = grid.length, DAYS = 7;
  const W = MARGIN * 2 + WEEKS * STEP - GAP;
  const H = MARGIN * 2 + DAYS * STEP - GAP;
  const DURATION = 26;

  const emptyColor = theme === "dark" ? "#161b22" : "#ebedf0";
  const scale =
    theme === "dark"
      ? ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]
      : ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
  const catColors =
    theme === "dark"
      ? ["#ff6b81", "#5bd6e0", "#ffb454"]
      : ["#e85d75", "#2fb8c4", "#e8973a"];

  const maxCount = Math.max(1, ...grid.flat());
  const path = buildPath(grid);
  const total = path.reduce((s, p) => s + p.count, 0) || 1;

  const cellCenter = (w, d) => [MARGIN + w * STEP + CELL / 2, MARGIN + d * STEP + CELL / 2];

  const N = path.length;
  let eaten = 0;
  const moveFrames = [];
  const frogFrames = [];
  const eatEvents = [];

  path.forEach((p, i) => {
    const pct = ((i / (N - 1)) * 100).toFixed(3);
    const [x, y] = cellCenter(p.w, p.d);
    moveFrames.push(`${pct}% { transform: translate(${x}px, ${y}px); }`);
    eaten += p.count;
    const t = eaten / total;
    frogFrames.push(`${pct}% { transform: translate(${x}px, ${y}px); fill: ${frogFill(t, theme)}; }`);
    if (p.count > 0) {
      eatEvents.push({ time: (i / (N - 1)) * DURATION, w: p.w, d: p.d });
    }
  });

  let dots = "";
  let dotAnims = "";
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const [cx, cy] = cellCenter(w, d);
      const level = levelOf(grid[w][d], maxCount);
      const id = `d${w}-${d}`;
      dots += `<rect x="${cx - CELL / 2}" y="${cy - CELL / 2}" width="${CELL}" height="${CELL}" rx="2.5" fill="${scale[level]}" class="${level > 0 ? id : ""}"/>`;
      const ev = eatEvents.find((e) => e.w === w && e.d === d);
      if (ev) {
        const p1 = Math.max(0, ((ev.time - 0.15) / DURATION) * 100).toFixed(3);
        const p2 = (((ev.time + 0.05) / DURATION) * 100).toFixed(3);
        const p3 = Math.min(100, ((ev.time + 3) / DURATION) * 100).toFixed(3);
        dotAnims += `
          @keyframes ${id} {
            0% { opacity: 1; }
            ${p1}% { opacity: 1; }
            ${p2}% { opacity: 0.15; transform: scale(0.4); }
            ${p3}% { opacity: 0.15; transform: scale(0.4); }
            100% { opacity: 0.15; transform: scale(0.4); }
          }
          .${id} { animation: ${id} ${DURATION}s linear infinite; transform-box: fill-box; transform-origin: center; }
        `;
      }
    }
  }

  const cats = catColors
    .map((color, i) => {
      const delay = -((i + 1) * (DURATION / (catColors.length + 3)));
      return `<g class="fs-cat" style="animation-delay:${delay}s">${catGhostSVG(color)}</g>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <style>
    @keyframes moveOnly { ${moveFrames.join("\n")} }
    @keyframes moveFrog { ${frogFrames.join("\n")} }
    @keyframes fsTongue {
      0%, 100% { transform: scaleX(0.15); opacity: 0; }
      45% { transform: scaleX(0.15); opacity: 0; }
      55% { transform: scaleX(1); opacity: 1; }
      65% { transform: scaleX(1); opacity: 1; }
      75% { transform: scaleX(0.15); opacity: 0; }
    }
    ${dotAnims}
    .fs-frog { animation: moveFrog ${DURATION}s linear infinite; }
    .fs-cat { animation: moveOnly ${DURATION}s linear infinite; }
    .fs-tongue { animation: fsTongue 0.9s ease-in-out infinite; transform-origin: 0px 0px; }
    rect { shape-rendering: geometricPrecision; }
  </style>
  <rect width="100%" height="100%" fill="transparent"/>
  ${dots}
  <g>${cats}</g>
  <g class="fs-frog">${frogSVG()}</g>
</svg>`;
}

async function main() {
  const grid = await fetchContributions();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "frog-snake.svg"), renderSVG(grid, "light"));
  fs.writeFileSync(path.join(OUT_DIR, "frog-snake-dark.svg"), renderSVG(grid, "dark"));
  console.log(`Wrote ${OUT_DIR}/frog-snake.svg and ${OUT_DIR}/frog-snake-dark.svg`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
