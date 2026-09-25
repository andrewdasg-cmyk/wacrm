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
  AlertTriangle,
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
  etapa: "Aviso ②③④",
  recordatorio: "Recordatorio (2do mensaje)",
  llamar: "📞 Llamar",
  novedad: "🚚 Novedad",
  carrito: "🛒 Carrito",
  carrito_verificar: "🛒 Tomar pedido: sus datos",
  carrito_crear: "📦 Crear pedido desde carrito",
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

// What each {{n}} is, per Meta template (Plantillas-Meta-API-v2.md). Only
// used until the templates are synced into the CRM and the page can show
// the full text instead.
const ETIQUETAS: Record<string, string[]> = {
  velio_confirmacion_pedido: ["Saludo", "Cliente", "Oferta", "Valor", "Ciudad", "Dirección"],
  velio_confirmacion_dato: ["Saludo", "Cliente", "Oferta", "Valor", "Ciudad", "Dirección", "Pregunta"],
  velio_confirmacion_retiro: ["Saludo", "Cliente", "Oferta", "Valor", "Ciudad", "Transportadora", "Oficina"],
  velio_recordatorio_confirmacion: ["Saludo", "Cliente", "Producto", "Valor", "Dirección"],
  velio_recordatorio_dato: ["Saludo", "Cliente", "Producto", "Lo que falta"],
  velio_novedad_entrega: ["Saludo", "Cliente", "Transportadora", "Producto", "Novedad"],
  velio_carrito_pendiente: ["Saludo", "Cliente", "Producto", "Botón de la página", "Enlace"],
  velio_carrito_primera_compra: ["Saludo", "Cliente", "Producto", "Botón de la página", "Enlace"],
  velio_guia_generada: ["Saludo", "Cliente", "Producto", "Transportadora", "Guía", "Seguimiento", "Valor", "Despacho"],
  velio_guia_primer_contacto: ["Saludo", "Cliente", "Oferta", "Valor", "Dirección", "Guía", "Transportadora", "Seguimiento", "Despacho"],
  velio_llego_a_su_ciudad: ["Saludo", "Cliente", "Producto", "Ciudad", "Valor"],
  velio_retiro_aviso: ["Saludo", "Cliente", "# pedido", "Producto", "Ciudad", "Transportadora"],
  velio_en_reparto: ["Saludo", "Cliente", "Producto", "Valor"],
  velio_retiro_en_camino: ["Saludo", "Cliente", "Producto", "Transportadora", "Ciudad", "Guía", "Seguimiento", "Valor"],
};

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

interface HistorialCliente {
  texto?: string;
  ultima_novedad?: string;
  porcentaje?: number | null;
  pedidos_nuestros?: {
    pedido: string;
    fecha: string;
    lista: string;
    estado: string;
    novedad?: string;
    notas?: string;
  }[];
}

// Who Andrés is about to talk to. Dropi's cross-store history only gives
// totals and the TYPE of the last incident; the carrier's own words are
// only available for orders placed in our store.
function Historial({ h }: { h: unknown }) {
  const hist = (h ?? {}) as HistorialCliente;
  const nuestros = hist.pedidos_nuestros ?? [];
  if (!hist.texto && nuestros.length === 0) return null;
  const riesgo = (hist.porcentaje ?? 0) >= 30;
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border p-3 text-sm",
        riesgo ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/30",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Historial del cliente
      </p>
      {hist.texto ? <p className="text-foreground">En Dropi (todas las tiendas): {hist.texto}</p> : null}
      {hist.ultima_novedad ? (
        <p className="text-foreground">
          Última novedad: <span className="font-medium">{hist.ultima_novedad}</span>
        </p>
      ) : null}
      {nuestros.length ? (
        <div className="space-y-1 pt-1">
          <p className="text-muted-foreground">Sus otros pedidos en nuestra tienda:</p>
          {nuestros.map((p) => (
            <p key={p.pedido} className="text-foreground">
              • {p.fecha} · #{p.pedido} · {p.lista}
              {p.estado && p.estado !== p.lista ? ` (${p.estado})` : ""}
              {p.novedad ? ` — novedad: ${p.novedad}` : ""}
              {p.notas ? ` — nota: ${p.notas}` : ""}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">Es su primer pedido en nuestra tienda.</p>
      )}
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
        <Fila etiqueta="Estado en Dropi" valor={ctx.estado_dropi} />
        <Fila etiqueta="Novedad" valor={ctx.motivo_novedad} />
        <Fila etiqueta="Carrito" valor={ctx.carrito} />
        <Fila etiqueta="Guion" valor={ctx.guion} />
        <Fila etiqueta="Guía" valor={ctx.guia ? `${texto(ctx.guia)} (${texto(ctx.transportadora)})` : ""} />
        <Fila etiqueta="Sin plantilla" valor={ctx.sin_plantilla} />
        <Fila etiqueta="Oficina" valor={ctx.oficina} />
      </div>

      <Historial h={ctx.historial_cliente} />

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
                <Fila
                  key={i}
                  etiqueta={`{{${i + 1}}} ${ETIQUETAS[caso.plantilla_meta ?? ""]?.[i] ?? ""}`}
                  valor={v}
                />
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

interface EstadoAgente {
  token_vence: string | null;
  token_subido: string | null;
  ultima_sync: string | null;
  ultima_actividad: string | null;
}

// The agent can silently stop reading Dropi when the 12-hour token expires,
// and nothing else would tell Andrés. So the queue says it, in red.
function AvisoAgente() {
  const [estado, setEstado] = useState<EstadoAgente | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    const cargar = () =>
      fetch("/api/agente/estado", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          setEstado(d);
          setAhora(Date.now());
        })
        .catch(() => {});
    cargar();
    const t = setInterval(cargar, 60000);
    return () => clearInterval(t);
  }, []);

  if (!estado) return null;
  const hora = (iso: string) =>
    new Date(iso).toLocaleString("es-CO", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  const avisos: { grave: boolean; texto: string }[] = [];
  const pasos = "Copia el token nuevo de Dropi al .env y da doble clic a «Actualizar token Dropi.bat».";

  if (!estado.token_vence) {
    avisos.push({ grave: false, texto: `No sé cuándo vence el token de Dropi. ${pasos}` });
  } else {
    const faltan = new Date(estado.token_vence).getTime() - ahora;
    if (faltan <= 0) {
      avisos.push({
        grave: true,
        texto: `El token de Dropi venció (${hora(estado.token_vence)}). El agente no está leyendo pedidos nuevos ni puede confirmar. ${pasos}`,
      });
    } else if (faltan < 2 * 3600 * 1000) {
      avisos.push({
        grave: false,
        texto: `El token de Dropi vence pronto: ${hora(estado.token_vence)}. ${pasos}`,
      });
    }
  }
  if (estado.ultima_actividad && ahora - new Date(estado.ultima_actividad).getTime() > 15 * 60 * 1000) {
    avisos.push({
      grave: true,
      texto: `El agente no da señales desde ${hora(estado.ultima_actividad)}. Revisa en Dokploy que velio-agente esté corriendo.`,
    });
  } else if (estado.ultima_sync && ahora - new Date(estado.ultima_sync).getTime() > 30 * 60 * 1000) {
    avisos.push({
      grave: true,
      texto: `La última sincronización con Dropi fue ${hora(estado.ultima_sync)}. Casi siempre es el token.`,
    });
  }
  if (!avisos.length) return null;
  return (
    <div className="space-y-2">
      {avisos.map((a, i) => (
        <div
          key={i}
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            a.grave
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{a.texto}</span>
        </div>
      ))}
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

      <AvisoAgente />

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
