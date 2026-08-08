import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RadialApp } from "./radial/RadialApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RadialApp />
  </StrictMode>,
);
