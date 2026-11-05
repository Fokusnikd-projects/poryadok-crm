import React from "react";
import { createRoot } from "react-dom/client";
import { RuntimeGate } from "./RuntimeGate.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RuntimeGate />
  </React.StrictMode>,
);
