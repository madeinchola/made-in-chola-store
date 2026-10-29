import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EnvError, getEnv } from "@/lib/env";
import { EnvErrorScreen } from "@/components/EnvErrorScreen";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

async function bootstrap() {
  try {
    getEnv();
  } catch (error) {
    // Env inválida: pantalla explicativa, nunca pantalla en blanco.
    const issues = error instanceof EnvError ? error.issues : [String(error)];
    root.render(<EnvErrorScreen issues={issues} />);
    return;
  }
  const { App } = await import("./app/App");
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
