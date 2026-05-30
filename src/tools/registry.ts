import {
  Binary,
  Braces,
  Clock,
  GitCompareArrows,
  KeyRound,
  Network,
} from "lucide-react";
import type { ToolDescriptor } from "./types";
import { PortKiller } from "./port-killer/PortKiller";
import { JsonFormatter } from "./json-formatter/JsonFormatter";
import { Base64Url } from "./base64-url/Base64Url";
import { Timestamp } from "./timestamp/Timestamp";
import { Generators } from "./generators/Generators";
import { TextDiff } from "./text-diff/TextDiff";

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
  {
    id: "base64-url",
    label: "Base64 / URL",
    description: "Encode and decode text as Base64 or URL components.",
    icon: Binary,
    component: Base64Url,
  },
  {
    id: "timestamp",
    label: "Timestamp",
    description: "Convert between Unix timestamps and human-readable dates.",
    icon: Clock,
    component: Timestamp,
  },
  {
    id: "generators",
    label: "Generators",
    description: "Generate UUIDs, hashes (MD5/SHA) and random passwords.",
    icon: KeyRound,
    component: Generators,
  },
  {
    id: "text-diff",
    label: "Text Diff",
    description: "Compare two texts and highlight line-by-line differences.",
    icon: GitCompareArrows,
    component: TextDiff,
  },
];
