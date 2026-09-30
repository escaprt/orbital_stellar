/**
 * Maps raw `xdr.ScSpecEntry`/`xdr.ScSpecTypeDef` values (as embedded in a
 * deployed contract's WASM `contractspecv0` section, or as returned by
 * on-chain queries) to the canonical {@link ContractSpec} building blocks.
 *
 * Field mappings below were verified against real WASM binaries built from
 * `contracts/registry` and `contracts/demo-emitter` (soroban-sdk 27,
 * `#[contractimpl]`/`#[contractevent]`/`#[contracterror]`), not guessed -
 * see the discovery module's test fixtures.
 */

import type { xdr } from "@stellar/stellar-sdk";
import type {
  EventSpec,
  FieldSpec,
  FunctionSpec,
  TypeSpec,
  UnionCaseSpec,
  UserDefinedType,
} from "../spec.js";

export class UnsupportedSpecTypeError extends Error {
  constructor(typeName: string) {
    super(`Unsupported Soroban spec type for auto-discovery: "${typeName}"`);
    this.name = "UnsupportedSpecTypeError";
  }
}

function toStr(value: string | Buffer): string {
  return typeof value === "string" ? value : value.toString("utf-8");
}

function optionalDoc(value: string | Buffer): { doc: string } | Record<string, never> {
  const doc = toStr(value);
  return doc ? { doc } : {};
}

export function mapTypeDef(type: xdr.ScSpecTypeDef): TypeSpec {
  const name = type.switch().name;
  switch (name) {
    case "scSpecTypeBool":
      return "bool";
    case "scSpecTypeVoid":
      return "void";
    case "scSpecTypeU32":
      return "u32";
    case "scSpecTypeI32":
      return "i32";
    case "scSpecTypeU64":
      return "u64";
    case "scSpecTypeI64":
      return "i64";
    case "scSpecTypeU128":
      return "u128";
    case "scSpecTypeI128":
      return "i128";
    case "scSpecTypeU256":
      return "u256";
    case "scSpecTypeI256":
      return "i256";
    case "scSpecTypeBytes":
      return "bytes";
    case "scSpecTypeString":
      return "string";
    case "scSpecTypeSymbol":
      return "symbol";
    case "scSpecTypeAddress":
      return "address";
    // Timepoint/duration are u64-based semantic wrappers with no dedicated
    // PrimitiveType slot - represented by their underlying wire type.
    case "scSpecTypeTimepoint":
    case "scSpecTypeDuration":
      return "u64";
    // A muxed address is an address variant on the wire.
    case "scSpecTypeMuxedAddress":
      return "address";
    case "scSpecTypeOption":
      return { type: "option", inner: mapTypeDef(type.option().valueType()) };
    case "scSpecTypeResult": {
      const result = type.result();
      return {
        type: "result",
        ok: mapTypeDef(result.okType()),
        err: mapTypeDef(result.errorType()),
      };
    }
    case "scSpecTypeVec":
      return { type: "vec", item: mapTypeDef(type.vec().elementType()) };
    case "scSpecTypeMap": {
      const map = type.map();
      return { type: "map", key: mapTypeDef(map.keyType()), value: mapTypeDef(map.valueType()) };
    }
    case "scSpecTypeTuple": {
      const elements = type.tuple().valueTypes().map(mapTypeDef);
      // The unit type `()` encodes as an empty tuple on the wire (e.g. the
      // `Ok` arm of `Result<(), ...>`); it is void semantically.
      if (elements.length === 0) return "void";
      return { type: "tuple", elements };
    }
    case "scSpecTypeBytesN":
      return { type: "bytes_n", size: type.bytesN().n() };
    case "scSpecTypeUdt":
      return { type: "named", name: toStr(type.udt().name()) };
    // The generic error-value slot - see PrimitiveType's "error" doc comment
    // in spec.ts. Real, common: it's how Result<T, Error>'s err arm is
    // encoded regardless of which #[contracterror] enum is named.
    case "scSpecTypeError":
      return "error";
    // scSpecTypeVal (generic "any" ScVal) has no faithful representation in
    // our closed PrimitiveType set.
    case "scSpecTypeVal":
    default:
      throw new UnsupportedSpecTypeError(name);
  }
}

function mapField(name: string | Buffer, type: xdr.ScSpecTypeDef, doc: string | Buffer): FieldSpec {
  return { name: toStr(name), type: mapTypeDef(type), ...optionalDoc(doc) };
}

export function mapFunctionV0(fn: xdr.ScSpecFunctionV0): FunctionSpec {
  const outputs = fn.outputs();
  let returns: TypeSpec;
  if (outputs.length === 0) {
    returns = "void";
  } else if (outputs.length === 1) {
    returns = mapTypeDef(outputs[0]!);
  } else {
    // Not idiomatic Soroban, but syntactically valid in the XDR spec format.
    returns = { type: "tuple", elements: outputs.map(mapTypeDef) };
  }
  return {
    name: toStr(fn.name()),
    ...optionalDoc(fn.doc()),
    params: fn.inputs().map((input) => mapField(input.name(), input.type(), input.doc())),
    returns,
  };
}

