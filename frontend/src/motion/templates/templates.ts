import { createLayer } from "../layerFactory";
import { newId } from "../state";
import type { MotionScene, MotionLayer, Transform } from "../../types/motion";
import { barChart, lineChart, stickyNoteGrid } from "../charts/charts";
import { arrowCallout, highlightBox, speechBubble } from "../callouts/calloutFactory";
import { laptopFrame } from "../deviceframes/deviceFrames";

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

export function createSoftwareTutorial(): MotionScene {
  // Step-by-step tutorial: a laptop frame holding a step-list panel plus a
  // numbered speech bubble pointing at it. Reuses the laptop frame chrome so
  // the screen looks like a real app window without rendering an actual one.
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#0F172A";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "How to Publish Your Project";
  title.text!.font_size = 64;
  title.text!.color = "#F1F5F9";
  title.text!.align = "left";
  overrideTransform(title, { x: 120, y: 110, width: 1200, height: 80 });

  const subtitle = createLayer("text");
  subtitle.name = "Subtitle";
  subtitle.text!.text = "A 3-step walkthrough";
  subtitle.text!.font_size = 28;
  subtitle.text!.color = "#94A3B8";
  subtitle.text!.align = "left";
  overrideTransform(subtitle, { x: 120, y: 200, width: 1200, height: 50 });

  // Laptop frame on the right, content is a colored panel standing in for
  // the actual app screen.
  const laptopScreen = createLayer("rect");
  laptopScreen.name = "Laptop Screen";
  laptopScreen.rect!.fill = "#1E293B";
  laptopScreen.rect!.corner_radius = 4;
  overrideTransform(laptopScreen, { x: 1020, y: 320, width: 720, height: 460 });

  const laptopFrameLayers = laptopFrame(1020, 320, 720, 460);

  // Step list on the left.
  const steps: Array<{ num: string; title: string; desc: string; color: string }> = [
    { num: "1", title: "Open the dashboard", desc: "Click Publish in the top right.", color: "#38BDF8" },
    { num: "2", title: "Choose a destination", desc: "Pick MP4, GIF, or share link.", color: "#A78BFA" },
    { num: "3", title: "Hit Publish", desc: "We render and notify you when ready.", color: "#34D399" },
  ];

  const stepLayers: MotionLayer[] = [];
  steps.forEach((step, i) => {
    const y = 320 + i * 140;
    // Number badge
    const badge = createLayer("ellipse");
    badge.name = `Step ${step.num} badge`;
    badge.ellipse!.fill = step.color;
    overrideTransform(badge, { x: 120, y, width: 64, height: 64 });
    stepLayers.push(badge);

    const badgeText = createLayer("text");
    badgeText.name = `Step ${step.num} number`;
    badgeText.text!.text = step.num;
    badgeText.text!.font_size = 36;
    badgeText.text!.color = "#0F172A";
    badgeText.text!.font_weight = 700;
    badgeText.text!.align = "center";
    overrideTransform(badgeText, { x: 120, y: y + 14, width: 64, height: 50 });
    stepLayers.push(badgeText);

    const stepTitle = createLayer("text");
    stepTitle.name = `Step ${step.num} title`;
    stepTitle.text!.text = step.title;
    stepTitle.text!.font_size = 32;
    stepTitle.text!.color = "#F1F5F9";
    stepTitle.text!.align = "left";
    overrideTransform(stepTitle, { x: 210, y: y + 2, width: 760, height: 40 });
    stepLayers.push(stepTitle);

    const stepDesc = createLayer("text");
    stepDesc.name = `Step ${step.num} description`;
    stepDesc.text!.text = step.desc;
    stepDesc.text!.font_size = 22;
    stepDesc.text!.color = "#94A3B8";
    stepDesc.text!.align = "left";
    overrideTransform(stepDesc, { x: 210, y: y + 46, width: 760, height: 36 });
    stepLayers.push(stepDesc);
  });

  // Speech bubble pointing at the laptop screen.
  const callout = speechBubble(820, 760, "Click Publish!", 220, 90);

  // Arrow from bubble to laptop screen.
  const arrow = arrowCallout(1040, 800, 180);

  return createScene("Software Tutorial", 8000, "#0F172A", [
    bg,
    title,
    subtitle,
    laptopScreen,
    ...laptopFrameLayers,
    ...stepLayers,
    ...callout,
    ...arrow,
  ]);
}

