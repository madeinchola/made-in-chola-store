import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PinText } from "./coords";
import { GeocoderError, type Geocoder, type GeocodeResult } from "./geocoder";
import type { LeafletMapProps } from "./LeafletMap";
import { IMPRECISE_METERS, LocationPicker, type MapLoader } from "./LocationPicker";
import leafletMapSource from "./LeafletMap.tsx?raw";
import pickerSource from "./LocationPicker.tsx?raw";

/** Mapa de mentira: expone lo que recibe y deja disparar lo que haría Leaflet. */
function FakeMap(props: LeafletMapProps) {
  return (
    <div
      data-testid="fake-map"
      data-pin={JSON.stringify(props.pin)}
      data-center={JSON.stringify(props.center)}
      data-zoom={props.zoom}
      data-focus={JSON.stringify(props.focus)}
      data-label={props.label}
      data-described-by={props.describedBy}
      data-pin-label={props.pinLabel}
    >
      <button type="button" onClick={() => props.onPick({ lat: -16.512345678, lng: -68.1 })}>
        fake-click
      </button>
      <button type="button" onClick={() => props.onPick({ lat: 10, lng: 190 })}>
        fake-click-far
      </button>
      <button type="button" onClick={() => props.onTilesFailing?.(true)}>
        fake-tiles-fail
      </button>
      <button type="button" onClick={() => props.onTilesFailing?.(false)}>
        fake-tiles-ok
      </button>
    </div>
  );
}
// «Thenable» que se resuelve al instante: React.lazy no llega a suspender, así que la mayoría de pruebas no esperan al mapa
// ni producen avisos de `act`. Las pruebas de carga lenta o fallida usan promesas reales.
const loadFake: MapLoader = () =>
  ({
    then: (resolve: (module: { default: typeof FakeMap }) => void) => resolve({ default: FakeMap }),
  }) as unknown as Promise<{ default: typeof FakeMap }>;

const map = () => screen.getByTestId("fake-map");
const mapPin = () => JSON.parse(map().dataset.pin ?? "null") as { lat: number; lng: number } | null;
const mapFocus = () =>
  JSON.parse(map().dataset.focus ?? "null") as {
    lat: number;
    lng: number;
    zoom: number;
    nonce: number;
  } | null;

function Harness({
  initial = { lat: "", lng: "" },
  geocoder,
  loadMap = loadFake,
  country,
  errors,
  onChangeSpy,
}: {
  initial?: PinText;
  geocoder?: Geocoder;
  loadMap?: MapLoader;
  country?: string;
  errors?: { lat?: string; lng?: string };
  onChangeSpy?: (value: PinText) => void;
}) {
  const [value, setValue] = useState<PinText>(initial);
  return (
    <LocationPicker
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
      loadMap={loadMap}
      {...(geocoder ? { geocoder } : {})}
      {...(country ? { country } : {})}
      {...(errors ? { errors } : {})}
    />
  );
}

const lat = () => screen.getByLabelText("Latitud") as HTMLInputElement;
const lng = () => screen.getByLabelText("Longitud") as HTMLInputElement;
const searchBox = () =>
  screen.getByRole("searchbox", { name: "Buscar un lugar" }) as HTMLInputElement;
const locateButton = () => screen.getByRole("button", { name: "Usar mi ubicación" });
const removeButton = () => screen.getByRole("button", { name: "Quitar pin" });

function fakeGeocoder(impl: Geocoder["search"] = async () => []) {
  const search = vi.fn(impl);
  return { geocoder: { search } as Geocoder, search };
}

const result = (id: string, label: string, latValue = -16.5, lngValue = -68.15): GeocodeResult => ({
  id,
  label,
  lat: latValue,
  lng: lngValue,
});