export function mapUdtStructV0(struct: xdr.ScSpecUdtStructV0): UserDefinedType {
  return {
    kind: "struct",
    name: toStr(struct.name()),
    ...optionalDoc(struct.doc()),
    fields: struct.fields().map((f) => mapField(f.name(), f.type(), f.doc())),
  };
}

export function mapUdtEnumV0(en: xdr.ScSpecUdtEnumV0): UserDefinedType {
  return {
    kind: "enum",
    name: toStr(en.name()),
    ...optionalDoc(en.doc()),
    variants: en.cases().map((c) => ({
      name: toStr(c.name()),
      ...optionalDoc(c.doc()),
      discriminant: c.value(),
    })),
  };
}

export function mapUdtErrorEnumV0(en: xdr.ScSpecUdtErrorEnumV0): UserDefinedType {
  // Structurally identical to a C-style enum (name + numeric discriminant
  // cases) on the wire - #[contracterror] enums just carry a distinct
  // ScSpecEntry kind, so they map onto our `enum` UserDefinedType too.
  return {
    kind: "enum",
    name: toStr(en.name()),
    ...optionalDoc(en.doc()),
    variants: en.cases().map((c) => ({
      name: toStr(c.name()),
      ...optionalDoc(c.doc()),
      discriminant: c.value(),
    })),
  };
}

export function mapUdtUnionV0(union: xdr.ScSpecUdtUnionV0): UserDefinedType {
  return {
    kind: "union",
    name: toStr(union.name()),
    ...optionalDoc(union.doc()),
    cases: union.cases().map((c): UnionCaseSpec => {
      if (c.switch().name === "scSpecUdtUnionCaseVoidV0") {
        const voidCase = c.voidCase();
        return { name: toStr(voidCase.name()), ...optionalDoc(voidCase.doc()), fields: [] };
      }
      const tupleCase = c.tupleCase();
      return {
        name: toStr(tupleCase.name()),
        ...optionalDoc(tupleCase.doc()),
        // Tuple-case fields are unnamed on the wire - synthesize positional names.
        fields: tupleCase.type().map((t, i) => ({ name: `_${i}`, type: mapTypeDef(t) })),
      };
    }),
  };
}

export function mapEventV0(event: xdr.ScSpecEventV0): EventSpec {
  const prefixTopicFields: FieldSpec[] = event.prefixTopics().map((raw, i) => ({
    name: i === 0 ? "event_name" : `prefix_topic_${i}`,
    type: "symbol",
    doc: `Fixed prefix topic, always "${toStr(raw)}".`,
  }));

  const params = event.params();
  const topicParams = params.filter(
    (p) => p.location().name === "scSpecEventParamLocationTopicList",
  );
  const dataParams = params.filter((p) => p.location().name === "scSpecEventParamLocationData");

  return {
    name: toStr(event.name()),
    ...optionalDoc(event.doc()),
    topics: [
      ...prefixTopicFields,
      ...topicParams.map((p) => mapField(p.name(), p.type(), p.doc())),
    ],
    data: dataParams.map((p) => mapField(p.name(), p.type(), p.doc())),
  };
}

export type MappedEntries = {
  functions: FunctionSpec[];
  events: EventSpec[];
  types: Record<string, UserDefinedType>;
};

/** Dispatches each `ScSpecEntry` to its mapper and buckets the result by kind. */
export function mapSpecEntries(entries: xdr.ScSpecEntry[]): MappedEntries {
  const functions: FunctionSpec[] = [];
  const events: EventSpec[] = [];
  const types: Record<string, UserDefinedType> = {};

  for (const entry of entries) {
    switch (entry.switch().name) {
      case "scSpecEntryFunctionV0":
        functions.push(mapFunctionV0(entry.functionV0()));
        break;
      case "scSpecEntryEventV0":
        events.push(mapEventV0(entry.eventV0()));
        break;
      case "scSpecEntryUdtStructV0": {
        const udt = mapUdtStructV0(entry.udtStructV0());
        types[udt.name] = udt;
        break;
      }
      case "scSpecEntryUdtEnumV0": {
        const udt = mapUdtEnumV0(entry.udtEnumV0());
        types[udt.name] = udt;
        break;
      }
      case "scSpecEntryUdtErrorEnumV0": {
        const udt = mapUdtErrorEnumV0(entry.udtErrorEnumV0());
        types[udt.name] = udt;
        break;
      }
      case "scSpecEntryUdtUnionV0": {
        const udt = mapUdtUnionV0(entry.udtUnionV0());
        types[udt.name] = udt;
        break;
      }
    }
  }

  return { functions, events, types };
}