export function createStartupPitch(): MotionScene {
  // Bold pitch hero with a stat strip — gradient-like accents via flat color
  // blocks. Visual rhythm: huge headline, supporting subline, three big
  // numbers, a CTA pill.
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#1E1B4B";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  // Decorative accent bar at the top.
  const accentBar = createLayer("rect");
  accentBar.name = "Accent Bar";
  accentBar.rect!.fill = "#F59E0B";
  accentBar.rect!.corner_radius = 4;
  overrideTransform(accentBar, { x: 0, y: 0, width: 1920, height: 12 });

  const tag = createLayer("text");
  tag.name = "Tagline";
  tag.text!.text = "SERIES A · 2026";
  tag.text!.font_size = 24;
  tag.text!.color = "#FBBF24";
  tag.text!.align = "left";
  overrideTransform(tag, { x: 160, y: 130, width: 600, height: 40 });

  const headline = createLayer("text");
  headline.name = "Headline";
  headline.text!.text = "Meet your AI motion studio.";
  headline.text!.font_size = 120;
  headline.text!.font_weight = 800;
  headline.text!.color = "#FFFFFF";
  headline.text!.align = "left";
  overrideTransform(headline, { x: 160, y: 200, width: 1600, height: 160 });

  const subline = createLayer("text");
  subline.name = "Subline";
  subline.text!.text = "Animated explainers, ready in minutes — not weeks.";
  subline.text!.font_size = 40;
  subline.text!.color = "#C7D2FE";
  subline.text!.align = "left";
  overrideTransform(subline, { x: 160, y: 380, width: 1600, height: 60 });

  // Three stat blocks.
  const stats: Array<{ big: string; label: string; color: string }> = [
    { big: "10×", label: "Faster than agencies", color: "#F472B6" },
    { big: "$0", label: "Per-seat pricing", color: "#34D399" },
    { big: "200+", label: "Templates ready", color: "#60A5FA" },
  ];

  const statLayers: MotionLayer[] = [];
  stats.forEach((stat, i) => {
    const x = 160 + i * 560;
    const y = 540;
    const big = createLayer("text");
    big.name = `Stat ${i + 1} value`;
    big.text!.text = stat.big;
    big.text!.font_size = 128;
    big.text!.font_weight = 800;
    big.text!.color = stat.color;
    big.text!.align = "left";
    overrideTransform(big, { x, y, width: 520, height: 160 });
    statLayers.push(big);

    const label = createLayer("text");
    label.name = `Stat ${i + 1} label`;
    label.text!.text = stat.label;
    label.text!.font_size = 28;
    label.text!.color = "#E0E7FF";
    label.text!.align = "left";
    overrideTransform(label, { x, y: y + 180, width: 520, height: 40 });
    statLayers.push(label);
  });

  // CTA pill.
  const cta = createLayer("rect");
  cta.name = "CTA Pill";
  cta.rect!.fill = "#F59E0B";
  cta.rect!.corner_radius = 32;
  overrideTransform(cta, { x: 160, y: 870, width: 320, height: 88 });

  const ctaText = createLayer("text");
  ctaText.name = "CTA Text";
  ctaText.text!.text = "Book a demo →";
  ctaText.text!.font_size = 32;
  ctaText.text!.font_weight = 700;
  ctaText.text!.color = "#1E1B4B";
  ctaText.text!.align = "center";
  overrideTransform(ctaText, { x: 160, y: 894, width: 320, height: 44 });

  // Founder line.
  const founder = createLayer("text");
  founder.name = "Founder";
  founder.text!.text = "Jane Doe, CEO · hello@startup.example";
  founder.text!.font_size = 24;
  founder.text!.color = "#A5B4FC";
  founder.text!.align = "right";
  overrideTransform(founder, { x: 1100, y: 900, width: 660, height: 40 });

  return createScene("Startup Pitch", 7000, "#1E1B4B", [
    bg,
    accentBar,
    tag,
    headline,
    subline,
    ...statLayers,
    cta,
    ctaText,
    founder,
  ]);
}

