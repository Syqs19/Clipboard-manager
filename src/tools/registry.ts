import {
  Binary,
  Braces,
  CaseSensitive,
  Clock,
  Code2,
  Database,
  FileCode,
  FileText,
  FileType2,
  Fingerprint,
  GitCompareArrows,
  Hash,
  ImageDown,
  KeyRound,
  Link2,
  Network,
  QrCode as QrCodeIcon,
  Regex as RegexIcon,
  ShieldCheck,
  Spline,
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
import { CaseConverter } from "./case-converter/CaseConverter";
import { EnvJson } from "./env-json/EnvJson";
import { HtmlEntities } from "./html-entities/HtmlEntities";
import { Slug } from "./slug/Slug";
import { HashCompare } from "./hash-compare/HashCompare";
import { YamlJson } from "./yaml-json/YamlJson";
import { Markdown } from "./markdown/Markdown";
import { ImageConverter } from "./image-converter/ImageConverter";
import { Vectorial } from "./vectorial/Vectorial";

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
    keywords: ["port", "tcp", "process", "pid", "kill", "listening", "localhost", "network"],
  },
  {
    id: "json-formatter",
    label: "JSON Formatter",
    description: "Validate, format and minify JSON with syntax highlighting.",
    icon: Braces,
    component: JsonFormatter,
    keywords: ["json", "format", "beautify", "prettify", "minify", "validate", "pretty"],
  },
  {
    id: "base64-url",
    label: "Base64 / URL",
    description: "Encode and decode text as Base64 or URL components.",
    icon: Binary,
    component: Base64Url,
    keywords: ["base64", "b64", "url", "uri", "encode", "decode", "escape"],
  },
  {
    id: "timestamp",
    label: "Timestamp",
    description: "Convert between Unix timestamps and human-readable dates.",
    icon: Clock,
    component: Timestamp,
    keywords: ["timestamp", "unix", "epoch", "date", "time", "iso", "utc", "millis"],
  },
  {
    id: "generators",
    label: "Generators",
    description: "Generate UUIDs, hashes (MD5/SHA) and random passwords.",
    icon: KeyRound,
    component: Generators,
    keywords: ["uuid", "guid", "ulid", "hash", "md5", "sha", "sha256", "password", "random", "token"],
  },
  {
    id: "text-diff",
    label: "Text Diff",
    description: "Compare two texts and highlight line-by-line differences.",
    icon: GitCompareArrows,
    component: TextDiff,
    keywords: ["diff", "compare", "text", "difference", "changes", "merge"],
  },
  {
    id: "jwt",
    label: "JWT Decoder",
    description: "Decode a JWT's header and payload, with readable expiry.",
    icon: ShieldCheck,
    component: Jwt,
    keywords: ["jwt", "token", "jose", "bearer", "decode", "auth", "claims"],
  },
  {
    id: "regex",
    label: "Regex Tester",
    description: "Test regular expressions with live match highlighting.",
    icon: RegexIcon,
    component: Regex,
    keywords: ["regex", "regexp", "pattern", "match", "replace", "regular expression"],
  },
  {
    id: "cron",
    label: "Cron Parser",
    description: "Explain a cron expression and show its next runs.",
    icon: Timer,
    component: Cron,
    keywords: ["cron", "crontab", "schedule", "expression", "job"],
  },
  {
    id: "number-base",
    label: "Number Base",
    description: "Convert numbers between binary, octal, decimal and hex.",
    icon: Hash,
    component: NumberBase,
    keywords: ["binary", "hex", "hexadecimal", "octal", "decimal", "base", "radix", "number"],
  },
  {
    id: "fake-data",
    label: "Fake Data",
    description: "Generate lorem ipsum text and sample JSON records.",
    icon: Database,
    component: FakeData,
    keywords: ["fake", "mock", "dummy", "lorem", "ipsum", "sample", "test data", "json"],
  },
  {
    id: "qrcode",
    label: "QR Code",
    description: "Generate a QR code from text or a URL and save it.",
    icon: QrCodeIcon,
    component: QrCode,
    keywords: ["qr", "qrcode", "barcode", "url", "png", "generate"],
  },
  {
    id: "case-converter",
    label: "Case Converter",
    description: "Convert between camelCase, snake_case, kebab-case and more.",
    icon: CaseSensitive,
    component: CaseConverter,
    keywords: ["case", "camelcase", "snake_case", "kebab-case", "pascalcase", "uppercase", "lowercase"],
  },
  {
    id: "env-json",
    label: ".env ↔ JSON",
    description: "Convert between .env files and JSON objects.",
    icon: Code2,
    component: EnvJson,
    keywords: ["env", "dotenv", ".env", "json", "environment", "variables", "config"],
  },
  {
    id: "html-entities",
    label: "HTML Entities",
    description: "Encode and decode HTML entities (&lt; &amp; &copy;).",
    icon: FileType2,
    component: HtmlEntities,
    keywords: ["html", "entities", "escape", "unescape", "encode", "decode", "ampersand"],
  },
  {
    id: "slug",
    label: "Slug Generator",
    description: "Turn any text into a clean URL-friendly slug.",
    icon: Link2,
    component: Slug,
    keywords: ["slug", "url", "permalink", "seo", "kebab", "friendly"],
  },
  {
    id: "hash-compare",
    label: "Hash Compare",
    description: "Hash a file and compare it against an expected checksum.",
    icon: Fingerprint,
    component: HashCompare,
    keywords: ["hash", "checksum", "md5", "sha", "sha256", "verify", "integrity", "file"],
  },
  {
    id: "yaml-json",
    label: "YAML ↔ JSON",
    description: "Convert between YAML and JSON in both directions.",
    icon: FileText,
    component: YamlJson,
    keywords: ["yaml", "yml", "json", "convert"],
  },
  {
    id: "markdown",
    label: "Markdown Preview",
    description: "Write Markdown and preview the rendered output.",
    icon: FileCode,
    component: Markdown,
    keywords: ["markdown", "md", "preview", "render", "html"],
  },
  {
    id: "image-converter",
    label: "Image Converter",
    description: "Convert images between PNG, JPEG, WebP, AVIF and more.",
    icon: ImageDown,
    component: ImageConverter,
    keywords: ["image", "png", "jpg", "jpeg", "webp", "avif", "bmp", "tiff", "ico", "convert", "compress", "resize"],
  },
  {
    id: "vectorial",
    label: "Vectorial",
    description: "Trace a logo or flat image into a scalable SVG.",
    icon: Spline,
    component: Vectorial,
    keywords: ["svg", "vector", "vectorize", "trace", "png", "jpg", "jpeg", "logo", "image"],
  },
];
