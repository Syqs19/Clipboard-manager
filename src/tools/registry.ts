import {
  Binary,
  Braces,
  Clock,
  Database,
  GitCompareArrows,
  Hash,
  KeyRound,
  Network,
  QrCode as QrCodeIcon,
  Regex as RegexIcon,
  ShieldCheck,
  Timer,
} from "lucide-react";
import type { ToolDescriptor } from "./types";
import { PortKiller } from "./port-killer/PortKiller";
import { JsonFormatter } from "./json-formatter/JsonFormatter";
import { Base64Url } from "./base64-url/Base64Url";
import { Timestamp } from "./timestamp/Timestamp";
import { Generators } from "./generators/Generators";
import { TextDiff } from "./text-diff/TextDiff";
import { Jwt } from "./jwt/Jwt";
import { Regex } from "./regex/Regex";
import { Cron } from "./cron/Cron";
import { NumberBase } from "./number-base/NumberBase";
import { FakeData } from "./fake-data/FakeData";
import { QrCode } from "./qrcode/QrCode";

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
  {
    id: "jwt",
    label: "JWT Decoder",
    description: "Decode a JWT's header and payload, with readable expiry.",
    icon: ShieldCheck,
    component: Jwt,
  },
  {
    id: "regex",
    label: "Regex Tester",
    description: "Test regular expressions with live match highlighting.",
    icon: RegexIcon,
    component: Regex,
  },
  {
    id: "cron",
    label: "Cron Parser",
    description: "Explain a cron expression and show its next runs.",
    icon: Timer,
    component: Cron,
  },
  {
    id: "number-base",
    label: "Number Base",
    description: "Convert numbers between binary, octal, decimal and hex.",
    icon: Hash,
    component: NumberBase,
  },
  {
    id: "fake-data",
    label: "Fake Data",
    description: "Generate lorem ipsum text and sample JSON records.",
    icon: Database,
    component: FakeData,
  },
  {
    id: "qrcode",
    label: "QR Code",
    description: "Generate a QR code from text or a URL and save it.",
    icon: QrCodeIcon,
    component: QrCode,
  },
];
