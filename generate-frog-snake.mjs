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
 *   dist/github-snake.svg
 *   dist/github-snake-dark.svg
 *
 * NOTE: these filenames must match whatever the README's <img>/<source>
 * tags point at on the `output` branch. If you rename one, rename the
 * other, or the README will keep showing a stale/old SVG forever.
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

// Deterministic PRNG so the light/dark render of the *same* day's grid
// produces the exact same frog/ghost routes (only colors differ), but a
// different day's grid (different contribution counts) shuffles fresh.
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

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function frogFill(t, theme) {
  const from = theme === "dark" ? [120, 140, 70] : [214, 222, 140];
  const to = theme === "dark" ? [70, 220, 120] : [42, 168, 74];
  const c = from.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function frogSVG() {
  return `
    <ellipse cx="0" cy="4.6" rx="6" ry="1.6" fill="#000000" opacity="0.18"/>
    <ellipse cx="-3.6" cy="4.4" rx="2" ry="1.1" fill="currentColor" stroke="#1b4d2b" stroke-width="0.5"/>
    <ellipse cx="3.6" cy="4.4" rx="2" ry="1.1" fill="currentColor" stroke="#1b4d2b" stroke-width="0.5"/>
    <path d="M -5.2 3.4 C -6.4 0.4 -6 -2.6 -3.4 -3.4 C -1.6 -4 1.6 -4 3.4 -3.4 C 6 -2.6 6.4 0.4 5.2 3.4 C 4.6 5.6 2.6 6.6 0 6.6 C -2.6 6.6 -4.6 5.6 -5.2 3.4 Z"
          fill="currentColor" stroke="#1b4d2b" stroke-width="0.6"/>
    <ellipse cx="-2.2" cy="2.6" rx="1.3" ry="0.9" fill="#ffffff" opacity="0.35"/>
    <circle cx="-3" cy="-3.6" r="2.3" fill="currentColor" stroke="#1b4d2b" stroke-width="0.5"/>
    <circle cx="3" cy="-3.6" r="2.3" fill="currentColor" stroke="#1b4d2b" stroke-width="0.5"/>
    <circle cx="-3" cy="-3.6" r="1.15" fill="#0d1117"/>
    <circle cx="3" cy="-3.6" r="1.15" fill="#0d1117"/>
    <circle cx="-3.4" cy="-4.05" r="0.4" fill="#ffffff"/>
    <circle cx="2.6" cy="-4.05" r="0.4" fill="#ffffff"/>
    <path d="M -2.2 0.6 Q 0 2 2.2 0.6" fill="none" stroke="#1b4d2b" stroke-width="0.55" stroke-linecap="round"/>
    <circle cx="-1.1" cy="1.7" r="0.35" fill="#1b4d2b" opacity="0.6"/>
    <circle cx="1.1" cy="1.7" r="0.35" fill="#1b4d2b" opacity="0.6"/>
    <line class="fs-tongue" x1="0" y1="1.3" x2="9" y2="1.3" stroke="#ff5c7a" stroke-width="1.4" stroke-linecap="round"/>
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
      ? ["#ff6b81", "#5bd6e0", "#ffb454", "#c792ea"]
      : ["#e85d75", "#2fb8c4", "#e8973a", "#9c6fd6"];

  const maxCount = Math.max(1, ...grid.flat());
  const basePath = buildPath(grid);
  const cellCenter = (w, d) => [MARGIN + w * STEP + CELL / 2, MARGIN + d * STEP + CELL / 2];

  // Seed is derived from the grid's own contents, so the light and dark
  // renders of the *same* day's data land on identical routes (only the
  // colors differ), but a day with different contribution counts reshuffles.
  const seed = grid.flat().reduce((a, b) => a + b, 7919) || 7919;
  const rng = mulberry32(seed);

  // --- Frog: random hop order over every cell, so it still eats every
  // dot eventually, but the route (and therefore the "escape") is
  // different each time instead of a fixed boustrophedon sweep.
  const frogPath = shuffled(basePath, rng);
  const total = frogPath.reduce((s, p) => s + p.count, 0) || 1;
  const N = frogPath.length;

  let eaten = 0;
  const frogFrames = [];
  const eatEvents = [];
  frogPath.forEach((p, i) => {
    const pct = ((i / (N - 1)) * 100).toFixed(3);
    const [x, y] = cellCenter(p.w, p.d);
    eaten += p.count;
    const t = eaten / total;
    frogFrames.push(`${pct}% { transform: translate(${x}px, ${y}px); color: ${frogFill(t, theme)}; }`);
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

  // --- Ghosts: each gets its OWN shuffled route (independent from the
  // frog's and from each other) plus random, uneven dwell times per stop
  // so their "step" rhythm differs too - no two ghosts move in lockstep.
  let ghostKeyframes = "";
  let ghostRules = "";
  const ghosts = catColors
    .map((color, i) => {
      const ghostPath = shuffled(basePath, rng);
      const weights = ghostPath.map(() => 0.5 + rng() * 1.5);
      const sumW = weights.reduce((a, b) => a + b, 0);
      let cum = 0;
      const frames = ghostPath.map((p, idx) => {
        const pct = ((cum / sumW) * 100).toFixed(3);
        cum += weights[idx];
        const [x, y] = cellCenter(p.w, p.d);
        return `${pct}% { transform: translate(${x}px, ${y}px); }`;
      });
      const animName = `ghostMove${i}`;
      const ghostDuration = (DURATION * (0.8 + rng() * 0.55)).toFixed(2);
      ghostKeyframes += `@keyframes ${animName} { ${frames.join("\n")} 100% { transform: translate(${cellCenter(
        ghostPath[0].w,
        ghostPath[0].d
      ).join("px,")}px); } }\n`;
      ghostRules += `.fs-cat-${i} { animation: ${animName} ${ghostDuration}s linear infinite; }\n`;
      return `<g class="fs-cat fs-cat-${i}">${catGhostSVG(color)}</g>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <style>
    @keyframes moveFrog { ${frogFrames.join("\n")} }
    ${ghostKeyframes}
    @keyframes fsTongue {
      0%, 100% { transform: scaleX(0.15); opacity: 0; }
      45% { transform: scaleX(0.15); opacity: 0; }
      55% { transform: scaleX(1); opacity: 1; }
      65% { transform: scaleX(1); opacity: 1; }
      75% { transform: scaleX(0.15); opacity: 0; }
    }
    ${dotAnims}
    .fs-frog { animation: moveFrog ${DURATION}s linear infinite; }
    ${ghostRules}
    .fs-tongue { animation: fsTongue 0.9s ease-in-out infinite; transform-origin: 0px 0px; }
    rect { shape-rendering: geometricPrecision; }
  </style>
  <rect width="100%" height="100%" fill="transparent"/>
  ${dots}
  <g>${ghosts}</g>
  <g class="fs-frog">${frogSVG()}</g>
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
