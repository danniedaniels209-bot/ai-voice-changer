import { createLayer } from "../layerFactory";
import { newId } from "../state";
import type { MotionScene, MotionLayer, Transform } from "../../types/motion";

function createScene(name: string, duration_ms: number, bg_color: string, layers: MotionLayer[]): MotionScene {
  return {
    id: newId(),
    name,
    width: 1920,
    height: 1080,
    duration_ms,
    background_color: bg_color,
    layers,
    audio_tracks: [],
  };
}

function overrideTransform(layer: MotionLayer, overrides: Partial<Transform>): MotionLayer {
  layer.transform = { ...layer.transform, ...overrides };
  return layer;
}

export function createApiExplainer(): MotionScene {
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#0B0F19"; // Dark background
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "API Explainer";
  title.text!.font_size = 96;
  title.text!.color = "#E2E8F0";
  title.text!.align = "center";
  overrideTransform(title, { x: 460, y: 150, width: 1000, height: 120 });

  const endpointBox = createLayer("rect");
  endpointBox.name = "Endpoint Box";
  endpointBox.rect!.fill = "#1E293B";
  endpointBox.rect!.corner_radius = 24;
  endpointBox.rect!.stroke_color = "#38BDF8";
  endpointBox.rect!.stroke_width = 4;
  overrideTransform(endpointBox, { x: 460, y: 400, width: 1000, height: 400 });

  const endpointText = createLayer("text");
  endpointText.name = "Endpoint Text";
  endpointText.text!.text = "POST /api/v1/motion/render";
  endpointText.text!.font_size = 56;
  endpointText.text!.color = "#38BDF8";
  endpointText.text!.align = "center";
  endpointText.text!.font_family = "monospace";
  overrideTransform(endpointText, { x: 500, y: 550, width: 920, height: 100 });

  return createScene("API Explainer", 5000, "#0B0F19", [bg, endpointBox, title, endpointText]);
}

export function createAppWalkthrough(): MotionScene {
  const title = createLayer("text");
  title.name = "Header";
  title.text!.text = "App Walkthrough";
  title.text!.font_size = 80;
  title.text!.color = "#111827";
  title.text!.align = "center";
  overrideTransform(title, { x: 460, y: 80, width: 1000, height: 100 });

  const phoneBody = createLayer("rect");
  phoneBody.name = "Phone Frame";
  phoneBody.rect!.fill = "#F9FAFB";
  phoneBody.rect!.corner_radius = 48;
  phoneBody.rect!.stroke_color = "#D1D5DB";
  phoneBody.rect!.stroke_width = 16;
  overrideTransform(phoneBody, { x: 700, y: 220, width: 520, height: 1040 }); // Bleeds off bottom

  const screenBg = createLayer("rect");
  screenBg.name = "Screen Background";
  screenBg.rect!.fill = "#3B82F6";
  screenBg.rect!.corner_radius = 24;
  overrideTransform(screenBg, { x: 720, y: 250, width: 480, height: 980 });

  const headerBox = createLayer("rect");
  headerBox.name = "App Header";
  headerBox.rect!.fill = "#FFFFFF";
  headerBox.rect!.corner_radius = 16;
  overrideTransform(headerBox, { x: 760, y: 320, width: 400, height: 120 });

  return createScene("App Walkthrough", 8000, "#F3F4F6", [title, phoneBody, screenBg, headerBox]);
}

export function createSaasProductDemo(): MotionScene {
  const bg = createLayer("rect");
  bg.name = "Hero Background";
  bg.rect!.fill = "#4F46E5";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  const title = createLayer("text");
  title.name = "Headline";
  title.text!.text = "Supercharge Your Workflow";
  title.text!.font_size = 112;
  title.text!.color = "#FFFFFF";
  title.text!.align = "center";
  overrideTransform(title, { x: 260, y: 200, width: 1400, height: 150 });

  const subtitle = createLayer("text");
  subtitle.name = "Sub-headline";
  subtitle.text!.text = "The all-in-one platform for modern teams.";
  subtitle.text!.font_size = 48;
  subtitle.text!.color = "#C7D2FE";
  subtitle.text!.align = "center";
  overrideTransform(subtitle, { x: 460, y: 380, width: 1000, height: 80 });

  const ctaBtn = createLayer("rect");
  ctaBtn.name = "CTA Button";
  ctaBtn.rect!.fill = "#10B981";
  ctaBtn.rect!.corner_radius = 32;
  overrideTransform(ctaBtn, { x: 760, y: 550, width: 400, height: 100 });

  const ctaText = createLayer("text");
  ctaText.name = "CTA Text";
  ctaText.text!.text = "Get Started Free";
  ctaText.text!.font_size = 36;
  ctaText.text!.color = "#FFFFFF";
  ctaText.text!.align = "center";
  overrideTransform(ctaText, { x: 780, y: 575, width: 360, height: 50 });

  return createScene("SaaS Product Demo", 6000, "#4F46E5", [bg, title, subtitle, ctaBtn, ctaText]);
}

