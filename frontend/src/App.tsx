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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/render/:projectId" element={<RenderFrame />} />
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