export function createWorkflowAnimation(): MotionScene {
  // A 5-step horizontal pipeline with a stage label above each box and a
  // short caption below — reads as a process diagram rather than a chart.
  // Reuses the simpleFlowchart factory for the box+arrow backbone, then
  // layers labels on top of each box.
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#F8FAFC";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "Deployment Pipeline";
  title.text!.font_size = 56;
  title.text!.color = "#0F172A";
  title.text!.align = "left";
  overrideTransform(title, { x: 120, y: 110, width: 1400, height: 80 });

  const subtitle = createLayer("text");
  subtitle.name = "Subtitle";
  subtitle.text!.text = "From commit to production in five automated stages.";
  subtitle.text!.font_size = 24;
  subtitle.text!.color = "#64748B";
  subtitle.text!.align = "left";
  overrideTransform(subtitle, { x: 120, y: 200, width: 1700, height: 40 });

  // Five labelled stages laid out by hand so we can size the arrows to fit
  // the wider canvas. The simpleFlowchart factory is too tight for 5 boxes
  // across 1920px.
  const stages: Array<{ label: string; caption: string; color: string }> = [
    { label: "Build", caption: "Compile & test", color: "#3B82F6" },
    { label: "Test", caption: "Unit + E2E", color: "#8B5CF6" },
    { label: "Stage", caption: "Deploy to staging", color: "#EC4899" },
    { label: "Approve", caption: "Manual sign-off", color: "#F59E0B" },
    { label: "Ship", caption: "Production push", color: "#10B981" },
  ];

  const boxW = 280;
  const boxH = 120;
  const gap = 60;
  const totalW = stages.length * boxW + (stages.length - 1) * gap;
  const startX = (1920 - totalW) / 2;
  const boxY = 480;

  const flowLayers: MotionLayer[] = [];
  stages.forEach((stage, i) => {
    const bx = startX + i * (boxW + gap);
    const box = createLayer("rect");
    box.name = `Stage ${i + 1} box`;
    box.rect!.fill = stage.color;
    box.rect!.corner_radius = 16;
    overrideTransform(box, { x: bx, y: boxY, width: boxW, height: boxH });
    flowLayers.push(box);

    const label = createLayer("text");
    label.name = `Stage ${i + 1} label`;
    label.text!.text = stage.label;
    label.text!.font_size = 36;
    label.text!.font_weight = 700;
    label.text!.color = "#FFFFFF";
    label.text!.align = "center";
    overrideTransform(label, { x: bx, y: boxY + 22, width: boxW, height: 50 });
    flowLayers.push(label);

    const caption = createLayer("text");
    caption.name = `Stage ${i + 1} caption`;
    caption.text!.text = stage.caption;
    caption.text!.font_size = 20;
    caption.text!.color = "#FFFFFF";
    caption.text!.align = "center";
    overrideTransform(caption, { x: bx, y: boxY + 74, width: boxW, height: 32 });
    flowLayers.push(caption);

    // Connector to the next box.
    if (i < stages.length - 1) {
      const arrowX = bx + boxW + 8;
      const arrowY = boxY + boxH / 2;
      const arrowLen = gap - 16;
      const arrow = arrowCallout(arrowX, arrowY - 3, arrowLen);
      flowLayers.push(...arrow);
    }
  });

  // Footer status row.
  const footer = createLayer("text");
  footer.name = "Footer";
  footer.text!.text = "Average duration: 4m 12s · Last run: 2 minutes ago";
  footer.text!.font_size = 22;
  footer.text!.color = "#64748B";
  footer.text!.align = "center";
  overrideTransform(footer, { x: 360, y: 880, width: 1200, height: 40 });

  return createScene("Workflow Animation", 7000, "#F8FAFC", [bg, title, subtitle, ...flowLayers, footer]);
}

