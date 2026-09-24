"use client";

// ============================================================
// Auditoría del agente VELIO.
//
// What the agent did not send on its own lands here: first contacts with
// doubts (Maps, risk history, pickup at an office), customer replies that
// are not a clean "yes", and — in shadow mode — everything. Andrés
// approves, rejects, or leaves a note (an instruction the agent applies in
// a Claude Code session before asking for a second approval).
//
// Spanish-only on purpose: this page exists for one account (see
// src/lib/agente/access.ts), so it skips the i18n catalogs.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Check,
  ClipboardCheck,
  Loader2,
  MessageSquareText,
  RefreshCw,
  StickyNote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Caso {
  id: string;
  creado_en: string;
  actualizado_en: string;
  pedido: string | null;
  telefono: string;
  cliente: string | null;
  tipo: string;
  motivos: string[];
  contexto: Record<string, unknown>;
  mensaje_propuesto: string | null;
  plantilla_meta: string | null;
  plantilla_texto: string | null;
  variables: string[] | null;
  version: number;
  estado: string;
  nota: string | null;
  error: string | null;
}

const TIPO: Record<string, string> = {
  primer_contacto: "Primer contacto",
  confirmacion: "Confirmación",
  respuesta: "Respuesta del cliente",
};

const ESTADO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "bg-amber-500/15 text-amber-600 dark:text-amber-300" },
  con_nota: { texto: "Con nota: la aplica Claude", clase: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  aprobado: { texto: "Aprobado: sale en segundos", clase: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
  enviando: { texto: "Enviando", clase: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
  enviado: { texto: "Enviado", clase: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
  error: { texto: "Error al enviar", clase: "bg-destructive/15 text-destructive" },
  rechazado: { texto: "Rechazado", clase: "bg-muted text-muted-foreground" },
  atendido: { texto: "Atendido", clase: "bg-muted text-muted-foreground" },
  vencido: { texto: "Vencido", clase: "bg-muted text-muted-foreground" },
};

const ETIQUETA_VARIABLE = [
  "Saludo",
  "Cliente",
  "Oferta",
  "Valor",
  "Ciudad",
  "Dirección",
  "Pregunta",
];

function texto(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: unknown }) {
  const t = texto(valor);
  if (!t) return null;
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="break-words text-foreground">{t}</span>
    </div>
  );
}

function Mensajes({ lista }: { lista: unknown }) {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Lo que escribió
      </p>
      {lista.map((m, i) => {
        const msg = m as { texto?: string; tipo?: string; media_url?: string; fecha?: string };
        return (
          <div key={i} className="w-fit max-w-full rounded-lg bg-muted px-3 py-1.5 text-sm">
            {msg.media_url && msg.tipo === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={msg.media_url} alt="sticker o foto" className="mb-1 max-h-28 rounded" />
            ) : null}
            {msg.texto || (msg.tipo !== "text" ? `[${msg.tipo}]` : "")}
          </div>
        );
      })}
    </div>
  );
}

