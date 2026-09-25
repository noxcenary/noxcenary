import fs from "node:fs";
import sharp from "sharp";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const USER = process.env.GITHUB_USER || "noxcenary";
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const WIDTH = 950;
const CELL = 12;
const GAP = 4;
const PAD_X = 28;
const PAD_Y = 30;
const COLS = 53;
const ROWS = 7;
const GRID_W = COLS * CELL + (COLS - 1) * GAP;
const GRID_H = ROWS * CELL + (ROWS - 1) * GAP;
const HEIGHT = GRID_H + PAD_Y * 2;
const START_LENGTH = 5;
const FPS = 20;
const OUTPUT = "dist/github-snake.gif";

async function githubCalendar() {
  const query = `
    query($login:String!) {
      user(login:$login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "custom-contribution-snake"
    },
    body: JSON.stringify({ query, variables: { login: USER } })
  });

  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const weeks =
    json.data.user.contributionsCollection.contributionCalendar.weeks;

  const selected = weeks.slice(-COLS);

  while (selected.length < COLS) {
    selected.unshift({ contributionDays: [] });
  }

  const cells = [];

  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      const day = selected[x].contributionDays[y];

      cells.push({
        x,
        y,
        count: day?.contributionCount ?? 0
      });
    }
  }

  // Convert GitHub's contribution intensity into your monochrome palette.
  const max = Math.max(1, ...cells.map(c => c.count));

  for (const c of cells) {
    if (c.count === 0) {
      c.gray = "#11161c";
    } else {
      const ratio = c.count / max;

      c.gray =
        ratio <= 0.25 ? "#444444" :
        ratio <= 0.50 ? "#777777" :
        ratio <= 0.75 ? "#aaaaaa" :
        "#d9d9d9";
    }
  }

  return cells;
}

function cellCenter(x, y) {
  return [
    PAD_X + x * (CELL + GAP) + CELL / 2,
    PAD_Y + y * (CELL + GAP) + CELL / 2
  ];
}

function roundedRect(x, y, w, h, r, fill) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
}

function buildSvg(cells, snake, eaten) {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg"
    width="${WIDTH}" height="${HEIGHT}"
    viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="100%" height="100%" fill="#000000"/>`;

  // Contribution graph.
  for (const c of cells) {
    const x = PAD_X + c.x * (CELL + GAP);
    const y = PAD_Y + c.y * (CELL + GAP);
    const key = `${c.x},${c.y}`;

    let fill = c.count > 0 ? c.gray : "#11161c";

    // The contribution disappears when the snake eats it.
    if (eaten.has(key)) fill = "#000000";

    svg += roundedRect(x, y, CELL, CELL, 2.5, fill);
  }

  // Snake body. The newest segment is the head.
  for (let i = 0; i < snake.length; i++) {
    const p = snake[i];
    const [cx, cy] = cellCenter(p.x, p.y);

    const t = i / Math.max(1, snake.length - 1);
    const value = Math.round(145 + 110 * t);

    svg += `<rect
      x="${cx - CELL / 2 + 1}"
      y="${cy - CELL / 2 + 1}"
      width="${CELL - 2}"
      height="${CELL - 2}"
      rx="3"
      fill="rgb(${value},${value},${value})"/>`;
  }

  // Snake eyes.
  if (snake.length) {
    const head = snake[snake.length - 1];
    const previous = snake.length > 1 ? snake[snake.length - 2] : head;

    const [cx, cy] = cellCenter(head.x, head.y);

    const dx = head.x - previous.x;
    const dy = head.y - previous.y;

    let ex1, ey1, ex2, ey2;

    if (Math.abs(dx) >= Math.abs(dy)) {
      ex1 = cx + (dx >= 0 ? 3 : -3);
      ey1 = cy - 3;
      ex2 = cx + (dx >= 0 ? 3 : -3);
      ey2 = cy + 3;
    } else {
      ex1 = cx - 3;
      ey1 = cy + (dy >= 0 ? 3 : -3);
      ex2 = cx + 3;
      ey2 = cy + (dy >= 0 ? 3 : -3);
    }

    svg += `<circle cx="${ex1}" cy="${ey1}" r="1.2" fill="#000000"/>`;
    svg += `<circle cx="${ex2}" cy="${ey2}" r="1.2" fill="#000000"/>`;
  }

  svg += "</svg>";
  return svg;
}

// A complete serpentine path through the contribution grid.
// This makes the snake visibly move cell-by-cell rather than becoming
// a straight horizontal line.
function serpentinePath() {
  const path = [];

  for (let x = 0; x < COLS; x++) {
    if (x % 2 === 0) {
      for (let y = 0; y < ROWS; y++) {
        path.push({ x, y });
      }
    } else {
      for (let y = ROWS - 1; y >= 0; y--) {
        path.push({ x, y });
      }
    }
  }

  return path;
}

async function main() {
  fs.mkdirSync("dist", { recursive: true });

  const cells = await githubCalendar();
  const path = serpentinePath();

  // Every non-zero contribution is food.
  const active = new Set(
    cells
      .filter(c => c.count > 0)
      .map(c => `${c.x},${c.y}`)
  );

  const eaten = new Set();
  const frames = [];
  const snake = [];

  // Initial snake length = 5.
  for (let i = 0; i < START_LENGTH; i++) {
    snake.push(path[i]);

    const key = `${path[i].x},${path[i].y}`;
    if (active.has(key)) eaten.add(key);
  }

  let cursor = START_LENGTH - 1;

  const render = () => {
    frames.push(buildSvg(cells, snake, eaten));
  };

  render();

  while (cursor < path.length - 1) {
    cursor++;

    const head = path[cursor];
    snake.push(head);

    const key = `${head.x},${head.y}`;

    if (active.has(key) && !eaten.has(key)) {
      // EAT: keep the new segment, so the snake grows by one.
      eaten.add(key);

      render();
      render();
    } else {
      // Normal movement: remove the tail.
      snake.shift();
      render();
    }
  }

  // Hold the final state briefly.
  for (let i = 0; i < 12; i++) render();

  console.log(`Rendering ${frames.length} frames...`);

  const encoder = GIFEncoder();

  // One shared palette keeps the GIF smaller and rendering faster.
  const first = await sharp(Buffer.from(frames[0]))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const palette = quantize(first.data, 256, {
    format: "rgb444"
  });

  for (const svg of frames) {
    const { data, info } = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const index = applyPalette(data, palette, "rgb444");

    encoder.writeFrame(index, info.width, info.height, {
      palette,
      delay: Math.round(1000 / FPS),
      repeat: 0,
      transparent: false
    });
  }

  encoder.finish();

  fs.writeFileSync(
    OUTPUT,
    Buffer.from(encoder.bytes())
  );

  console.log(
    `Generated ${OUTPUT}. ${eaten.size} contributions eaten.`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
