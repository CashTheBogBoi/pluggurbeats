import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import "./styles/global.css";

// Live data is pushed into the cache by Firestore onSnapshot listeners (see
// src/lib/live.js), so queries never go stale and never refetch on their own.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 1000 * 60 * 10,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    }
  }
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
