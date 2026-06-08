import React, { useRef, useState, useEffect } from 'react';
import { useWhiteboardStore, WhiteboardElement } from '@/stores/whiteboard';

interface InteractiveElementProps {
  element: WhiteboardElement;
  children: React.ReactNode;
  cameraZoom: number;
}

export const InteractiveElement: React.FC<InteractiveElementProps> = ({ element, children, cameraZoom }) => {
  const { selectedElementId, setSelectedElement, executeActions } = useWhiteboardStore();
  const isSelected = selectedElementId === element.id;
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  
  const initialPointer = useRef({ x: 0, y: 0 });
  const initialTransform = useRef({ x: 0, y: 0, width: 0, height: 0, rotation: 0 });

  // Only IMAGE elements support resize/rotate for now, but position is universal
  const isImage = element.type === 'IMAGE';
  const width = isImage ? element.width : 'auto';
  const height = isImage ? element.height : 'auto';
  const rotation = isImage ? element.rotation : 0;

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isDragging || isResizing || isRotating) {
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
  }, [isDragging, isResizing, isRotating, cameraZoom, element.id, isImage, executeActions]);

  const handlePointerDown = (e: React.PointerEvent, action: 'drag' | 'resize' | 'rotate') => {
    e.stopPropagation();
    setSelectedElement(element.id);
    
    initialPointer.current = { x: e.clientX, y: e.clientY };
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
      className={`absolute group cursor-move ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950' : ''}`}
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
            className="absolute -bottom-2 -right-2 w-4 h-4 bg-blue-500 rounded-full border-2 border-white cursor-se-resize z-50"
            onPointerDown={(e) => handlePointerDown(e, 'resize')}
          />
          
          {/* Rotate Handle (top center) */}
          <div
            className="absolute -top-8 left-1/2 -translate-x-1/2 w-4 h-4 bg-green-500 rounded-full border-2 border-white cursor-grab z-50 flex flex-col items-center justify-end"
            onPointerDown={(e) => handlePointerDown(e, 'rotate')}
          >
            <div className="w-px h-4 bg-green-500 absolute top-4" />
          </div>
        </>
      )}
    </div>
  );
};
