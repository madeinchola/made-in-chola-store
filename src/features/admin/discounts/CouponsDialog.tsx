import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ConflictBanner } from "../ui/ConflictBanner";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setCouponArchived, updateCoupon } from "./api";
import { CouponCopyButton } from "./CouponCopyButton";
import { CouponEditDialog } from "./CouponEditDialog";
import { CouponGenerateForm } from "./CouponGenerateForm";
import { CouponManualForm } from "./CouponManualForm";
import {
  couponStatus,
  couponsCsv,
  filterCoupons,
  sortCoupons,
  usesByCoupon,
  usesText,
  validityText,
  type CouponStatus,
} from "./CouponsLogic";
import { csvFileName, downloadCsv } from "./csv";
import { useCoupons, useDiscountMutation, useInvalidateDiscounts, useRedemptions } from "./hooks";
import { REDEMPTIONS_LIMIT } from "./RedemptionsLogic";
import type { Coupon, Discount } from "./types";

const K = "admin.discounts.coupons" as const;
/** Cuántos códigos se pintan a la vez (un descuento puede tener cientos). */
const PAGE_SIZE = 50;
/** Cuánto se queda a la vista un aviso de la región de estado. */
const STATUS_MS = 6000;

const STATUS_TONE = {
  active: "success",
  scheduled: "info",
  inactive: "warning",
  exhausted: "warning",
  expired: "danger",
  archived: "neutral",
} as const satisfies Record<CouponStatus, string>;

