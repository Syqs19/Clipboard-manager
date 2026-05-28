# Roadmap miglioramenti — Clipboard Manager

Idee di miglioramento per l'app, in ordine di impatto. Stato: ☐ da fare · ⏳ in corso · ✅ fatto.

## 🔑 Alto impatto (esperienza da clipboard manager "vero")

- ✅ **Navigazione da tastiera** — frecce ↑↓ per scorrere (selezione evidenziata e
  sincronizzata col mouse), `Invio` e `1-9` per copiare la clip selezionata, con animazione
  "Copiato" (anche quando una clip risale in cima). L'incolla automatico (Ctrl+V simulato +
  chiusura finestra) è stato **scartato per scelta UX**: l'Invio ora **copia e basta**.
- ☐ **Salta i password manager** — rispettare i formati clipboard "escludi da cronologia"
  (`ExcludeClipboardContentFromMonitorProcessing`) così le password copiate non vengono
  salvate. Era nel piano originale; tocca la priorità privacy.
- ✅ **Icona personalizzata** — icona clipboard verde generata, sostituita a quella di Tauri.

## 🔒 Hardening privacy

- ☐ **Cifratura a riposo** dei clip sensibili (o intero DB con SQLCipher) — ora in chiaro nel file SQLite.
- ☐ **Auto-cancellazione** dei clip sensibili dopo X minuti, o opzione "non salvarli affatto".
- ☐ **Hotkey panico** per svuotare tutta la cronologia all'istante.

## ✨ Completare lo spec / feature

- ✅ **Modifica del contenuto** di un clip (matita in hover → editor inline; al salvataggio
  ricategorizza tipo e sensibilità).
- ☐ **Riordino drag & drop** dei fissati. Previsto, non fatto.
- ✅ **Colori dei tag** — color picker nativo (ruota completa) sia dal pallino nella sidebar
  sia dai pallini sui chip nelle card; fallback deterministico dal nome del tag.
- ☐ **Più tipi di contenuto**: file copiati, HTML/RTF.
- ☐ **"Incolla come testo semplice"**.
- ☐ **Raggruppa per data** in cronologia (Oggi / Ieri / ...).
- ☐ **Multi-selezione** + elimina in blocco.
- ☐ **Export / Import** della cronologia.

## 🎨 Polish & distribuzione

- ☐ **Miniature ridotte** salvate a parte (ora carica i PNG interi → pesante con tante immagini).
- ☐ **Auto-update** (`tauri-plugin-updater`) + **CI GitHub Actions** che genera le release.
- ☐ **Firma del codice** (rimuove l'avviso SmartScreen — richiede certificato a pagamento).
- ☐ **README** con screenshot + onboarding al primo avvio ("premi Ctrl+Shift+V").

## 🧰 Qualità codice

- ☐ Più test (watcher / commands), gestione errori mostrata in UI invece che solo console.

---

### Completato (2026-05-28)
- ✅ Icona personalizzata
- ✅ Modifica del contenuto dei clip
- ✅ Colori dei tag (picker nativo da sidebar e dai chip)
- ✅ Navigazione da tastiera (Invio/1-9 = copia) + feedback "Copiato"

### Prossimi candidati (non ancora fatti)
- Salta i password manager (privacy)
- Riordino drag & drop dei fissati
- README + onboarding al primo avvio
