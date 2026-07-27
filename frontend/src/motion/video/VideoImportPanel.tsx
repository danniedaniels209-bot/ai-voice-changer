import React, { useState, useRef } from "react";

export interface VideoImportPanelProps {
  onImport: (file: File) => void;
  className?: string;
}

export function VideoImportPanel({ onImport, className = "" }: VideoImportPanelProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError("Please select a valid video file.");
      return;
    }
    setError(null);
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      onImport(selectedFile);
      handleClear();
    }
  };

  return (
    <div className={`flex flex-col h-full bg-surface border-l border-border ${className}`}>
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-text">Import Video</h2>
        <p className="text-sm text-text-muted mt-1">Upload a video clip to add to your scene.</p>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        {!selectedFile ? (
          <div
            className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-colors cursor-pointer
              ${dragActive ? "border-accent bg-accent-dim" : "border-border hover:bg-surface-hover hover:border-accent"}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleChange}
              className="hidden"
            />
            <div className="w-12 h-12 mb-3 text-text-faint bg-surface-hover rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text">Click or drag a video here</p>
            <p className="text-xs text-text-muted mt-1 text-center">MP4, WebM, or MOV up to 100MB</p>
            {error && <p className="text-xs text-danger mt-2 text-center">{error}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-border">
              {previewUrl && (
                <video
                  src={previewUrl}
                  controls
                  className="w-full h-full object-contain"
                />
              )}
              <button
                onClick={handleClear}
                className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
                title="Remove video"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            
            <div className="flex flex-col gap-1 p-3 bg-surface-hover rounded-md border border-border">
              <span className="text-sm font-medium text-text truncate" title={selectedFile.name}>
                {selectedFile.name}
              </span>
              <span className="text-xs text-text-muted">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>

            <button
              onClick={handleImport}
              className="w-full py-2.5 px-4 bg-accent hover:bg-accent/90 text-white font-medium text-sm rounded-md transition-colors"
            >
              Add to Scene
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
