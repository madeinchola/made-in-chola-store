import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LeafletMap from "./LeafletMap";

/**
 * Humo con Leaflet REAL en jsdom (sin layout, así que no se dibujan teselas): comprueba que el módulo se importa con la
 * forma UMD de Leaflet, que el mapa se crea y se destruye y que la atribución de OpenStreetMap queda en el DOM.
 */
describe("LeafletMap con Leaflet real", () => {
  it("crea el mapa, pone la atribución de OSM y el pin, y se desmonta sin errores", () => {
    const onPick = vi.fn();
    const { container, rerender, unmount } = render(
      <LeafletMap
        pin={{ lat: -16.5, lng: -68.15 }}
        center={{ lat: -16.5, lng: -68.15 }}
        zoom={12}
        focus={null}
        label="Mapa para ubicar la dirección"
        pinLabel="Pin de la dirección"
        onPick={onPick}
      />,
    );
    const map = screen.getByRole("application", { name: "Mapa para ubicar la dirección" });
    expect(map).toHaveClass("leaflet-container");
    expect(map).toHaveAttribute("tabindex", "0");
    // Atribución visible, con enlace a la licencia.
    const attribution = container.querySelector(".leaflet-control-attribution");
    expect(attribution?.textContent).toContain("© OpenStreetMap contributors");
    expect(
      attribution?.querySelector('a[href="https://www.openstreetmap.org/copyright"]'),
    ).not.toBeNull();
    // Controles de zoom con nombre accesible.
    expect(container.querySelector(".leaflet-control-zoom-in")).not.toBeNull();
    // El pin es un elemento enfocable con texto alternativo.
    const marker = container.querySelector("img.leaflet-marker-icon");
    expect(marker).toHaveAttribute("alt", "Pin de la dirección");
    expect(marker).toHaveAttribute("tabindex", "0");

    // Quitar el pin retira el marcador.
    rerender(
      <LeafletMap
        pin={null}
        center={{ lat: -16.5, lng: -68.15 }}
        zoom={12}
        focus={null}
        label="Mapa para ubicar la dirección"
        pinLabel="Pin de la dirección"
        onPick={onPick}
      />,
    );
    expect(container.querySelector("img.leaflet-marker-icon")).toBeNull();

    unmount();
    expect(container.querySelector(".leaflet-container")).toBeNull();
  });
});