export function createNetworkDiagram(): MotionScene {
  // Mesh-style network: a central hub with spokes to four satellites, plus
  // a satellite-to-satellite link to break the strict hub-and-spoke pattern.
  // The connector paths are line-segment style — drawn with thin rotated rects
  // to keep within the rect/ellipse/text primitives the renderer supports.
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#020617";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "Mesh Network Topology";
  title.text!.font_size = 48;
  title.text!.color = "#E2E8F0";
  title.text!.align = "center";
  overrideTransform(title, { x: 360, y: 100, width: 1200, height: 60 });

  const subtitle = createLayer("text");
  subtitle.name = "Subtitle";
  subtitle.text!.text = "5 nodes · 6 links · 0 single points of failure";
  subtitle.text!.font_size = 24;
  subtitle.text!.color = "#94A3B8";
  subtitle.text!.align = "center";
  overrideTransform(subtitle, { x: 360, y: 170, width: 1200, height: 40 });

  // Helper: a node is a colored ellipse + label below it.
  function node(cx: number, cy: string | number, label: string, color: string, sublabel: string): MotionLayer[] {
    const w = 200;
    const h = 200;
    const x = cx - w / 2;
    const y = (typeof cy === "number" ? cy : 0) - h / 2;
    const dot = createLayer("ellipse");
    dot.name = `${label} node`;
    dot.ellipse!.fill = color;
    dot.ellipse!.stroke_color = "#FFFFFF";
    dot.ellipse!.stroke_width = 4;
    overrideTransform(dot, { x, y, width: w, height: h });
    const lab = createLayer("text");
    lab.name = `${label} text`;
    lab.text!.text = label;
    lab.text!.font_size = 22;
    lab.text!.font_weight = 700;
    lab.text!.color = "#0F172A";
    lab.text!.align = "center";
    overrideTransform(lab, { x: x - 40, y: y + h / 2 - 14, width: w + 80, height: 32 });
    const sub = createLayer("text");
    sub.name = `${label} sublabel`;
    sub.text!.text = sublabel;
    sub.text!.font_size = 16;
    sub.text!.color = "#0F172A";
    sub.text!.align = "center";
    overrideTransform(sub, { x: x - 60, y: y + h / 2 + 18, width: w + 120, height: 24 });
    return [dot, lab, sub];
  }

  // Helper: a thin rotated-rect line segment connecting two points.
  function link(x1: number, y1: number, x2: number, y2: number, color = "#475569"): MotionLayer {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const link = createLayer("rect");
    link.name = "Network link";
    link.rect!.fill = color;
    link.rect!.corner_radius = 1;
    overrideTransform(link, { x: midX - length / 2, y: midY - 2, width: length, height: 4, rotation: angleDeg });
    return link;
  }

  // Layout: hub in the center, satellites at compass points.
  const cx = 960;
  const cy = 600;
  const r = 280;
  const n_top = { x: cx, y: cy - r };
  const n_right = { x: cx + r, y: cy };
  const n_bottom = { x: cx, y: cy + r };
  const n_left = { x: cx - r, y: cy };
  const n_tr = { x: cx + r * 0.7, y: cy - r * 0.7 };

  const linkLayers: MotionLayer[] = [
    link(cx, cy, n_top.x, n_top.y),
    link(cx, cy, n_right.x, n_right.y),
    link(cx, cy, n_bottom.x, n_bottom.y),
    link(cx, cy, n_left.x, n_left.y),
    link(n_top.x, n_top.y, n_tr.x, n_tr.y),
    link(n_right.x, n_right.y, n_tr.x, n_tr.y),
  ];

  const hub = node(cx, cy, "Gateway", "#F59E0B", "primary");
  const top = node(n_top.x, n_top.y, "Sensor A", "#38BDF8", "leaf");
  const right = node(n_right.x, n_right.y, "Sensor B", "#A78BFA", "leaf");
  const bottom = node(n_bottom.x, n_bottom.y, "Sensor C", "#F472B6", "leaf");
  const left = node(n_left.x, n_left.y, "Sensor D", "#34D399", "leaf");
  const tr = node(n_tr.x, n_tr.y, "Repeater", "#FBBF24", "relay");

  // Legend block in the corner.
  const legendBg = createLayer("rect");
  legendBg.name = "Legend background";
  legendBg.rect!.fill = "#0F172A";
  legendBg.rect!.corner_radius = 8;
  overrideTransform(legendBg, { x: 80, y: 900, width: 480, height: 140 });

  const legendText = createLayer("text");
  legendText.name = "Legend title";
  legendText.text!.text = "● Gateway  ● Sensor  ● Repeater";
  legendText.text!.font_size = 20;
  legendText.text!.color = "#E2E8F0";
  legendText.text!.align = "left";
  overrideTransform(legendText, { x: 100, y: 920, width: 440, height: 30 });

  const legendSub = createLayer("text");
  legendSub.name = "Legend subtitle";
  legendSub.text!.text = "All nodes run on battery + solar";
  legendSub.text!.font_size = 16;
  legendSub.text!.color = "#94A3B8";
  legendSub.text!.align = "left";
  overrideTransform(legendSub, { x: 100, y: 960, width: 440, height: 24 });

  return createScene("Network Diagram", 7000, "#020617", [
    bg,
    title,
    subtitle,
    ...linkLayers,
    ...hub,
    ...top,
    ...right,
    ...bottom,
    ...left,
    ...tr,
    legendBg,
    legendText,
    legendSub,
  ]);
}

