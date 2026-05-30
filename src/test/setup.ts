// Setup globale dei test (Vitest + React Testing Library).
//
// - jest-dom: aggiunge matcher comodi su DOM (toBeInTheDocument, ecc.).
// - cleanup: smonta i componenti renderizzati dopo ogni test (no leak fra test).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom non implementa alcune API del browser usate dai componenti. Le stubbiamo
// come no-op così i test non crashano (non testiamo lo scroll vero o l'OS).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
