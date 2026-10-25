import "@fontsource-variable/plus-jakarta-sans";
import "./styles/app.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ToastProvider } from "./components/ui";
import { ConfirmProvider } from "./components/extra";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <AuthProvider><App /></AuthProvider>
            </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