function Tarjeta({ caso, alCambiar }: { caso: Caso; alCambiar: () => void }) {
  const [nota, setNota] = useState("");
  const [abrirNota, setAbrirNota] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const ctx = caso.contexto ?? {};
  const estado = ESTADO[caso.estado] ?? { texto: caso.estado, clase: "bg-muted" };
  const abierto = ["pendiente", "error"].includes(caso.estado);
  const tieneMensaje = Boolean(caso.mensaje_propuesto || caso.plantilla_meta);

  const actuar = useCallback(
    async (accion: string) => {
      setOcupado(accion);
      try {
        const res = await fetch(`/api/agente/auditoria/${caso.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion, version: caso.version, nota }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? "No se pudo guardar");
        } else {
          toast.success(
            accion === "aprobar"
              ? "Aprobado. El agente lo envía en su próxima pasada."
              : accion === "nota"
                ? "Nota guardada. Pídele a Claude: «revisa la auditoría»."
                : "Listo",
          );
          setAbrirNota(false);
          setNota("");
        }
      } finally {
        setOcupado(null);
        alCambiar();
      }
    },
    [caso.id, caso.version, nota, alCambiar],
  );

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-foreground">{caso.cliente || caso.telefono}</h2>
            <Badge variant="outline">{TIPO[caso.tipo] ?? caso.tipo}</Badge>
            {ctx.tienda ? <Badge variant="secondary">{texto(ctx.tienda)}</Badge> : null}
            {ctx.linea ? (
              <Badge variant="outline">
                {ctx.linea === "entrante" ? "Escribió él (Releasit)" : "Le escribimos"}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pedido {caso.pedido ?? "?"} · {caso.telefono} ·{" "}
            {formatDistanceToNow(new Date(caso.creado_en), { addSuffix: true, locale: es })}
            {caso.version > 1 ? ` · versión ${caso.version}` : ""}
          </p>
        </div>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", estado.clase)}>
          {estado.texto}
        </span>
      </div>

      {caso.motivos?.length ? (
        <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          {caso.motivos.map((m, i) => (
            <li key={i} className="text-foreground">
              • {m}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1.5">
        <Fila etiqueta="Dirección Dropi" valor={ctx.direccion_dropi} />
        <Fila etiqueta="Así se le muestra" valor={ctx.direccion_limpia} />
        <Fila etiqueta="Ciudad" valor={ctx.ciudad} />
        <Fila etiqueta="Maps" valor={ctx.maps} />
        <Fila
          etiqueta="Confirmado"
          valor={Array.isArray(ctx.confirmado_por) ? (ctx.confirmado_por as string[]).join(", ") : ""}
        />
        <Fila etiqueta="Historial" valor={ctx.historial} />
        <Fila etiqueta="Variante" valor={ctx.variante} />
      </div>

      <Mensajes lista={ctx.mensajes} />
      {ctx.mensaje ? <Mensajes lista={[{ texto: ctx.mensaje, tipo: "text" }]} /> : null}

      {tieneMensaje ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {caso.plantilla_meta ? `Plantilla ${caso.plantilla_meta}` : "Mensaje que saldría"}
          </p>
          {caso.mensaje_propuesto || caso.plantilla_texto ? (
            <div className="whitespace-pre-wrap rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-foreground">
              {caso.mensaje_propuesto || caso.plantilla_texto}
            </div>
          ) : (
            <div className="space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              {(caso.variables ?? []).map((v, i) => (
                <Fila key={i} etiqueta={`{{${i + 1}}} ${ETIQUETA_VARIABLE[i] ?? ""}`} valor={v} />
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                Para ver el texto completo, sincroniza las plantillas desde Meta en Configuración.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {caso.nota ? <Fila etiqueta="Tu nota" valor={caso.nota} /> : null}
      {caso.error ? (
        <p className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{caso.error}</p>
      ) : null}

      {abierto ? (
        <div className="space-y-2">
          {abrirNota ? (
            <div className="space-y-2">
              <Textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Qué debe cambiar el agente. Ej.: pregúntale el número del apartamento; la dirección correcta es…"
                rows={3}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={!nota.trim() || !!ocupado} onClick={() => actuar("nota")}>
                  {ocupado === "nota" ? <Loader2 className="animate-spin" /> : <StickyNote />}
                  Guardar nota
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAbrirNota(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tieneMensaje ? (
                <Button
                  size="sm"
                  disabled={!!ocupado}
                  onClick={() => actuar(caso.estado === "error" ? "reintentar" : "aprobar")}
                >
                  {ocupado === "aprobar" || ocupado === "reintentar" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  {caso.estado === "error" ? "Reintentar" : "Aprobar y enviar"}
                </Button>
              ) : (
                <Button size="sm" disabled={!!ocupado} onClick={() => actuar("atendido")}>
                  {ocupado === "atendido" ? <Loader2 className="animate-spin" /> : <Check />}
                  Ya lo atendí
                </Button>
              )}
              {tieneMensaje ? (
                <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => setAbrirNota(true)}>
                  <StickyNote />
                  Dejar nota
                </Button>
              ) : null}
              <Button size="sm" variant="destructive" disabled={!!ocupado} onClick={() => actuar("rechazar")}>
                {ocupado === "rechazar" ? <Loader2 className="animate-spin" /> : <X />}
                Rechazar
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function AuditoriaPage() {
  const [vista, setVista] = useState<"abiertos" | "cerrados">("abiertos");
  const [casos, setCasos] = useState<Caso[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/agente/auditoria?vista=${vista}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar la auditoría");
        return;
      }
      setError(null);
      setCasos(data.casos ?? []);
    } catch {
      setError("No se pudo cargar la auditoría");
    }
  }, [vista]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
    // The agent works every ~30 s; the queue refreshes at the same pace.
    const t = setInterval(cargar, 20000);
    return () => clearInterval(t);
  }, [cargar]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Auditoría del agente
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lo que el agente VELIO no envió solo. Aprueba, rechaza o deja una nota con instrucciones.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {(["abiertos", "cerrados"] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setCasos(null);
                  setVista(v);
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-sm",
                  vista === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {v === "abiertos" ? "Por revisar" : "Resueltos"}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={cargar} aria-label="Recargar">
            <RefreshCw />
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : casos === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : casos.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
          <MessageSquareText className="h-6 w-6 text-primary" />
          <p className="mt-3 text-sm font-medium text-foreground">
            {vista === "abiertos" ? "Nada por revisar" : "Aún no hay casos resueltos"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {casos.map((c) => (
            <Tarjeta key={`${c.id}-${c.version}-${c.estado}`} caso={c} alCambiar={cargar} />
          ))}
        </div>
      )}
    </div>
  );
}