/** `navigator.geolocation` falso (jsdom no lo trae). */
function stubGeolocation(
  getCurrentPosition:
    ((ok: PositionCallback, fail: PositionErrorCallback, options?: PositionOptions) => void) | null,
) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: getCurrentPosition ? { getCurrentPosition: vi.fn(getCurrentPosition) } : undefined,
  });
  if (!getCurrentPosition) delete (navigator as { geolocation?: unknown }).geolocation;
  return navigator.geolocation as unknown as { getCurrentPosition: ReturnType<typeof vi.fn> };
}
const position = (latitude: number, longitude: number, accuracy: number) =>
  ({ coords: { latitude, longitude, accuracy } }) as GeolocationPosition;
const failure = (code: number) =>
  ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError;

beforeEach(() => {
  stubGeolocation(null);
});
afterEach(() => {
  delete (navigator as { geolocation?: unknown }).geolocation;
});

describe("LocationPicker · estructura y accesibilidad", () => {
  it("es una región con título, indica que el pin es opcional y muestra buscador, ubicación, mapa y coordenadas", async () => {
    render(<Harness />);
    const region = screen.getByRole("region", { name: "Ubicación en el mapa" });
    expect(
      within(region).getByText("Opcional. Si no la marcas, usaremos la referencia escrita."),
    ).toBeInTheDocument();
    expect(searchBox()).toBeInTheDocument();
    expect(locateButton()).toBeInTheDocument();
    expect(await screen.findByTestId("fake-map")).toBeInTheDocument();
    expect(lat()).toBeInTheDocument();
    expect(lng()).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Coordenadas" })).toBeInTheDocument();
  });

  it("el mapa recibe nombre accesible, instrucciones de teclado y texto alternativo del pin", async () => {
    render(<Harness />);
    await screen.findByTestId("fake-map");
    expect(map().dataset.label).toBe("Mapa para ubicar la dirección");
    expect(map().dataset.pinLabel).toBe("Pin de la dirección");
    const instructions = document.getElementById(map().dataset.describedBy ?? "");
    expect(instructions).toHaveTextContent("Toca el mapa o arrastra el pin");
    expect(instructions).toHaveTextContent("flechas");
    expect(instructions).toHaveTextContent("Intro para colocar el pin en el centro");
    expect(instructions).toHaveTextContent("También puedes escribir las coordenadas");
  });

  it("por defecto el mapa arranca en La Paz (−16.5, −68.15) con zoom 12; el centro es configurable", async () => {
    render(<Harness />);
    await screen.findByTestId("fake-map");
    expect(JSON.parse(map().dataset.center!)).toEqual({ lat: -16.5, lng: -68.15 });
    expect(map().dataset.zoom).toBe("12");
  });

  it("el mapa se carga bajo demanda: antes de llegar se ve «Cargando el mapa…» y el resto ya funciona", async () => {
    let release: (module: { default: typeof FakeMap }) => void = () => {};
    const slow: MapLoader = () => new Promise((resolve) => (release = resolve));
    const user = userEvent.setup();
    render(<Harness loadMap={slow} />);
    expect(screen.getByText("Cargando el mapa…")).toBeInTheDocument();
    expect(screen.queryByTestId("fake-map")).not.toBeInTheDocument();
    // Los campos numéricos ya se pueden usar sin el mapa.
    await user.type(lat(), "-16.5");
    expect(lat()).toHaveValue("-16.5");
    await act(async () => release({ default: FakeMap }));
    expect(screen.queryByText("Cargando el mapa…")).not.toBeInTheDocument();
    expect(map()).toBeInTheDocument();
  });

  it("la geolocalización viene EXPLICADA antes de usarla y el botón apunta a la explicación", () => {
    render(<Harness />);
    const help = screen.getByText(
      "Usamos tu ubicación solo para marcar el punto en el mapa. No se guarda hasta que guardes la dirección.",
    );
    expect(locateButton()).toHaveAttribute("aria-describedby", help.id);
  });

  it("los campos de coordenadas piden teclado decimal y no autocompletan", () => {
    render(<Harness />);
    for (const field of [lat(), lng()]) {
      expect(field).toHaveAttribute("inputmode", "decimal");
      expect(field).toHaveAttribute("autocomplete", "off");
    }
  });

  it("muestra los errores que le pasa el formulario junto a cada campo, enlazados", () => {
    render(
      <Harness
        initial={{ lat: "91", lng: "" }}
        errors={{ lat: "La latitud debe estar entre -90 y 90.", lng: "Falta la longitud" }}
      />,
    );
    expect(lat()).toHaveAttribute("aria-invalid", "true");
    expect(lat()).toHaveAccessibleDescription("La latitud debe estar entre -90 y 90.");
    expect(lng()).toHaveAttribute("aria-invalid", "true");
    expect(lng()).toHaveAccessibleDescription("Falta la longitud");
  });
});

