import { describe, it, expect } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { mapTypeDef, mapUdtUnionV0 } from "../../src/discovery/xdrToSpec.js";

describe("mapTypeDef - composite and edge-case types not covered by the real WASM fixtures", () => {
  it("maps map<K,V>", () => {
    const type = xdr.ScSpecTypeDef.scSpecTypeMap(
      new xdr.ScSpecTypeMap({
        keyType: xdr.ScSpecTypeDef.scSpecTypeString(),
        valueType: xdr.ScSpecTypeDef.scSpecTypeU64(),
      }),
    );
    expect(mapTypeDef(type)).toEqual({ type: "map", key: "string", value: "u64" });
  });

  it("maps tuple<...>", () => {
    const type = xdr.ScSpecTypeDef.scSpecTypeTuple(
      new xdr.ScSpecTypeTuple({
        valueTypes: [xdr.ScSpecTypeDef.scSpecTypeU32(), xdr.ScSpecTypeDef.scSpecTypeBool()],
      }),
    );
    expect(mapTypeDef(type)).toEqual({ type: "tuple", elements: ["u32", "bool"] });
  });

  it("maps muxed address to address", () => {
    expect(mapTypeDef(xdr.ScSpecTypeDef.scSpecTypeMuxedAddress())).toBe("address");
  });

  it("maps timepoint and duration to u64", () => {
    expect(mapTypeDef(xdr.ScSpecTypeDef.scSpecTypeTimepoint())).toBe("u64");
    expect(mapTypeDef(xdr.ScSpecTypeDef.scSpecTypeDuration())).toBe("u64");
  });

  it("maps the generic error slot to the error primitive", () => {
    expect(mapTypeDef(xdr.ScSpecTypeDef.scSpecTypeError())).toBe("error");
  });

  it("maps the generic Val slot to the val primitive", () => {
    expect(mapTypeDef(xdr.ScSpecTypeDef.scSpecTypeVal())).toBe("val");
  });

  it("maps the empty tuple (Rust unit) to void", () => {
    const type = xdr.ScSpecTypeDef.scSpecTypeTuple(new xdr.ScSpecTypeTuple({ valueTypes: [] }));
    expect(mapTypeDef(type)).toBe("void");
  });

  it("recurses through nested composites: Option<Vec<Address>>", () => {
    const type = xdr.ScSpecTypeDef.scSpecTypeOption(
      new xdr.ScSpecTypeOption({
        valueType: xdr.ScSpecTypeDef.scSpecTypeVec(
          new xdr.ScSpecTypeVec({ elementType: xdr.ScSpecTypeDef.scSpecTypeAddress() }),
        ),
      }),
    );
    expect(mapTypeDef(type)).toEqual({ type: "option", inner: { type: "vec", item: "address" } });
  });
});

describe("mapUdtUnionV0 - Rust enum-with-data (union) cases not present in the real fixtures", () => {
  it("maps a void (unit) case and a tuple (data-carrying) case", () => {
    const union = new xdr.ScSpecUdtUnionV0({
      doc: "A union-style UDT",
      lib: "",
      name: "Shape",
      cases: [
        xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
          new xdr.ScSpecUdtUnionCaseVoidV0({ doc: "no data", name: "None" }),
        ),
        xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseTupleV0(
          new xdr.ScSpecUdtUnionCaseTupleV0({
            doc: "carries a radius and a label",
            name: "Circle",
            type: [xdr.ScSpecTypeDef.scSpecTypeU32(), xdr.ScSpecTypeDef.scSpecTypeString()],
          }),
        ),
      ],
    });

    const mapped = mapUdtUnionV0(union);
    expect(mapped).toEqual({
      kind: "union",
      name: "Shape",
      doc: "A union-style UDT",
      cases: [
        { name: "None", doc: "no data", fields: [] },
        {
          name: "Circle",
          doc: "carries a radius and a label",
          fields: [
            { name: "_0", type: "u32" },
            { name: "_1", type: "string" },
          ],
        },
      ],
    });
  });
});
