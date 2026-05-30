// Test di App.tsx: rete di sicurezza PRIMA del refactor in custom hook.
// Verificano il comportamento osservabile (rendering lista, copia, selezione,
// filtri) mockando il layer Tauri — il backend reale non gira nei test.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToasterProvider } from "./components/Toaster";
import { makeClip } from "./test/fixtures";

// --- Mock del layer Tauri ---------------------------------------------------
// Tutto l'invoke passa da ./lib/api (wrapper centralizzato): mockando questo
// copriamo quasi tutte le chiamate al backend. Le funzioni sono vi.fn() così
// i test possono asserire che siano state chiamate con gli argomenti giusti.
vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  return {
    ...actual, // mantiene i tipi/costanti reali (ContentType, SELECT_MODIFIERS…)
    api: {
      listClips: vi.fn(),
      searchClips: vi.fn(),
      listTags: vi.fn(),
      copyClip: vi.fn().mockResolvedValue(undefined),
      copyImageAsFile: vi.fn().mockResolvedValue(undefined),
      copyTransformed: vi.fn().mockResolvedValue(null),
      togglePin: vi.fn().mockResolvedValue(undefined),
      reorderPinned: vi.fn().mockResolvedValue(undefined),
      removeClip: vi.fn().mockResolvedValue(undefined),
      removeClips: vi.fn().mockResolvedValue(undefined),
      bulkSetPinned: vi.fn().mockResolvedValue(undefined),
      bulkAddTag: vi.fn().mockResolvedValue(undefined),
      bulkRemoveTag: vi.fn().mockResolvedValue(undefined),
      addTag: vi.fn().mockResolvedValue(undefined),
      removeTag: vi.fn().mockResolvedValue(undefined),
      setTagColor: vi.fn().mockResolvedValue(undefined),
      setTagPinned: vi.fn().mockResolvedValue(undefined),
      renameTag: vi.fn().mockResolvedValue(undefined),
      updateClip: vi.fn().mockResolvedValue(undefined),
      mergeClips: vi.fn().mockResolvedValue(1),
      revealInExplorer: vi.fn().mockResolvedValue(undefined),
      openPath: vi.fn().mockResolvedValue(undefined),
    },
    // gli "onX" registrano listener di eventi: nei test sono no-op che
    // ritornano una funzione di unsubscribe.
    onClipsChanged: vi.fn().mockResolvedValue(() => {}),
    onOpenSettings: vi.fn().mockResolvedValue(() => {}),
  };
});

// Moduli Tauri importati direttamente da App.tsx
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: vi.fn().mockResolvedValue({ get: vi.fn().mockResolvedValue(undefined), set: vi.fn(), save: vi.fn() }) },
}));

// Stub dei componenti che tirano dentro plugin Tauri pesanti (updater/process/
// dialog) o che non c'entrano con ciò che testiamo qui. La Sidebar è stubbata
// perché contiene UpdateButton (→ plugin-updater); Settings idem.
vi.mock("./components/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));
vi.mock("./components/Settings", () => ({
  Settings: () => null,
}));

// import DOPO i mock (vi.mock è hoisted, ma teniamo l'ordine chiaro)
import App from "./App";
import { api } from "./lib/api";

function renderApp() {
  return render(
    <ToasterProvider>
      <App />
    </ToasterProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // default: nessun tag, lista vuota (i singoli test sovrascrivono)
    vi.mocked(api.listTags).mockResolvedValue([]);
    vi.mocked(api.listClips).mockResolvedValue([]);
    vi.mocked(api.searchClips).mockResolvedValue([]);
  });

  it("carica e mostra le clip dal backend al mount", async () => {
    vi.mocked(api.listClips).mockResolvedValue([
      makeClip({ id: 1, content: "ciao mondo" }),
      makeClip({ id: 2, content: "secondo testo" }),
    ]);
    renderApp();
    expect(await screen.findByText("ciao mondo")).toBeInTheDocument();
    expect(screen.getByText("secondo testo")).toBeInTheDocument();
  });

  it("copia una clip cliccandola (chiama api.copyClip con il suo id)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listClips).mockResolvedValue([
      makeClip({ id: 42, content: "da copiare" }),
    ]);
    renderApp();
    const card = await screen.findByText("da copiare");
    await user.click(card);
    await waitFor(() => expect(api.copyClip).toHaveBeenCalledWith(42, false));
  });

  it("copia la clip selezionata con Enter", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listClips).mockResolvedValue([
      makeClip({ id: 7, content: "prima clip" }),
    ]);
    renderApp();
    await screen.findByText("prima clip");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.copyClip).toHaveBeenCalledWith(7));
  });

  it("filtra per ricerca usando api.searchClips", async () => {
    const user = userEvent.setup();
    // "uniquecontent" e "risultatocerca" sono singole parole: niente <mark> a
    // spezzarle quando la query ("cerca") evidenzia solo una sottostringa.
    vi.mocked(api.listClips).mockResolvedValue([
      makeClip({ id: 1, content: "uniquecontent" }),
    ]);
    vi.mocked(api.searchClips).mockResolvedValue([
      makeClip({ id: 99, content: "risultatocerca" }),
    ]);
    renderApp();
    await screen.findByText("uniquecontent");
    const search = screen.getByRole("textbox");
    await user.type(search, "cerca");
    // la ricerca è stata interrogata e la lista ora mostra il risultato del
    // backend (la clip iniziale, non più nel risultato, sparisce)
    await waitFor(() => expect(api.searchClips).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("uniquecontent")).not.toBeInTheDocument(),
    );
  });
});
