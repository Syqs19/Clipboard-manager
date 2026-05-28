import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToasterProvider } from "./components/Toaster";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToasterProvider>
      <App />
    </ToasterProvider>
  </React.StrictMode>,
);