export function createTimeline(): MotionScene {
  // Horizontal timeline: 5 dated events on a single axis with a date label,
  // a heading, and a short description per marker. Each marker is a circle
  // sitting on the line; vertical rules are not used so it reads cleanly.
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#FFFFFF";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "Project Milestones";
  title.text!.font_size = 56;
  title.text!.color = "#111827";
  title.text!.align = "center";
  overrideTransform(title, { x: 260, y: 110, width: 1400, height: 80 });

  const subtitle = createLayer("text");
  subtitle.name = "Subtitle";
  subtitle.text!.text = "How we got from idea to launch";
  subtitle.text!.font_size = 24;
  subtitle.text!.color = "#6B7280";
  subtitle.text!.align = "center";
  overrideTransform(subtitle, { x: 260, y: 200, width: 1400, height: 40 });

  // The axis bar.
  const axisY = 540;
  const axis = createLayer("rect");
  axis.name = "Timeline axis";
  axis.rect!.fill = "#9CA3AF";
  overrideTransform(axis, { x: 200, y: axisY, width: 1520, height: 6 });

  const events: Array<{ date: string; heading: string; desc: string; color: string; above: boolean }> = [
    { date: "Q1 2024", heading: "Discovery", desc: "Customer interviews, market sizing.", color: "#3B82F6", above: true },
    { date: "Q3 2024", heading: "Prototype", desc: "First working demo with 5 beta users.", color: "#8B5CF6", above: false },
    { date: "Q1 2025", heading: "Seed round", desc: "$3M to grow the founding team.", color: "#EC4899", above: true },
    { date: "Q4 2025", heading: "Public beta", desc: "Opened sign-ups; 12k users in week one.", color: "#F59E0B", above: false },
    { date: "Q2 2026", heading: "GA launch", desc: "Available to everyone, with paid plans.", color: "#10B981", above: true },
  ];

  const timelineLayers: MotionLayer[] = [];
  events.forEach((evt, i) => {
    const t = events.length === 1 ? 0.5 : i / (events.length - 1);
    const cx = 200 + t * 1520;
    // Marker dot.
    const dot = createLayer("ellipse");
    dot.name = `${evt.date} marker`;
    dot.ellipse!.fill = evt.color;
    dot.ellipse!.stroke_color = "#FFFFFF";
    dot.ellipse!.stroke_width = 4;
    overrideTransform(dot, { x: cx - 16, y: axisY - 13, width: 32, height: 32 });
    timelineLayers.push(dot);

    // Date label sits on the side opposite the heading.
    const dateY = evt.above ? axisY + 30 : axisY - 70;
    const date = createLayer("text");
    date.name = `${evt.date} date`;
    date.text!.text = evt.date;
    date.text!.font_size = 22;
    date.text!.font_weight = 700;
    date.text!.color = evt.color;
    date.text!.align = "center";
    overrideTransform(date, { x: cx - 130, y: dateY, width: 260, height: 32 });
    timelineLayers.push(date);

    // Heading + description go on the opposite side.
    const headY = evt.above ? axisY - 200 : axisY + 80;
    const head = createLayer("text");
    head.name = `${evt.date} heading`;
    head.text!.text = evt.heading;
    head.text!.font_size = 30;
    head.text!.font_weight = 700;
    head.text!.color = "#111827";
    head.text!.align = "center";
    overrideTransform(head, { x: cx - 160, y: headY, width: 320, height: 40 });
    timelineLayers.push(head);

    const descY = evt.above ? axisY - 150 : axisY + 130;
    const desc = createLayer("text");
    desc.name = `${evt.date} description`;
    desc.text!.text = evt.desc;
    desc.text!.font_size = 18;
    desc.text!.color = "#4B5563";
    desc.text!.align = "center";
    overrideTransform(desc, { x: cx - 180, y: descY, width: 360, height: 70 });
    timelineLayers.push(desc);
  });

  // Footer caption.
  const footer = createLayer("text");
  footer.name = "Footer";
  footer.text!.text = "Next milestone: Series A · target close Q4 2026";
  footer.text!.font_size = 20;
  footer.text!.color = "#9CA3AF";
  footer.text!.align = "center";
  overrideTransform(footer, { x: 260, y: 940, width: 1400, height: 32 });

  return createScene("Timeline", 8000, "#FFFFFF", [bg, title, subtitle, axis, ...timelineLayers, footer]);
}

