import { Button } from "./Button";
import type { RVCModelInfo } from "../types/api";

interface ModelCardProps {
  model: RVCModelInfo;
  onDelete: (name: string) => void;
}

export function ModelCard({ model, onDelete }: ModelCardProps) {
  return (
    <div className="border border-border rounded-md p-4 flex items-center justify-between">
      <div>
        <p className="font-medium">{model.name}</p>
        <p className="text-sm text-text-muted mt-0.5">
          {model.size_mb.toFixed(1)} MB
          {model.has_index ? " · has index" : " · no index file"}
          {model.sample_rate ? ` · ${model.sample_rate} Hz` : ""}
        </p>
      </div>
      <Button variant="danger" onClick={() => onDelete(model.name)}>
        Delete
      </Button>
    </div>
  );
}
