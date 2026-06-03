export interface FeignMethod {
  name: string;
  httpMethod?: string;
  path?: string;
  operationSummary?: string;
}

export interface FeignInterface {
  name: string;
  clientRef: string;
  methods: FeignMethod[];
}

const INTERFACE_RE = /(?:public\s+)?interface\s+(\w+)/;
const FEIGN_SHORTHAND_RE = /@FeignClient\s*\(\s*"([^"]+)"\s*\)/;
const FEIGN_LITERAL_RE =
  /@FeignClient\s*\([^)]*(?:name|value)\s*=\s*"([^"]+)"[^)]*\)/;
const FEIGN_CONST_RE =
  /@FeignClient\s*\([^)]*(?:name|value)\s*=\s*([^"),\s]+)[^)]*\)/;
const MAPPING_RE =
  /@(Get|Post|Put|Patch|Delete)Mapping\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']+)["'])?/g;
const OPERATION_SUMMARY_RE =
  /@Operation\s*\([^)]*summary\s*=\s*["']([^"']+)["']/;
const METHOD_NAME_RE = /(\w+)\s*\([^;{]*\)\s*;/g;

function extractClientRef(content: string): string | null {
  const shorthand = content.match(FEIGN_SHORTHAND_RE);
  if (shorthand) return shorthand[1];

  const literal = content.match(FEIGN_LITERAL_RE);
  if (literal) return literal[1];

  const constant = content.match(FEIGN_CONST_RE);
  if (constant) return constant[1].trim();

  return null;
}

function extractMethods(content: string): FeignMethod[] {
  const methods: FeignMethod[] = [];
  const mappingMatches = [...content.matchAll(MAPPING_RE)];

  for (let i = 0; i < mappingMatches.length; i++) {
    const m = mappingMatches[i];
    const httpMethod = m[1].toUpperCase();
    const mappingPath = m[2] ?? "";

    const afterMapping = content.slice(m.index ?? 0);
    const opMatch = afterMapping.match(OPERATION_SUMMARY_RE);
    const operationSummary = opMatch?.[1];

    const methodBody = afterMapping.slice(0, 400);
    const nameMatch = methodBody.match(METHOD_NAME_RE);
    const name = nameMatch?.[1] ?? `method${i + 1}`;

    methods.push({
      name,
      httpMethod,
      path: mappingPath,
      operationSummary,
    });
  }

  return methods;
}

export function parseFeignInterface(content: string): FeignInterface | null {
  if (!content.includes("@FeignClient")) return null;

  const ifaceMatch = content.match(INTERFACE_RE);
  if (!ifaceMatch) return null;

  const clientRef = extractClientRef(content);
  if (!clientRef) return null;

  return {
    name: ifaceMatch[1],
    clientRef,
    methods: extractMethods(content),
  };
}
