import { create } from 'zustand';

export type Position = { x: number; y: number };

let whiteboardHistorySequence = 0;

/** Общий монотонный номер для истории DOM-элементов и canvas-штрихов. */
export function nextWhiteboardHistorySequence(): number {
  whiteboardHistorySequence += 1;
  return whiteboardHistorySequence;
}

export type TextElement = {
  id: string;
  type: 'TEXT';
  position: Position;
  content: string;
  width?: number;
  fontSize?: number;
  lineHeight?: number;
  color?: string;
  variant?: 'heading' | 'body' | 'formula' | 'table';
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
  /** Semantic grounding target used for deterministic label placement. */
  target_kind?: 'object' | 'vector' | 'angle' | 'region';
  arrow_to?: { x: number; y: number };
  /**
   * Пользовательская позиция подписи в процентах изображения. Якорь
   * `arrow_to` при этом не двигается: renderer пересчитывает выноску, поэтому
   * подпись остаётся «магнитно» привязанной к научному объекту.
   */
  manual_position?: Position;
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
  /** Стиль генерации (flat/2_5d/3d/sketch) — выбирает типографику подписей. */
  genStyle?: string;
  /**
   * Сюжет, которым эта картинка была сгенерирована (`image_prompt`).
   * Хранится, чтобы «сделай в стиле скетч» перерисовало ЭТУ иллюстрацию, не
   * спрашивая board-модель заново: без сюжета пришлось бы генерировать весь
   * конспект целиком, и на холст ложилась вторая копия текста.
   */
  imagePrompt?: string;
  /**
   * Картинка ещё генерируется (прогрессивная выдача): доска приходит с
   * текстом и структурой сразу, а растр догружается отдельным запросом
   * (/api/ai/illustration) и подставляется через UPDATE_ELEMENT. Пока флаг
   * стоит, на холсте показывается скелетон вместо пустого места.
   */
  pending?: boolean;
  /** Текст ошибки, если генерация иллюстрации не удалась. */
  error?: string;
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
    width?: number;
    fontSize?: number;
    lineHeight?: number;
    color?: string;
    variant?: TextElement['variant'];
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
    genStyle?: string;
    imagePrompt?: string;
    pending?: boolean;
    error?: string;
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
    content?: string;
    fontSize?: number;
    lineHeight?: number;
    color?: string;
    variant?: TextElement['variant'];
    function?: string;
    domain?: [number, number];
    /**
     * Поля ниже нужны прогрессивной выдаче: иллюстрация создаётся
     * плейсхолдером (pending), а когда растр догрузился — тем же id
     * подставляется картинка с подписями.
     */
    src?: string;
    labels?: IllustrationLabel[];
    /** Меняется при рестайле: от стиля зависит типографика подписей. */
    genStyle?: string;
    masks?: IllustrationMask[] | null;
    pending?: boolean;
    error?: string;
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

export type ExecuteActionsOptions = {
  /**
   * CREATE/DELETE/CLEAR записываются автоматически. UPDATE по умолчанию
   * пропускается, чтобы drag/resize не создавали сотни кадров истории.
   */
  history?: 'auto' | 'record' | 'skip';
  /** Позволяет объединить DOM-элементы и canvas-штрихи в одно действие. */
  historySequence?: number;
};

export type ElementHistoryEntry = {
  elements: WhiteboardElement[];
  sequence: number;
};

export interface WhiteboardState {
  elements: WhiteboardElement[];
  camera: Camera;
  selectedElementId: string | null;
  elementHistoryPast: ElementHistoryEntry[];
  elementHistoryFuture: ElementHistoryEntry[];
  lastElementHistorySequence: number;
  executeActions: (
    actionsInput: string | WhiteboardAction[],
    options?: ExecuteActionsOptions,
  ) => void;
  recordElementCheckpoint: (elementsBefore: WhiteboardElement[]) => void;
  undoElementAction: () => void;
  redoElementAction: () => void;
  /**
   * Полностью заменить содержимое доски сохранённым снимком.
   *
   * Отдельный метод, а не набор действий: восстановление — это НЕ правка,
   * которую ученик делал руками, и в историю Undo она попадать не должна,
   * иначе первым же Ctrl+Z пользователь стёр бы всю восстановленную доску.
   */
  restoreCanvas: (snapshot: { elements?: unknown[]; camera?: unknown } | null) => void;
  setCamera: (x: number, y: number, zoom?: number) => void;
  panCamera: (dx: number, dy: number) => void;
  setSelectedElement: (id: string | null) => void;
}

export const useWhiteboardStore = create<WhiteboardState>((set) => ({
  elements: [],
  camera: { x: 0, y: 0, zoom: 1 },
  selectedElementId: null,
  elementHistoryPast: [],
  elementHistoryFuture: [],
  lastElementHistorySequence: 0,
  
  setSelectedElement: (id) => set({ selectedElementId: id }),
  
  restoreCanvas: (snapshot) => {
    // Снимок приходит с сервера нетипизированным JSON — это граница доверия,
    // и приведение живёт здесь, а не размазано по вызывающим местам.
    const rawCamera = snapshot?.camera as Camera | undefined;
    set(() => ({
      elements: Array.isArray(snapshot?.elements)
        ? (snapshot!.elements as WhiteboardElement[])
        : [],
      camera:
        rawCamera && typeof rawCamera.zoom === 'number'
          ? rawCamera
          : { x: 0, y: 0, zoom: 1 },
      selectedElementId: null,
      // История чистится намеренно: шаги Undo относились к ПРЕЖНЕЙ доске, и
      // после подмены содержимого они означали бы возврат к чужому состоянию.
      elementHistoryPast: [],
      elementHistoryFuture: [],
    }));
  },
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

  recordElementCheckpoint: (elementsBefore) => {
    set((state) => {
      const sequence = nextWhiteboardHistorySequence();
      return {
        elementHistoryPast: [
          ...state.elementHistoryPast,
          { elements: elementsBefore, sequence },
        ].slice(-80),
        elementHistoryFuture: [],
        lastElementHistorySequence: sequence,
      };
    });
  },

  undoElementAction: () => {
    set((state) => {
      const entry = state.elementHistoryPast.at(-1);
      if (!entry) return state;
      const nextPast = state.elementHistoryPast.slice(0, -1);
      return {
        elements: entry.elements,
        elementHistoryPast: nextPast,
        elementHistoryFuture: [
          ...state.elementHistoryFuture,
          { elements: state.elements, sequence: entry.sequence },
        ],
        lastElementHistorySequence: nextPast.at(-1)?.sequence ?? 0,
        selectedElementId: null,
      };
    });
  },

  redoElementAction: () => {
    set((state) => {
      const entry = state.elementHistoryFuture.at(-1);
      if (!entry) return state;
      return {
        elements: entry.elements,
        elementHistoryPast: [
          ...state.elementHistoryPast,
          { elements: state.elements, sequence: entry.sequence },
        ],
        elementHistoryFuture: state.elementHistoryFuture.slice(0, -1),
        lastElementHistorySequence: entry.sequence,
        selectedElementId: null,
      };
    });
  },

  executeActions: (actionsInput, options) => {
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
      if (actions.length === 0) return state;

      const historyMode = options?.history ?? 'auto';
      const shouldRecordHistory =
        historyMode === 'record'
        || (
          historyMode === 'auto'
          && actions.some((action) => action.type !== 'UPDATE_ELEMENT')
        );
      const historySequence = shouldRecordHistory
        ? options?.historySequence ?? nextWhiteboardHistorySequence()
        : 0;

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
              width: action.payload.width,
              fontSize: action.payload.fontSize,
              lineHeight: action.payload.lineHeight,
              color: action.payload.color,
              variant: action.payload.variant,
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
              genStyle: p.genStyle,
              imagePrompt: p.imagePrompt,
              pending: p.pending,
              error: p.error,
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
              if (newEl.type === 'TEXT') {
                if (action.payload.content !== undefined) newEl.content = action.payload.content;
                if (action.payload.fontSize !== undefined) newEl.fontSize = action.payload.fontSize;
                if (action.payload.lineHeight !== undefined) newEl.lineHeight = action.payload.lineHeight;
                if (action.payload.color !== undefined) newEl.color = action.payload.color;
                if (action.payload.variant !== undefined) newEl.variant = action.payload.variant;
              }
              if (newEl.type === 'GRAPH') {
                if (action.payload.function !== undefined) newEl.function = action.payload.function;
                if (action.payload.domain !== undefined) newEl.domain = action.payload.domain;
              }
              // Прогрессивная выдача: подставляем догрузившуюся картинку в уже
              // стоящий на холсте плейсхолдер. Только для ILLUSTRATION —
              // у остальных типов этих полей нет.
              if (newEl.type === 'ILLUSTRATION') {
                if (action.payload.src !== undefined) newEl.src = action.payload.src;
                if (action.payload.labels !== undefined) newEl.labels = action.payload.labels;
                if (action.payload.genStyle !== undefined) newEl.genStyle = action.payload.genStyle;
                if (action.payload.masks !== undefined) newEl.masks = action.payload.masks;
                if (action.payload.pending !== undefined) newEl.pending = action.payload.pending;
                if (action.payload.error !== undefined) newEl.error = action.payload.error;
              }
              nextElements[elIndex] = newEl;
            }
            break;
          }
          default:
            console.warn("Unknown action type skipped:", action);
        }
      }

      const nextPast = shouldRecordHistory
        ? [
            ...state.elementHistoryPast,
            { elements: state.elements, sequence: historySequence },
          ].slice(-80)
        : state.elementHistoryPast;

      return {
        elements: nextElements,
        elementHistoryPast: nextPast,
        // Любое новое изменение после undo создаёт новую ветку.
        elementHistoryFuture: [],
        lastElementHistorySequence: shouldRecordHistory
          ? historySequence
          : state.lastElementHistorySequence,
        selectedElementId:
          state.selectedElementId
          && nextElements.some((element) => element.id === state.selectedElementId)
            ? state.selectedElementId
            : null,
      };
    });
  }
}));
