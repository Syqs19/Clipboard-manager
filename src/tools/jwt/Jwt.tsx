import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Copy } from "lucide-react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { useCopy } from "../../hooks/useCopy";
import { base64UrlToText } from "../shared/codec";

/// Descrizioni dei claim registrati (RFC 7519) + i più comuni, per spiegare a
/// colpo d'occhio cosa significano le sigle nel payload.
const CLAIM_DOCS: Record<string, string> = {
  iss: "Issuer — who issued the token",
  sub: "Subject — who the token is about",
  aud: "Audience — who the token is for",
  exp: "Expiration time",
  nbf: "Not valid before",
  iat: "Issued at",
  jti: "JWT ID — unique identifier",
  scope: "Granted scopes/permissions",
  azp: "Authorized party",
  email: "Email address",
  name: "Display name",
};

/// "in 23 minutes" / "expired 5 minutes ago" dato un istante epoch (secondi).
function countdown(expSec: number, nowMs: number): string {
  const diff = expSec * 1000 - nowMs;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86400000, "day"],
    [3600000, "hour"],
    [60000, "minute"],
    [1000, "second"],
  ];
  for (const [u, name] of units) {
    if (abs >= u) {
      const v = Math.round(abs / u);
      const plural = v === 1 ? name : name + "s";
      return diff < 0 ? `expired ${v} ${plural} ago` : `expires in ${v} ${plural}`;
    }
  }
  return diff < 0 ? "just expired" : "expires now";
}

/// Decodifica una parte Base64URL di un JWT in JSON.
function decodePart(part: string): unknown {
  return JSON.parse(base64UrlToText(part));
}

/// I claim temporali standard (in secondi epoch) da rendere leggibili.
const TIME_CLAIMS: Record<string, string> = {
  exp: "Expires",
  iat: "Issued at",
  nbf: "Not before",
};

function fmtEpoch(sec: number): string {
  const d = new Date(sec * 1000);
  return d.toLocaleString();
}

/// JWT decoder: incolla un token, mostra header e payload decodificati (JSON
/// formattato + highlight) e rende leggibili i claim temporali (exp/iat/nbf),
/// segnalando se il token è scaduto. NON verifica la firma (serve la chiave).
export function Jwt() {
  const copy = useCopy();
  const [token, setToken] = useState("");
  // tick ogni secondo per il countdown live alla scadenza
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const parsed = useMemo(() => {
    const t = token.trim();
    if (!t) return null;
    const parts = t.split(".");
    if (parts.length !== 3) {
      return { ok: false as const, err: "A JWT has 3 dot-separated parts." };
    }
    try {
      const header = decodePart(parts[0]);
      const payload = decodePart(parts[1]) as Record<string, unknown>;
      // claim temporali → date leggibili + stato scadenza
      const times = Object.entries(TIME_CLAIMS)
        .filter(([k]) => typeof payload[k] === "number")
        .map(([k, label]) => ({ label, value: fmtEpoch(payload[k] as number) }));
      const exp = typeof payload.exp === "number" ? (payload.exp as number) : null;
      return { ok: true as const, header, payload, times, exp };
    } catch (e) {
      return { ok: false as const, err: e instanceof Error ? e.message : String(e) };
    }
  }, [token]);

  const block = (value: unknown) => {
    const json = JSON.stringify(value, null, 2);
    return hljs.highlight(json, { language: "json" }).value;
  };

  const copyJson = (value: unknown) => copy(JSON.stringify(value, null, 2));

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      <textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Paste a JWT (eyJ...)"
        spellCheck={false}
        rows={4}
        className="shrink-0 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
      />

      {parsed && !parsed.ok && (
        <span className="inline-flex items-center gap-1.5 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" /> {parsed.err}
        </span>
      )}

      {parsed && parsed.ok && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
          {/* stato scadenza con countdown live */}
          {parsed.exp !== null &&
            (() => {
              const expired = parsed.exp * 1000 < now;
              return (
                <span
                  className={`inline-flex w-fit items-center gap-1.5 text-sm ${
                    expired ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {expired ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {expired ? "Expired" : "Valid"} · {countdown(parsed.exp, now)}
                </span>
              );
            })()}

          {/* claim temporali leggibili */}
          {parsed.times.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
              {parsed.times.map((t) => (
                <div key={t.label} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-500">{t.label}</span>
                  <span className="font-mono text-zinc-200">{t.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* header + payload */}
          {([
            ["Header", parsed.header],
            ["Payload", parsed.payload],
          ] as const).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
                <button onClick={() => copyJson(value)} className="text-zinc-500 hover:text-zinc-200">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <pre className="overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 text-sm">
                {/* sicuro: highlight.js fa escape dell'HTML (come in CodeBlock) */}
                <code dangerouslySetInnerHTML={{ __html: block(value) }} />
              </pre>
            </div>
          ))}

          {/* spiegazione dei claim presenti nel payload */}
          {(() => {
            const known = Object.keys(parsed.payload).filter((k) => CLAIM_DOCS[k]);
            if (known.length === 0) return null;
            return (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Claims
                </span>
                <div className="flex flex-col gap-1 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
                  {known.map((k) => (
                    <div key={k} className="flex gap-2 text-sm">
                      <span className="w-16 shrink-0 font-mono text-accent">{k}</span>
                      <span className="text-zinc-400">{CLAIM_DOCS[k]}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <p className="text-xs text-zinc-600">
            Signature is not verified (that requires the secret/public key).
          </p>
        </div>
      )}
    </div>
  );
}