export function createRoadmap(): MotionScene {
  // A 3-column roadmap (Now / Next / Later) with cards stacked under each
  // header. Uses a simple column-rule motif (a thin vertical divider between
  // columns) and status-pill cards so it reads as a planning board.
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#0B0F19";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "Q3 Roadmap";
  title.text!.font_size = 64;
  title.text!.color = "#F8FAFC";
  title.text!.align = "left";
  overrideTransform(title, { x: 120, y: 100, width: 1200, height: 80 });

  const subtitle = createLayer("text");
  subtitle.name = "Subtitle";
  subtitle.text!.text = "Where we're headed this quarter.";
  subtitle.text!.font_size = 26;
  subtitle.text!.color = "#94A3B8";
  subtitle.text!.align = "left";
  overrideTransform(subtitle, { x: 120, y: 190, width: 1400, height: 40 });

  const columns: Array<{ header: string; color: string; cards: Array<{ title: string; tag: string; tagColor: string }> }> = [
    {
      header: "Now",
      color: "#22C55E",
      cards: [
        { title: "Live captions", tag: "Shipping", tagColor: "#22C55E" },
        { title: "Custom export presets", tag: "Polishing", tagColor: "#22C55E" },
      ],
    },
    {
      header: "Next",
      color: "#3B82F6",
      cards: [
        { title: "Team workspaces", tag: "In design", tagColor: "#3B82F6" },
        { title: "Comments & review", tag: "Researching", tagColor: "#3B82F6" },
        { title: "Brand kits", tag: "Scoping", tagColor: "#3B82F6" },
      ],
    },
    {
      header: "Later",
      color: "#A78BFA",
      cards: [
        { title: "AI-assisted scripting", tag: "Exploring", tagColor: "#A78BFA" },
        { title: "Marketplace templates", tag: "Backlog", tagColor: "#A78BFA" },
      ],
    },
  ];

  const colW = 540;
  const colGap = 30;
  const colStartX = 120;
  const colY = 290;
  const colH = 700;

  const roadmapLayers: MotionLayer[] = [];
  columns.forEach((col, ci) => {
    const x = colStartX + ci * (colW + colGap);

    // Column header strip.
    const headerStrip = createLayer("rect");
    headerStrip.name = `${col.header} column header`;
    headerStrip.rect!.fill = col.color;
    headerStrip.rect!.corner_radius = 12;
    overrideTransform(headerStrip, { x, y: colY, width: colW, height: 64 });
    roadmapLayers.push(headerStrip);

    const headerText = createLayer("text");
    headerText.name = `${col.header} header text`;
    headerText.text!.text = col.header;
    headerText.text!.font_size = 30;
    headerText.text!.font_weight = 700;
    headerText.text!.color = "#0B0F19";
    headerText.text!.align = "left";
    overrideTransform(headerText, { x: x + 24, y: colY + 14, width: colW - 48, height: 40 });
    roadmapLayers.push(headerText);

    // Column body (a darker panel under the cards so they pop).
    const body = createLayer("rect");
    body.name = `${col.header} column body`;
    body.rect!.fill = "#111827";
    body.rect!.corner_radius = 12;
    overrideTransform(body, { x, y: colY + 80, width: colW, height: colH - 80 });
    roadmapLayers.push(body);

    // Cards.
    const cardH = 110;
    const cardGap = 16;
    let cursorY = colY + 100;
    col.cards.forEach((card) => {
      const cardRect = createLayer("rect");
      cardRect.name = `${card.title} card`;
      cardRect.rect!.fill = "#1F2937";
      cardRect.rect!.corner_radius = 10;
      overrideTransform(cardRect, { x: x + 16, y: cursorY, width: colW - 32, height: cardH });
      roadmapLayers.push(cardRect);

      // Left accent bar.
      const accent = createLayer("rect");
      accent.name = `${card.title} accent`;
      accent.rect!.fill = card.tagColor;
      accent.rect!.corner_radius = 3;
      overrideTransform(accent, { x: x + 16, y: cursorY + 12, width: 6, height: cardH - 24 });
      roadmapLayers.push(accent);

      const cardTitle = createLayer("text");
      cardTitle.name = `${card.title} title`;
      cardTitle.text!.text = card.title;
      cardTitle.text!.font_size = 24;
      cardTitle.text!.font_weight = 600;
      cardTitle.text!.color = "#F9FAFB";
      cardTitle.text!.align = "left";
      overrideTransform(cardTitle, { x: x + 36, y: cursorY + 18, width: colW - 80, height: 36 });
      roadmapLayers.push(cardTitle);

      // Status pill.
      const pillW = 130;
      const pillX = x + colW - 16 - pillW - 12;
      const pill = createLayer("rect");
      pill.name = `${card.title} pill`;
      pill.rect!.fill = card.tagColor;
      pill.rect!.corner_radius = 14;
      overrideTransform(pill, { x: pillX, y: cursorY + 64, width: pillW, height: 28 });
      roadmapLayers.push(pill);

      const pillText = createLayer("text");
      pillText.name = `${card.title} pill text`;
      pillText.text!.text = card.tag;
      pillText.text!.font_size = 14;
      pillText.text!.font_weight = 700;
      pillText.text!.color = "#0B0F19";
      pillText.text!.align = "center";
      overrideTransform(pillText, { x: pillX, y: cursorY + 68, width: pillW, height: 22 });
      roadmapLayers.push(pillText);

      cursorY += cardH + cardGap;
    });
  });

  return createScene("Roadmap", 7000, "#0B0F19", [bg, title, subtitle, ...roadmapLayers]);
}

