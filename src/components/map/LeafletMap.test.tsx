import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeafletMap, { type LeafletMapProps } from "./LeafletMap";

/**
 * jsdom no tiene layout (sin tamaños no se pintan teselas), así que Leaflet se simula: lo que se comprueba es el CABLEADO
 * (qué teselas, qué opciones, qué eventos y cuándo se llama a cada cosa), no el dibujo.
 */
const fake = vi.hoisted(() => {
  type Handler = (event?: unknown) => void;
  class Evented {
    handlers = new Map<string, Handler[]>();
    on(name: string, handler: Handler) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
      return this;
    }
    fire(name: string, event?: unknown) {
      for (const handler of this.handlers.get(name) ?? []) handler(event);
    }
  }
  class FakeMap extends Evented {
    removed = false;
    zoom: number;
    centerValue: { lat: number; lng: number };
    setView = vi.fn();
    invalidateSize = vi.fn();
    attributionControl = { setPrefix: vi.fn() };
    constructor(
      public container: HTMLElement,
      public options: { center: [number, number]; zoom: number } & Record<string, unknown>,
    ) {
      super();
      this.zoom = options.zoom;
      this.centerValue = { lat: options.center[0], lng: options.center[1] };
      container.setAttribute("tabindex", "0"); // Leaflet lo hace con `keyboard: true`
    }
    getContainer() {
      return this.container;
    }
    getCenter() {
      return this.centerValue;
    }
    getZoom() {
      return this.zoom;
    }
    remove = vi.fn(() => {
      this.removed = true;
    });
  }
  class FakeTileLayer extends Evented {
    map: FakeMap | null = null;
    constructor(
      public url: string,
      public options: Record<string, unknown>,
    ) {
      super();
    }
    addTo(map: FakeMap) {
      this.map = map;
      return this;
    }
  }
  class FakeMarker extends Evented {
    removed = false;
    constructor(
      public position: { lat: number; lng: number },
      public options: Record<string, unknown>,
    ) {
      super();
    }
    addTo = vi.fn(() => this);
    getLatLng() {
      return this.position;
    }
    setLatLng = vi.fn((value: [number, number]) => {
      this.position = { lat: value[0], lng: value[1] };
      return this;
    });
    remove = vi.fn(() => {
      this.removed = true;
    });
  }
  const state = {
    maps: [] as FakeMap[],
    tiles: [] as FakeTileLayer[],
    markers: [] as FakeMarker[],
    zoomControls: [] as { options: Record<string, unknown>; addTo: ReturnType<typeof vi.fn> }[],
    mergeOptions: vi.fn(),
  };
  class DefaultIcon {
    static mergeOptions(options: unknown) {
      state.mergeOptions(options);
    }
    _getIconUrl = () => "x";
  }
  const L = {
    map: (container: HTMLElement, options: FakeMap["options"]) => {
      const map = new FakeMap(container, options);
      state.maps.push(map);
      return map;
    },
    tileLayer: (url: string, options: Record<string, unknown>) => {
      const layer = new FakeTileLayer(url, options);
      state.tiles.push(layer);
      return layer;
    },
    marker: (latlng: [number, number], options: Record<string, unknown>) => {
      const marker = new FakeMarker({ lat: latlng[0], lng: latlng[1] }, options);
      state.markers.push(marker);
      return marker;
    },
    Icon: { Default: DefaultIcon },
    control: {
      zoom: (options: Record<string, unknown>) => {
        const control = { options, addTo: vi.fn(() => control) };
        state.zoomControls.push(control);
        return control;
      },
    },
  };
  return { L, state };
});
// Leaflet es UMD: se ofrece como `default` (la forma que da Node) y se comprueba que el módulo la admite.
vi.mock("leaflet", () => ({ default: fake.L }));

const baseProps = (over: Partial<LeafletMapProps> = {}): LeafletMapProps => ({
  pin: null,
  center: { lat: -16.5, lng: -68.15 },
  zoom: 12,
  focus: null,
  label: "Mapa para ubicar la dirección",
  describedBy: "instrucciones",
  pinLabel: "Pin de la dirección",
  onPick: vi.fn(),
  ...over,
});

