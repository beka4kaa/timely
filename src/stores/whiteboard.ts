import { create } from 'zustand';

export type Position = { x: number; y: number };

export type TextElement = {
  id: string;
  type: 'TEXT';
  position: Position;
  content: string;
};

export type GraphElement = {
  id: string;
  type: 'GRAPH';
  position: Position;
  function: string;
  domain: [number, number];
};

export type ImageElement = {
  id: string;
  type: 'IMAGE';
  position: Position;
  src: string;
  width: number;
  height: number;
  rotation: number; // in degrees
};

/** A label overlaid on an illustration, positioned in IMAGE percentages (0–100). */
export type IllustrationLabel = {
  content: string;
  x: number;
  y: number;
  color?: string;
  arrow_to?: { x: number; y: number };
};

/** An optional SAM2 segmentation mask, as a polygon in IMAGE percentages (0–100). */
export type IllustrationMask = {
  label?: string;
  polygon: [number, number][];
  bbox_pct?: [number, number, number, number];
  color?: string;
};

/**
 * Composite illustration element: a single base image (from Banana) with
 * text labels overlaid at percentage positions, plus optional SAM2 masks
 * revealed on hover. Rendered as ONE layered DOM block (IllustrationRenderer)
 * instead of being shattered into separate IMAGE / TEXT / SHAPE elements.
 */
export type IllustrationElement = {
  id: string;
  type: 'ILLUSTRATION';
  position: Position;
  src: string;            // base_image_url
  width: number;
  height: number;
  rotation: number;
  labels: IllustrationLabel[];
  masks?: IllustrationMask[] | null;
  alt?: string;
};

/** Supported hand-drawn shape kinds (rendered sketchy via rough.js). */
export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'arrow' | 'path' | 'polygon';

export type ShapeElement = {
  id: string;
  type: 'SHAPE';
  position: Position;          // bounding-box top-left in canvas coords
  shape: ShapeKind;
  width: number;              // bounding-box width
  height: number;             // bounding-box height
  /** Points relative to `position`, used for 'path' / 'polygon'. */
  points?: [number, number][];
  /** For 'line' / 'arrow': true flips the diagonal (bottom-left → top-right). */
  flip?: boolean;
  color?: string;
  strokeWidth?: number;
  /** Optional fill color (drawn as hachure). */
  fill?: string;
  /** Deterministic roughness seed (defaults to a hash of the id). */
  seed?: number;
};

export type WhiteboardElement =
  | TextElement
  | GraphElement
  | ImageElement
  | ShapeElement
  | IllustrationElement;

export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

// ----- Action Payload Types -----

export type CreateTextAction = {
  type: 'CREATE_TEXT';
  payload: {
    id: string;
    content: string;
    position: Position;
  };
};

export type DrawGraphAction = {
  type: 'DRAW_GRAPH';
  payload: {
    id: string;
    function: string;
    domain: [number, number];
    position: Position;
  };
};

export type DrawShapeAction = {
  type: 'DRAW_SHAPE';
  payload: {
    id: string;
    shape: ShapeKind;
    position: Position;
    width?: number;
    height?: number;
    points?: [number, number][];
    flip?: boolean;
    color?: string;
    strokeWidth?: number;
    fill?: string;
  };
};

export type DeleteElementAction = {
  type: 'DELETE_ELEMENT';
  payload: {
    id: string;
  };
};

export type ClearBoardAction = {
  type: 'CLEAR_BOARD';
};

export type CreateImageAction = {
  type: 'CREATE_IMAGE';
  payload: {
    id: string;
    position: Position;
    src: string;
    width: number;
    height: number;
    rotation: number;
  };
};

export type CreateIllustrationAction = {
  type: 'CREATE_ILLUSTRATION';
  payload: {
    id: string;
    position: Position;
    src: string;
    width: number;
    height: number;
    rotation?: number;
    labels: IllustrationLabel[];
    masks?: IllustrationMask[] | null;
    alt?: string;
  };
};

export type UpdateElementAction = {
  type: 'UPDATE_ELEMENT';
  payload: {
    id: string;
    position?: Position;
    width?: number;
    height?: number;
    rotation?: number;
  };
};

export type WhiteboardAction =
  | CreateTextAction
  | DrawGraphAction
  | DrawShapeAction
  | DeleteElementAction
  | ClearBoardAction
  | CreateImageAction
  | CreateIllustrationAction
  | UpdateElementAction;