describe("LocationPicker · campos numéricos sincronizados con el pin", () => {
  it("escribir ambos campos (con coma o punto) coloca el pin en el mapa", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId("fake-map");
    expect(mapPin()).toBeNull();
    await user.type(lat(), "-16,5");
    expect(mapPin()).toBeNull(); // con solo la latitud todavía no hay pin
    await user.type(lng(), "-68.15");
    expect(mapPin()).toEqual({ lat: -16.5, lng: -68.15 });
  });

  it("conserva el texto tal cual se escribe (no lo «corrige» mientras se teclea)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(lat(), "-16,");
    expect(lat()).toHaveValue("-16,");
  });

  it("un valor inválido o fuera de rango no mueve el pin", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lat: "-16.5", lng: "-68.15" }} />);
    await screen.findByTestId("fake-map");
    await user.clear(lat());
    await user.type(lat(), "95");
    expect(mapPin()).toBeNull();
    await user.clear(lat());
    await user.type(lat(), "abc");
    expect(mapPin()).toBeNull();
    await user.clear(lat());
    await user.type(lat(), "-17");
    expect(mapPin()).toEqual({ lat: -17, lng: -68.15 });
  });

  it("un pin inicial (editar una dirección) se ve en el mapa y el mapa arranca centrado en él", async () => {
    render(<Harness initial={{ lat: "-17.78", lng: "-63.18" }} />);
    await screen.findByTestId("fake-map");
    expect(mapPin()).toEqual({ lat: -17.78, lng: -63.18 });
  });

  it("al salir de un campo con un pin NUEVO el mapa se centra en él; pasar de largo sin cambiar nada no lo mueve", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId("fake-map");
    await user.type(lat(), "-16.5");
    await user.type(lng(), "-68.15");
    expect(mapFocus()).toBeNull();
    await user.tab(); // sale de la longitud
    const first = mapFocus();
    expect(first).toMatchObject({ lat: -16.5, lng: -68.15, zoom: 16 });
    await user.click(lat()); // vuelve a entrar y sale sin cambiar nada
    await user.tab();
    expect(mapFocus()?.nonce).toBe(first?.nonce);
  });

  it("salir de un campo con el pin inválido no centra nada", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId("fake-map");
    await user.type(lat(), "-16.5");
    await user.tab();
    expect(mapFocus()).toBeNull();
  });

  it("Intro en un campo numérico no busca ni coloca nada", async () => {
    const { geocoder, search } = fakeGeocoder();
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(lat(), "-16.5{Enter}");
    expect(search).not.toHaveBeenCalled();
  });
});

