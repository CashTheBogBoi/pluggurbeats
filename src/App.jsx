import { BrowserRouter, Routes, Route } from "react-router-dom";
import Marketing from "./pages/Marketing.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Staff from "./pages/Staff.jsx";
import Verified from "./pages/Verified.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Marketing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/verified" element={<Verified />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
