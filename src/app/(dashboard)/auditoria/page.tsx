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

import { useCallback, useEffect, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  Building2,
  Check,
  ClipboardCheck,
  Loader2,
  MessageSquareText,
  PencilLine,
  RefreshCw,
  StickyNote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { aBotones } from "@/lib/agente/botones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  cambiosDelContexto,
  direccionPideRetiro,
  esCambioDeRetiro,
  esCasoDeRetiro,
  type RetiroAlerta,
} from "@/lib/agente/alertas";
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
  llamar: "📞 LLAMAR: no contestó los 3 mensajes",
  ultimo_aviso: "⏳ Último aviso",
  cancelar: "❌ Cancelar en Dropi",
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
  velio_confirmacion_pedido_v2: ["Saludo", "Cliente", "Oferta", "Valor", "Ciudad", "Dirección"],
  velio_confirmacion_dato_v2: ["Saludo", "Cliente", "Oferta", "Valor", "Ciudad", "Dirección", "Pregunta"],
  velio_confirmacion_retiro: ["Saludo", "Cliente", "Oferta", "Valor", "Ciudad", "Transportadora", "Oficina"],
  velio_recordatorio_confirmacion: ["Saludo", "Cliente", "Producto", "Valor", "Dirección"],
  velio_recordatorio_dato: ["Saludo", "Cliente", "Producto", "Lo que falta"],
  velio_ultimo_aviso: ["Saludo", "Cliente", "Producto"],
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
      <span className="wrap-anywhere text-foreground">{t}</span>
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

