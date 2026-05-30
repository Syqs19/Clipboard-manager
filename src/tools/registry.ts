import { Braces, Network } from "lucide-react";
import type { ToolDescriptor } from "./types";
import { PortKiller } from "./port-killer/PortKiller";
import { JsonFormatter } from "./json-formatter/JsonFormatter";

/// Registry dei Tools: UNICA fonte di verità. Sia la griglia di card sia il
/// contenitore full-screen leggono da qui — niente liste sincronizzate a mano.
/// Per aggiungere un tool: crea src/tools/<nome>/<Nome>.tsx e aggiungi UNA voce.
export const toolsRegistry: ToolDescriptor[] = [
  {
    id: "port-killer",
    label: "Port Killer",
    description: "Find what is listening on a TCP port and kill it.",
    icon: Network,
    component: PortKiller,
  },
  {
    id: "json-formatter",
    label: "JSON Formatter",
    description: "Validate, format and minify JSON with syntax highlighting.",
    icon: Braces,
    component: JsonFormatter,
  },
];
