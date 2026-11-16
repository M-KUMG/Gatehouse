export const GRID_SIZE = 20; // world units between minor lines
const MAJOR_EVERY = 5; // every Nth line is drawn stronger

const COLORS = {
  background: '#1e1f22',
  minor: '#2e3035',
  major: '#43464d',
};

export interface Camera {
  x: number; // world position shown at the top-left corner of the canvas
  y: number;
}

export class GridView {
  readonly camera: Camera = { x: 0, y: 0 };
  private readonly ctx: CanvasRenderingContext2D;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not supported');
    this.ctx = ctx;

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    // Stop the browser's middle-click autoscroll.
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    window.addEventListener('resize', this.render);

    this.render();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 1) return; // middle mouse button only
    e.preventDefault();
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    // Dragging the grid right means the camera moves left in world space.
    this.camera.x -= e.clientX - this.lastX;
    this.camera.y -= e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.render();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging || e.button !== 1) return;
    this.dragging = false;
    this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.style.cursor = '';
  };

  private render = (): void => {
    const { canvas, ctx, camera } = this;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    const firstCol = Math.floor(camera.x / GRID_SIZE);
    const lastCol = Math.ceil((camera.x + width) / GRID_SIZE);
    const firstRow = Math.floor(camera.y / GRID_SIZE);
    const lastRow = Math.ceil((camera.y + height) / GRID_SIZE);

    const strokeLines = (color: string, major: boolean): void => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let col = firstCol; col <= lastCol; col++) {
        if ((col % MAJOR_EVERY === 0) !== major) continue;
        const x = Math.round(col * GRID_SIZE - camera.x) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let row = firstRow; row <= lastRow; row++) {
        if ((row % MAJOR_EVERY === 0) !== major) continue;
        const y = Math.round(row * GRID_SIZE - camera.y) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    };

    ctx.lineWidth = 1;
    strokeLines(COLORS.minor, false);
    strokeLines(COLORS.major, true);
  };
}
