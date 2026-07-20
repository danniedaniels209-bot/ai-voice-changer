import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Jobs } from "./pages/Jobs";
import { Studio } from "./pages/Studio";
import { Chat } from "./pages/Chat";
import { Processing } from "./pages/Processing";
import { Models } from "./pages/Models";
import { Settings } from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/chat" element={<Chat />} />
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
