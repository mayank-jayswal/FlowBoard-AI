import { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  pointerWithin,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import Column from "./Column";
import TaskCard from "./TaskCard";

const KanbanBoard = ({ columns, tasks, actions, onTaskClick, onAddTask, onAiGenerate, onAddColumn }) => {
  const [activeTask, setActiveTask] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const tasksByColumn = useMemo(() => {
    const map = {};
    for (const col of columns) map[col.id] = [];
    for (const t of tasks) (map[t.column_id] ||= []).push(t);
    for (const id in map) map[id].sort((a, b) => a.position - b.position);
    return map;
  }, [columns, tasks]);

  // Prioritize task cards over parent column when pointer intersects
  const customCollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    const collisions = pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
    const taskCollision = collisions.find(
      (c) => c.data?.droppableContainer?.data?.current?.type === "task"
    );
    if (taskCollision) return [taskCollision];
    return collisions;
  }, []);

  const onDragStart = ({ active }) => {
    setActiveTask(tasks.find((t) => t.id === active.id) || null);
  };

  const onDragEnd = ({ active, over }) => {
    setActiveTask(null);
    if (!over || active.id === over.id) return;

    const activeId = active.id;
    const activeTaskObj = tasks.find((t) => t.id === activeId);
    if (!activeTaskObj) return;

    // Resolve the target column from the drop target.
    const overData = over.data.current;
    let targetColumnId;
    if (overData?.type === "column") targetColumnId = over.id;
    else if (overData?.type === "task") targetColumnId = overData.task.column_id;
    else targetColumnId = activeTaskObj.column_id;

    const isSameColumn = activeTaskObj.column_id === targetColumnId;

    if (isSameColumn) {
      // In same column, dropping on empty column padding/gap should not move the task to the end
      if (overData?.type === "column") return;

      const colTasks = tasksByColumn[targetColumnId] || [];
      const oldIndex = colTasks.findIndex((t) => t.id === activeId);
      const overIndex = colTasks.findIndex((t) => t.id === over.id);

      if (oldIndex === -1 || overIndex === -1 || oldIndex === overIndex) return;

      const newTasks = arrayMove(colTasks, oldIndex, overIndex);
      let newPosition;

      if (overIndex === 0) {
        const nextPos = newTasks[1]?.position;
        newPosition = nextPos != null ? nextPos / 2 : 1000;
      } else if (overIndex === newTasks.length - 1) {
        const prevPos = newTasks[newTasks.length - 2]?.position;
        newPosition = prevPos != null ? prevPos + 1000 : 1000;
      } else {
        const prevPos = newTasks[overIndex - 1]?.position;
        const nextPos = newTasks[overIndex + 1]?.position;
        newPosition = (prevPos + nextPos) / 2;
      }

      if (activeTaskObj.position === newPosition) return;
      actions.moveTask(activeId, targetColumnId, newPosition);
    } else {
      // Moving to a different column
      const destTasks = tasksByColumn[targetColumnId] || [];
      let newPosition;

      if (overData?.type === "task") {
        const overIndex = destTasks.findIndex((t) => t.id === over.id);
        if (overIndex === -1) {
          const lastPos = destTasks[destTasks.length - 1]?.position;
          newPosition = lastPos != null ? lastPos + 1000 : 1000;
        } else {
          const newTasks = [
            ...destTasks.slice(0, overIndex),
            activeTaskObj,
            ...destTasks.slice(overIndex),
          ];
          if (overIndex === 0) {
            const nextPos = newTasks[1]?.position;
            newPosition = nextPos != null ? nextPos / 2 : 1000;
          } else {
            const prevPos = newTasks[overIndex - 1]?.position;
            const nextPos = newTasks[overIndex + 1]?.position;
            newPosition = nextPos != null ? (prevPos + nextPos) / 2 : prevPos + 1000;
          }
        }
      } else {
        // Dropped on empty column
        const lastPos = destTasks[destTasks.length - 1]?.position;
        newPosition = lastPos != null ? lastPos + 1000 : 1000;
      }

      actions.moveTask(activeId, targetColumnId, newPosition);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      <div className="flex h-full gap-5 overflow-x-auto px-6 pb-6">
        {columns.map((col, i) => (
          <Column
            key={col.id}
            column={col}
            index={i}
            tasks={tasksByColumn[col.id] || []}
            onTaskClick={onTaskClick}
            onAddTask={onAddTask}
            onAiGenerate={onAiGenerate}
            onRename={actions.renameColumn}
            onDelete={actions.deleteColumn}
          />
        ))}

        {/* Add column */}
        <button
          onClick={onAddColumn}
          className="flex h-11 w-[300px] shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line text-sm font-medium text-faint transition-colors hover:border-brand-500/50 hover:bg-surface hover:text-muted"
        >
          <Plus className="h-4 w-4" /> Add column
        </button>
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="w-[314px]">
            <TaskCard task={activeTask} overlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default KanbanBoard;