// ----- State Definition -----

export interface WhiteboardState {
  elements: WhiteboardElement[];
  camera: Camera;
  selectedElementId: string | null;
  executeActions: (actionsInput: string | WhiteboardAction[]) => void;
  setCamera: (x: number, y: number, zoom?: number) => void;
  panCamera: (dx: number, dy: number) => void;
  setSelectedElement: (id: string | null) => void;
}

export const useWhiteboardStore = create<WhiteboardState>((set) => ({
  elements: [],
  camera: { x: 0, y: 0, zoom: 1 },
  selectedElementId: null,
  
  setSelectedElement: (id) => set({ selectedElementId: id }),
  
  setCamera: (x, y, zoom) => {
    set((state) => ({
      camera: {
        x,
        y,
        zoom: zoom !== undefined ? zoom : state.camera.zoom,
      }
    }));
  },

  panCamera: (dx, dy) => {
    set((state) => ({
      camera: {
        ...state.camera,
        x: state.camera.x + dx,
        y: state.camera.y + dy,
      }
    }));
  },

  executeActions: (actionsInput) => {
    set((state) => {
      let actions: WhiteboardAction[];
      
      // Support both JSON string and Action array
      if (typeof actionsInput === 'string') {
        try {
          actions = JSON.parse(actionsInput);
        } catch (error) {
          console.error("Failed to parse actions JSON:", error);
          return state;
        }
      } else {
        actions = actionsInput;
      }

      if (!Array.isArray(actions)) {
        console.error("executeActions expected an array of actions.");
        return state;
      }

      // Clone current elements to apply sequential mutations
      let nextElements = [...state.elements];

      for (const action of actions) {
        switch (action.type) {
          case 'CREATE_TEXT': {
            nextElements.push({
              id: action.payload.id,
              type: 'TEXT',
              position: action.payload.position,
              content: action.payload.content,
            });
            break;
          }
          case 'DRAW_GRAPH': {
            nextElements.push({
              id: action.payload.id,
              type: 'GRAPH',
              position: action.payload.position,
              function: action.payload.function,
              domain: action.payload.domain,
            });
            break;
          }
          case 'DRAW_SHAPE': {
            const p = action.payload;
            nextElements.push({
              id: p.id,
              type: 'SHAPE',
              position: p.position,
              shape: p.shape,
              width: p.width ?? 0,
              height: p.height ?? 0,
              points: p.points,
              flip: p.flip,
              color: p.color,
              strokeWidth: p.strokeWidth,
              fill: p.fill,
            });
            break;
          }
          case 'DELETE_ELEMENT': {
            nextElements = nextElements.filter(el => el.id !== action.payload.id);
            break;
          }
          case 'CLEAR_BOARD': {
            nextElements = [];
            break;
          }
          case 'CREATE_IMAGE': {
            nextElements.push({
              id: action.payload.id,
              type: 'IMAGE',
              position: action.payload.position,
              src: action.payload.src,
              width: action.payload.width,
              height: action.payload.height,
              rotation: action.payload.rotation,
            });
            break;
          }
          case 'CREATE_ILLUSTRATION': {
            const p = action.payload;
            nextElements.push({
              id: p.id,
              type: 'ILLUSTRATION',
              position: p.position,
              src: p.src,
              width: p.width,
              height: p.height,
              rotation: p.rotation ?? 0,
              labels: p.labels ?? [],
              masks: p.masks ?? null,
              alt: p.alt,
            });
            break;
          }
          case 'UPDATE_ELEMENT': {
            const elIndex = nextElements.findIndex(el => el.id === action.payload.id);
            if (elIndex !== -1) {
              const el = nextElements[elIndex];
              const newEl = { ...el } as any;
              // IMAGE and ILLUSTRATION share the same box-transform semantics.
              const sizable = newEl.type === 'IMAGE' || newEl.type === 'ILLUSTRATION';
              if (action.payload.position !== undefined) newEl.position = action.payload.position;
              if (action.payload.width !== undefined && sizable) newEl.width = action.payload.width;
              if (action.payload.height !== undefined && sizable) newEl.height = action.payload.height;
              if (action.payload.rotation !== undefined && sizable) newEl.rotation = action.payload.rotation;
              nextElements[elIndex] = newEl;
            }
            break;
          }
          default:
            console.warn("Unknown action type skipped:", action);
        }
      }

      return { elements: nextElements };
    });
  }
}));
