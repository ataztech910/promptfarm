import { z } from "zod";

export const VerdictSchema = z.enum(["pass", "fail"]);

export type Verdict = z.infer<typeof VerdictSchema>;