export function createSystemDiagram(): MotionScene {
  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "Architecture Diagram";
  title.text!.font_size = 72;
  title.text!.color = "#1F2937";
  title.text!.align = "center";
  overrideTransform(title, { x: 460, y: 80, width: 1000, height: 100 });

  // Client
  const clientBox = createLayer("rect");
  clientBox.name = "Client Node";
  clientBox.rect!.fill = "#DBEAFE";
  clientBox.rect!.corner_radius = 16;
  overrideTransform(clientBox, { x: 200, y: 440, width: 300, height: 200 });

  const clientText = createLayer("text");
  clientText.name = "Client Label";
  clientText.text!.text = "Client App";
  clientText.text!.font_size = 40;
  clientText.text!.color = "#1E3A8A";
  clientText.text!.align = "center";
  overrideTransform(clientText, { x: 200, y: 510, width: 300, height: 60 });

  // API Gateway
  const apiBox = createLayer("rect");
  apiBox.name = "API Gateway Node";
  apiBox.rect!.fill = "#FEF3C7";
  apiBox.rect!.corner_radius = 16;
  overrideTransform(apiBox, { x: 810, y: 440, width: 300, height: 200 });

  const apiText = createLayer("text");
  apiText.name = "API Gateway Label";
  apiText.text!.text = "API Gateway";
  apiText.text!.font_size = 40;
  apiText.text!.color = "#92400E";
  apiText.text!.align = "center";
  overrideTransform(apiText, { x: 810, y: 510, width: 300, height: 60 });

  // DB
  const dbEllipse = createLayer("ellipse");
  dbEllipse.name = "Database Node";
  dbEllipse.ellipse!.fill = "#D1FAE5";
  overrideTransform(dbEllipse, { x: 1420, y: 440, width: 300, height: 200 });

  const dbText = createLayer("text");
  dbText.name = "Database Label";
  dbText.text!.text = "Database";
  dbText.text!.font_size = 40;
  dbText.text!.color = "#065F46";
  dbText.text!.align = "center";
  overrideTransform(dbText, { x: 1420, y: 510, width: 300, height: 60 });

  return createScene("System Diagram", 4000, "#FFFFFF", [
    title,
    clientBox,
    clientText,
    apiBox,
    apiText,
    dbEllipse,
    dbText,
  ]);
}

export function createComparison(): MotionScene {
  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "Before vs After";
  title.text!.font_size = 80;
  title.text!.color = "#111827";
  title.text!.align = "center";
  overrideTransform(title, { x: 460, y: 100, width: 1000, height: 100 });

  // Left Side (Before)
  const leftBg = createLayer("rect");
  leftBg.name = "Before Background";
  leftBg.rect!.fill = "#FEE2E2";
  leftBg.rect!.corner_radius = 32;
  overrideTransform(leftBg, { x: 200, y: 300, width: 700, height: 600 });

  const leftLabel = createLayer("text");
  leftLabel.name = "Before Label";
  leftLabel.text!.text = "Before";
  leftLabel.text!.font_size = 56;
  leftLabel.text!.color = "#991B1B";
  leftLabel.text!.align = "center";
  overrideTransform(leftLabel, { x: 200, y: 360, width: 700, height: 80 });

  // Right Side (After)
  const rightBg = createLayer("rect");
  rightBg.name = "After Background";
  rightBg.rect!.fill = "#D1FAE5";
  rightBg.rect!.corner_radius = 32;
  overrideTransform(rightBg, { x: 1020, y: 300, width: 700, height: 600 });

  const rightLabel = createLayer("text");
  rightLabel.name = "After Label";
  rightLabel.text!.text = "After";
  rightLabel.text!.font_size = 56;
  rightLabel.text!.color = "#065F46";
  rightLabel.text!.align = "center";
  overrideTransform(rightLabel, { x: 1020, y: 360, width: 700, height: 80 });

  return createScene("Comparison", 5000, "#FFFFFF", [title, leftBg, leftLabel, rightBg, rightLabel]);
}

export const TEMPLATES = [
  {
    id: "api-explainer",
    name: "API Explainer",
    description: "Dark-mode technical design for API visualization.",
    factory: createApiExplainer,
  },
  {
    id: "app-walkthrough",
    name: "App Walkthrough",
    description: "Mobile app frame and screen walkthrough.",
    factory: createAppWalkthrough,
  },
  {
    id: "saas-product-demo",
    name: "SaaS Product Demo",
    description: "Hero section style layout with bold CTA.",
    factory: createSaasProductDemo,
  },
  {
    id: "system-diagram",
    name: "System Diagram",
    description: "Multi-node architecture layout.",
    factory: createSystemDiagram,
  },
  {
    id: "comparison",
    name: "Comparison",
    description: "Before vs After split view.",
    factory: createComparison,
  },
];
