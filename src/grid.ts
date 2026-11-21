import { FlowPhases, frameSeconds, needsAnimation } from './animation';
import { ART_CELL } from './art/common';
import { fanSpinning, setFansDriven } from './art/motor';
import { screenToWorld, worldToScreen, zoomAround, type Camera, type Point } from './camera';
import { PALETTE } from './canvaspalette';
import { drawBoardNames } from './gridlabel';
import { footprint, type CellBox, type GridPoint, type PinRef, type Placement, type Scene } from './model';
import { getPart } from './parts';
import type { SimView } from './simulation';
import { getSprite, partLook } from './sprites';
import { drawDraft, drawPins, drawTapHint, drawWarnings, drawWires, type WireDraft } from './wireview';

export const GRID_SIZE = 20; // world units between minor lines
const MAJOR_EVERY = 5; // every Nth line is drawn stronger
const WHEEL_SPEED = 0.0015; // zoom factor exponent per wheel pixel

// All colours of the drawing are in canvaspalette.ts (the canvas is cleared first and the
// background there is translucent, so the glass backdrop shows through the grid).

/** Screen rectangle in CSS pixels, relative to the viewport. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Draws the grid and the scene. Owns the camera, wheel zoom and panning (middle or right mouse button drag). */
export class GridView {
  readonly selected = new Set<number>();
  readonly selectedWires = new Set<number>();
  hoverId: number | null = null;
  hoverWireId: number | null = null;
  hoverPin: PinRef | null = null;
  /** Grid point on the hovered wire where a wire would attach (press and drag there to start one). */
  hoverTap: GridPoint | null = null;
  /** Wire being drawn. */
  draft: WireDraft | null = null;
  /** Latest simulation results, for glow, wire colours and warnings. */
  sim: SimView | null = null;
  /** Lets a part under the cursor use the wheel (e.g. a knob). Return true when handled. */
  onWheel: ((e: WheelEvent) => boolean) | null = null;
  /** Part being placed from the menu, drawn translucent. */
  ghost: Placement | null = null;
  /** Selection rectangle being dragged, in (fractional) cells. */
  marquee: CellBox | null = null;
  /** Called after every frame (e.g. to position overlay buttons). */
  readonly renderListeners: (() => void)[] = [];
  /** Called when the camera pans or zooms, before the next frame. */
  onCameraChange: (() => void) | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private panning = false;
  /** Mouse button that started the pan (1 middle, 2 right) and whether the pointer has moved since. */
  private panButton = 1;
  private panMoved = false;
  private lastX = 0;
  private lastY = 0;
  private frame = 0;
  /** Timestamp of the previous frame while animating, else null. */
  private lastFrame: number | null = null;
  /** Phase of the current dashes per wire (visual only). */
  private readonly flow = new FlowPhases();

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    /** Owned by the project; changed in place. */
    readonly camera: Camera,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not supported');
    this.ctx = ctx;

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    // Stop the browser's middle-click autoscroll.
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    // A right-button drag pans the grid: no context menu when it ends (a plain right click still gets one).
    canvas.addEventListener('contextmenu', (e) => {
      if (this.panButton === 2 && this.panMoved) e.preventDefault();
      this.panMoved = false;
    });
    // Not passive: Ctrl+wheel must not zoom the page.
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    // The canvas fills the centre area, which changes size with the window,
    // docked windows and the parts menu: redraw whenever its own box changes.
    new ResizeObserver(this.requestRender).observe(canvas);

