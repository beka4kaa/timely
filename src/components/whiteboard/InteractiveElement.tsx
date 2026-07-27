import React, { useRef, useState, useEffect } from 'react';
import { useWhiteboardStore, WhiteboardElement } from '@/stores/whiteboard';

interface InteractiveElementProps {
  element: WhiteboardElement;
  children: React.ReactNode;
  cameraZoom: number;
}

export const InteractiveElement: React.FC<InteractiveElementProps> = ({ element, children, cameraZoom }) => {
  const {
    selectedElementId,
    setSelectedElement,
    executeActions,
    recordElementCheckpoint,
  } = useWhiteboardStore();
  const isSelected = selectedElementId === element.id;
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  
  const initialPointer = useRef({ x: 0, y: 0 });
  const initialTransform = useRef({ x: 0, y: 0, width: 0, height: 0, rotation: 0 });
  const historySnapshot = useRef<WhiteboardElement[] | null>(null);
  const didTransform = useRef(false);

  // Only IMAGE elements support resize/rotate here; position is universal.
  // (ILLUSTRATION nodes use DraggableBoardNode instead — see Whiteboard.tsx.)
  const isImage = element.type === 'IMAGE';
  const showSelectionRing =
    isSelected && (element.type === 'IMAGE' || element.type === 'SHAPE');
  const width = isImage ? element.width : 'auto';
  const height = isImage ? element.height : 'auto';
  const rotation = isImage ? element.rotation : 0;

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isDragging || isResizing || isRotating) {
        if (didTransform.current && historySnapshot.current) {
          recordElementCheckpoint(historySnapshot.current);
        }
        historySnapshot.current = null;
        didTransform.current = false;
        setIsDragging(false);
        setIsResizing(false);
        setIsRotating(false);
      }
    };
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (!isDragging && !isResizing && !isRotating) return;
      e.preventDefault();
      
      const dx = (e.clientX - initialPointer.current.x) / cameraZoom;
      const dy = (e.clientY - initialPointer.current.y) / cameraZoom;

      if (isDragging) {
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) didTransform.current = true;
        executeActions([{
          type: 'UPDATE_ELEMENT',
          payload: {
            id: element.id,
            position: {
              x: initialTransform.current.x + dx,
              y: initialTransform.current.y + dy
            }
          }
        }]);
      } else if (isResizing && isImage) {
        if (Math.abs(dx) > 0.5) didTransform.current = true;
        // Uniform scaling based on dx mostly, or hypotenuse
        const aspect = initialTransform.current.width / initialTransform.current.height;
        let newWidth = Math.max(50, initialTransform.current.width + dx);
        let newHeight = newWidth / aspect;
        
        executeActions([{
          type: 'UPDATE_ELEMENT',
          payload: {
            id: element.id,
            width: newWidth,
            height: newHeight
          }
        }]);
      } else if (isRotating && isImage) {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
        // initial angle offset
        const initialAngle = Math.atan2(initialPointer.current.y - centerY, initialPointer.current.x - centerX) * 180 / Math.PI;
        if (Math.abs(angle - initialAngle) > 0.5) didTransform.current = true;
        
        executeActions([{
          type: 'UPDATE_ELEMENT',
          payload: {
            id: element.id,
            rotation: initialTransform.current.rotation + (angle - initialAngle)
          }
        }]);
      }
    };

    if (isDragging || isResizing || isRotating) {
      window.addEventListener('pointermove', handleGlobalPointerMove);
      window.addEventListener('pointerup', handleGlobalPointerUp);
    }

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [
    isDragging,
    isResizing,
    isRotating,
    cameraZoom,
    element.id,
    isImage,
    executeActions,
    recordElementCheckpoint,
  ]);

  const handlePointerDown = (e: React.PointerEvent, action: 'drag' | 'resize' | 'rotate') => {
    e.stopPropagation();
    setSelectedElement(element.id);
    
    initialPointer.current = { x: e.clientX, y: e.clientY };
    historySnapshot.current = useWhiteboardStore.getState().elements;
    didTransform.current = false;
    initialTransform.current = {
      x: element.position.x,
      y: element.position.y,
      width: isImage ? element.width : 0,
      height: isImage ? element.height : 0,
      rotation: isImage ? element.rotation : 0,
    };

    if (action === 'drag') setIsDragging(true);
    if (action === 'resize') setIsResizing(true);
    if (action === 'rotate') setIsRotating(true);
  };

  return (
    <div
      ref={containerRef}
      className={`absolute group cursor-move ${showSelectionRing ? 'ring-1 ring-[#b7792d]/75 ring-offset-2 ring-offset-[#f7f5f1]' : ''}`}
      style={{
        width: width,
        height: height,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center',
        // Enable pointer events for interaction
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => handlePointerDown(e, 'drag')}
    >
      {children}

      {/* Handles: visible on selection or hover */}
      {isImage && isSelected && (
        <>
          {/* Resize Handle (bottom right) */}
          <div
            className="absolute -bottom-1.5 -right-1.5 z-50 h-3 w-3 cursor-se-resize rounded-full border-2 border-white bg-[#b7792d]"
            onPointerDown={(e) => handlePointerDown(e, 'resize')}
          />
          
          {/* Rotate Handle (top center) */}
          <div
            className="absolute -top-7 left-1/2 z-50 flex h-3 w-3 -translate-x-1/2 cursor-grab flex-col items-center justify-end rounded-full border-2 border-white bg-[#777168]"
            onPointerDown={(e) => handlePointerDown(e, 'rotate')}
          >
            <div className="absolute top-3 h-4 w-px bg-[#9c958c]" />
          </div>
        </>
      )}
    </div>
  );
};
