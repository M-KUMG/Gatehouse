'use strict';

// Window size and position for the desktop app, as plain functions with no
// Electron in them (so they can be tested): the default and minimum size, the
// saved size/position read back safely (a window can never end up off-screen or
// tiny), reading and writing the small JSON file, and telling from the page title
// whether the project has unsaved changes (the page puts a dot in front of it).

const DEFAULT_SIZE = { width: 1360, height: 860 };
const MIN_SIZE = { width: 900, height: 600 };
/** A saved window must overlap a screen by at least this many pixels (both ways) to keep its position. */
const MIN_VISIBLE = 120;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));

function overlap(a1, a2, b1, b2) {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

/**
 * The bounds to open the window with. `saved` is what was stored last time
 * (anything, it is checked), `workAreas` the usable rectangle of every screen
 * ({x, y, width, height}, the primary first). The size is kept between the
 * minimum and the biggest screen; the position is kept only while the window
 * still shows on some screen, otherwise it is left out so Electron centres it.
 */
function sanitizeBounds(saved, workAreas, defaults = DEFAULT_SIZE, min = MIN_SIZE) {
  const areas = Array.isArray(workAreas) && workAreas.length > 0 ? workAreas : [{ x: 0, y: 0, width: 1920, height: 1080 }];
  const biggestW = Math.max(...areas.map((a) => a.width));
  const biggestH = Math.max(...areas.map((a) => a.height));

  const s = saved && typeof saved === 'object' ? saved : {};
  const width = clamp(isNum(s.width) ? s.width : defaults.width, Math.min(min.width, biggestW), biggestW);
  const height = clamp(isNum(s.height) ? s.height : defaults.height, Math.min(min.height, biggestH), biggestH);
  const out = { width: Math.round(width), height: Math.round(height) };

  if (isNum(s.x) && isNum(s.y)) {
    const visible = areas.some(
      (a) => overlap(s.x, s.x + out.width, a.x, a.x + a.width) >= MIN_VISIBLE && overlap(s.y, s.y + out.height, a.y, a.y + a.height) >= MIN_VISIBLE,
    );
    if (visible) {
      out.x = Math.round(s.x);
      out.y = Math.round(s.y);
    }
  }
  return out;
}

/** The saved state ({ bounds, maximized }) from a file, or an empty one when it is missing or broken. */
function loadState(file, fs) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') return { bounds: raw.bounds && typeof raw.bounds === 'object' ? raw.bounds : null, maximized: raw.maximized === true };
  } catch {
    // no file yet, or not JSON: start fresh
  }
  return { bounds: null, maximized: false };
}

/** Write the state; a failure (read-only disk, ...) is ignored, the window just opens at the default size next time. */
function saveState(file, state, fs) {
  try {
    fs.writeFileSync(file, JSON.stringify({ bounds: state.bounds, maximized: state.maximized === true }));
    return true;
  } catch {
    return false;
  }
}

/** The page puts "● " in front of its title while the project has unsaved changes. */
function isDirtyTitle(title) {
  return typeof title === 'string' && title.startsWith('● ');
}

/** The project name out of a page title like "● My circuit · Gatehouse". */
function projectNameFromTitle(title) {
  if (typeof title !== 'string') return '';
  const withoutDot = title.replace(/^●\s+/, '');
  const at = withoutDot.lastIndexOf(' · ');
  return (at >= 0 ? withoutDot.slice(0, at) : withoutDot).trim();
}

module.exports = { DEFAULT_SIZE, MIN_SIZE, MIN_VISIBLE, sanitizeBounds, loadState, saveState, isDirtyTitle, projectNameFromTitle };
