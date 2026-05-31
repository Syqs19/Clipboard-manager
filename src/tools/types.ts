import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

/// Descrittore di un singolo tool. Stessa forma riusata in futuro dalla sezione
/// Design (un registry per macro-sezione, una sola interfaccia condivisa).
/// Aggiungere un tool = aggiungere UNA voce tipata nel registry + il componente.
export interface ToolDescriptor {
  /// id stabile (key React + eventuale routing futuro). Univoco nel registry.
  id: string;
  /// nome mostrato nella card e nell'header full-screen.
  label: string;
  /// descrizione breve (una riga) mostrata nella card della griglia.
  description: string;
  /// icona Lucide: il **componente**, non l'elemento JSX. Così un nome di icona
  /// sbagliato è un errore di compilazione nel registry, non un bug a runtime.
  icon: LucideIcon;
  /// componente che renderizza il tool a tutto schermo. Nessuna prop richiesta:
  /// il tool è autonomo (chiama `api` da lib/api.ts solo se gli serve un backend).
  component: ComponentType;
  /// parole-chiave per la ricerca (formati gestiti, sinonimi, azioni). Fonte unica:
  /// stanno qui col tool, così cercare "png" trova ogni tool che dichiara di
  /// gestirlo, senza una lista formato→tool separata da tenere in sync.
  keywords?: string[];
}