describe("LocationPicker · colocar el pin en el mapa", () => {
  it("un clic en el mapa rellena los campos con el punto redondeado a 6 decimales y lo anuncia con las coordenadas", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId("fake-map");
    await user.click(screen.getByRole("button", { name: "fake-click" }));
    expect(lat()).toHaveValue("-16.512346");
    expect(lng()).toHaveValue("-68.1");
    expect(mapPin()).toEqual({ lat: -16.512346, lng: -68.1 });
    expect(screen.getByRole("status", { name: "" })).toBeDefined();
    expect(
      screen.getByText("Pin colocado: latitud -16.512346, longitud -68.1."),
    ).toBeInTheDocument();
    // Un clic NO recentra el mapa (ya está donde la persona miró).
    expect(mapFocus()).toBeNull();
  });

  it("un punto más allá de ±180° se envuelve a la longitud válida (190 → −170)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId("fake-map");
    await user.click(screen.getByRole("button", { name: "fake-click-far" }));
    expect(lat()).toHaveValue("10");
    expect(lng()).toHaveValue("-170");
  });

  it("tras colocar el pin con el mapa, salir de un campo NO recentra el mapa", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId("fake-map");
    await user.click(screen.getByRole("button", { name: "fake-click" }));
    await user.click(lat());
    await user.tab();
    expect(mapFocus()).toBeNull();
  });
});

describe("LocationPicker · «Quitar pin»", () => {
  it("sin nada escrito el botón está desactivado con aria-disabled (no con disabled) y no hace nada", async () => {
    const onChangeSpy = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChangeSpy={onChangeSpy} />);
    expect(removeButton()).toHaveAttribute("aria-disabled", "true");
    expect(removeButton()).not.toBeDisabled();
    await user.click(removeButton());
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Pin quitado/)).not.toBeInTheDocument();
  });

  it("con pin: vacía ambos campos, quita el pin del mapa, lo anuncia y NO pierde el foco", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lat: "-16.5", lng: "-68.15" }} />);
    await screen.findByTestId("fake-map");
    expect(removeButton()).not.toHaveAttribute("aria-disabled", "true");
    await user.click(removeButton());
    expect(lat()).toHaveValue("");
    expect(lng()).toHaveValue("");
    expect(mapPin()).toBeNull();
    expect(
      screen.getByText("Pin quitado: la dirección se guardará sin ubicación en el mapa."),
    ).toBeInTheDocument();
    expect(removeButton()).toHaveFocus();
    expect(removeButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("también quita un pin a medias o inválido (texto suelto en un solo campo)", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lat: "abc", lng: "" }} />);
    expect(removeButton()).not.toHaveAttribute("aria-disabled", "true");
    await user.click(removeButton());
    expect(lat()).toHaveValue("");
  });

  it("tras quitarlo, escribir el MISMO punto vuelve a centrar el mapa", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lat: "-16.5", lng: "-68.15" }} />);
    await screen.findByTestId("fake-map");
    await user.click(removeButton());
    await user.type(lat(), "-16.5");
    await user.type(lng(), "-68.15");
    await user.tab();
    expect(mapFocus()).toMatchObject({ lat: -16.5, lng: -68.15 });
  });
});