export interface CouponsDialogProps {
  /** El descuento cuyos códigos se administran (solo uno con `requiresCoupon`). */
  discount: Discount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Panel = "none" | "manual" | "generate";

function CouponsBody({ discount }: { discount: Discount }) {
  const coupons = useCoupons(discount.id);
  const redemptions = useRedemptions(discount.id);
  const invalidate = useInvalidateDiscounts();
  const toggle = useDiscountMutation((v: { coupon: Coupon; isActive: boolean }) =>
    updateCoupon(v.coupon.id, v.coupon.updatedAt, {
      isActive: v.isActive,
      startsAt: v.coupon.startsAt,
      endsAt: v.coupon.endsAt,
      usageLimit: v.coupon.usageLimit,
    }),
  );
  const archive = useDiscountMutation((v: { coupon: Coupon; archived: boolean }) =>
    setCouponArchived(v.coupon.id, v.coupon.updatedAt, v.archived),
  );
  const busy = toggle.isPending || archive.isPending;

  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [panel, setPanel] = useState<Panel>("none");
  const [restoreFocusTo, setRestoreFocusTo] = useState<Panel | null>(null);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [toArchive, setToArchive] = useState<Coupon | null>(null);
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState({ text: "", tick: 0 });
  const manualButton = useRef<HTMLButtonElement>(null);
  const generateButton = useRef<HTMLButtonElement>(null);

  // «Ahora» se fija al recibir datos: el estado de cada código se calcula con la hora de ese momento.
  const now = useMemo(() => new Date(), [coupons.dataUpdatedAt, redemptions.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const uses = useMemo(
    () => (redemptions.data ? usesByCoupon(redemptions.data) : null),
    [redemptions.data],
  );
  const usedOf = (coupon: Coupon): number | null => (uses ? (uses.get(coupon.id) ?? 0) : null);

  const all = useMemo(() => coupons.data ?? [], [coupons.data]);
  const filtered = useMemo(() => filterCoupons(sortCoupons(all), query), [all, query]);
  const visible = filtered.slice(0, shown);

  // El aviso se queda a la vista un rato y se va solo.
  useEffect(() => {
    if (status.text === "") return;
    const id = setTimeout(() => setStatus((s) => ({ ...s, text: "" })), STATUS_MS);
    return () => clearTimeout(id);
  }, [status]);

  // Al cerrar un formulario el foco vuelve al botón que lo abrió (si no, se perdería en la página).
  useEffect(() => {
    if (restoreFocusTo === null || panel !== "none") return;
    (restoreFocusTo === "manual" ? manualButton : generateButton).current?.focus();
    setRestoreFocusTo(null);
  }, [restoreFocusTo, panel]);

  /** Un aviso visible, anunciado a lectores de pantalla (región de estado DENTRO del diálogo) y también como aviso emergente. */
  const notify = (message: string, ok: boolean) => {
    setStatus((s) => ({ text: message, tick: s.tick + 1 }));
    if (ok) toast.success(message);
    else toast.error(message);
  };

  const closePanel = (which: Panel) => {
    setPanel("none");
    setRestoreFocusTo(which);
  };
  const togglePanel = (which: Exclude<Panel, "none">) =>
    setPanel((current) => (current === which ? "none" : which));

  /** Devuelve true si el fallo fue un conflicto de edición (ya mostrado); si no, avisa del error. */
  const handleFailure = (e: unknown): boolean => {
    if (isStaleVersion(e)) {
      setConflict(true);
      void invalidate();
      return true;
    }
    notify(toAppError(e).message, false);
    return false;
  };

  const runToggle = async (coupon: Coupon, isActive: boolean) => {
    try {
      await toggle.mutateAsync({ coupon, isActive });
      notify(t(isActive ? `${K}.toasts.turnedOn` : `${K}.toasts.turnedOff`), true);
    } catch (e) {
      handleFailure(e);
    }
  };
  const runArchive = async (coupon: Coupon, archived: boolean) => {
    try {
      await archive.mutateAsync({ coupon, archived });
      notify(t(archived ? `${K}.toasts.archived` : `${K}.toasts.restored`), true);
    } catch (e) {
      // Un conflicto ya queda explicado en el aviso de la lista y la confirmación se cierra; otro error la deja abierta.
      if (!handleFailure(e)) throw e;
    }
  };

  const downloadAll = () => {
    downloadCsv(csvFileName(`codigos-${discount.name}`), couponsCsv(all));
    notify(t(`${K}.toasts.downloaded`, { count: all.length }), true);
  };

  if (!discount.requiresCoupon) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {t(`${K}.noCodeNeeded`)}
      </p>
    );
  }

  const columns: Column<Coupon>[] = [
    {
      id: "code",
      header: t(`${K}.columns.code`),
      cell: (c) => (
        <span className="whitespace-nowrap font-mono text-sm font-medium">{c.code}</span>
      ),
    },
    {
      id: "status",
      header: t(`${K}.columns.status`),
      cell: (c) => {
        const state = couponStatus(c, usedOf(c), now);
        return <Badge tone={STATUS_TONE[state]}>{t(`${K}.status.${state}`)}</Badge>;
      },
    },
    {
      id: "uses",
      header: t(`${K}.columns.uses`),
      cell: (c) => <span className="whitespace-nowrap">{usesText(c, usedOf(c))}</span>,
    },
    {
      id: "validity",
      header: t(`${K}.columns.validity`),
      cell: (c) => <span className="block min-w-[10rem] max-w-[16rem]">{validityText(c)}</span>,
    },
    {
      id: "actions",
      header: t(`${K}.columns.actions`),
      cell: (c) => (
        <div className="flex flex-wrap gap-1">
          <CouponCopyButton
            text={c.code}
            successMessage={t(`${K}.copy.one`, { code: c.code })}
            onResult={notify}
            aria-label={t(`${K}.actions.copyNamed`, { code: c.code })}
          >
            {t(`${K}.actions.copy`)}
          </CouponCopyButton>
          {c.archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              disabled={busy}
              aria-label={t(`${K}.actions.restoreNamed`, { code: c.code })}
              onClick={() => void runArchive(c, false).catch(() => undefined)}
            >
              {t("admin.actions.restore")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                disabled={busy}
                aria-label={t(
                  c.isActive ? `${K}.actions.turnOffNamed` : `${K}.actions.turnOnNamed`,
                  { code: c.code },
                )}
                onClick={() => void runToggle(c, !c.isActive)}
              >
                {t(c.isActive ? `${K}.actions.turnOff` : `${K}.actions.turnOn`)}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                aria-label={t(`${K}.actions.editNamed`, { code: c.code })}
                onClick={() => {
                  setEditing(c);
                  setEditOpen(true);
                }}
              >
                {t("admin.actions.edit")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                disabled={busy}
                aria-label={t(`${K}.actions.archiveNamed`, { code: c.code })}
                onClick={() => setToArchive(c)}
              >
                {t("admin.actions.archive")}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const filtering = query.trim() !== "";
  const countText = filtering
    ? t(`${K}.count.filtered`, { shown: filtered.length, total: all.length })
    : all.length === 1
      ? t(`${K}.count.one`)
      : t(`${K}.count.many`, { count: all.length });

  return (
    <div className="grid gap-4">
      <div role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        <span key={status.tick}>{status.text}</span>
      </div>

      {discount.archived && (
        <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          {t(`${K}.archivedDiscount`)}
        </p>
      )}

      <div role="group" aria-label={t(`${K}.toolbar.label`)} className="flex flex-wrap gap-2">
        <Button
          ref={manualButton}
          type="button"
          variant={panel === "manual" ? "default" : "outline"}
          className="min-h-11"
          aria-expanded={panel === "manual"}
          onClick={() => togglePanel("manual")}
        >
          {t(`${K}.toolbar.addManual`)}
        </Button>
        {!discount.archived && (
          <Button
            ref={generateButton}
            type="button"
            variant={panel === "generate" ? "default" : "outline"}
            className="min-h-11"
            aria-expanded={panel === "generate"}
            onClick={() => togglePanel("generate")}
          >
            {t(`${K}.toolbar.generate`)}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={all.length === 0}
          onClick={downloadAll}
        >
          {t(`${K}.toolbar.downloadAll`)}
        </Button>
      </div>

      {panel === "manual" && (
        <CouponManualForm
          discount={discount}
          existing={all}
          onCreated={(code) => {
            notify(t(`${K}.toasts.created`, { code }), true);
            closePanel("manual");
          }}
          onClose={() => closePanel("manual")}
        />
      )}
      {panel === "generate" && !discount.archived && (
        <CouponGenerateForm
          discount={discount}
          onGenerated={(count) =>
            notify(
              count === 1
                ? t(`${K}.toasts.generatedOne`)
                : t(`${K}.toasts.generatedMany`, { count }),
              true,
            )
          }
          onStatus={notify}
          onClose={() => closePanel("generate")}
        />
      )}

      {conflict && (
        <ConflictBanner
          onReload={() => {
            setConflict(false);
            void invalidate();
          }}
        />
      )}

      {redemptions.isError && (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning"
        >
          {t(`${K}.usesNotice.error`)}
        </p>
      )}
      {redemptions.isSuccess && redemptions.data.length >= REDEMPTIONS_LIMIT && (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning"
        >
          {t(`${K}.usesNotice.truncated`, { count: REDEMPTIONS_LIMIT })}
        </p>
      )}

      <Field label={t(`${K}.toolbar.search`)}>
        <Input
          className="min-h-11"
          type="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={t(`${K}.toolbar.searchPlaceholder`)}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE_SIZE);
          }}
        />
      </Field>
      {coupons.isSuccess && (
        <p aria-live="polite" className="-mt-2 text-sm text-muted-foreground">
          {countText}
        </p>
      )}

      <DataTable
        caption={t(`${K}.toolbar.label`)}
        columns={columns}
        rows={visible}
        getRowId={(c) => c.id}
        loading={coupons.isPending}
        refreshing={coupons.isFetching && !coupons.isPending}
        error={coupons.isError}
        onRetry={() => void coupons.refetch()}
        empty={
          <EmptyState>
            {filtering ? t(`${K}.noMatches`, { query: query.trim() }) : t(`${K}.empty`)}
          </EmptyState>
        }
      />
      {filtered.length > visible.length && (
        <div className="text-center">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
          >
            {t(`${K}.showMore`, { count: filtered.length - visible.length })}
          </Button>
        </div>
      )}

      <CouponEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        coupon={editing}
        onSaved={(message) => notify(message, true)}
      />
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t(`${K}.confirmArchive.title`, { code: toArchive?.code ?? "" })}
        description={t(`${K}.confirmArchive.body`)}
        confirmLabel={t(`${K}.confirmArchive.confirm`)}
        destructive
        onConfirm={() => runArchive(toArchive as Coupon, true)}
      />
    </div>
  );
}

/**
 * Códigos (cupones) de un descuento: lista con su estado, usos, vigencia y tope; apagar, editar, archivar y copiar; y dos
 * formas de agregar (a mano o al azar). El contenido vive DENTRO del diálogo: al cerrarlo se olvida todo lo escrito y los
 * códigos recién generados.
 */
export function CouponsDialog({ discount, open, onOpenChange }: CouponsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl"
        // Un clic fuera no debe tirar a la basura lo escrito ni los códigos recién generados: se cierra con la X o Esc.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="break-words leading-tight">
            {t(`${K}.title`, { name: discount.name })}
          </DialogTitle>
          <DialogDescription>{t(`${K}.description`)}</DialogDescription>
        </DialogHeader>
        <CouponsBody discount={discount} />
      </DialogContent>
    </Dialog>
  );
}