export function createPresentation(): MotionScene {
  // Single-slide presentation deck: a centered title block, three bullet
  // points with bullet dots, and a small page-number / brand bar in the
  // corner. Reads as a clean, business-deck cover slide.
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#FFFFFF";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  // Left vertical accent stripe.
  const stripe = createLayer("rect");
  stripe.name = "Left accent";
  stripe.rect!.fill = "#1E40AF";
  overrideTransform(stripe, { x: 0, y: 0, width: 24, height: 1080 });

  // Slide label.
  const slideLabel = createLayer("text");
  slideLabel.name = "Slide label";
  slideLabel.text!.text = "SLIDE 03 / 12";
  slideLabel.text!.font_size = 22;
  slideLabel.text!.color = "#1E40AF";
  slideLabel.text!.align = "left";
  slideLabel.text!.font_weight = 700;
  overrideTransform(slideLabel, { x: 120, y: 110, width: 400, height: 32 });

  const title = createLayer("text");
  title.name = "Slide title";
  title.text!.text = "Where we go from here";
  title.text!.font_size = 96;
  title.text!.color = "#0F172A";
  title.text!.font_weight = 800;
  title.text!.align = "left";
  overrideTransform(title, { x: 120, y: 180, width: 1680, height: 130 });

  // Underline accent under the title.
  const titleAccent = createLayer("rect");
  titleAccent.name = "Title accent";
  titleAccent.rect!.fill = "#1E40AF";
  overrideTransform(titleAccent, { x: 120, y: 330, width: 200, height: 8 });

  const bullets: Array<{ heading: string; body: string }> = [
    { heading: "Expand the team", body: "Hire two engineers and one designer in Q4." },
    { heading: "Ship the analytics dashboard", body: "Internal users will get it first, in beta." },
    { heading: "Pilot with three design partners", body: "Tailored onboarding for the design partners." },
  ];

  const bulletLayers: MotionLayer[] = [];
  bullets.forEach((b, i) => {
    const by = 460 + i * 140;
    // Bullet dot.
    const dot = createLayer("ellipse");
    dot.name = `Bullet ${i + 1} dot`;
    dot.ellipse!.fill = "#1E40AF";
    overrideTransform(dot, { x: 120, y: by + 18, width: 24, height: 24 });
    bulletLayers.push(dot);

    const head = createLayer("text");
    head.name = `Bullet ${i + 1} heading`;
    head.text!.text = b.heading;
    head.text!.font_size = 40;
    head.text!.font_weight = 700;
    head.text!.color = "#0F172A";
    head.text!.align = "left";
    overrideTransform(head, { x: 170, y: by, width: 1500, height: 50 });
    bulletLayers.push(head);

    const body = createLayer("text");
    body.name = `Bullet ${i + 1} body`;
    body.text!.text = b.body;
    body.text!.font_size = 26;
    body.text!.color = "#475569";
    body.text!.align = "left";
    overrideTransform(body, { x: 170, y: by + 60, width: 1500, height: 40 });
    bulletLayers.push(body);
  });

  // Footer / brand bar.
  const brandBar = createLayer("rect");
  brandBar.name = "Brand bar";
  brandBar.rect!.fill = "#F1F5F9";
  overrideTransform(brandBar, { x: 0, y: 1020, width: 1920, height: 60 });

  const brand = createLayer("text");
  brand.name = "Brand";
  brand.text!.text = "Motion Studio · Internal Review · 2026";
  brand.text!.font_size = 20;
  brand.text!.color = "#475569";
  brand.text!.align = "left";
  overrideTransform(brand, { x: 120, y: 1036, width: 1200, height: 28 });

  const pageNum = createLayer("text");
  pageNum.name = "Page number";
  pageNum.text!.text = "03";
  pageNum.text!.font_size = 22;
  pageNum.text!.font_weight = 700;
  pageNum.text!.color = "#1E40AF";
  pageNum.text!.align = "right";
  overrideTransform(pageNum, { x: 1700, y: 1032, width: 100, height: 36 });

  return createScene("Presentation", 6000, "#FFFFFF", [
    bg,
    stripe,
    slideLabel,
    title,
    titleAccent,
    ...bulletLayers,
    brandBar,
    brand,
    pageNum,
  ]);
}

