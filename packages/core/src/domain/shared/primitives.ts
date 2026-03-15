import { z } from "zod";

export const IDENTIFIER_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const IdentifierSchema = z
  .string()
  .min(1)
  .regex(IDENTIFIER_REGEX, "must be snake/kebab alphanumeric id");

export const SemVerSchema = z.string().regex(SEMVER_REGEX, "must be semver (e.g. 1.0.0)");

export const ScalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([ScalarValueSchema, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

export const JsonRecordSchema = z.record(z.string(), JsonValueSchema);