const lastMap = () => fake.state.maps.at(-1)!;
const lastMarker = () => fake.state.markers.at(-1)!;

beforeEach(() => {
  fake.state.maps.length = 0;
  fake.state.tiles.length = 0;
  fake.state.markers.length = 0;
  fake.state.zoomControls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LeafletMap · controles en español", () => {
  it("no usa el control de zoom de fábrica (en inglés) y pone el suyo con títulos en español", () => {
    render(<LeafletMap {...baseProps()} />);
    expect(lastMap().options.zoomControl).toBe(false);
    expect(fake.state.zoomControls).toHaveLength(1);
    expect(fake.state.zoomControls[0]!.options).toMatchObject({
      position: "topleft",
      zoomInTitle: "Acercar el mapa",
      zoomOutTitle: "Alejar el mapa",
    });
    expect(fake.state.zoomControls[0]!.addTo).toHaveBeenCalledWith(lastMap());
  });

  it("el crédito de Leaflet va en español, con enlace seguro y sin el texto en inglés de fábrica", () => {
    render(<LeafletMap {...baseProps()} />);
    const prefix = lastMap().attributionControl.setPrefix.mock.calls[0]![0] as string;
    expect(prefix).toContain('href="https://leafletjs.com"');
    expect(prefix).toContain('rel="noopener noreferrer"');
    expect(prefix).toContain('title="Leaflet: biblioteca de mapas interactivos"');
    expect(prefix).not.toContain("JavaScript library");
  });
});

