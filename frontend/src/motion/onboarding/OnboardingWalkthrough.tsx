import { useEffect, useState } from "react";
import { X, ChevronRight, GraduationCap } from "lucide-react";

const ONBOARDING_KEY = "motion_onboard_dismissed";

interface Step {
  title: string;
  content: string;
}

const STEPS: Step[] = [
  {
    title: "Welcome to Motion Studio",
    content: "This is your infinite canvas. You can build animated explainer videos by hand — adding shapes, text, and videos, and animating them freely.",
  },
  {
    title: "Adding Layers",
    content: "Use the toolbar above or the 'Add Layer' button on the left to add your first element to the canvas.",
  },
  {
    title: "The Timeline",
    content: "The timeline at the bottom shows your layers over time. Drag the red playhead to move through your scene, and click the Play button to preview.",
  },
  {
    title: "Setting Keyframes",
    content: "Select a layer, move the playhead, and click the diamond icon next to any property in the right panel (like Position or Opacity) to animate it.",
  },
  {
    title: "Exporting",
    content: "When you're happy with your sequence, hit Export in the top right to render your masterpiece to MP4 or ProRes.",
  }
];

export function OnboardingWalkthrough() {
  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(ONBOARDING_KEY);
    if (!dismissed) {
      // Small delay so it animates in after editor loads
      const timer = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!visible) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  function dismiss() {
    setVisible(false);
    localStorage.setItem(ONBOARDING_KEY, "true");
  }

  function next() {
    if (isLast) {
      dismiss();
    } else {
      setStepIndex(i => i + 1);
    }
  }

  return (
    <div className="absolute bottom-6 right-6 z-50 w-80 bg-surface border border-accent shadow-2xl rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-accent/10 px-4 py-3 flex items-start justify-between border-b border-accent/20">
        <div className="flex items-center gap-2 text-accent">
          <GraduationCap size={18} />
          <h3 className="font-semibold text-sm">{step.title}</h3>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-text-muted hover:text-text transition-colors"
          title="Skip tutorial"
        >
          <X size={16} />
        </button>
      </div>
      
      <div className="p-4">
        <p className="text-sm text-text-muted leading-relaxed min-h-[60px]">
          {step.content}
        </p>
        
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div 
                key={i} 
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === stepIndex ? "bg-accent" : "bg-border"}`}
              />
            ))}
          </div>
          
          <div className="flex gap-3">
            <button
              type="button"
              onClick={dismiss}
              className="text-xs font-medium text-text-muted hover:text-text"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={next}
              className="flex items-center gap-1 bg-accent text-white px-3 py-1.5 rounded text-xs font-medium hover:opacity-90 transition-opacity"
            >
              {isLast ? "Get Started" : "Next"}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