    this.onFrame(performance.now());
  }

  get isPanning(): boolean {
    return this.panning;
  }

  /**
   * Draw on the next animation frame (once, however often it is asked).
   * While something moves on its own (current dashes, a running board) each
   * frame asks for the next one; when nothing moves the loop stops, so an
   * idle grid costs nothing. Browsers pause animation frames in hidden tabs.
   */
  requestRender = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(this.onFrame);
  };

  private onFrame = (now: number): void => {
    this.frame = 0;
    const animate = this.render(now);
    // Ask for the next frame before the listeners run, so a failing overlay cannot stop the animation.
    if (animate) {
      this.lastFrame = now;
      this.requestRender();
    } else {
      this.lastFrame = null;
    }
    // One failing listener must not skip the others (autosave and the unsaved marker are listeners too).
    for (const listener of this.renderListeners) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    }
  };

  /** Fractional grid cell under a viewport point. */
  toCell(clientX: number, clientY: number): { col: number; row: number } {
    const rect = this.canvas.getBoundingClientRect();
    const w = screenToWorld(this.camera, clientX - rect.left, clientY - rect.top);
    return { col: w.x / GRID_SIZE, row: w.y / GRID_SIZE };
  }

  /** Viewport rectangle of a cell box. */
  toScreen(box: CellBox): ScreenRect {
    const rect = this.canvas.getBoundingClientRect();
    const r = this.boxToCanvas(box);
    return { left: rect.left + r.x, top: rect.top + r.y, right: rect.left + r.x + r.w, bottom: rect.top + r.y + r.h };
  }

  /** Zoom keeping the world point under the viewport point (clientX, clientY) in place. */
  zoomAt(clientX: number, clientY: number, zoom: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const before = this.camera.zoom;
    zoomAround(this.camera, clientX - rect.left, clientY - rect.top, zoom);
    if (this.camera.zoom !== before) this.cameraChanged();
  }

  /** Zoom around the centre of the canvas (e.g. reset to 100%). */
  setZoom(zoom: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, zoom);
  }

  /** Call after changing the camera from outside (e.g. loading a project). */
  cameraChanged(): void {
    this.onCameraChange?.();
    this.requestRender();
  }

  /** CSS pixels per grid cell at the current zoom. */
  get cellPx(): number {
    return GRID_SIZE * this.camera.zoom;
  }

  /** Canvas-relative CSS pixel position of a (fractional) cell point. */
  cellToCanvas(col: number, row: number): Point {
    return worldToScreen(this.camera, col * GRID_SIZE, row * GRID_SIZE);
  }

  /** Pan so the box sits in the middle of the canvas. */
  centerOn(box: CellBox): void {
    const cam = this.camera;
    cam.x = (box.col + box.cols / 2) * GRID_SIZE - this.canvas.clientWidth / 2 / cam.zoom;
    cam.y = (box.row + box.rows / 2) * GRID_SIZE - this.canvas.clientHeight / 2 / cam.zoom;
    this.cameraChanged();
  }

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.panning || this.onWheel?.(e)) return;
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1; // lines / pages to pixels
    const delta = Math.max(-300, Math.min(300, e.deltaY * unit));
    this.zoomAt(e.clientX, e.clientY, this.camera.zoom * Math.exp(-delta * WHEEL_SPEED));
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 1 && e.button !== 2) return; // middle or right mouse button (the left one edits)
    e.preventDefault();
    this.panButton = e.button;
    this.panMoved = false;
    this.panning = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
    this.requestRender();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.panning) return;
    this.panMoved = true;
    // Dragging the grid right means the camera moves left in world space.
    this.camera.x -= (e.clientX - this.lastX) / this.camera.zoom;
    this.camera.y -= (e.clientY - this.lastY) / this.camera.zoom;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.cameraChanged();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.panning || (e.type === 'pointerup' && e.button !== this.panButton)) return;
    this.panning = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.style.cursor = '';
    this.requestRender();
  };

  /** Canvas-relative CSS pixel rectangle of a cell box. */
  private boxToCanvas(box: CellBox): { x: number; y: number; w: number; h: number } {
    const p = worldToScreen(this.camera, box.col * GRID_SIZE, box.row * GRID_SIZE);
    const s = GRID_SIZE * this.camera.zoom;
    return { x: p.x, y: p.y, w: box.cols * s, h: box.rows * s };
  }

  /** Draw one frame at time `now` (ms). Returns true when it needs a next frame to keep moving. */
  private render(now: number): boolean {
    const { canvas, ctx } = this;
    this.sim?.update();
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawGrid(dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const part of this.scene.parts) this.drawPart(part, dpr, false);
    this.flow.begin(frameSeconds(this.lastFrame, now));
    setFansDriven(this.sim?.timeRunning ?? false); // a paused simulation leaves the shaft speed frozen: the drawn fan coasts to a stop
    const maxWireAmps = drawWires(this, ctx, this.scene, this.flow);
    this.flow.end();

    const hovered = this.scene.find(this.hoverId);
    if (hovered && !this.selected.has(hovered.id)) this.drawFrame(footprint(hovered), 'hover');
    for (const id of this.selected) {
      const part = this.scene.find(id);
      if (part) this.drawFrame(footprint(part), 'select');
    }

    drawPins(this, ctx, this.scene);
    drawWarnings(this, ctx, this.scene);
    drawBoardNames(ctx, this.scene.parts, (box) => this.boxToCanvas(box), { width, height });
    drawDraft(this, ctx, this.scene);
    drawTapHint(this, ctx);

    if (this.ghost) {
      this.drawPart(this.ghost, dpr, true);
      this.drawFrame(footprint(this.ghost), 'ghost');
    }

    if (this.marquee) this.drawMarquee(this.marquee);
    return needsAnimation({ maxWireAmps, boardRunning: this.sim?.timeRunning ?? false }) || fanSpinning();
  }

  /** Grid lines in device pixels so they stay 1px sharp at any DPR and zoom. */
  private drawGrid(dpr: number): void {
    const { ctx, camera, canvas } = this;
    const step = GRID_SIZE * camera.zoom * dpr; // device pixels between minor lines
    const lineWidth = Math.max(1, Math.round(dpr));
    const half = lineWidth % 2 ? 0.5 : 0;
    const originX = -camera.x * camera.zoom * dpr; // device x of world 0
    const originY = -camera.y * camera.zoom * dpr;
    const firstCol = Math.floor(-originX / step);
    const lastCol = Math.ceil((canvas.width - originX) / step);
    const firstRow = Math.floor(-originY / step);
    const lastRow = Math.ceil((canvas.height - originY) / step);
    // Fade minor lines out when they get closer than ~12 CSS px; skip below ~5.
    const minorAlpha = Math.min(1, Math.max(0, (step / dpr - 5) / 7));

    const strokeLines = (color: string, major: boolean): void => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let col = firstCol; col <= lastCol; col++) {
        if ((col % MAJOR_EVERY === 0) !== major) continue;
        const x = Math.round(originX + col * step) + half;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
      }
      for (let row = firstRow; row <= lastRow; row++) {
        if ((row % MAJOR_EVERY === 0) !== major) continue;
        const y = Math.round(originY + row * step) + half;
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
      }
      ctx.stroke();
    };

    ctx.lineWidth = lineWidth;
    if (minorAlpha > 0) {
      ctx.globalAlpha = minorAlpha;
      strokeLines(PALETTE.gridMinor, false);
      ctx.globalAlpha = 1;
    }
    strokeLines(PALETTE.gridMajor, true);

    // A small bright dot where two major lines cross: gives the grid a finished, jewel-like rhythm.
    if (step / dpr >= 8) {
      const dot = Math.max(2, Math.round(1.6 * dpr));
      ctx.fillStyle = PALETTE.gridDot;
      for (let col = firstCol; col <= lastCol; col++) {
        if (col % MAJOR_EVERY !== 0) continue;
        const x = Math.round(originX + col * step);
        for (let row = firstRow; row <= lastRow; row++) {
          if (row % MAJOR_EVERY !== 0) continue;
          ctx.fillRect(x - Math.floor(dot / 2), Math.round(originY + row * step) - Math.floor(dot / 2), dot, dot);
        }
      }
    }
  }

  private drawPart(p: Placement & { id?: number }, dpr: number, ghost: boolean): void {
    const type = getPart(p.typeId);
    if (!type) return;
    const { ctx, camera } = this;
    const cell = GRID_SIZE * camera.zoom; // CSS pixels per cell
    const px = Math.max(1, Math.round(cell * dpr));
    // While a state's own artwork is still loading, show the default look instead of a gap.
    const sprite =
      getSprite(type, partLook(type, p.state), px, this.requestRender) ??
      getSprite(type, partLook(type, undefined), px, this.requestRender);
    if (!sprite) return;
    const w = type.cols * cell;
    const h = type.rows * cell;
    // Snap the origin to device pixels so the bitmap maps 1:1.
    const snap = (v: number): number => Math.round(v * dpr) / dpr;
    const origin = worldToScreen(camera, p.col * GRID_SIZE, p.row * GRID_SIZE);
    const shadow = Math.min(1, camera.zoom) * dpr;

    ctx.save();
    ctx.translate(snap(origin.x), snap(origin.y));
    // Rotate around the cell box: the rotated box keeps its top-left at the origin.
    if (p.rotation === 90) ctx.translate(h, 0);
    else if (p.rotation === 180) ctx.translate(w, h);
    else if (p.rotation === 270) ctx.translate(0, w);
    ctx.rotate((p.rotation * Math.PI) / 180);
    // Mirrored inside its own box before the rotation, like pins.ts rotatePoint.
    // The sprite bitmap is the same either way (text on the art reads mirrored).
    if (p.mirrorX) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    if (p.mirrorY) {
      ctx.translate(0, h);
      ctx.scale(1, -1);
    }
    if (ghost) {
      ctx.globalAlpha = 0.6;
    } else {
      // Shadow offsets ignore the transform, so the light stays top-left when rotated.
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 4 * shadow;
      ctx.shadowOffsetX = 1.5 * shadow;
      ctx.shadowOffsetY = 2 * shadow;
    }
    ctx.drawImage(sprite, 0, 0, w, h);
    if (!ghost && type.overlay) {
      // Live parts of the art (glow, knob pointer) are drawn in art units.
      ctx.shadowColor = 'transparent';
      ctx.scale(cell / ART_CELL, cell / ART_CELL);
      type.overlay(ctx, p.state ?? {}, p.id === undefined ? undefined : this.sim?.partResult(p.id), p.id);
    }
    ctx.restore();
  }

  /**
   * A rounded glass frame around a part: `select` is a bright blue outline with a soft glow and a thin
   * light line just inside it, `hover` a faint white one, `ghost` a dashed blue one for the part being
   * dragged in.
   */
  private drawFrame(box: CellBox, kind: 'select' | 'hover' | 'ghost'): void {
    const { ctx } = this;
    const r = this.boxToCanvas(box);
    const pad = kind === 'select' ? 3 : 2;
    const radius = Math.min(12, Math.max(5, this.cellPx * 0.4));
    const dpr = window.devicePixelRatio || 1;
    const path = (inset: number): void => {
      ctx.beginPath();
      ctx.roundRect(r.x - pad + inset, r.y - pad + inset, r.w + 2 * pad - 2 * inset, r.h + 2 * pad - 2 * inset, Math.max(2, radius - inset));
    };

    ctx.save();
    path(0);
    if (kind === 'select') {
      ctx.fillStyle = PALETTE.accentFill;
      ctx.fill();
      ctx.shadowColor = PALETTE.accentGlow; // blur is in device pixels, so it is scaled with the pixel ratio
      ctx.shadowBlur = 14 * dpr;
      ctx.strokeStyle = PALETTE.accentBright;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      path(2);
      ctx.strokeStyle = PALETTE.selectInner;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (kind === 'hover') {
      ctx.fillStyle = PALETTE.hoverFill;
      ctx.fill();
      ctx.strokeStyle = PALETTE.hoverEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = PALETTE.ghostFill;
      ctx.fill();
      ctx.shadowColor = PALETTE.accentGlow;
      ctx.shadowBlur = 8 * dpr;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = PALETTE.accentBright;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The selection box while dragging: a rounded, faintly glowing blue glass rectangle. */
  private drawMarquee(box: CellBox): void {
    const { ctx } = this;
    const r = this.boxToCanvas(box);
    if (r.w < 1 || r.h < 1) return;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h), Math.min(8, r.w / 2, r.h / 2));
    ctx.fillStyle = PALETTE.accentFill;
    ctx.fill();
    ctx.shadowColor = PALETTE.accentGlow;
    ctx.shadowBlur = 8 * (window.devicePixelRatio || 1);
    ctx.strokeStyle = PALETTE.accentBright;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
