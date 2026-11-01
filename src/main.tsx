import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import "./design/components.css";
import App from "./App";
import { DbProvider } from "./db/DbContext";
import Gate from "./components/Gate";
createRoot(document.getElementById("root")!).render(<DbProvider><Gate><App /></Gate></DbProvider>);
