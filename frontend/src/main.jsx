import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { legacyPublicPath } from "./utils/storefrontRoutes.js";

const legacyDestination = legacyPublicPath(window.location.hash);
if (legacyDestination)
  window.location.replace(legacyDestination + window.location.search);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Suspense
      fallback={
        <p role="status" className="px-6 py-12 text-center">
          Loading shop…
        </p>
      }
    >
      <App />
    </Suspense>
  </StrictMode>,
);
