// Aperture charges the prices in aperture.yaml; the shop only shows the ones in catalog.ts.
import { expect, test } from "bun:test";
import { catalog } from "../src/catalog";

const { services } = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/aperture.yaml`).text()) as {
  services: { name: string; pathregexp: string; price: number }[];
};

test("aperture.yaml sells exactly the catalog at the catalog's sats prices", () => {
  expect(services.map((s) => [s.name, s.pathregexp, s.price])).toEqual(
    catalog.map((i) => [i.id, `^/l402/${i.id}$`, i.sats]),
  );
});

test("item prices are distinct: the beamer checkout names a purchase by its amount", () => {
  expect(new Set(catalog.map((i) => i.sats)).size).toBe(catalog.length);
});
