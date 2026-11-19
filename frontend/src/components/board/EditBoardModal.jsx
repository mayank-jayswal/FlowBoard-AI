import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import ConfirmDialog from "../ui/ConfirmDialog";
import { cn } from "../../lib/utils";

const COLORS = [
  "#2f8159", // forest
  "#2c9c8f", // teal
  "#6f9b54", // olive / sage
  "#d4a23c", // amber
  "#c26a45", // terracotta
  "#5f7da6", // slate blue
];

const EditBoardModal = ({ open, onClose, board, onUpdate, onDelete, isOwner }) => {
  const [form, setForm] = useState({
    title: "",
    description: "",
    color: COLORS[0],
  });
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (board) {
      setForm({
        title: board.title || "",
        description: board.description || "",
        color: board.color || COLORS[0],
      });
    }
  }, [board, open]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Board title is required");
    setLoading(true);
    try {
      await onUpdate({
        title: form.title.trim(),
        description: form.description.trim() || null,
        color: form.color,
      });
      onClose();
    } catch {
      /* handled in caller */
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
      setConfirmDelete(false);
      onClose();
    } catch {
      /* handled in caller */
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Board settings" description="Manage details and preferences for this board.">
        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="Board name"
            placeholder="e.g. Product Roadmap"
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />

          <Textarea
            label="Description"
            rows={3}
            placeholder="Add context or goals for this board…"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted">Accent color</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  className={cn(
                    "h-7 w-7 rounded-full transition-transform",
                    form.color === c ? "ring-2 ring-ink/70 ring-offset-2 ring-offset-surface scale-105" : "hover:scale-110"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line/60 pt-4">
            <div>
              {isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-priority-urgent hover:bg-priority-urgent/10 hover:text-priority-urgent"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4" /> Delete board
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                Save changes
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete board?"
        description={`Are you sure you want to permanently delete "${board?.title}"? All columns, tasks, and activity logs will be lost forever.`}
        confirmLabel="Delete board"
        danger
        loading={deleting}
      />
    </>
  );
};

export default EditBoardModal;