export function createEducationInfographic(): MotionScene {
  // Education / infographic layout: a big stat on the left (large number,
  // caption, source line) with a multi-series bar chart and a line chart on
  // the right. The left side teaches a fact; the right side shows the data
  // behind it. Reuses barChart + lineChart + a small key-fact callout.
  const bg = createLayer("rect");
  bg.name = "Background";
  bg.rect!.fill = "#FAFAF9";
  overrideTransform(bg, { x: 0, y: 0, width: 1920, height: 1080 });

  const title = createLayer("text");
  title.name = "Title";
  title.text!.text = "How People Learn Online";
  title.text!.font_size = 56;
  title.text!.color = "#111827";
  title.text!.align = "left";
  overrideTransform(title, { x: 100, y: 100, width: 1500, height: 80 });

  const subtitle = createLayer("text");
  subtitle.name = "Subtitle";
  subtitle.text!.text = "Engagement trends from 2020 to 2025";
  subtitle.text!.font_size = 24;
  subtitle.text!.color = "#6B7280";
  subtitle.text!.align = "left";
  overrideTransform(subtitle, { x: 100, y: 190, width: 1500, height: 40 });

  // Left: the headline stat card.
  const statBg = createLayer("rect");
  statBg.name = "Stat card";
  statBg.rect!.fill = "#0F766E";
  statBg.rect!.corner_radius = 16;
  overrideTransform(statBg, { x: 100, y: 300, width: 520, height: 480 });

  const statLabel = createLayer("text");
  statLabel.name = "Stat label";
  statLabel.text!.text = "MEDIAN WEEKLY TIME";
  statLabel.text!.font_size = 18;
  statLabel.text!.font_weight = 700;
  statLabel.text!.color = "#5EEAD4";
  statLabel.text!.align = "left";
  overrideTransform(statLabel, { x: 140, y: 340, width: 440, height: 30 });

  const statNumber = createLayer("text");
  statNumber.name = "Stat number";
  statNumber.text!.text = "4.7 hrs";
  statNumber.text!.font_size = 160;
  statNumber.text!.font_weight = 800;
  statNumber.text!.color = "#FFFFFF";
  statNumber.text!.align = "left";
  overrideTransform(statNumber, { x: 140, y: 380, width: 440, height: 200 });

  const statDelta = createLayer("text");
  statDelta.name = "Stat delta";
  statDelta.text!.text = "+38% vs 2020";
  statDelta.text!.font_size = 28;
  statDelta.text!.font_weight = 700;
  statDelta.text!.color = "#FACC15";
  statDelta.text!.align = "left";
  overrideTransform(statDelta, { x: 140, y: 600, width: 440, height: 40 });

  const statCaption = createLayer("text");
  statCaption.name = "Stat caption";
  statCaption.text!.text = "Across 12,000 surveyed learners aged 18–44.";
  statCaption.text!.font_size = 18;
  statCaption.text!.color = "#CCFBF1";
  statCaption.text!.align = "left";
  overrideTransform(statCaption, { x: 140, y: 650, width: 440, height: 60 });

  const statSource = createLayer("text");
  statSource.name = "Stat source";
  statSource.text!.text = "Source: Annual Learning Survey 2025";
  statSource.text!.font_size = 14;
  statSource.text!.color = "#99F6E4";
  statSource.text!.align = "left";
  overrideTransform(statSource, { x: 140, y: 730, width: 440, height: 24 });

  // Right: bar chart on top, line chart below, with a small heading each.
  const rightX = 720;
  const rightW = 1100;

  const barHeading = createLayer("text");
  barHeading.name = "Bar chart heading";
  barHeading.text!.text = "By device (minutes per session)";
  barHeading.text!.font_size = 24;
  barHeading.text!.color = "#111827";
  barHeading.text!.align = "left";
  barHeading.text!.font_weight = 700;
  overrideTransform(barHeading, { x: rightX, y: 300, width: rightW, height: 40 });

  const barLayers = barChart(rightX, 350, [0.45, 0.62, 0.88, 0.35, 0.71]);

  const lineHeading = createLayer("text");
  lineHeading.name = "Line chart heading";
  lineHeading.text!.text = "Year-over-year growth";
  lineHeading.text!.font_size = 24;
  lineHeading.text!.color = "#111827";
  lineHeading.text!.align = "left";
  lineHeading.text!.font_weight = 700;
  overrideTransform(lineHeading, { x: rightX, y: 720, width: rightW, height: 40 });

  const lineLayers = lineChart(rightX, 770, [0.32, 0.41, 0.55, 0.68, 0.79, 0.92]);

  // Highlight callout over the tallest bar.
  const highlight = highlightBox(rightX + 360, 460, 120, 200);

  // A sticky-note style aside that anchors a single takeaway.
  const noteLayers = stickyNoteGrid(1480, 880, ["Try it", "today!"]);

  return createScene("Education / Infographic", 8000, "#FAFAF9", [
    bg,
    title,
    subtitle,
    statBg,
    statLabel,
    statNumber,
    statDelta,
    statCaption,
    statSource,
    barHeading,
    ...barLayers,
    lineHeading,
    ...lineLayers,
    ...highlight,
    ...noteLayers,
  ]);
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
  {
    id: "software-tutorial",
    name: "Software Tutorial",
    description: "Step-by-step walkthrough with device frame and speech bubble.",
    factory: createSoftwareTutorial,
  },
  {
    id: "startup-pitch",
    name: "Startup Pitch",
    description: "Bold pitch hero with a stat strip and CTA pill.",
    factory: createStartupPitch,
  },
  {
    id: "workflow-animation",
    name: "Workflow Animation",
    description: "5-stage horizontal pipeline with labels per stage.",
    factory: createWorkflowAnimation,
  },
  {
    id: "network-diagram",
    name: "Network Diagram",
    description: "Mesh topology with central hub and 5 satellites.",
    factory: createNetworkDiagram,
  },
  {
    id: "timeline",
    name: "Timeline",
    description: "Horizontal milestone timeline with dated events.",
    factory: createTimeline,
  },
  {
    id: "roadmap",
    name: "Roadmap",
    description: "Now / Next / Later three-column planning board.",
    factory: createRoadmap,
  },
  {
    id: "presentation",
    name: "Presentation",
    description: "Single-slide deck cover with bullets and brand bar.",
    factory: createPresentation,
  },
  {
    id: "education-infographic",
    name: "Education / Infographic",
    description: "Headline stat card plus bar and line chart breakdowns.",
    factory: createEducationInfographic,
  },
];