describe("LeafletMap · teselas y atribución (política de OpenStreetMap)", () => {
  it("usa las teselas de tile.openstreetmap.org con zoom máximo 19", () => {
    render(<LeafletMap {...baseProps()} />);
    expect(fake.state.tiles).toHaveLength(1);
    expect(fake.state.tiles[0]?.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(fake.state.tiles[0]?.options.maxZoom).toBe(19);
    expect(fake.state.tiles[0]?.map).toBe(lastMap());
  });

  it("la atribución «© OpenStreetMap contributors» enlaza a la licencia", () => {
    render(<LeafletMap {...baseProps()} />);
    const attribution = String(fake.state.tiles[0]?.options.attribution);
    expect(attribution).toContain("&copy;");
    expect(attribution).toContain("OpenStreetMap");
    expect(attribution).toContain("contributors");
    expect(attribution).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(attribution).toContain('rel="noopener noreferrer"');
  });
});

describe("LeafletMap · creación del mapa", () => {
  it("sin pin: centra en el centro dado con el zoom dado", () => {
    render(<LeafletMap {...baseProps()} />);
    expect(lastMap().options.center).toEqual([-16.5, -68.15]);
    expect(lastMap().options.zoom).toBe(12);
  });

  it("con pin: empieza centrado en el pin con zoom 16", () => {
    render(<LeafletMap {...baseProps({ pin: { lat: -17.78, lng: -63.18 } })} />);
    expect(lastMap().options.center).toEqual([-17.78, -63.18]);
    expect(lastMap().options.zoom).toBe(16);
  });

  it("teclado activo y rueda del ratón SIN zoom (no secuestra el scroll de la página)", () => {
    render(<LeafletMap {...baseProps()} />);
    expect(lastMap().options.keyboard).toBe(true);
    expect(lastMap().options.scrollWheelZoom).toBe(false);
  });

  it("con movimiento normal deja activas las animaciones de Leaflet", () => {
    render(<LeafletMap {...baseProps()} />);
    expect(lastMap().options).toMatchObject({
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      inertia: true,
    });
  });

  it("con «reducir movimiento» apaga las animaciones que mueve JavaScript (zoom, desvanecido, inercia)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    render(<LeafletMap {...baseProps()} />);
    expect(lastMap().options).toMatchObject({
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
    });
  });

  it("se crea un solo mapa por montaje y se destruye al desmontar", () => {
    const { rerender, unmount } = render(<LeafletMap {...baseProps()} />);
    rerender(<LeafletMap {...baseProps({ label: "Otro nombre" })} />);
    expect(fake.state.maps).toHaveLength(1);
    unmount();
    expect(lastMap().remove).toHaveBeenCalledTimes(1);
  });

  it("corrige los iconos por defecto con las imágenes del paquete resueltas por Vite (sin CDN)", () => {
    render(<LeafletMap {...baseProps()} />);
    expect(fake.state.mergeOptions).toHaveBeenCalledTimes(1);
    const options = fake.state.mergeOptions.mock.calls[0]?.[0] as Record<string, string>;
    expect(options.iconUrl).toMatch(/marker-icon\.png/);
    expect(options.iconRetinaUrl).toMatch(/marker-icon-2x\.png/);
    expect(options.shadowUrl).toMatch(/marker-shadow\.png/);
    for (const url of Object.values(options)) expect(url).not.toMatch(/^https?:\/\//);
  });

  it("al cambiar el tamaño del contenedor se recalcula el mapa (cajón que se abre, móvil que gira)", () => {
    let notify: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    render(<LeafletMap {...baseProps()} />);
    expect(lastMap().invalidateSize).not.toHaveBeenCalled();
    notify();
    expect(lastMap().invalidateSize).toHaveBeenCalledTimes(1);
  });
});

describe("LeafletMap · limpieza", () => {
  it("al desmontar deja de observar el tamaño del contenedor", () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
        unobserve() {}
      },
    );
    const { unmount } = render(<LeafletMap {...baseProps()} />);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(expect.any(HTMLElement));
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("LeafletMap · accesibilidad del mapa", () => {
  it("el contenedor enfocable tiene rol, nombre y las instrucciones de teclado", () => {
    render(<LeafletMap {...baseProps()} />);
    const root = lastMap().getContainer();
    expect(root).toHaveAttribute("role", "application");
    expect(root).toHaveAttribute("aria-label", "Mapa para ubicar la dirección");
    expect(root).toHaveAttribute("aria-describedby", "instrucciones");
    expect(root).toHaveAttribute("tabindex", "0");
  });

  it("sin instrucciones no deja un aria-describedby colgando", () => {
    render(<LeafletMap {...baseProps({ describedBy: undefined })} />);
    expect(lastMap().getContainer()).not.toHaveAttribute("aria-describedby");
  });

  it("el nombre se actualiza si cambia", () => {
    const { rerender } = render(<LeafletMap {...baseProps()} />);
    rerender(<LeafletMap {...baseProps({ label: "Mapa de entrega" })} />);
    expect(lastMap().getContainer()).toHaveAttribute("aria-label", "Mapa de entrega");
  });
});

describe("LeafletMap · colocar el pin", () => {
  it("un clic en el mapa avisa con las coordenadas del clic", () => {
    const onPick = vi.fn();
    render(<LeafletMap {...baseProps({ onPick })} />);
    lastMap().fire("click", { latlng: { lat: -16.51, lng: -68.12 } });
    expect(onPick).toHaveBeenCalledWith({ lat: -16.51, lng: -68.12 });
  });

  it("Intro con el MAPA enfocado coloca el pin en el centro", () => {
    const onPick = vi.fn();
    render(<LeafletMap {...baseProps({ onPick })} />);
    const root = lastMap().getContainer();
    lastMap().centerValue = { lat: -16.6, lng: -68.2 };
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ lat: -16.6, lng: -68.2 });
  });

  it("otras teclas no hacen nada, ni Intro sobre un hijo (el pin, un control)", () => {
    const onPick = vi.fn();
    render(<LeafletMap {...baseProps({ onPick })} />);
    const root = lastMap().getContainer();
    for (const key of ["ArrowUp", "+", "-", " ", "Escape"]) {
      root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    const child = document.createElement("button");
    root.appendChild(child);
    child.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Intro con el mapa enfocado no se propaga como «enviar formulario» (se cancela el evento)", () => {
    render(<LeafletMap {...baseProps()} />);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    lastMap().getContainer().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("al desmontar se quitan los manejadores del teclado", () => {
    const onPick = vi.fn();
    const { unmount } = render(<LeafletMap {...baseProps({ onPick })} />);
    const root = lastMap().getContainer();
    unmount();
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("los manejadores usan siempre la ÚLTIMA función onPick (el mapa no se recrea)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<LeafletMap {...baseProps({ onPick: first })} />);
    rerender(<LeafletMap {...baseProps({ onPick: second })} />);
    lastMap().fire("click", { latlng: { lat: 1, lng: 2 } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ lat: 1, lng: 2 });
    expect(fake.state.maps).toHaveLength(1);
  });
});

describe("LeafletMap · el pin", () => {
  it("sin pin no hay marcador", () => {
    render(<LeafletMap {...baseProps()} />);
    expect(fake.state.markers).toHaveLength(0);
  });

  it("con pin: marcador arrastrable, enfocable con teclado y con texto alternativo", () => {
    render(<LeafletMap {...baseProps({ pin: { lat: -16.5, lng: -68.15 } })} />);
    expect(fake.state.markers).toHaveLength(1);
    expect(lastMarker().position).toEqual({ lat: -16.5, lng: -68.15 });
    expect(lastMarker().options).toMatchObject({
      draggable: true,
      keyboard: true,
      alt: "Pin de la dirección",
      title: "Pin de la dirección",
    });
    expect(lastMarker().addTo).toHaveBeenCalledWith(lastMap());
  });

  it("al soltar el pin arrastrado avisa con su posición final", () => {
    const onPick = vi.fn();
    render(<LeafletMap {...baseProps({ pin: { lat: -16.5, lng: -68.15 }, onPick })} />);
    lastMarker().position = { lat: -16.7, lng: -68.3 }; // lo arrastró la persona
    lastMarker().fire("dragend");
    expect(onPick).toHaveBeenCalledWith({ lat: -16.7, lng: -68.3 });
  });

  it("si el pin cambia (campos numéricos, búsqueda) mueve el MISMO marcador, sin crear otro", () => {
    const { rerender } = render(
      <LeafletMap {...baseProps({ pin: { lat: -16.5, lng: -68.15 } })} />,
    );
    rerender(<LeafletMap {...baseProps({ pin: { lat: -17, lng: -63 } })} />);
    expect(fake.state.markers).toHaveLength(1);
    expect(lastMarker().setLatLng).toHaveBeenCalledTimes(1);
    expect(lastMarker().setLatLng).toHaveBeenCalledWith([-17, -63]);
  });

  it("no reposiciona el marcador si ya está donde dice el pin (el arrastre no se «rebota»)", () => {
    const { rerender } = render(
      <LeafletMap {...baseProps({ pin: { lat: -16.5, lng: -68.15 } })} />,
    );
    lastMarker().position = { lat: -16.7, lng: -68.3 }; // arrastrado…
    rerender(<LeafletMap {...baseProps({ pin: { lat: -16.7, lng: -68.3 } })} />); // …y el formulario lo confirma
    expect(lastMarker().setLatLng).not.toHaveBeenCalled();
  });

  it("cambiar solo la longitud también mueve el marcador", () => {
    const { rerender } = render(
      <LeafletMap {...baseProps({ pin: { lat: -16.5, lng: -68.15 } })} />,
    );
    rerender(<LeafletMap {...baseProps({ pin: { lat: -16.5, lng: -68.2 } })} />);
    expect(lastMarker().setLatLng).toHaveBeenCalledWith([-16.5, -68.2]);
  });

  it("al quitar el pin se quita el marcador, y al volver a ponerlo se crea uno nuevo", () => {
    const { rerender } = render(
      <LeafletMap {...baseProps({ pin: { lat: -16.5, lng: -68.15 } })} />,
    );
    const first = lastMarker();
    rerender(<LeafletMap {...baseProps({ pin: null })} />);
    expect(first.remove).toHaveBeenCalledTimes(1);
    rerender(<LeafletMap {...baseProps({ pin: { lat: -16.4, lng: -68.1 } })} />);
    expect(fake.state.markers).toHaveLength(2);
    expect(lastMarker()).not.toBe(first);
    expect(lastMarker().position).toEqual({ lat: -16.4, lng: -68.1 });
  });

  it("un pin que aparece después de crear el mapa también se dibuja", () => {
    const { rerender } = render(<LeafletMap {...baseProps()} />);
    rerender(<LeafletMap {...baseProps({ pin: { lat: -16.5, lng: -68.15 } })} />);
    expect(fake.state.markers).toHaveLength(1);
  });
});

describe("LeafletMap · centrar a petición", () => {
  it("una petición mueve el mapa al punto, con animación", () => {
    const { rerender } = render(<LeafletMap {...baseProps()} />);
    rerender(
      <LeafletMap {...baseProps({ focus: { lat: -16.49, lng: -68.13, zoom: 16, nonce: 1 } })} />,
    );
    expect(lastMap().setView).toHaveBeenCalledTimes(1);
    expect(lastMap().setView).toHaveBeenCalledWith([-16.49, -68.13], 16, { animate: true });
  });

  it("nunca ALEJA: si la persona ya acercó más que el zoom pedido, lo conserva", () => {
    const { rerender } = render(<LeafletMap {...baseProps()} />);
    lastMap().zoom = 18;
    rerender(<LeafletMap {...baseProps({ focus: { lat: 1, lng: 2, zoom: 16, nonce: 1 } })} />);
    expect(lastMap().setView).toHaveBeenCalledWith([1, 2], 18, { animate: true });
  });

  it("si el mapa está lejos, acerca hasta el zoom pedido; sin zoom pedido usa 16", () => {
    const { rerender } = render(<LeafletMap {...baseProps()} />);
    rerender(<LeafletMap {...baseProps({ focus: { lat: 1, lng: 2, nonce: 1 } })} />);
    expect(lastMap().setView).toHaveBeenCalledWith([1, 2], 16, { animate: true });
  });

  it("re-renderizar con la MISMA petición no vuelve a mover el mapa; una nueva (otro nonce) sí", () => {
    const { rerender } = render(<LeafletMap {...baseProps()} />);
    rerender(<LeafletMap {...baseProps({ focus: { lat: 1, lng: 2, zoom: 16, nonce: 1 } })} />);
    rerender(<LeafletMap {...baseProps({ focus: { lat: 1, lng: 2, zoom: 16, nonce: 1 } })} />);
    expect(lastMap().setView).toHaveBeenCalledTimes(1);
    rerender(<LeafletMap {...baseProps({ focus: { lat: 1, lng: 2, zoom: 16, nonce: 2 } })} />);
    expect(lastMap().setView).toHaveBeenCalledTimes(2);
  });

  it("con «reducir movimiento» no anima", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { rerender } = render(<LeafletMap {...baseProps()} />);
    rerender(<LeafletMap {...baseProps({ focus: { lat: 1, lng: 2, zoom: 16, nonce: 1 } })} />);
    expect(lastMap().setView).toHaveBeenCalledWith([1, 2], 16, { animate: false });
  });
});

describe("LeafletMap · teselas que no cargan", () => {
  it("avisa UNA vez al fallar (aunque fallen muchas) y avisa al recuperarse", () => {
    const onTilesFailing = vi.fn();
    render(<LeafletMap {...baseProps({ onTilesFailing })} />);
    const tiles = fake.state.tiles[0]!;
    tiles.fire("tileload");
    expect(onTilesFailing).not.toHaveBeenCalled(); // cargar bien al principio no es noticia
    tiles.fire("tileerror");
    tiles.fire("tileerror");
    tiles.fire("tileerror");
    expect(onTilesFailing).toHaveBeenCalledTimes(1);
    expect(onTilesFailing).toHaveBeenLastCalledWith(true);
    tiles.fire("tileload");
    tiles.fire("tileload");
    expect(onTilesFailing).toHaveBeenCalledTimes(2);
    expect(onTilesFailing).toHaveBeenLastCalledWith(false);
  });

  it("sin manejador no falla", () => {
    render(<LeafletMap {...baseProps()} />);
    expect(() => fake.state.tiles[0]?.fire("tileerror")).not.toThrow();
  });
});
