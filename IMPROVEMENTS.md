# Roadmap miglioramenti — Clipboard Manager

Idee di miglioramento per l'app, in ordine di impatto. Stato: ☐ da fare · ⏳ in corso · ✅ fatto.

## 🔑 Alto impatto (esperienza da clipboard manager "vero")

- ✅ **Navigazione da tastiera** — frecce ↑↓ per scorrere (selezione evidenziata e
  sincronizzata col mouse), `Invio` e `1-9` per copiare la clip selezionata, con animazione
  "Copiato" (anche quando una clip risale in cima). L'incolla automatico (Ctrl+V simulato +
  chiusura finestra) è stato **scartato per scelta UX**: l'Invio ora **copia e basta**.
- ✅ **Salta i password manager** — il watcher rispetta i formati clipboard
  `ExcludeClipboardContentFromMonitorProcessing` e `CanIncludeInClipboardHistory`:
  se presenti, la cattura viene saltata in silenzio (sempre-on, niente UI).
- ✅ **Icona personalizzata** — icona clipboard verde generata, sostituita a quella di Tauri.

## 🔒 Hardening privacy

- ☐ **Cifratura a riposo** dei clip sensibili (o intero DB con SQLCipher) — ora in chiaro nel file SQLite.
- ✅ **Auto-cancellazione** dei clip sensibili: toggle "Non salvarli mai" + TTL in minuti
  (sweep ogni 60s, non tocca le clip fissate). Inoltre, se il toggle è on e si ricopia
  un sensibile già in cronologia, viene rimosso anche quello.
- ✅ **Granularità categorie sensibili** — multi-checkbox (email/IBAN/carte/token) per
  decidere quali tipi sono soggetti a non-salvataggio e TTL. La mascheratura nella UI
  resta sempre attiva su tutti i sensibili rilevati, indipendentemente dalla scelta.
- ☐ ~~Hotkey panico~~ — scartata per UX (rischio pressioni accidentali).

## ✨ Completare lo spec / feature

- ✅ **Modifica del contenuto** di un clip (matita in hover → editor inline; al salvataggio
  ricategorizza tipo e sensibilità).
- ✅ **Riordino drag & drop** dei fissati — trascina una clip fissata sopra un'altra
  per riordinare. Persistito su `pinned_order` nel DB.
- ✅ **Colori dei tag** — color picker nativo (ruota completa) sia dal pallino nella sidebar
  sia dai pallini sui chip nelle card; fallback deterministico dal nome del tag.
- ☐ **Più tipi di contenuto**: file copiati, HTML/RTF.
- ☐ **"Incolla come testo semplice"**.
- ✅ **Raggruppa per data** in cronologia (Fissati / Oggi / Ieri / Questa settimana /
  Questo mese / Più vecchi). Header sottili tra i gruppi.
- ✅ **Multi-selezione** + elimina in blocco — Ctrl/Alt+click (configurabile) per
  attivare, Shift+click per estendere il range, modalità selezione con checkbox
  e barra di azioni (Elimina, Pinna/Despinna, Aggiungi tag).
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
- ✅ Salta i password manager (rispetto dei formati di esclusione)
- ✅ Auto-cancellazione clip sensibili (toggle + TTL + rimozione su ricopia)
- ✅ Granularità categorie sensibili (multi-checkbox email/IBAN/carte/token)
- ✅ Impostazioni divise in tab (Generali / Sicurezza / Reset), altezza stabile
- ✅ Raggruppa per data nella cronologia
- ✅ Riordino drag & drop delle clip fissate
- ✅ Multi-selezione con barra di azioni e modifier configurabile

### Prossimi candidati (non ancora fatti)
- Export / Import della cronologia (JSON)
- Polish & motion (pass animazioni dedicato)
- README + onboarding al primo avvio