describe("LocationPicker · «Usar mi ubicación»", () => {
  it("éxito preciso: coloca el pin, centra el mapa y lo confirma", async () => {
    const api = stubGeolocation((ok) => ok(position(-16.4897, -68.1193, 25)));
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId("fake-map");
    await user.click(locateButton());
    expect(api.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(lat()).toHaveValue("-16.4897");
    expect(lng()).toHaveValue("-68.1193");
    expect(mapPin()).toEqual({ lat: -16.4897, lng: -68.1193 });
    expect(mapFocus()).toMatchObject({ lat: -16.4897, lng: -68.1193, zoom: 16 });
    expect(screen.getByText("Marcamos tu ubicación en el mapa.")).toBeInTheDocument();
  });

  it("pide alta precisión, con un tiempo de espera de 10 s y caché de 1 minuto", async () => {
    const api = stubGeolocation((ok) => ok(position(1, 2, 10)));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(locateButton());
    expect(api.getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    });
  });

  it("ubicación imprecisa (> 500 m): coloca el pin pero AVISA de la precisión para afinarlo", async () => {
    expect(IMPRECISE_METERS).toBe(500);
    stubGeolocation((ok) => ok(position(-16.5, -68.15, 1234.6)));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(locateButton());
    expect(lat()).toHaveValue("-16.5");
    expect(
      screen.getByText(
        "Marcamos tu ubicación, pero es aproximada (± 1235 m). Arrastra el pin hasta el sitio exacto.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Marcamos tu ubicación en el mapa.")).not.toBeInTheDocument();
  });

  it("justo en el límite (500 m) todavía cuenta como precisa; 501 m no", async () => {
    stubGeolocation((ok) => ok(position(-16.5, -68.15, 500)));
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(locateButton());
    expect(screen.getByText("Marcamos tu ubicación en el mapa.")).toBeInTheDocument();
    unmount();
    stubGeolocation((ok) => ok(position(-16.5, -68.15, 501)));
    render(<Harness />);
    await user.click(locateButton());
    expect(screen.getByText(/aproximada \(± 501 m\)/)).toBeInTheDocument();
  });

  it.each([
    [
      1,
      "No tenemos permiso para ver tu ubicación. Puedes activarlo en los ajustes del navegador, buscar el lugar o marcarlo en el mapa.",
    ],
    [2, "No pudimos determinar tu ubicación. Busca el lugar o márcalo en el mapa."],
    [
      3,
      "Tu dispositivo tardó demasiado en responder. Inténtalo de nuevo o marca el punto en el mapa.",
    ],
  ])(
    "error de geolocalización %i → mensaje claro (alerta) y el pin queda como estaba",
    async (code, message) => {
      stubGeolocation((_ok, fail) => fail(failure(code)));
      const user = userEvent.setup();
      render(<Harness initial={{ lat: "-1", lng: "-2" }} />);
      await user.click(locateButton());
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(lat()).toHaveValue("-1");
      expect(lng()).toHaveValue("-2");
    },
  );

  it("tras un error se puede volver a intentar", async () => {
    let calls = 0;
    stubGeolocation((ok, fail) =>
      ++calls === 1 ? fail(failure(1)) : ok(position(-16.5, -68.15, 10)),
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(locateButton());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(locateButton());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(lat()).toHaveValue("-16.5");
  });

  it("navegador sin geolocalización → aviso claro; el resto sigue disponible", async () => {
    stubGeolocation(null);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(locateButton());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tu navegador no permite obtener la ubicación. Busca el lugar o márcalo en el mapa.",
    );
    await user.type(lat(), "-16.5");
    expect(lat()).toHaveValue("-16.5");
  });

  it("coordenadas no numéricas del dispositivo se tratan como «no disponible»", async () => {
    stubGeolocation((ok) => ok(position(Number.NaN, -68, 10)));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(locateButton());
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos determinar tu ubicación.");
    expect(lat()).toHaveValue("");
  });

  it("mientras espera: aria-disabled (no disabled), indicador y un segundo clic no lanza otra consulta", async () => {
    let finish: PositionCallback = () => {};
    const api = stubGeolocation((ok) => {
      finish = ok;
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(locateButton());
    expect(screen.getByText("Buscando tu ubicación…")).toBeInTheDocument();
    expect(locateButton()).toHaveAttribute("aria-disabled", "true");
    expect(locateButton()).toHaveAttribute("aria-busy", "true");
    expect(locateButton()).not.toBeDisabled();
    await user.click(locateButton());
    expect(api.getCurrentPosition).toHaveBeenCalledTimes(1);
    act(() => finish(position(-16.5, -68.15, 5)));
    expect(locateButton()).not.toHaveAttribute("aria-disabled");
    expect(lat()).toHaveValue("-16.5");
  });

  it("si el selector desaparece antes de la respuesta, no intenta tocar nada", async () => {
    let finish: PositionCallback = () => {};
    stubGeolocation((ok) => {
      finish = ok;
    });
    const onChangeSpy = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Harness onChangeSpy={onChangeSpy} />);
    await user.click(locateButton());
    unmount();
    act(() => finish(position(-16.5, -68.15, 5)));
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});

describe("LocationPicker · búsqueda por texto", () => {
  it("NO hay autocompletado: escribir no llama al geocodificador", async () => {
    const { geocoder, search } = fakeGeocoder();
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza Murillo La Paz");
    expect(search).not.toHaveBeenCalled();
  });

  it("Intro busca (una sola vez), con el texto recortado, el país y una señal de cancelación", async () => {
    const { geocoder, search } = fakeGeocoder(async () => [result("1", "Plaza Murillo, La Paz")]);
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} country="BO" />);
    await user.type(searchBox(), "  Plaza Murillo  {Enter}");
    expect(search).toHaveBeenCalledTimes(1);
    const [query, options] = search.mock.calls[0]!;
    expect(query).toBe("Plaza Murillo");
    expect(options).toMatchObject({ country: "BO" });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("el botón «Buscar» también busca", async () => {
    const { geocoder, search } = fakeGeocoder(async () => [result("1", "Plaza")]);
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("Intro en la búsqueda NO envía el formulario que contiene al selector", async () => {
    const { geocoder, search } = fakeGeocoder(async () => []);
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Harness geocoder={geocoder} />
        <button type="submit">Guardar</button>
      </form>,
    );
    await user.type(searchBox(), "Plaza{Enter}");
    expect(search).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("menos de 3 letras: avisa y no consulta", async () => {
    const { geocoder, search } = fakeGeocoder();
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "ab{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe al menos 3 letras para buscar.");
    expect(search).not.toHaveBeenCalled();
    await user.type(searchBox(), "   "); // los espacios no cuentan
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(search).not.toHaveBeenCalled();
  });

  it("exactamente 3 letras ya se buscan", async () => {
    const { geocoder, search } = fakeGeocoder();
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "abc{Enter}");
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("muestra los resultados como lista de botones y anuncia cuántos hay", async () => {
    const { geocoder } = fakeGeocoder(async () => [
      result("1", "Plaza Murillo, La Paz"),
      result("2", "Plaza Abaroa, La Paz"),
    ]);
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza{Enter}");
    const list = await screen.findByRole("list", { name: "Resultados de la búsqueda" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Plaza Murillo, La Paz", "Plaza Abaroa, La Paz"]);
    expect(
      screen.getByText("2 resultados. Elige uno para marcarlo en el mapa."),
    ).toBeInTheDocument();
  });

  it("un solo resultado usa el singular", async () => {
    const { geocoder } = fakeGeocoder(async () => [result("1", "Plaza Murillo")]);
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza{Enter}");
    expect(
      await screen.findByText("1 resultado. Elígelo para marcarlo en el mapa."),
    ).toBeInTheDocument();
  });

  it("elegir un resultado coloca el pin, centra el mapa, cierra la lista y devuelve el foco al buscador", async () => {
    const { geocoder } = fakeGeocoder(async () => [
      result("1", "Plaza Murillo", -16.4955, -68.1336),
    ]);
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await screen.findByTestId("fake-map");
    await user.type(searchBox(), "Plaza{Enter}");
    await user.click(await screen.findByRole("button", { name: "Plaza Murillo" }));
    expect(lat()).toHaveValue("-16.4955");
    expect(lng()).toHaveValue("-68.1336");
    expect(mapPin()).toEqual({ lat: -16.4955, lng: -68.1336 });
    expect(mapFocus()).toMatchObject({ lat: -16.4955, lng: -68.1336, zoom: 16 });
    expect(
      screen.queryByRole("list", { name: "Resultados de la búsqueda" }),
    ).not.toBeInTheDocument();
    expect(searchBox()).toHaveFocus();
    expect(
      screen.getByText("Punto marcado en el mapa. Arrastra el pin para afinarlo."),
    ).toBeInTheDocument();
  });

  it("los nombres se pintan como TEXTO: el HTML del geocodificador no se interpreta", async () => {
    const hostile = '<img src=x onerror="alert(1)"><b>negrita</b><script>window.hacked=1</script>';
    const { geocoder } = fakeGeocoder(async () => [result("1", hostile)]);
    const user = userEvent.setup();
    const { container } = render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza{Enter}");
    const button = await screen.findByRole("button", { name: hostile });
    expect(button.textContent).toBe(hostile);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it("sin coincidencias: mensaje claro (y se puede seguir)", async () => {
    const { geocoder } = fakeGeocoder(async () => []);
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "zzzzzz{Enter}");
    expect(
      await screen.findByText(
        "No encontramos ese lugar. Prueba con otro nombre o marca el punto en el mapa.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Resultados de la búsqueda" }),
    ).not.toBeInTheDocument();
    await user.type(lat(), "-16.5");
    expect(lat()).toHaveValue("-16.5");
  });

  it.each([
    [
      "rate_limited",
      "Hay muchas búsquedas ahora mismo. Espera unos segundos e inténtalo de nuevo, o marca el punto en el mapa.",
    ],
    [
      "timeout",
      "La búsqueda tardó demasiado. Inténtalo de nuevo, marca el punto en el mapa o escribe las coordenadas.",
    ],
    [
      "unavailable",
      "No pudimos buscar en este momento. Marca el punto en el mapa o escribe las coordenadas.",
    ],
    [
      "invalid_response",
      "No pudimos buscar en este momento. Marca el punto en el mapa o escribe las coordenadas.",
    ],
  ] as const)(
    "fallo %s → mensaje claro en una alerta, sin romper el formulario",
    async (kind, message) => {
      const { geocoder } = fakeGeocoder(async () => {
        throw new GeocoderError(kind);
      });
      const user = userEvent.setup();
      render(<Harness geocoder={geocoder} />);
      await user.type(searchBox(), "Plaza{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      // Se puede seguir: marcar a mano y escribir coordenadas.
      await user.type(lat(), "-16.5");
      expect(lat()).toHaveValue("-16.5");
    },
  );

  it("un error que no es del geocodificador también se muestra como «no disponible»", async () => {
    const { geocoder } = fakeGeocoder(async () => {
      throw new TypeError("raro");
    });
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos buscar en este momento.",
    );
  });

  it("mientras busca, el botón usa aria-disabled (no disabled) y un segundo envío se ignora", async () => {
    let finish: (results: GeocodeResult[]) => void = () => {};
    const { geocoder, search } = fakeGeocoder(() => new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza{Enter}");
    const button = screen.getByRole("button", { name: "Buscando…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toBeDisabled();
    await user.click(button);
    await user.type(searchBox(), "{Enter}");
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => finish([result("1", "Plaza")]));
    expect(screen.getByRole("button", { name: "Buscar" })).not.toHaveAttribute("aria-disabled");
  });

  it("cancela la búsqueda en curso al desmontar y no actualiza nada después", async () => {
    let signal: AbortSignal | undefined;
    let finish: (results: GeocodeResult[]) => void = () => {};
    const { geocoder } = fakeGeocoder((_query, options) => {
      signal = options?.signal;
      return new Promise((resolve) => (finish = resolve));
    });
    const user = userEvent.setup();
    const { unmount } = render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza{Enter}");
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish([result("1", "Plaza")]));
  });

  it("al escribir de nuevo se cierra la lista de resultados anterior", async () => {
    const { geocoder } = fakeGeocoder(async () => [result("1", "Plaza Murillo")]);
    const user = userEvent.setup();
    render(<Harness geocoder={geocoder} />);
    await user.type(searchBox(), "Plaza{Enter}");
    await screen.findByRole("list", { name: "Resultados de la búsqueda" });
    await user.type(searchBox(), "s");
    expect(
      screen.queryByRole("list", { name: "Resultados de la búsqueda" }),
    ).not.toBeInTheDocument();
  });

  it("el buscador es un rol «search» etiquetado y explica cómo se usa", () => {
    render(<Harness />);
    expect(screen.getByRole("search", { name: "Buscar un lugar" })).toBeInTheDocument();
    // La descripción incluye el aviso de privacidad: el texto y el mapa llegan a un tercero (OpenStreetMap)
    expect(searchBox()).toHaveAccessibleDescription(
      "Escribe el lugar y pulsa «Buscar» o Intro. La búsqueda y el mapa usan OpenStreetMap: lo que escribes aquí, el área que ves y tu dirección IP llegan a ese servicio.",
    );
  });
});

describe("LocationPicker · el mapa falla o no hay teselas", () => {
  const silence = () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  };
  afterEach(() => vi.restoreAllMocks());

  it("si el mapa no carga (sin conexión): alerta, reintento, y los campos numéricos siguen siendo una alternativa completa", async () => {
    silence();
    const loader = vi
      .fn<MapLoader>()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValue({ default: FakeMap });
    const user = userEvent.setup();
    render(<Harness loadMap={loader} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "No pudimos cargar el mapa. Puedes escribir las coordenadas o seguir sin pin: la referencia basta.",
    );
    // El resto del selector sigue vivo.
    await user.type(lat(), "-16.5");
    await user.type(lng(), "-68.15");
    expect(lat()).toHaveValue("-16.5");
    // Reintentar vuelve a cargar y el pin escrito ya se ve.
    await user.click(screen.getByRole("button", { name: "Reintentar el mapa" }));
    expect(await screen.findByTestId("fake-map")).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(mapPin()).toEqual({ lat: -16.5, lng: -68.15 });
    expect(lat()).toHaveValue("-16.5"); // lo escrito sobrevivió
  });

  it("si las teselas fallan avisa (estado) sin quitar nada, y lo oculta al recuperarse", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId("fake-map");
    const message =
      "Las imágenes del mapa no cargan (¿sin conexión?). La búsqueda y las coordenadas siguen funcionando.";
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "fake-tiles-fail" }));
    expect(screen.getByText(message)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "fake-tiles-ok" }));
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });
});

describe("LocationPicker · carga diferida (Leaflet fuera del chunk principal)", () => {
  it("el módulo del selector no importa Leaflet: el mapa solo entra por import() dinámico", () => {
    const source = pickerSource;
    // Solo importaciones de TIPOS desde LeafletMap (se borran al compilar); la real es dinámica.
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"\.\/LeafletMap"/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const match of imports) expect(match[1]).toBe("type ");
    expect(source).toContain('import("./LeafletMap")');
    expect(source).not.toMatch(/from\s+"leaflet"/);
    expect(source).not.toMatch(/leaflet\.css/);
  });

  it("el CSS de Leaflet se importa dentro del módulo del mapa", () => {
    const source = leafletMapSource;
    expect(source).toContain('import "leaflet/dist/leaflet.css"');
    expect(source).toMatch(/marker-icon\.png\?url/);
    expect(source).toMatch(/marker-icon-2x\.png\?url/);
    expect(source).toMatch(/marker-shadow\.png\?url/);
  });
});

describe("LocationPicker · integración básica con waitFor", () => {
  it("un pin cambiado desde fuera (otro valor controlado) se refleja en campos y mapa", async () => {
    function Outer() {
      const [value, setValue] = useState<PinText>({ lat: "", lng: "" });
      return (
        <>
          <button type="button" onClick={() => setValue({ lat: "-17.4", lng: "-66.1" })}>
            cargar
          </button>
          <LocationPicker value={value} onChange={setValue} loadMap={loadFake} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Outer />);
    await screen.findByTestId("fake-map");
    await user.click(screen.getByRole("button", { name: "cargar" }));
    await waitFor(() => expect(mapPin()).toEqual({ lat: -17.4, lng: -66.1 }));
    expect(lat()).toHaveValue("-17.4");
  });
});
