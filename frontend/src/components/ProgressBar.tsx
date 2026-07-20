interface ProgressBarProps {
  percent: number;
}

export function ProgressBar({ percent }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="w-full h-1.5 bg-elevated rounded-full overflow-hidden">
      <div
        className="h-full bg-accent rounded-full transition-[width] duration-500 [transition-timing-function:cubic-bezier(.22,1,.36,1)]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
