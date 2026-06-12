import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// NOTE: we intentionally do NOT wrap in <React.StrictMode>. StrictMode
// double-invokes effects in dev, which would mount xterm.js twice and spawn the
// PTY against a discarded terminal — losing the agent's initial output. The
// mirror hosts a single, imperative, real process, so a single mount is correct.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
