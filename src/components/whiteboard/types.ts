/** A single point captured from pointer input */
export interface Point {
  x: number;
  y: number;
  pressure: number;
}

/** A continuous stroke made up of points */
export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  lineWidth: number;
}

/** Axis-aligned bounding box */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Result emitted after debounce crop */
export interface CropResult {
  boundingBox: BoundingBox;
  base64: string;
}

/** Public state shape — ready for external state-manager integration */
export interface WhiteboardState {
  strokes: Stroke[];
  currentStroke: Stroke | null;
  isDrawing: boolean;
  strokeColor: string;
  lineWidth: number;
}

/** Actions the consumer can dispatch */
export interface WhiteboardActions {
  clearCanvas: () => void;
  setStrokeColor: (color: string) => void;
  setLineWidth: (width: number) => void;
  undo: () => void;
}