// What has to be changed in Dropi before confirming, big enough that it
// cannot be missed (Andrés, 28/9). Confirming does not apply any of it.
function AlertasDropi({
  retiro,
  cambios,
  grande = false,
}: {
  retiro: RetiroAlerta | null;
  cambios: string[];
  grande?: boolean;
}) {
  if (!retiro && !cambios.length) return null;
  return (
    <div className="space-y-2">
      {retiro ? (
        <div className="rounded-xl border-2 border-orange-500 bg-orange-500/10 p-4">
          <p className="flex items-center gap-2 text-base font-bold tracking-wide text-orange-700 dark:text-orange-300">
            <Building2 className="h-5 w-5 shrink-0" />
            RETIRO EN OFICINA
          </p>
          <p className={cn("mt-1.5 text-foreground", grande ? "text-lg font-semibold" : "text-sm")}>
            Antes de confirmar, en Dropi déjelo como <strong>retiro en oficina</strong>
            {retiro.oficina ? (
              <>
                : <strong>{retiro.oficina}</strong>
              </>
            ) : (
              ". La dirección lo pide, pero el agente no ubicó la oficina: confirme cuál con el cliente"
            )}
            .
          </p>
          {retiro.otra_transportadora ? (
            <p className={cn("mt-1.5 font-semibold text-destructive", grande ? "text-lg" : "text-sm")}>
              En Dropi va con {retiro.otra_transportadora}: cámbiele la transportadora.
            </p>
          ) : null}
        </div>
      ) : null}
      {cambios.length ? (
        <div className="rounded-xl border-2 border-red-500 bg-red-500/10 p-4">
          <p className="flex items-center gap-2 text-base font-bold tracking-wide text-red-700 dark:text-red-300">
            <PencilLine className="h-5 w-5 shrink-0" />
            CAMBIOS POR APLICAR EN DROPI
          </p>
          <ul className={cn("mt-1.5 space-y-1", grande ? "text-lg" : "text-sm")}>
            {cambios.map((c, i) => (
              <li key={i} className={cn("text-foreground", grande ? "font-bold" : "font-medium")}>
                • {c}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Aplíquelos en Dropi antes de confirmar.</p>
        </div>
      ) : null}
    </div>
  );
}

interface MensajeChat {
  id: string;
  nuestro: boolean;
  tipo: string;
  texto: string | null;
  plantilla: string | null;
  media_url: string | null;
  media_type: string | null;
  estado: string | null;
  fecha: string;
}

// The whole chat with the customer, opened on demand: a case only shows the
// last thing he wrote, and with many cases open it is easy to lose the
// thread (Andrés, 28/9). Loads when opened, so a long queue stays light.
function Conversacion({ telefono }: { telefono: string }) {
  const [abierta, setAbierta] = useState(false);
  const [datos, setDatos] = useState<{
    conversacion: string | null;
    mensajes: MensajeChat[];
    completa: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierta) return;
    let vivo = true;
    fetch(`/api/agente/conversacion?telefono=${encodeURIComponent(telefono)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) setError(d.error ?? "No se pudo cargar la conversación");
        else {
          setError(null);
          setDatos(d);
        }
      })
      .catch(() => vivo && setError("No se pudo cargar la conversación"));
    return () => {
      vivo = false;
    };
  }, [abierta, telefono]);

  // Open at the end, where the conversation is now.
  useEffect(() => {
    if (abierta && datos && lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [abierta, datos]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAbierta((v) => !v)}
          className="h-auto py-1 text-xs"
        >
          <MessageSquareText />
          {abierta ? "Ocultar conversación" : "Ver conversación"}
        </Button>
        {abierta && datos?.conversacion ? (
          <a
            href={`/inbox?c=${datos.conversacion}`}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted"
          >
            Abrir en el chat
          </a>
        ) : null}
      </div>
      {abierta ? (
        <div
          ref={lista}
          className="max-h-[28rem] space-y-1.5 overflow-y-auto rounded-lg border border-border bg-background/60 p-3"
        >
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : datos === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : !datos.mensajes.length ? (
            <p className="text-sm text-muted-foreground">No hay mensajes con este número en el CRM.</p>
          ) : (
            <>
              {!datos.completa ? (
                <p className="text-center text-xs text-muted-foreground">
                  Solo los últimos mensajes. El resto, en «Abrir en el chat».
                </p>
              ) : null}
              {datos.mensajes.map((m) => (
                <div key={m.id} className={cn("flex", m.nuestro ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-1.5 text-sm text-foreground",
                      m.nuestro ? "bg-primary/15" : "bg-muted",
                    )}
                  >
                    {m.plantilla ? (
                      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Plantilla {m.plantilla}
                      </p>
                    ) : null}
                    {m.media_url && (m.media_type === "image" || m.tipo === "image" || m.tipo === "sticker") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.media_url} alt="foto o sticker" className="mb-1 max-h-40 rounded" />
                    ) : null}
                    <p className="whitespace-pre-wrap wrap-anywhere">
                      {m.texto || (m.tipo !== "text" ? `[${m.tipo}]` : "")}
                    </p>
                    <p className="mt-0.5 text-right text-[10px] text-muted-foreground">
                      {format(new Date(m.fecha), "d MMM, h:mm a", { locale: es })}
                      {m.estado === "failed" ? " · no se entregó" : ""}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
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
  const conBotones = aBotones(caso.mensaje_propuesto);

  // Approving a confirmation confirms the order in Dropi; approving a pickup
  // first contact tells the customer where to collect it. Either way Dropi
  // has to be right first, so the approve button waits for the tick.
  const antesDeConfirmar = caso.tipo === "primer_contacto" || caso.tipo === "confirmacion";
  const retiro: RetiroAlerta | null =
    antesDeConfirmar &&
    (esCasoDeRetiro(caso.plantilla_meta, ctx) ||
      (caso.tipo === "confirmacion" && direccionPideRetiro(texto(ctx.direccion_dropi))))
      ? { oficina: ctx.oficina ? texto(ctx.oficina) : null, otra_transportadora: null }
      : null;
  const esConfirmacion = caso.tipo === "confirmacion";
  const cambios = esConfirmacion ? cambiosDelContexto(ctx).filter((c) => !(retiro && esCambioDeRetiro(c))) : [];
  const conAlerta = Boolean(retiro || cambios.length);
  // A confirmation with changes only SENDS the message: Andrés edits the
  // order and confirms it in Dropi himself (6/10). Without changes, approving
  // confirms it in Dropi. The button says which of the two it does.
  const soloMensaje = esConfirmacion && (ctx.solo_mensaje === true || conAlerta);
  // The agent's own draft for a customer who asked for a change (a
  // `respuesta` with the new address or quantity) is the same kind of
  // message: it only goes to the customer, and Dropi is his.
  const respuestaConCambios = caso.tipo === "respuesta" && cambiosDelContexto(ctx).length > 0;
  // The tick "ya lo dejé así en Dropi" is only for a pickup first contact.
  const pideMarca = conAlerta && !esConfirmacion;
  const [enDropi, setEnDropi] = useState(false);

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
    <div
      className={cn(
        "space-y-4 rounded-xl border bg-card p-4 sm:p-5",
        conAlerta && abierto ? "border-orange-500/60 ring-1 ring-orange-500/30" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-foreground">{caso.cliente || caso.telefono}</h2>
            <Badge variant="outline">
              {caso.tipo === "llamar" && ctx.mensaje_fallido
                ? "📵 LLAMAR: el mensaje no le llegó"
                : (TIPO[caso.tipo] ?? caso.tipo)}
            </Badge>
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

      {abierto ? <AlertasDropi retiro={retiro} cambios={cambios} /> : null}

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
      {caso.telefono ? <Conversacion telefono={caso.telefono} /> : null}

      {tieneMensaje ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {caso.plantilla_meta ? `Plantilla ${caso.plantilla_meta}` : "Mensaje que saldría"}
          </p>
          {caso.mensaje_propuesto && conBotones ? (
            // What the customer gets: the agent sends the numbered menu as
            // WhatsApp buttons (lib/agente/botones.ts).
            <div className="space-y-1.5">
              <div className="whitespace-pre-wrap wrap-anywhere rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-foreground">
                {conBotones.cuerpo}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {conBotones.botones.map((b) => (
                  <span
                    key={b}
                    className="rounded-md border border-emerald-500/40 bg-background px-3 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400"
                  >
                    {b}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Le llega con botones: el cliente toca, no escribe el número.</p>
            </div>
          ) : caso.mensaje_propuesto || caso.plantilla_texto ? (
            <div className="whitespace-pre-wrap wrap-anywhere rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-foreground">
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
                placeholder={
                  tieneMensaje
                    ? "Qué debe cambiar el agente. Ej.: pregúntale el número del apartamento; la dirección correcta es…"
                    : "Qué le respondemos. Ej.: salúdalo y pregúntale en qué le ayudo con su pedido; dile que la dirección quedó bien…"
                }
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
            <div className="space-y-2">
            {(esConfirmacion || respuestaConCambios) && tieneMensaje ? (
              <p
                className={cn(
                  "rounded-lg border-2 p-3 text-sm font-semibold text-foreground",
                  soloMensaje || respuestaConCambios
                    ? "border-red-500 bg-red-500/10"
                    : "border-emerald-500/60 bg-emerald-500/10",
                )}
              >
                {ctx.hecho_en_dropi === true
                  ? "Ya lo dejó hecho y confirmado en Dropi: al aprobar SOLO se envía este mensaje al cliente."
                  : soloMensaje || respuestaConCambios
                    ? "CON CAMBIOS: al aprobar SOLO se envía este mensaje al cliente. El agente NO confirma el pedido en Dropi. Haga el cambio, confírmelo usted y márquelo en la pestaña «Confirmar en Dropi»."
                    : "SIN CAMBIOS: al aprobar, el agente confirma el pedido en Dropi y le envía este mensaje al cliente."}
              </p>
            ) : null}
            {pideMarca && tieneMensaje ? (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-sm font-medium text-foreground">
                <Checkbox checked={enDropi} onCheckedChange={(v) => setEnDropi(Boolean(v))} />
                Ya lo dejé así en Dropi
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {tieneMensaje ? (
                <Button
                  size="sm"
                  disabled={!!ocupado || (pideMarca && !enDropi)}
                  onClick={() => actuar(caso.estado === "error" ? "reintentar" : "aprobar")}
                >
                  {ocupado === "aprobar" || ocupado === "reintentar" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  {caso.estado === "error"
                    ? "Reintentar"
                    : esConfirmacion
                      ? soloMensaje
                        ? "Aprobar: solo envía el mensaje"
                        : "Aprobar: confirma en Dropi y envía"
                      : respuestaConCambios
                        ? "Aprobar: solo envía el mensaje"
                        : caso.tipo === "carrito_crear"
                        ? "Aprobar: crea el pedido y envía"
                        : "Aprobar y enviar"}
                </Button>
              ) : (
                <Button size="sm" disabled={!!ocupado} onClick={() => actuar("atendido")}>
                  {ocupado === "atendido" ? <Loader2 className="animate-spin" /> : <Check />}
                  Ya lo atendí
                </Button>
              )}
              {/* Also on cases with nothing to send (a customer's reply): the
                  note says what to answer, and the agent comes back with a
                  message from the skill for a second approval (28/9). */}
              <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => setAbrirNota(true)}>
                <StickyNote />
                {tieneMensaje ? "Dejar nota" : "Nota: qué responder"}
              </Button>
              <Button size="sm" variant="destructive" disabled={!!ocupado} onClick={() => actuar("rechazar")}>
                {ocupado === "rechazar" ? <Loader2 className="animate-spin" /> : <X />}
                Rechazar
              </Button>
            </div>
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

interface PedidoPorConfirmar {
  pedido: string;
  cliente: string;
  telefono: string;
  ciudad: string;
  direccion: string;
  valor: number | null;
  producto: string;
  tienda: string;
  fecha_pedido: string;
  intencion: string | null;
  etiqueta: string;
  resumen: string;
  pide: string[];
  cambios: string[];
  retiro: RetiroAlerta | null;
  caso_estado: string | null;
  caso_tipo: string | null;
  caso_tiene_mensaje: boolean;
  hecho_sin_confirmar: string | null;
  hecho_por_agente?: boolean;
  le_respondimos: boolean;
  ultimo_mensaje: string | null;
  conversacion: string | null;
  mensajes: { texto: string | null; tipo: string; media_url: string | null; fecha: string }[];
}

const COLOR_INTENCION: Record<string, string> = {
  confirma: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  cambio: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  dato: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  pregunta: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  cancela: "bg-destructive/15 text-destructive",
  pausa: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
};

// Andrés settled the chat by hand: ask the agent to read it and draft the
// confirmation with the final address/quantity. It lands in "Por revisar".
function ArmarConfirmacion({ pedido }: { pedido: string }) {
  const [estado, setEstado] = useState<"listo" | "enviando" | "pedido">("listo");
  const pedir = async () => {
    setEstado("enviando");
    try {
      const res = await fetch("/api/agente/por-confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo pedir la confirmación");
        setEstado("listo");
        return;
      }
      toast.success("El agente la arma en menos de un minuto. La verás en «Por revisar».");
      setEstado("pedido");
    } catch {
      toast.error("No se pudo pedir la confirmación");
      setEstado("listo");
    }
  };
  return (
    <Button size="sm" variant="outline" disabled={estado !== "listo"} onClick={pedir} className="h-auto py-1 text-xs">
      {estado === "enviando" ? <Loader2 className="animate-spin" /> : <Check />}
      {estado === "pedido" ? "Pedida" : "Armar confirmación"}
    </Button>
  );
}

// "Cambios hechos y pedido confirmado": Andrés already edited the order and
// confirmed it in Dropi. The card goes away, and if the customer has no
// confirmation message yet, the agent drafts it for "Por revisar" (6/10).
function PedidoHecho({
  pedido,
  conCambios,
  armar,
  onHecho,
}: {
  pedido: string;
  conCambios: boolean;
  armar: boolean;
  onHecho: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const marcar = async () => {
    setEnviando(true);
    try {
      const res = await fetch("/api/agente/por-confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido, hecho: true, armar }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo guardar");
        setEnviando(false);
        return;
      }
      toast.success(
        armar
          ? "Listo. El agente arma el mensaje para el cliente: lo verá en «Por revisar»."
          : "Listo. Sale de esta lista.",
      );
      onHecho();
    } catch {
      toast.error("No se pudo guardar");
      setEnviando(false);
    }
  };
  return (
    <Button disabled={enviando} onClick={marcar} className="w-full bg-emerald-600 text-white hover:bg-emerald-700">
      {enviando ? <Loader2 className="animate-spin" /> : <Check />}
      {conCambios ? "Cambios hechos y pedido confirmado" : "Ya lo confirmé en Dropi"}
    </Button>
  );
}

// Nothing to confirm yet ("Buenas" and no answer since): hide the card until
// the customer writes again.
function QuitarDeLista({ pedido, onQuitado }: { pedido: string; onQuitado: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const quitar = async () => {
    setEnviando(true);
    try {
      const res = await fetch("/api/agente/por-confirmar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo quitar");
        setEnviando(false);
        return;
      }
      toast.success("Quitado. Si el cliente vuelve a escribir, reaparece.");
      onQuitado();
    } catch {
      toast.error("No se pudo quitar");
      setEnviando(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" disabled={enviando} onClick={quitar} className="h-auto py-1 text-xs text-muted-foreground">
      {enviando ? <Loader2 className="animate-spin" /> : <X />}
      Quitar de la lista
    </Button>
  );
}

// Orders the customer already answered in the chat but that are still
// "Por confirmar" in Dropi: what Andrés has left to confirm or fix there.
function PorConfirmar({ recarga, irARevisar }: { recarga: number; irARevisar: () => void }) {
  const [pedidos, setPedidos] = useState<PedidoPorConfirmar[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      fetch("/api/agente/por-confirmar", { cache: "no-store" })
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!vivo) return;
          if (!r.ok) setError(d.error ?? "No se pudo cargar la lista");
          else {
            setError(null);
            setPedidos(d.pedidos ?? []);
          }
        })
        .catch(() => vivo && setError("No se pudo cargar la lista"));
    cargar();
    const t = setInterval(cargar, 60000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [recarga]);

  if (error) return <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (pedidos === null)
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  if (!pedidos.length)
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
        <Check className="h-6 w-6 text-primary" />
        <p className="mt-3 text-sm font-medium text-foreground">
          Ningún cliente que ya respondió está esperando en Dropi
        </p>
      </div>
    );

  // Two lists (Andrés, 6/10). With something to change in Dropi: he edits
  // the order and confirms it himself, the agent never does. Without
  // changes: approving its confirmation in "Por revisar" confirms it.
  const conAlerta = (p: PedidoPorConfirmar) => Boolean(p.retiro || p.cambios.length);
  // Is its message already drafted (waiting in "Por revisar"), or sent?
  const armada = (p: PedidoPorConfirmar) =>
    p.caso_tiene_mensaje && ["pendiente", "con_nota", "aprobado", "enviando", "error"].includes(p.caso_estado ?? "");
  const enviada = (p: PedidoPorConfirmar) => p.caso_tiene_mensaje && p.caso_estado === "enviado";
  const grupos = [
    {
      clave: "cambios",
      titulo: "HAY QUE CAMBIAR EN DROPI",
      ayuda:
        "Haga el cambio en Dropi y confirme usted el pedido. El agente NO confirma estos, aunque apruebe el mensaje para el cliente.",
      clase: "border-red-500 bg-red-500/10",
      lista: pedidos.filter(conAlerta),
    },
    {
      clave: "limpios",
      titulo: "SIN CAMBIOS: SOLO FALTA CONFIRMAR",
      ayuda:
        "El agente los confirma en Dropi cuando usted aprueba su confirmación en «Por revisar». También puede confirmarlos usted directamente.",
      clase: "border-emerald-500/60 bg-emerald-500/10",
      lista: pedidos.filter((p) => !conAlerta(p)),
    },
  ].filter((g) => g.lista.length);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {pedidos.length} pedido{pedidos.length === 1 ? "" : "s"} siguen «Por confirmar» en Dropi y el cliente ya
        respondió en el chat.
      </p>
      {grupos.map((g) => (
        <div key={g.clave} className="space-y-3">
          <div className={cn("flex items-start gap-2 rounded-lg border-2 p-3 text-foreground", g.clase)}>
            <AlertTriangle className="mt-1 h-5 w-5 shrink-0" />
            <div>
              <p className="text-lg font-bold tracking-wide">
                {g.titulo} ({g.lista.length})
              </p>
              <p className="text-sm font-medium">{g.ayuda}</p>
            </div>
          </div>
      {g.lista.map((p) => (
        <div
          key={p.pedido}
          className={cn(
            "space-y-2 rounded-xl border bg-card p-4",
            conAlerta(p) ? "border-orange-500/60 ring-1 ring-orange-500/30" : "border-border",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-foreground">{p.cliente || p.telefono}</h2>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    COLOR_INTENCION[p.intencion ?? ""] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {p.etiqueta}
                </span>
                {p.tienda ? <Badge variant="secondary">{p.tienda}</Badge> : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pedido {p.pedido} · {p.telefono} · {p.ciudad}
                {p.valor ? ` · $${p.valor.toLocaleString("es-CO")}` : ""}
                {p.ultimo_mensaje
                  ? ` · escribió ${formatDistanceToNow(new Date(p.ultimo_mensaje), { addSuffix: true, locale: es })}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {p.conversacion ? (
                <a
                  href={`/inbox?c=${p.conversacion}`}
                  className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted"
                >
                  Abrir chat
                </a>
              ) : null}
              {armada(p) ? (
                <Button size="sm" variant="outline" onClick={irARevisar} className="h-auto py-1 text-xs">
                  <ClipboardCheck />
                  Ya está armada: ver en «Por revisar»
                </Button>
              ) : enviada(p) ? null : (
                <ArmarConfirmacion pedido={p.pedido} />
              )}
              <QuitarDeLista
                pedido={p.pedido}
                onQuitado={() => setPedidos((lista) => (lista ?? []).filter((x) => x.pedido !== p.pedido))}
              />
            </div>
          </div>

          {p.hecho_sin_confirmar ? (
            <p className="rounded-lg border-2 border-red-500 bg-red-500/10 p-3 text-sm font-semibold text-foreground">
              {p.hecho_por_agente ? "El agente lo confirmó en Dropi" : "Usted lo marcó como hecho"}{" "}
              {formatDistanceToNow(new Date(p.hecho_sin_confirmar), { addSuffix: true, locale: es })}, pero Dropi
              lo sigue mostrando sin confirmar. Revíselo en Dropi.
            </p>
          ) : null}
          <AlertasDropi retiro={p.retiro} cambios={p.cambios} grande />

          {/* What the customer said, when it is not already a change above. */}
          {p.resumen && !p.cambios.includes(p.resumen) ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-foreground">
              • {p.resumen}
            </p>
          ) : null}

          <Fila etiqueta="Dirección Dropi" valor={p.direccion} />
          <Mensajes lista={p.mensajes} />
          <Conversacion telefono={p.telefono} />

          <PedidoHecho
            pedido={p.pedido}
            conCambios={conAlerta(p)}
            armar={!armada(p) && !enviada(p)}
            onHecho={() => setPedidos((lista) => (lista ?? []).filter((x) => x.pedido !== p.pedido))}
          />
          <p className="text-sm font-medium text-foreground">
            {conAlerta(p)
              ? "Lo confirma usted en Dropi, después de hacer el cambio. "
              : armada(p)
                ? "Al aprobar su confirmación en «Por revisar», el agente lo confirma en Dropi. "
                : ""}
            <span className="font-normal text-muted-foreground">
              {armada(p)
                ? conAlerta(p)
                  ? "El mensaje para el cliente ya está armado en «Por revisar»: aprobarlo solo lo envía."
                  : "El mensaje para el cliente ya está armado."
                : enviada(p)
                  ? "El mensaje de confirmación ya se le envió al cliente: solo falta Dropi."
                  : p.caso_estado === "pendiente" || p.caso_estado === "con_nota"
                    ? "Su respuesta espera en «Por revisar», todavía sin mensaje."
                    : p.le_respondimos
                      ? "Ya le respondimos en el chat. Con «Armar confirmación» el agente le prepara el mensaje final."
                      : "Todavía no le hemos contestado su último mensaje."}
            </span>
          </p>
        </div>
      ))}
        </div>
      ))}
    </div>
  );
}

const VISTAS = {
  abiertos: "Por revisar",
  cerrados: "Resueltos",
  dropi: "Confirmar en Dropi",
} as const;

export default function AuditoriaPage() {
  const [vista, setVista] = useState<keyof typeof VISTAS>("abiertos");
  const [casos, setCasos] = useState<Caso[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const cargar = useCallback(async () => {
    if (vista === "dropi") {
      setRecarga((n) => n + 1);
      return;
    }
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
            {(Object.keys(VISTAS) as (keyof typeof VISTAS)[]).map((v) => (
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
                {VISTAS[v]}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={cargar} aria-label="Recargar">
            <RefreshCw />
          </Button>
        </div>
      </div>

      <AvisoAgente />

      {vista === "dropi" ? (
        <PorConfirmar
          recarga={recarga}
          irARevisar={() => {
            setCasos(null);
            setVista("abiertos");
          }}
        />
      ) : error ? (
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
