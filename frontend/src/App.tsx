import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Jobs } from "./pages/Jobs";
import { Studio } from "./pages/Studio";
import { Chat } from "./pages/Chat";
import { Guide } from "./pages/Guide";
import { Motion } from "./pages/Motion";
import { MotionEditor } from "./pages/MotionEditor";
import { Processing } from "./pages/Processing";
import { Models } from "./pages/Models";
import { Settings } from "./pages/Settings";

import { RenderFrame } from "./pages/RenderFrame";
// Redesign prototype (LT-REDESIGN). Sits OUTSIDE <Layout> like /render,
// because it proposes a replacement for that shell — nesting it inside the
// shell it replaces would render a shell within a shell. Nothing else in
// the app links here; it is reachable only by typing the URL, so no
// existing screen is affected.
import { VoiceoverStudioPreview } from "./design/VoiceoverStudioPreview";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/render/:projectId" element={<RenderFrame />} />
        <Route path="/design-preview" element={<VoiceoverStudioPreview />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/motion" element={<Motion />} />
          <Route path="/motion/:projectId" element={<MotionEditor />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/processing" element={<Jobs />} />
          <Route path="/processing/:jobId" element={<Processing />} />
          <Route path="/models" element={<Models />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
