import { useRef, useState, type DragEvent } from "react";

const SUPPORTED_EXTENSIONS = [".mp4", ".avi", ".mov", ".mkv", ".webm"];

interface FileDropzoneProps {
  files: File[];
  onFilesSelected: (files: File[]) => void;
}

export function FileDropzone({ files, onFilesSelected }: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    // Merge with existing selection, de-duplicated by name+size.
    const seen = new Set(files.map((f) => `${f.name}:${f.size}`));
    onFilesSelected([...files, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(false);
    addFiles(event.dataTransfer.files);
  }

  function removeFile(index: number) {
    onFilesSelected(files.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          isDragOver ? "border-accent bg-accent-bg" : "border-border hover:border-accent/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SUPPORTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
        <p className="font-medium text-text">
          {files.length > 0
            ? "Click or drop to add more videos"
            : "Drop videos here, or click to browse"}
        </p>
        <p className="text-sm text-text-muted mt-1">
          Supported: {SUPPORTED_EXTENSIONS.join(", ")} — multiple files convert as a batch
        </p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, i) => (
            <li
              key={`${file.name}:${file.size}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <span className="truncate">
                {file.name}
                <span className="text-text-muted"> — {(file.size / (1024 * 1024)).toFixed(1)} MB</span>
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="text-text-muted hover:text-danger shrink-0"
                aria-label={`Remove ${file.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
