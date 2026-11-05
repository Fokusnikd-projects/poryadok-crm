import React from "react";
import { createRoot } from "react-dom/client";
import { RuntimeGate } from "./RuntimeGate.jsx";
import "./styles.css";
import { applyTheme, readThemePref } from "./theme.js";

// Apply the saved theme before the first paint.
applyTheme(readThemePref());

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RuntimeGate />
  </React.StrictMode>,
);
