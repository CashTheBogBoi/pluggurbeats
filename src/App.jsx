import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

const Marketing = lazy(() => import("./pages/Marketing.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Staff = lazy(() => import("./pages/Staff.jsx"));
const Verified = lazy(() => import("./pages/Verified.jsx"));
const NotFound = lazy(() => import("./pages/NotFound.jsx"));

// In the native app there's no marketing site — launch straight into the
// sign-in screen. On the web, "/" is the marketing landing page.
const isNative = Capacitor.isNativePlatform();

function RouteFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink text-bone-dim">
      <div className="flex items-center gap-3 text-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
        Loading...
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={isNative ? <Navigate to="/login" replace /> : <Marketing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/verified" element={<Verified />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
